'use strict'
// Estado das sessões do Claude Code para a barra: o que cada uma está a fazer,
// desde quando, e quantos tokens/contexto usa (lido do fim do histórico .jsonl).

const fs = require('node:fs')
const texto = require('./texto')
const tarefas = require('./tarefas')

const SESSAO_VELHA_MS = 45 * 60 * 1000
const LER_TOKENS_MS = 12 * 1000
const FERRAMENTA_VELHA_MS = 30 * 60 * 1000 // uma ferramenta sem fim há tanto tempo já não está a correr
const COMPACTAR_MAX_MS = 5 * 60 * 1000

const sessoes = new Map()
let ouvintes = []

function aoMudar(fn) {
  ouvintes.push(fn)
}
function avisar() {
  for (const fn of ouvintes) fn()
}

function nomeModelo(id) {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d+))?/i.exec(String(id || ''))
  if (!m) return id ? String(id) : ''
  const familia = m[1][0].toUpperCase() + m[1].slice(1)
  return `${familia} ${m[2]}${m[3] && m[3].length <= 2 ? '.' + m[3] : ''}`
}

/** Lê o fim do histórico: modelo, contexto usado e tokens gerados neste pedido. */
function lerUso(caminho) {
  let fd
  try {
    fd = fs.openSync(caminho, 'r')
    const tamanho = fs.fstatSync(fd).size
    const n = Math.min(tamanho, 768 * 1024)
    const buf = Buffer.alloc(n)
    fs.readSync(fd, buf, 0, n, tamanho - n)
    const linhas = buf.toString('utf8').split('\n')
    if (tamanho > n) linhas.shift() // primeira linha pode vir cortada
    let ultimo = null
    let saidaPedido = 0
    let titulo = null
    let fimDoPedido = false
    for (let i = linhas.length - 1; i >= 0; i--) {
      const l = linhas[i]
      if (!l) continue
      if (!titulo && l.includes('"custom-title"')) {
        try {
          titulo = JSON.parse(l).customTitle || null
        } catch {}
      }
      if (fimDoPedido) {
        if (titulo) break
        continue
      }
      let e
      try {
        e = JSON.parse(l)
      } catch {
        continue
      }
      if (e.type === 'assistant' && e.message && e.message.usage) {
        if (!ultimo) ultimo = e.message
        saidaPedido += Number(e.message.usage.output_tokens) || 0
      } else if (e.type === 'user' && e.message && !e.isMeta) {
        const c = e.message.content
        const ePrompt = typeof c === 'string' || (Array.isArray(c) && !c.some(b => b && b.type === 'tool_result'))
        if (ePrompt && ultimo) fimDoPedido = true
      }
    }
    if (!ultimo) return titulo ? { titulo } : null
    const u = ultimo.usage
    const usados =
      (Number(u.input_tokens) || 0) +
      (Number(u.cache_creation_input_tokens) || 0) +
      (Number(u.cache_read_input_tokens) || 0) +
      (Number(u.output_tokens) || 0)
    const limite = usados > 200000 ? 1000000 : 200000
    return { modelo: nomeModelo(ultimo.model), usados, limite, pct: Math.round((usados / limite) * 100), saidaPedido, titulo }
  } catch {
    return null
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {}
    }
  }
}

function obter(msg) {
  const id = msg.sessao
  if (!id) return null
  let s = sessoes.get(id)
  if (!s) {
    s = {
      id,
      pasta: msg.cwd ? texto.base(msg.cwd) : 'sessão',
      estado: 'parada', // parada | trabalhar | atencao | terminou
      acao: '',
      inicio: null,
      fim: null,
      ultimo: Date.now(),
      transcript: null,
      uso: null,
      lidoEm: 0,
      titulo: null,
      pedido: '',
      resposta: '',
      respostaEm: null,
      historico: [], // últimas ações (para a linha temporal da barra)
      correr: new Map(), // tool_use_id -> início (ferramentas a correr agora)
      temFim: false, // esta versão do Claude Code manda PostToolUse? (sem isso não há cronómetro)
      falha: null, // { texto, t } do último comando importante que falhou
      subagentes: new Map(), // agent_id -> { tipo, inicio }
      compactar: null, // início da compactação em curso
      plano: null, // lista de tarefas [{ t, s }]
    }
    sessoes.set(id, s)
  }
  if (msg.cwd) s.pasta = texto.base(msg.cwd)
  if (msg.transcript) s.transcript = msg.transcript
  if (msg.titulo) s.titulo = msg.titulo
  s.ultimo = Date.now()
  return s
}

function atualizarUso(s, forcar) {
  if (!s.transcript) return
  if (!forcar && Date.now() - s.lidoEm < LER_TOKENS_MS) return
  s.lidoEm = Date.now()
  const uso = lerUso(s.transcript)
  if (uso && uso.titulo) s.titulo = uso.titulo
  if (uso && uso.modelo) s.uso = uso
}

