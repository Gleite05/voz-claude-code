'use strict'
// Gancho PermissionRequest: mostra o pedido de autorização na barra («Permitir» / «Recusar»)
// e devolve a tua decisão ao Claude Code.
//
// Na app do Claude (Agent SDK) este gancho corre AO LADO do diálogo normal e vale quem decidir
// primeiro — por isso pode esperar pela barra. No terminal interativo o gancho correria antes do
// diálogo, por isso aí não espera (não atrasa nada): sai logo sem decidir.

const net = require('node:net')
const crypto = require('node:crypto')
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

/** Resumo legível do que o Claude quer fazer (nunca o conteúdo inteiro de um ficheiro). */
function resumir(ferramenta, entrada) {
  const e = entrada || {}
  const corta = (s, n) => (String(s || '').length > n ? String(s).slice(0, n - 1) + '…' : String(s || ''))
  if (e.command) return corta(e.command, 600)
  if (e.file_path) return corta(e.file_path, 300)
  if (e.url) return corta(e.url, 300)
  if (e.pattern) return corta(e.pattern, 200)
  if (e.query) return corta(e.query, 200)
  return corta(JSON.stringify(e), 300)
}

function naAppDoClaude() {
  const env = process.env
  return Boolean(env.CLAUDE_AGENT_SDK_VERSION) || /desktop|sdk/i.test(env.CLAUDE_CODE_ENTRYPOINT || '')
}

async function principal() {
  const cfg = lerConfig()
  if (cfg.aprovarPelaBarra === false || process.env.VOZ_SILENCIO) return
  if (!naAppDoClaude() && !cfg.aprovarPelaBarraNoTerminal) return
  let e
  try {
    e = JSON.parse(await lerStdin())
  } catch {
    return
  }
  if (!e.session_id) return

  const { enviar } = require('./cliente')
  try {
    await enviar({ controlo: 'estado' }, { resposta: true }) // garante o servidor
  } catch {
    return
  }

  const decisao = await new Promise(resolve => {
    const s = net.connect(CAMINHOS.canal)
    s.setEncoding('utf8')
    let buffer = ''
    s.on('connect', () =>
      s.write(
        JSON.stringify({
          permissao: {
            id: crypto.randomBytes(8).toString('hex'),
            sessao: e.session_id,
            cwd: e.cwd,
            agente: e.agent_id || null,
            ferramenta: e.tool_name,
            resumo: resumir(e.tool_name, e.tool_input),
            descricao: e.tool_input && typeof e.tool_input.description === 'string' ? e.tool_input.description.slice(0, 200) : '',
          },
        }) + '\n',
      ),
    )
    s.on('data', d => {
      buffer += d
      const i = buffer.indexOf('\n')
      if (i < 0) return
      try {
        resolve(JSON.parse(buffer.slice(0, i)).decisao || null)
      } catch {
        resolve(null)
      }
      s.destroy()
    })
    s.on('error', () => resolve(null))
    s.on('close', () => resolve(null))
  })

  if (decisao === 'allow' || decisao === 'deny') {
    const saida = { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: decisao } } }
    if (decisao === 'deny') saida.hookSpecificOutput.decision.message = 'O utilizador recusou pela barra «Voz».'
    process.stdout.write(JSON.stringify(saida) + '\n')
  }
}

principal()
  .catch(() => {})
  .finally(() => process.exit(0))
