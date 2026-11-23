'use strict'
// Caminhos, configuração e registo partilhados pelo gancho, pelo servidor e pela linha de comandos.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const PASTA = process.env.VOZ_DIR || path.join(os.homedir(), '.claude', 'voz')
const WIN = process.platform === 'win32'

const CAMINHOS = {
  pasta: PASTA,
  config: path.join(PASTA, 'config.json'),
  log: path.join(PASTA, 'voz.log'),
  tmp: path.join(PASTA, 'tmp'),
  vozes: path.join(PASTA, 'vozes'),
  python: path.join(PASTA, 'python'),
  pythonExe: path.join(PASTA, 'python', WIN ? 'Scripts' : 'bin', WIN ? 'python.exe' : 'python'),
  modelo: path.join(PASTA, 'vozes', 'pt_PT-tugao-medium.onnx'),
  avisoMostrado: path.join(PASTA, '.aviso-instalar'),
  // Um servidor por utilizador: pipe com nome no Windows, socket Unix nos outros.
  // Com VOZ_DIR (pasta própria, ex.: testes ou demonstração) o canal também é próprio.
  canal: WIN
    ? `\\\\.\\pipe\\voz-claude-code-${(os.userInfo().username || 'user').replace(/[^\w.-]/g, '_')}${
        process.env.VOZ_DIR ? '-' + require('node:crypto').createHash('sha1').update(PASTA).digest('hex').slice(0, 8) : ''
      }`
    : path.join(PASTA, 'voz.sock'),
}

const PREDEFINICOES = {
  ligado: true,
  anunciarAcoes: true, // "A editar config.ts", "A usar o git"...
  lerRespostas: true, // lê o texto do Claude enquanto ele escreve
  sons: true, // sons curtos por evento (testes passaram/falharam, autorização, conversa terminou)
  somEspacial: true, // com várias conversas, cada uma fala do seu lado (esquerda/centro/direita)
  silencioReunioes: true, // voz calada com o microfone ocupado por outra app (Teams, Zoom…) ou em ecrã inteiro
  resumoAoVoltar: true, // ao voltar ao computador (5+ min fora), diz o que aconteceu entretanto
  moeda: 'auto', // custo dos tokens: auto (euro em pt/es, dólar em en) | EUR | USD
  anunciarResultados: true, // "Os 12 testes passaram", "A compilação falhou", comandos longos
  velocidade: 0.88, // 0.5 a 2.0 (abaixo de 1 é mais calmo)
  ruido: 0.4, // Piper noise_scale: mais baixo = voz mais estável e menos "metálica"
  ruidoDuracao: 0.5, // Piper noise_w_scale: variação do ritmo entre sílabas
  volume: 1.0, // 0 a 2
  altura: 0, // tom em meios-tons, -6 a +6 (não muda a velocidade)
  graves: 0, // equalizador, dB de -12 a +12
  medios: 0,
  agudos: 0,
  maxCaracteres: 1200, // por mensagem; o resto fica só no ecrã
  soSessaoAtiva: true, // só a sessão onde escreveste por último fala tudo
  avisarOutrasSessoes: true, // as outras só dizem quando terminam ou precisam de ti
  motor: 'auto', // auto | piper | sistema
  vozSistema: '', // parte do nome de uma voz do sistema (ex.: "Helia"), opcional
  pronuncias: { Claude: 'Cláude' }, // como dizer certas palavras (só no áudio)
  idioma: 'auto', // língua da barra e das frases faladas: auto (a do sistema) | pt | en | es
  // Barra (Windows)
  barraPosicao: 'topo', // topo | escondida | flutuante | esquerda | direita | fundo
  barraArranque: 'windows', // windows | claude | mao
  barraTema: 'sistema', // sistema | escuro | claro
  barraEstilo: 'macos', // macos (vidro líquido, cápsulas) | windows (Windows 11: Mica, Fluent, cor de destaque)
  barraMaterial: 'liquido', // liquido | fosco | personalizado | classico (vidro líquido só na barra encaixada)
  vidroTransparencia: 87, // material «personalizado» (como o painel Material do Atrium)
  vidroDesfoque: 100,
  vidroRefracao: 6,
  vidroBorda: 10,
  vidroDispersao: 4,
  vidroBrilho: 45,
  vidroSombra: 30,
  barraAvisos: true, // aviso no canto quando uma conversa termina ou precisa de ti
  respostasPelaBarra: true, // responder às conversas a partir da barra (gancho asyncRewake)
  barraModulos: [
    { id: 'ilha', on: true },
    { id: 'sessao', on: true },
    { id: 'acao', on: false },
    { id: 'conversas', on: true },
    { id: 'legenda', on: false },
    { id: 'onda', on: false },
    { id: 'sessoes', on: false },
    { id: 'contexto', on: true },
    { id: 'som', on: true },
    { id: 'tempo', on: true },
  ],
  porta: 47821, // servidor web local da barra (só 127.0.0.1); se estiver ocupada usa a seguinte livre
  barraEcra: -1, // -1 = ecrã principal; 0, 1, 2… = esse monitor
  // Não incomodar
  naoIncomodar: false, // botão: sem voz nem avisos no ecrã
  silencioHorario: { ativo: false, inicio: '22:00', fim: '08:00' },
  // Vozes
  vozPadrao: 'pt_PT-tugao-medium',
  vozPorConversa: 'auto', // auto = cada conversa com um tom diferente; igual = todas iguais
  idiomaAuto: true, // resposta noutro idioma usa uma voz instalada desse idioma
  // Permissões e ditado
  aprovarPelaBarra: true, // pedidos de autorização na barra (app do Claude)
  aprovarPelaBarraNoTerminal: false, // no terminal o gancho atrasaria o diálogo: desligado
  ditadoIdioma: 'auto', // auto = a língua da interface
  ditadoModelo: 'small', // tiny | base | small | medium (Whisper)
}

