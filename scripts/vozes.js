'use strict'
// Vozes Piper: catálogo oficial (rhasspy/piper-voices), vozes instaladas, downloads verificados
// (MD5 do catálogo) e a escolha da voz para cada frase: por conversa e pelo idioma do texto.

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { CAMINHOS, garantirPasta, log, idiomaEfetivo } = require('./comum')

const BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/'
const CATALOGO_URL = BASE + 'voices.json'
const CATALOGO = path.join(CAMINHOS.vozes, 'catalogo.json')
const FICHEIRO_SESSOES = path.join(CAMINHOS.pasta, 'vozes-sessoes.json')
const LINGUAS = ['pt_PT', 'pt_BR', 'en_US', 'en_GB', 'es_ES', 'es_MX', 'fr_FR', 'de_DE', 'it_IT', 'nl_NL', 'ca_ES']
const NOMES_LINGUA = {
  pt_PT: 'Português (Portugal)', pt_BR: 'Português (Brasil)', en_US: 'Inglês (EUA)', en_GB: 'Inglês (Reino Unido)',
  es_ES: 'Espanhol (Espanha)', es_MX: 'Espanhol (México)', fr_FR: 'Francês', de_DE: 'Alemão', it_IT: 'Italiano',
  nl_NL: 'Neerlandês', ca_ES: 'Catalão',
}
// Variações de tom para distinguir conversas que usam a mesma voz (meios-tons).
const VARIACOES = [0, -2, 2, -4, 3, -1]

const semAcentos = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
/** Só nomes de voz simples (ex.: pt_PT-tugão-medium): nada de barras nem «..» (vira caminho de ficheiro). */
const idValido = id => typeof id === 'string' && id.length < 100 && /^[\p{L}\p{N}_.-]+$/u.test(id) && !id.includes('..')

// ---------- catálogo ----------

let catalogo = null
async function obterCatalogo(forcar) {
  if (catalogo && !forcar) return catalogo
  try {
    const st = fs.statSync(CATALOGO)
    if (!forcar && Date.now() - st.mtimeMs < 24 * 3600 * 1000) {
      catalogo = JSON.parse(fs.readFileSync(CATALOGO, 'utf8'))
      return catalogo
    }
  } catch {}
  const r = await fetch(CATALOGO_URL)
  if (!r.ok) throw new Error(`catálogo indisponível (${r.status})`)
  catalogo = await r.json()
  garantirPasta(CAMINHOS.vozes)
  fs.writeFileSync(CATALOGO, JSON.stringify(catalogo))
  return catalogo
}

/** Lista resumida para a barra: só as línguas suportadas na interface. */
async function listarCatalogo() {
  const c = await obterCatalogo(false)
  const instaladas = new Set(instaladasIds().map(semAcentos))
  return Object.values(c)
    .filter(v => LINGUAS.includes(v.language.code))
    .map(v => {
      const onnx = Object.entries(v.files).find(([f]) => f.endsWith('.onnx'))
      return {
        id: v.key,
        nome: v.name,
        lingua: v.language.code,
        linguaNome: NOMES_LINGUA[v.language.code] || v.language.code,
        qualidade: v.quality,
        oradores: v.num_speakers,
        mb: onnx ? Math.round(onnx[1].size_bytes / 1048576) : 0,
        instalada: instaladas.has(semAcentos(v.key)),
      }
    })
    .sort((a, b) => LINGUAS.indexOf(a.lingua) - LINGUAS.indexOf(b.lingua) || a.nome.localeCompare(b.nome))
}

// ---------- instaladas ----------

function instaladasIds() {
  try {
    return fs
      .readdirSync(CAMINHOS.vozes)
      .filter(f => f.endsWith('.onnx') && fs.existsSync(path.join(CAMINHOS.vozes, f + '.json')))
      .map(f => f.slice(0, -5))
  } catch {
    return []
  }
}

function linguaDe(id) {
  return (/^([a-z]{2}_[A-Z]{2})-/.exec(id) || [])[1] || 'pt_PT'
}

