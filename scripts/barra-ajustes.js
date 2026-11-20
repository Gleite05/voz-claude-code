'use strict'
// Ajustes da barra que se podem ler e mudar pela linha de comandos (e pela skill /voz:barra, que é
// como o Claude os muda quando lhe pedes em linguagem normal). Cada ajuste é validado aqui, para
// que um pedido mal percebido nunca escreva lixo na configuração.

const LISTA = (valores, desc) => ({ tipo: 'lista', valores, desc })
const NUM = (min, max, desc) => ({ tipo: 'num', min, max, desc })
const SIM = desc => ({ tipo: 'sim', desc })

const AJUSTES = {
  barraPosicao: LISTA(['topo', 'fundo', 'esquerda', 'direita', 'flutuante', 'escondida'], 'onde fica a barra'),
  barraTema: LISTA(['sistema', 'escuro', 'claro'], 'tema (sistema = segue o Windows)'),
  barraMaterial: LISTA(['liquido', 'fosco', 'personalizado', 'classico'], 'material: vidro líquido, vidro fosco, personalizado ou clássico (vidro só com a barra encaixada)'),
  vidroTransparencia: NUM(40, 100, 'vidro: transparência %'),
  vidroDesfoque: NUM(0, 100, 'vidro: desfoque %'),
  vidroRefracao: NUM(0, 20, 'vidro: refração px'),
  vidroBorda: NUM(2, 20, 'vidro: largura da lente px'),
  vidroDispersao: NUM(0, 20, 'vidro: dispersão das cores %'),
  vidroBrilho: NUM(0, 100, 'vidro: brilho na aresta %'),
  vidroSombra: NUM(0, 100, 'vidro: sombra %'),
  barraEcra: NUM(-1, 9, 'monitor (-1 = principal; 0, 1, 2… = esse monitor)'),
  barraAvisos: SIM('aviso quando uma conversa termina ou precisa de ti'),
  respostasPelaBarra: SIM('responder às conversas a partir da barra'),
  aprovarPelaBarra: SIM('autorizações e perguntas do Claude na barra'),
  naoIncomodar: SIM('não incomodar (sem voz nem avisos)'),
  idioma: LISTA(['auto', 'pt', 'en', 'es'], 'língua da barra e da voz'),
  moeda: LISTA(['auto', 'eur', 'usd'], 'moeda do custo dos tokens'),
}

// Valores das predefinições do vidro (os mesmos de barra/vidro.js): ao afinar um valor do vidro a
// partir de uma predefinição, o material passa a «personalizado» com os outros valores dela.
const VIDRO_PREDEF = {
  liquido: { vidroTransparencia: 90, vidroDesfoque: 15, vidroRefracao: 8, vidroBorda: 10, vidroDispersao: 6, vidroBrilho: 55, vidroSombra: 30 },
  fosco: { vidroTransparencia: 74, vidroDesfoque: 100, vidroRefracao: 3, vidroBorda: 8, vidroDispersao: 0, vidroBrilho: 35, vidroSombra: 25 },
}

const MODULOS = ['ilha', 'sessao', 'acao', 'conversas', 'legenda', 'onda', 'sessoes', 'contexto', 'microfone', 'silencio', 'tema', 'som', 'tempo']

const SIM_VAL = { sim: true, true: true, on: true, ligado: true, ligar: true, '1': true, nao: false, 'não': false, false: false, off: false, desligado: false, desligar: false, '0': false }

/** Converte e valida um valor; devolve { ok, valor } ou { ok:false, erro }. */
function validar(chave, bruto) {
  const a = AJUSTES[chave]
  if (!a) return { ok: false, erro: `ajuste desconhecido: ${chave}` }
  const s = String(bruto).trim().toLowerCase()
  if (a.tipo === 'lista') {
    if (!a.valores.includes(s)) return { ok: false, erro: `${chave}: usa ${a.valores.join(' | ')}` }
    return { ok: true, valor: chave === 'moeda' && s !== 'auto' ? s.toUpperCase() : s }
  }
  if (a.tipo === 'num') {
    const n = Number(s.replace(',', '.').replace(/(%|px)$/, ''))
    if (!Number.isFinite(n) || n < a.min || n > a.max) return { ok: false, erro: `${chave}: número de ${a.min} a ${a.max}` }
    return { ok: true, valor: Math.round(n) }
  }
  if (!(s in SIM_VAL)) return { ok: false, erro: `${chave}: usa sim | nao` }
  return { ok: true, valor: SIM_VAL[s] }
}

/**
 * Lê pares «chave=valor» e devolve as alterações a gravar (ou os erros, sem gravar nada).
 * Mexer num valor do vidro sem escolher o material passa-o a «personalizado», como no painel Material.
 */
function interpretar(pares, cfg) {
  const alteracoes = {}
  const erros = []
  for (const par of pares) {
    const i = String(par).indexOf('=')
    if (i < 1) {
      erros.push(`«${par}» não é chave=valor`)
      continue
    }
    const chave = encontrarChave(String(par).slice(0, i).trim())
    const r = validar(chave, String(par).slice(i + 1))
    if (r.ok) alteracoes[chave] = r.valor
    else erros.push(r.erro)
  }
  if (erros.length) return { ok: false, erros }
  const mexeNoVidro = Object.keys(alteracoes).some(k => k.startsWith('vidro'))
  if (mexeNoVidro && !('barraMaterial' in alteracoes)) {
    const atual = cfg.barraMaterial || 'liquido'
    if (atual !== 'personalizado') {
      const base = VIDRO_PREDEF[atual] || VIDRO_PREDEF.liquido
      for (const [k, v] of Object.entries(base)) if (!(k in alteracoes)) alteracoes[k] = v
      alteracoes.barraMaterial = 'personalizado'
    }
  }
  return { ok: true, alteracoes }
}

/** Aceita a chave sem olhar a maiúsculas (barratema, BarraTema…). */
function encontrarChave(k) {
  return Object.keys(AJUSTES).find(x => x.toLowerCase() === k.toLowerCase()) || k
}

/** Módulos pela ordem da barra, com os que faltam na configuração no fim. */
function modulos(cfg) {
  const lista = (Array.isArray(cfg.barraModulos) ? cfg.barraModulos : []).filter(m => m && MODULOS.includes(m.id)).map(m => ({ id: m.id, on: !!m.on }))
  for (const id of MODULOS) if (!lista.some(m => m.id === id)) lista.push({ id, on: false })
  return lista
}

/** Liga ou desliga um módulo; devolve a nova lista ou { erro }. */
function alternarModulo(cfg, id, estado) {
  const m = String(id || '').toLowerCase()
  if (!MODULOS.includes(m)) return { erro: `módulos: ${MODULOS.join(', ')}` }
  const on = SIM_VAL[String(estado || '').toLowerCase()]
  if (on === undefined) return { erro: 'usa on | off' }
  return { lista: modulos(cfg).map(x => (x.id === m ? { ...x, on } : x)) }
}

module.exports = { AJUSTES, MODULOS, VIDRO_PREDEF, validar, interpretar, modulos, alternarModulo }
