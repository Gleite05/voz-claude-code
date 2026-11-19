'use strict'
// Gancho PermissionRequest: mostra o pedido de autorização na barra («Permitir» / «Recusar»)
// e devolve a tua decisão ao Claude Code.
//
// Na app do Claude (Agent SDK) este gancho corre AO LADO do diálogo normal e vale quem decidir
// primeiro — por isso pode esperar pela barra. No terminal interativo o gancho correria antes do
// diálogo, por isso aí não espera (não atrasa nada): sai logo sem decidir.

const fs = require('node:fs')
const net = require('node:net')
const crypto = require('node:crypto')
const { CAMINHOS, lerConfig } = require('./comum')
const { daFerramenta } = require('./diff')

const MAX_FICHEIRO = 1024 * 1024

/** Conteúdo atual de um ficheiro pequeno (para o diff de um Write), ou null. */
function lerAtual(caminho) {
  try {
    if (!caminho || fs.statSync(caminho).size > MAX_FICHEIRO) return null
    return fs.readFileSync(caminho, 'utf8')
  } catch {
    return null
  }
}

/**
 * O que «Permitir sempre» faria, para a barra mostrar no botão: as regras sugeridas pelo próprio
 * Claude Code (as mesmas do «não voltar a perguntar» do diálogo normal). Sem sugestões, não há botão.
 */
function descreverSugestoes(sugestoes) {
  if (!Array.isArray(sugestoes) || !sugestoes.length) return null
  const regras = []
  let modo = null
  let destino = null
  for (const x of sugestoes) {
    if (!x || typeof x !== 'object') continue
    destino = destino || x.destination || null
    if (x.type === 'addRules' && x.behavior === 'allow' && Array.isArray(x.rules)) {
      for (const r of x.rules) if (r && r.toolName) regras.push(r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName)
    } else if (x.type === 'setMode' && typeof x.mode === 'string') modo = x.mode
    else if (x.type === 'addDirectories' && Array.isArray(x.directories)) regras.push(...x.directories.map(d => String(d)))
  }
  if (!regras.length && !modo) return null
  return { regras: regras.slice(0, 4).map(r => r.slice(0, 120)), modo, destino }
}

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
  const sugestoes = Array.isArray(e.permission_suggestions) ? e.permission_suggestions : null
  let diff = null
  try {
    diff = daFerramenta(e.tool_name, e.tool_input, lerAtual)
  } catch {}

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
            sempre: descreverSugestoes(sugestoes),
            diff,
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

  if (decisao === 'allow' || decisao === 'deny' || decisao === 'always') {
    const saida = { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: decisao === 'deny' ? 'deny' : 'allow' } } }
    if (decisao === 'deny') saida.hookSpecificOutput.decision.message = 'O utilizador recusou pela barra «Voz».'
    // «Permitir sempre»: aplica as regras que o Claude Code sugeriu para este pedido.
    if (decisao === 'always' && sugestoes) saida.hookSpecificOutput.decision.updatedPermissions = sugestoes
    process.stdout.write(JSON.stringify(saida) + '\n')
  }
}

principal()
  .catch(() => {})
  .finally(() => process.exit(0))