function instaladas() {
  return instaladasIds().map(id => ({
    id,
    nome: (id.split('-')[1] || id).replace(/_/g, ' '),
    lingua: linguaDe(id),
    linguaNome: NOMES_LINGUA[linguaDe(id)] || linguaDe(id),
    qualidade: id.split('-')[2] || '',
    modelo: path.join(CAMINHOS.vozes, id + '.onnx'),
  }))
}

function caminhoModelo(id) {
  if (!idValido(id)) return null
  const exato = path.join(CAMINHOS.vozes, id + '.onnx')
  if (fs.existsSync(exato)) return exato
  const alvo = semAcentos(id)
  const achada = instaladasIds().find(x => semAcentos(x) === alvo)
  return achada ? path.join(CAMINHOS.vozes, achada + '.onnx') : null
}

// ---------- descarregar / remover ----------

const emCurso = new Map() // id -> { pct }

function md5(f) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('md5')
    fs.createReadStream(f)
      .on('data', d => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })
}

async function baixar(url, destino, tamanho, aoProgresso) {
  const r = await fetch(url)
  if (!r.ok || !r.body) throw new Error(`download falhou (${r.status})`)
  const tmp = destino + '.parcial'
  const out = fs.createWriteStream(tmp)
  let recebido = 0
  for await (const pedaco of r.body) {
    recebido += pedaco.length
    if (!out.write(pedaco)) await new Promise(res => out.once('drain', res))
    if (tamanho) aoProgresso(Math.min(99, Math.round((recebido / tamanho) * 100)))
  }
  await new Promise((res, rej) => out.end(err => (err ? rej(err) : res())))
  fs.renameSync(tmp, destino)
}

/** Descarrega uma voz do catálogo (verifica o MD5 do modelo). aoProgresso(pct) vai sendo chamado. */
async function descarregar(id, aoProgresso = () => {}) {
  if (!idValido(id)) throw new Error('nome de voz inválido')
  if (emCurso.has(id)) return
  const c = await obterCatalogo(false)
  const v = c[id]
  if (!v) throw new Error('voz desconhecida')
  emCurso.set(id, { pct: 0 })
  garantirPasta(CAMINHOS.vozes)
  const progresso = pct => {
    emCurso.set(id, { pct })
    aoProgresso(pct)
  }
  try {
    const [onnxPath, onnxInfo] = Object.entries(v.files).find(([f]) => f.endsWith('.onnx'))
    const [jsonPath] = Object.entries(v.files).find(([f]) => f.endsWith('.onnx.json'))
    const destino = path.join(CAMINHOS.vozes, id + '.onnx')
    const url = p => BASE + p.split('/').map(encodeURIComponent).join('/')
    await baixar(url(jsonPath), destino + '.json', 0, () => {})
    JSON.parse(fs.readFileSync(destino + '.json', 'utf8')) // tem de ser JSON válido
    await baixar(url(onnxPath), destino, onnxInfo.size_bytes, progresso)
    const obtido = await md5(destino)
    if (obtido !== onnxInfo.md5_digest) {
      fs.rmSync(destino, { force: true })
      fs.rmSync(destino + '.json', { force: true })
      throw new Error('o ficheiro descarregado não corresponde ao catálogo (MD5)')
    }
    log(`voz instalada: ${id}`)
    progresso(100)
  } finally {
    emCurso.delete(id)
  }
}

function remover(id) {
  const m = caminhoModelo(id)
  if (!m) return false
  fs.rmSync(m, { force: true })
  fs.rmSync(m + '.json', { force: true })
  return true
}

// ---------- voz por conversa ----------

let porSessao = null
function lerSessoes() {
  if (porSessao) return porSessao
  try {
    porSessao = JSON.parse(fs.readFileSync(FICHEIRO_SESSOES, 'utf8'))
  } catch {
    porSessao = {}
  }
  // Esquece conversas com mais de 14 dias.
  const limite = Date.now() - 14 * 24 * 3600 * 1000
  for (const [k, v] of Object.entries(porSessao)) if (!v.t || v.t < limite) delete porSessao[k]
  return porSessao
}

function gravarSessoes() {
  try {
    fs.writeFileSync(FICHEIRO_SESSOES, JSON.stringify(porSessao))
  } catch {}
}

