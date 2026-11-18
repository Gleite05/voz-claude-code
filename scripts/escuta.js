'use strict'
// Gancho Stop com "asyncRewake": corre em segundo plano depois de o Claude acabar uma resposta
// e fica à escuta de uma resposta escrita na barra para esta sessão. Quando ela chega, escreve-a
// no stderr e sai com o código 2 — o Claude Code acorda o Claude com esse texto, mesmo com a
// sessão parada. Se escreveres na própria conversa, o servidor manda esta escuta sair calada.

const net = require('node:net')
const { CAMINHOS, lerConfig } = require('./comum')

function lerStdin() {
  return new Promise(resolve => {
    let dados = ''
    const t = setTimeout(() => resolve(dados), 2000)
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', d => (dados += d))
    process.stdin.on('end', () => {
      clearTimeout(t)
      resolve(dados)
    })
    process.stdin.on('error', () => resolve(dados))
  })
}

function sair(codigo) {
  process.exit(codigo)
}

async function principal() {
  if (process.env.VOZ_SILENCIO || process.env.CLAUDE_CODE_SESSION_ATTENDED === '0') return sair(0)
  if (lerConfig().respostasPelaBarra === false) return sair(0)
  let e
  try {
    e = JSON.parse(await lerStdin())
  } catch {
    return sair(0)
  }
  if (!e.session_id || e.agent_id) return sair(0)

  // Garante o servidor (a escuta só faz sentido com ele a correr).
  const { enviar } = require('./cliente')
  try {
    await enviar({ controlo: 'estado' }, { resposta: true })
  } catch {
    return sair(0)
  }

  const s = net.connect(CAMINHOS.canal)
  s.setEncoding('utf8')
  let buffer = ''
  s.on('connect', () => s.write(JSON.stringify({ escuta: e.session_id, cwd: e.cwd }) + '\n'))
  s.on('data', d => {
    buffer += d
    const i = buffer.indexOf('\n')
    if (i < 0) return
    let msg
    try {
      msg = JSON.parse(buffer.slice(0, i))
    } catch {
      return sair(0)
    }
    if (msg.resposta) {
      process.stderr.write(
        'O utilizador respondeu-te pela barra «Voz» (é como se tivesse escrito aqui na conversa). ' +
          'Responde e continua normalmente.\n\n' +
          msg.resposta +
          '\n',
        () => sair(2),
      )
      return
    }
    sair(0)
  })
  s.on('error', () => sair(0))
  s.on('close', () => sair(0))
}

principal().catch(() => sair(0))
