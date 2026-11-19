'use strict'
// O gancho que o Claude Code corre em cada evento. Tem de ser rápido e nunca falhar:
// lê o JSON do stdin, fica só com o que interessa e passa-o ao servidor da voz.

const fs = require('node:fs')
const path = require('node:path')
const { lerConfig, CAMINHOS } = require('./comum')
const { eDeTarefas } = require('./tarefas')

const LIMITE_LEITURA_MS = 2000

function lerStdin() {
  return new Promise(resolve => {
    let dados = ''
    const t = setTimeout(() => resolve(dados), LIMITE_LEITURA_MS)
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', d => (dados += d))
    process.stdin.on('end', () => {
      clearTimeout(t)
      resolve(dados)
    })
    process.stdin.on('error', () => {
      clearTimeout(t)
      resolve(dados)
    })
  })
}

/** Só os campos de que o servidor precisa (o tool_input pode ser enorme: um Write inteiro). */
function resumirEntrada(entrada, ferramenta) {
  if (!entrada || typeof entrada !== 'object') return {}
  const curto = v => (typeof v === 'string' ? v.slice(0, 400) : undefined)
  const r = {
    command: curto(entrada.command),
    description: curto(entrada.description),
    file_path: curto(entrada.file_path || entrada.notebook_path),
    url: curto(entrada.url),
    skill: curto(entrada.skill),
  }
  // Listas de tarefas: só o texto curto e o estado de cada uma (para o progresso na barra).
  if (eDeTarefas(ferramenta)) {
    const lista = l => (Array.isArray(l) ? l.slice(0, 40).map(x => ({ t: String((x && (x.activeForm || x.content)) || '').slice(0, 120), s: x && x.status })) : undefined)
    Object.assign(r, {
      todos: lista(entrada.todos),
      items: lista(entrada.items),
      advance: entrada.advance === true || undefined,
      done: Array.isArray(entrada.done) ? entrada.done.slice(0, 40).map(Number) : undefined,
      start: Number.isInteger(entrada.start) ? entrada.start : undefined,
      taskId: entrada.taskId != null ? String(entrada.taskId).slice(0, 20) : undefined,
      status: curto(entrada.status),
      subject: curto(entrada.subject),
    })
  }
  return r
}

/** O fim da saída de um comando (é lá que os executores de testes põem os totais). */
function cauda(v) {
  if (v == null) return undefined
  if (typeof v !== 'string') {
    if (typeof v === 'object') v = [v.stdout, v.stderr, v.output].filter(x => typeof x === 'string').join('\n')
    else v = String(v)
  }
  return v.length > 1500 ? v.slice(-1500) : v
}

/** Sessões sem ninguém a ver (tarefas agendadas, sessões marcadas como não acompanhadas) ficam caladas. */
function silenciado() {
  const env = process.env
  return Boolean(env.VOZ_SILENCIO || env.CLAUDE_CODE_HOST_SCHEDULED_RUN || env.CLAUDE_CODE_SESSION_ATTENDED === '0')
}

async function principal() {
  if (silenciado()) return
  const bruto = await lerStdin()
  let e
  try {
    e = JSON.parse(bruto)
  } catch {
    return
  }
  const evento = e.hook_event_name
  // Com a voz desligada, os eventos continuam a ir para o servidor (a barra mostra-os),
  // mas só arrancam o servidor se a barra estiver instalada.
  const cfg = lerConfig()
  const barraInstalada = fs.existsSync(path.join(CAMINHOS.pasta, 'barra', 'VozBarra.exe'))
  if (!cfg.ligado && !barraInstalada && evento !== 'UserPromptSubmit') return

  // Nos eventos de sub-agentes, o agent_id é o do sub-agente que começa/acaba (o evento é da conversa).
  const deSubagente = evento === 'SubagentStart' || evento === 'SubagentStop'
  const msg = {
    evento,
    sessao: e.session_id,
    cwd: e.cwd,
    agente: deSubagente ? undefined : e.agent_id,
    transcript: e.transcript_path,
    titulo: typeof e.session_title === 'string' ? e.session_title.slice(0, 120) : undefined,
  }
  switch (evento) {
    case 'PreToolUse':
      msg.ferramenta = e.tool_name
      msg.entrada = resumirEntrada(e.tool_input, e.tool_name)
      msg.id = e.tool_use_id
      break
    case 'PostToolUse':
    case 'PostToolUseFailure':
      msg.ferramenta = e.tool_name
      msg.entrada = resumirEntrada(e.tool_input, e.tool_name)
      msg.id = e.tool_use_id
      msg.duracao = Number.isFinite(e.duration_ms) ? e.duration_ms : undefined
      if (evento === 'PostToolUseFailure') {
        msg.erro = cauda(e.error)
        msg.interrompido = !!e.is_interrupt
      } else if (e.tool_name === 'Bash' || e.tool_name === 'PowerShell') {
        msg.saida = cauda(e.tool_response)
      }
      break
    case 'SubagentStart':
    case 'SubagentStop':
      msg.subagente = e.agent_id
      msg.tipoAgente = typeof e.agent_type === 'string' ? e.agent_type.slice(0, 60) : ''
      break
    case 'PreCompact':
    case 'PostCompact':
      msg.gatilho = e.trigger
      break
    case 'MessageDisplay':
      msg.message_id = e.message_id
      msg.index = e.index
      msg.final = e.final
      msg.delta = e.delta
      break
    case 'Notification':
      msg.mensagem = e.message
      break
    case 'UserPromptSubmit':
      msg.pedido = typeof e.prompt === 'string' ? e.prompt.slice(0, 2000) : undefined
      break
    case 'Stop':
      msg.ultima = typeof e.last_assistant_message === 'string' ? e.last_assistant_message.slice(0, 8000) : undefined
      break
  }

  const { enviar } = require('./cliente')
  // Só estes eventos justificam arrancar o servidor; os outros só servem se ele já estiver a correr.
  const arrancar = !/^(UserPromptSubmit|SessionEnd|PostToolUse|PostToolUseFailure|SubagentStart|SubagentStop|PostCompact)$/.test(evento)
  await enviar(msg, { arrancar })
}

principal()
  .catch(() => {})
  .finally(() => process.exit(0))