/** Atualiza o estado com um evento de gancho (de qualquer sessão, mesmo das que não falam). */
function registar(msg) {
  if (msg.agente) return
  if (msg.evento === 'SessionEnd') {
    if (sessoes.delete(msg.sessao)) avisar()
    return
  }
  const s = obter(msg)
  if (!s) return
  switch (msg.evento) {
    case 'SessionStart':
      atualizarUso(s, true)
      break
    case 'UserPromptSubmit':
      s.correr.clear()
      s.falha = null
      { const r = tarefas.resumir(s.plano); if (r && r.feitas === r.total) s.plano = null } // plano acabado: o pedido novo começa limpo
      s.estado = 'trabalhar'
      s.acao = texto.frase(msg.idioma, 'aPensar')
      if (msg.pedido) s.pedido = msg.pedido
      s.inicio = Date.now()
      s.fim = null
      atualizarUso(s, true)
      break
    case 'PreToolUse': {
      const frase = texto.anunciarFerramenta(msg.ferramenta, msg.entrada, msg.idioma)
      s.estado = 'trabalhar'
      s.compactar = null
      if (!s.inicio) s.inicio = Date.now()
      if (msg.id) s.correr.set(msg.id, Date.now())
      if (frase) {
        s.acao = frase.replace(/\.$/, '')
        s.historico.push({ t: Date.now(), acao: s.acao, id: msg.id })
        if (s.historico.length > 6) s.historico.shift()
      }
      s.plano = tarefas.atualizar(s.plano, msg.ferramenta, msg.entrada)
      atualizarUso(s, false)
      break
    }
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      s.temFim = true
      const desde = msg.id ? s.correr.get(msg.id) : null
      if (msg.id) s.correr.delete(msg.id)
      const ok = msg.evento === 'PostToolUse'
      const h = msg.id && s.historico.find(x => x.id === msg.id)
      if (h) {
        h.ok = ok || !!msg.interrompido
        h.dur = Number.isFinite(msg.duracao) ? msg.duracao : desde ? Date.now() - desde : undefined
      }
      if (!ok && !msg.interrompido) {
        const leg = texto.legendaFalha(msg.ferramenta, msg.entrada, msg.idioma)
        if (leg) s.falha = { texto: leg, t: Date.now() }
      }
      break
    }
    case 'SubagentStart':
      if (msg.subagente && msg.tipoAgente) s.subagentes.set(msg.subagente, { tipo: msg.tipoAgente, inicio: Date.now() })
      break
    case 'SubagentStop':
      if (!msg.subagente || !s.subagentes.delete(msg.subagente)) return
      break
    case 'PreCompact':
      s.compactar = Date.now()
      break
    case 'PostCompact':
      s.compactar = null
      atualizarUso(s, true)
      break
    case 'MessageDisplay':
      if (s.estado !== 'atencao') {
        s.estado = 'trabalhar'
        s.acao = texto.frase(msg.idioma, 'aEscrever')
      }
      break
    case 'Notification':
      s.estado = 'atencao'
      s.acao = texto.frasesNotificacao(msg.mensagem, msg.idioma).replace(/\.$/, '')
      break
    case 'Stop':
      s.correr.clear()
      s.compactar = null
      s.estado = 'terminou'
      s.acao = texto.frase(msg.idioma, 'terminou')
      s.fim = Date.now()
      if (msg.ultima) {
        s.resposta = msg.ultima
        s.respostaEm = Date.now()
      }
      atualizarUso(s, true)
      break
  }
  avisar()
}

function limparVelhas() {
  let mudou = false
  for (const [id, s] of sessoes) {
    if (Date.now() - s.ultimo > SESSAO_VELHA_MS) {
      sessoes.delete(id)
      mudou = true
    }
  }
  if (mudou) avisar()
}

/** Para o servidor anotar campos extra (ex.: se a sessão está à escuta de respostas). */
function anotar(id, campos) {
  const s = sessoes.get(id)
  if (!s) return
  Object.assign(s, campos)
  avisar()
}

/** Regista o texto que o utilizador mandou pela barra como último pedido. */
function pedidoPelaBarra(id, texto) {
  const s = sessoes.get(id)
  if (!s) return
  s.pedido = texto
  avisar()
}

/** Desde quando corre a ferramenta mais antiga ainda sem fim (só se o Claude Code avisar quando acabam). */
function emCursoDesde(s) {
  if (!s.temFim || s.estado !== 'trabalhar' || !s.correr.size) return null
  const agora = Date.now()
  let min = null
  for (const [id, t] of s.correr) {
    if (agora - t > FERRAMENTA_VELHA_MS) s.correr.delete(id)
    else if (min === null || t < min) min = t
  }
  return min
}

function subagentesDe(s) {
  const agora = Date.now()
  const out = []
  for (const [id, a] of s.subagentes) {
    if (agora - a.inicio > FERRAMENTA_VELHA_MS) s.subagentes.delete(id)
    else out.push({ id, tipo: a.tipo, inicio: a.inicio })
  }
  return out
}

function lista() {
  return [...sessoes.values()]
    .sort((a, b) => b.ultimo - a.ultimo)
    .map(s => ({
      id: s.id,
      pasta: s.pasta,
      titulo: s.titulo || s.pasta,
      pedido: s.pedido.slice(0, 600),
      resposta: s.resposta.slice(0, 1500),
      respostaEm: s.respostaEm,
      estado: s.estado,
      acao: s.acao,
      historico: s.historico.slice(-4).map(({ t, acao, ok, dur }) => ({ t, acao, ok, dur })),
      emCursoDesde: emCursoDesde(s),
      falha: s.falha,
      subagentes: subagentesDe(s),
      compactar: !!s.compactar && Date.now() - s.compactar < COMPACTAR_MAX_MS,
      tarefas: tarefas.resumir(s.plano),
      inicio: s.inicio,
      fim: s.fim,
      uso: s.uso,
      escuta: !!s.escuta,
      pendentes: s.pendentes || 0,
    }))
}

module.exports = { registar, lista, aoMudar, limparVelhas, lerUso, nomeModelo, anotar, pedidoPelaBarra }