/** Predefinições de som: só mexem na velocidade, tom e equalizador. */
const PREDEFINICOES_SOM = {
  natural: { velocidade: 0.88, altura: 0, graves: 0, medios: 0, agudos: 0 },
  calma: { velocidade: 0.82, altura: -1, graves: 3, medios: 0, agudos: -3 },
  clara: { velocidade: 0.92, altura: 0, graves: -1, medios: 3, agudos: 2 },
  quente: { velocidade: 0.86, altura: -2, graves: 4, medios: 1, agudos: -4 },
  radio: { velocidade: 0.95, altura: 0, graves: -6, medios: 5, agudos: -2 },
}

function garantirPasta(p = PASTA) {
  fs.mkdirSync(p, { recursive: true })
}

let cache = { mtime: -1, valor: { ...PREDEFINICOES } }

/** Lê a configuração (com cache pelo mtime). Um ficheiro em falta ou partido dá as predefinições. */
function lerConfig() {
  try {
    const st = fs.statSync(CAMINHOS.config)
    if (st.mtimeMs === cache.mtime) return cache.valor
    const lido = JSON.parse(fs.readFileSync(CAMINHOS.config, 'utf8'))
    cache = { mtime: st.mtimeMs, valor: { ...PREDEFINICOES, ...lido } }
  } catch {
    cache = { mtime: -1, valor: { ...PREDEFINICOES } }
  }
  return cache.valor
}

function escreverConfig(alteracoes) {
  garantirPasta()
  const atual = { ...lerConfig(), ...alteracoes }
  fs.writeFileSync(CAMINHOS.config, JSON.stringify(atual, null, 2) + '\n')
  cache = { mtime: -1, valor: atual }
  return atual
}

function log(...partes) {
  try {
    garantirPasta()
    try {
      if (fs.statSync(CAMINHOS.log).size > 256 * 1024) fs.writeFileSync(CAMINHOS.log, '')
    } catch {}
    const linha = `${new Date().toISOString()} ${partes.map(p => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`
    fs.appendFileSync(CAMINHOS.log, linha)
  } catch {}
}

/** Língua efetiva: a escolhida, ou a do sistema (pt, es; o resto em inglês). */
function idiomaEfetivo(cfg) {
  if (cfg && ['pt', 'en', 'es'].includes(cfg.idioma)) return cfg.idioma
  let loc = ''
  try {
    loc = Intl.DateTimeFormat().resolvedOptions().locale || ''
  } catch {}
  loc = (process.env.VOZ_LOCALE || loc || process.env.LANG || '').toLowerCase()
  return loc.startsWith('pt') ? 'pt' : loc.startsWith('es') ? 'es' : 'en'
}

/** Não incomodar: o botão manual ou o horário de silêncio (ex.: 22:00 → 08:00, atravessa a meia-noite). */
function emSilencio(cfg, data = new Date()) {
  if (cfg.naoIncomodar) return true
  const h = cfg.silencioHorario
  if (!h || !h.ativo) return false
  const min = s => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''))
    return m ? Number(m[1]) * 60 + Number(m[2]) : null
  }
  const ini = min(h.inicio)
  const fim = min(h.fim)
  if (ini === null || fim === null || ini === fim) return false
  const agora = data.getHours() * 60 + data.getMinutes()
  return ini < fim ? agora >= ini && agora < fim : agora >= ini || agora < fim
}

function piperInstalado() {
  return fs.existsSync(CAMINHOS.pythonExe) && fs.existsSync(CAMINHOS.modelo) && fs.existsSync(CAMINHOS.modelo + '.json')
}

module.exports = { idiomaEfetivo, emSilencio, CAMINHOS, PREDEFINICOES, PREDEFINICOES_SOM, WIN, garantirPasta, lerConfig, escreverConfig, log, piperInstalado }
