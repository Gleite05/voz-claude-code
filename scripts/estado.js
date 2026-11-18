'use strict'
// Estado das sessões do Claude Code para a barra: o que cada uma está a fazer,
// desde quando, e quantos tokens/contexto usa (lido do fim do histórico .jsonl).

const fs = require('node:fs')
const texto = require('./texto')

const SESSAO_VELHA_MS = 45 * 60 * 1000
const LER_TOKENS_MS = 12 * 1000

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
    for (let i = linhas.length - 1; i >= 0; i--) {
      const l = linhas[i]
      if (!l) continue
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
        if (ePrompt && ultimo) break
      }
    }
    if (!ultimo) return null
    const u = ultimo.usage
    const usados =
      (Number(u.input_tokens) || 0) +
      (Number(u.cache_creation_input_tokens) || 0) +
      (Number(u.cache_read_input_tokens) || 0) +
      (Number(u.output_tokens) || 0)
    const limite = usados > 200000 ? 1000000 : 200000
    return { modelo: nomeModelo(ultimo.model), usados, limite, pct: Math.round((usados / limite) * 100), saidaPedido }
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
    }
    sessoes.set(id, s)
  }
  if (msg.cwd) s.pasta = texto.base(msg.cwd)
  if (msg.transcript) s.transcript = msg.transcript
  s.ultimo = Date.now()
  return s
}

function atualizarUso(s, forcar) {
  if (!s.transcript) return
  if (!forcar && Date.now() - s.lidoEm < LER_TOKENS_MS) return
  s.lidoEm = Date.now()
  const uso = lerUso(s.transcript)
  if (uso) s.uso = uso
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
      s.estado = 'trabalhar'
      s.acao = 'A pensar'
      s.inicio = Date.now()
      s.fim = null
      atualizarUso(s, true)
      break
    case 'PreToolUse': {
      const frase = texto.anunciarFerramenta(msg.ferramenta, msg.entrada)
      s.estado = 'trabalhar'
      if (!s.inicio) s.inicio = Date.now()
      if (frase) s.acao = frase.replace(/\.$/, '')
      atualizarUso(s, false)
      break
    }
    case 'MessageDisplay':
      if (s.estado !== 'atencao') {
        s.estado = 'trabalhar'
        s.acao = 'A escrever'
      }
      break
    case 'Notification':
      s.estado = 'atencao'
      s.acao = texto.frasesNotificacao(msg.mensagem).replace(/\.$/, '')
      break
    case 'Stop':
      s.estado = 'terminou'
      s.acao = 'Terminou'
      s.fim = Date.now()
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

function lista() {
  return [...sessoes.values()]
    .sort((a, b) => b.ultimo - a.ultimo)
    .map(s => ({
      id: s.id,
      pasta: s.pasta,
      estado: s.estado,
      acao: s.acao,
      inicio: s.inicio,
      fim: s.fim,
      uso: s.uso,
    }))
}

module.exports = { registar, lista, aoMudar, limparVelhas, lerUso, nomeModelo }
