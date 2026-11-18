'use strict'
// O gancho que o Claude Code corre em cada evento. Tem de ser rápido e nunca falhar:
// lê o JSON do stdin, fica só com o que interessa e passa-o ao servidor da voz.

const { lerConfig } = require('./comum')

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
function resumirEntrada(entrada) {
  if (!entrada || typeof entrada !== 'object') return {}
  const curto = v => (typeof v === 'string' ? v.slice(0, 400) : undefined)
  return {
    command: curto(entrada.command),
    description: curto(entrada.description),
    file_path: curto(entrada.file_path || entrada.notebook_path),
    url: curto(entrada.url),
    skill: curto(entrada.skill),
  }
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
  // Desligado: não arranca nada. (Ao escrever um prompt, manda parar na mesma, se o servidor existir.)
  if (!lerConfig().ligado && evento !== 'UserPromptSubmit') return

  const msg = {
    evento,
    sessao: e.session_id,
    cwd: e.cwd,
    agente: e.agent_id,
  }
  switch (evento) {
    case 'PreToolUse':
      msg.ferramenta = e.tool_name
      msg.entrada = resumirEntrada(e.tool_input)
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
    case 'Stop':
      msg.ultima = typeof e.last_assistant_message === 'string' ? e.last_assistant_message.slice(0, 8000) : undefined
      break
  }

  const { enviar } = require('./cliente')
  // Só estes eventos justificam arrancar o servidor; os outros só servem se ele já estiver a correr.
  const arrancar = evento !== 'UserPromptSubmit' && evento !== 'SessionEnd'
  await enviar(msg, { arrancar })
}

principal()
  .catch(() => {})
  .finally(() => process.exit(0))