/** Escolhe à mão a voz (e o tom) de uma conversa. voz = null volta ao automático. */
function definirVozSessao(sessao, voz, altura) {
  if (voz && !idValido(voz)) return
  const s = lerSessoes()
  if (!voz && !altura) delete s[sessao]
  else s[sessao] = { voz: voz || null, altura: Number(altura) || 0, t: Date.now(), manual: true }
  gravarSessoes()
}

function vozDaSessao(sessao) {
  const s = lerSessoes()[sessao]
  return s ? { voz: s.voz, altura: s.altura, manual: !!s.manual } : null
}

// ---------- idioma do texto ----------

const PALAVRAS = {
  pt: ' o a os as de do da que não é um uma para com por se ao à está estou já foi isto isso também mas ',
  en: ' the and is are to of in that it for you with this was on not be have i we can will ',
  es: ' el la los las de que no es un una para con por se lo está estoy ya pero también muy ',
  fr: ' le la les de des que ne pas est un une pour avec et je vous nous il elle ',
  de: ' der die das und ist nicht ein eine zu mit für ich sie wir es den dem ',
  it: ' il lo la gli le di che non è un una per con sono questo ',
}

/** Idioma provável de uma frase (pt, en, es, fr, de, it) ou null se for curta/ambígua. */
function detetarIdioma(frase) {
  const t = ' ' + semAcentos(String(frase || '').toLowerCase()).replace(/[^a-z\s]/g, ' ') + ' '
  const palavras = t.split(/\s+/).filter(Boolean)
  if (palavras.length < 4) return null
  let melhor = null
  let max = 0
  for (const [l, lista] of Object.entries(PALAVRAS)) {
    const conjunto = semAcentos(lista)
    let n = 0
    for (const p of palavras) if (conjunto.includes(' ' + p + ' ')) n++
    if (n > max) {
      max = n
      melhor = l
    }
  }
  if (/[ãõç]/.test(frase) && (melhor === 'es' || melhor === 'it' || melhor === 'fr')) melhor = 'pt'
  return max >= 2 ? melhor : null
}

/**
 * A voz para uma frase: { modelo, altura } (altura = meios-tons a somar ao som geral).
 * cfg.vozPadrao, cfg.vozPorConversa ('auto' | 'igual'), cfg.idiomaAuto (bool).
 */
function escolher(cfg, sessao, frase, tipo, ordemSessoes) {
  let padrao = caminhoModelo(cfg.vozPadrao) || CAMINHOS.modelo
  // A língua da interface manda nos anúncios: se a voz principal for de outra língua e houver uma voz
  // instalada na língua da interface, os anúncios (e o resto, por omissão) usam essa.
  const idiomaUi = idiomaEfetivo(cfg)
  if (linguaDe(path.basename(padrao, '.onnx')).slice(0, 2) !== idiomaUi) {
    const daLingua = instaladas().find(v => v.lingua.startsWith(idiomaUi))
    if (daLingua) padrao = daLingua.modelo
  }
  let modelo = padrao
  let altura = 0
  if (sessao) {
    const manual = vozDaSessao(sessao)
    if (manual && manual.manual) {
      modelo = caminhoModelo(manual.voz) || padrao
      altura = manual.altura || 0
    } else if (cfg.vozPorConversa !== 'igual') {
      // Automático: cada conversa recebe uma variação de tom (pela ordem em que apareceu).
      const i = Math.max(0, ordemSessoes.indexOf(sessao))
      altura = VARIACOES[i % VARIACOES.length]
    }
  }
  // Idioma automático: uma resposta noutro idioma usa uma voz instalada desse idioma.
  if (tipo === 'fala' && cfg.idiomaAuto !== false) {
    const idioma = detetarIdioma(frase)
    const atual = linguaDe(path.basename(modelo, '.onnx')).slice(0, 2)
    if (idioma && idioma !== atual) {
      const outra = instaladas().find(v => v.lingua.startsWith(idioma))
      if (outra) modelo = outra.modelo
    }
  }
  return { modelo, altura }
}

module.exports = {
  listarCatalogo, instaladas, descarregar, remover, emCurso, caminhoModelo, definirVozSessao, vozDaSessao,
  detetarIdioma, escolher, NOMES_LINGUA, linguaDe,
}
