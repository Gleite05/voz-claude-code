'use strict'
// Tudo o que transforma o que o Claude escreve ou faz em frases para dizer em voz alta.
// Funções puras: não tocam no disco nem em processos (são o que os testes cobrem).

// ---------- utilitários ----------

/** Último segmento de um caminho, sem aspas nem ":linha". */
function base(caminho) {
  const limpo = String(caminho || '').trim().replace(/^["']|["']$/g, '').replace(/:\d+(?::\d+)?$/, '')
  const partes = limpo.split(/[\\/]+/).filter(Boolean)
  return partes.length ? partes[partes.length - 1] : limpo
}

const PALAVRAS_PT = new Set(
  ('a o os as de do da dos das em no na nos nas um uma uns umas para pelo pela com que e é não por ao aos à às se ' +
    'ficheiro ficheiros pasta pastas correr instalar verificar ver listar criar abrir ler testar procurar mostrar ' +
    'atualizar apagar descarregar enviar copiar mover guardar compilar arrancar iniciar parar reiniciar configurar ' +
    'servidor comando código página utilizador sessão rede estado versão').split(' '),
)
const PALAVRAS_EN = new Set(
  ('the and to of for with in on from by at is are be this that it its list check run install show read create ' +
    'update delete remove get fetch find search open copy move build test start stop restart files file directory ' +
    'folder into out all new current status version server command page user').split(' '),
)

/** Heurística simples: o texto parece estar em português? */
function parecePortugues(texto) {
  const t = String(texto || '').toLowerCase()
  if (/[ãõç]|ção|ções/.test(t)) return true
  let pt = 0
  let en = 0
  for (const p of t.split(/[^a-zà-ÿ]+/).filter(Boolean)) {
    if (PALAVRAS_PT.has(p)) pt++
    if (PALAVRAS_EN.has(p)) en++
  }
  return pt > en
}

// ---------- limpeza de uma linha de texto ----------

const RE_URL = /\bhttps?:\/\/[^\s)>\]"'`]+/gi
// Caminhos: C:\x\y.txt, /usr/bin/x, src/a/b.ts, ~/.claude/x, ./x/y
const RE_CAMINHO = /(?:[A-Za-z]:)?(?:~|\.{1,2})?[\\/]?(?:[\w.@+-]+[\\/])+[\w.@+-]*/g

function trocarCaminho(m) {
  if (/^\d+\/\d+(\/\d+)?$/.test(m)) return m // datas e frações (18/11/2026, 3/4)
  const partes = m.split(/[\\/]+/).filter(Boolean)
  // "e/ou", "on/off": duas palavras curtas sem pontos nem barra invertida.
  if (partes.length === 2 && !m.includes('\\') && !m.includes('.') && partes.every(p => p.length <= 6)) {
    return partes.join(' ou ')
  }
  return base(m)
}

function hostDe(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'um link'
  }
}

/** Limpa uma linha de markdown para a voz. Devolve '' quando não há nada para dizer. */
function limparLinha(linha) {
  let t = String(linha || '')
  const titulo = /^\s{0,3}#{1,6}\s+/.test(t)

  t = t
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, '')
    .replace(/^\[[ xX]\]\s*/, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    .replace(/`([^`]*)`/g, (_, dentro) => (dentro.length <= 40 ? dentro : ' (código) '))
    .replace(RE_URL, url => hostDe(url))
    .replace(/\be\/ou\b/gi, 'e ou')
    .replace(RE_CAMINHO, trocarCaminho)
    .replace(/\*\*|__|~~|\*/g, '')
    .replace(/(^|\s)_([^_\s][^_]*)_(?=\s|$|[.,;:!?])/g, '$1$2')
    .replace(/\s*(?:→|->|=>|⇒)\s*/g, ' para ')
    .replace(/[←⇐]/g, ' ')
    .replace(/≈/g, ' cerca de ')
    .replace(/\s&\s/g, ' e ')
    .replace(/[|#^]/g, ' ')
    .replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[,;:.\s]+/, '')

  if (!/[\p{L}\p{N}]/u.test(t)) return ''
  if (titulo || !/[.!?…:;]$/.test(t)) t = t.replace(/[,:;]$/, '') + '.'
  return t
}

// ---------- texto em streaming (MessageDisplay) ----------

function novoEstado(maxCaracteres = 1200) {
  return { emCodigo: false, emTabela: false, caracteres: 0, cortado: false, max: maxCaracteres }
}

/**
 * Recebe um bloco de linhas acabadas e devolve as frases a dizer.
 * Guarda no estado se está dentro de um bloco de código ou tabela, e quanto já disse.
 */
function processarDelta(estado, delta) {
  const saida = []
  if (estado.cortado) return saida
  for (const linha of String(delta || '').split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(linha)) {
      estado.emCodigo = !estado.emCodigo
      continue
    }
    if (estado.emCodigo) continue
    if (/^\s*\|/.test(linha)) {
      if (!estado.emTabela) saida.push('Há uma tabela no ecrã.')
      estado.emTabela = true
      continue
    }
    estado.emTabela = false
    if (/^\s*([-*_]\s*){3,}$/.test(linha)) continue
    const frase = limparLinha(linha)
    if (!frase) continue
    if (estado.caracteres + frase.length > estado.max && estado.caracteres > 0) {
      saida.push('O resto está no ecrã.')
      estado.cortado = true
      break
    }
    estado.caracteres += frase.length
    saida.push(frase)
  }
  return saida
}

// ---------- anúncios de ações (PreToolUse) ----------

const PROGRAMAS = [
  [/^(git)$/, 'A usar o git.'],
  [/^(gh)$/, 'A falar com o GitHub.'],
  [/^(npm|npx|pnpm|yarn|bun)$/, p => `A correr o ${p}.`],
  [/^(node|deno|tsx|ts-node)$/, 'A correr um script em Node.'],
  [/^(python3?|py|uv|uvx)$/, 'A correr um script em Python.'],
  [/^(pip3?)$/, 'A instalar pacotes Python.'],
  [/^(curl|wget|invoke-webrequest|invoke-restmethod|iwr|irm)$/, 'A fazer um pedido à internet.'],
  [/^(ssh|plink|scp|sftp|pscp|rsync|enter-pssession|invoke-command)$/, 'A ligar a um servidor remoto.'],
  [/^(docker|docker-compose|podman|kubectl)$/, 'A usar contentores.'],
  [/^(ls|dir|get-childitem|gci|find|tree|fd|du)$/, 'A ver ficheiros.'],
  [/^(cat|head|tail|less|get-content|gc|type|sed|awk)$/, 'A ler ficheiros.'],
  [/^(grep|rg|select-string|findstr)$/, 'A pesquisar texto.'],
  [/^(rm|del|rmdir|remove-item)$/, 'A apagar ficheiros.'],
  [/^(mkdir|new-item|md|touch)$/, 'A criar ficheiros.'],
  [/^(cp|mv|copy|move|copy-item|move-item|robocopy|xcopy)$/, 'A copiar ficheiros.'],
  [/^(tar|unzip|zip|7z|expand-archive|compress-archive)$/, 'A tratar de um arquivo.'],
  [/^(claude)$/, 'A usar o Claude Code.'],
  [/^(winget|choco|scoop|brew|apt|apt-get|dnf|pacman)$/, 'A instalar programas.'],
  [/^(cargo|go|dotnet|mvn|gradle|gradlew|make|cmake|msbuild)$/, 'A compilar.'],
  [/^(get-service|get-process|tasklist|ps|systemctl|sc)$/, 'A ver serviços e processos.'],
  [/^(ping|test-netconnection|tracert|traceroute|nslookup|resolve-dnsname|ipconfig|ip|netstat)$/, 'A verificar a rede.'],
]

/** O primeiro programa de um comando de shell, sem cd, variáveis, sudo nem caminhos. */
function primeiroPrograma(comando) {
  let resto = String(comando || '').trim()
  for (let i = 0; i < 5; i++) {
    const antes = resto
    resto = resto
      .replace(/^cd\s+("[^"]*"|'[^']*'|\S+)\s*(?:&&|;|\|\|)\s*/i, '')
      .replace(/^(?:set-location|pushd)\s+("[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/i, '')
      .replace(/^\$?[A-Za-z_][\w:]*\s*=\s*("[^"]*"|'[^']*'|\S+)\s*(?:;|&&)?\s*/, '')
      .replace(/^(?:sudo|exec|time|nohup|env)\s+/, '')
      .replace(/^&\s*/, '')
      .trim()
    if (resto === antes) break
  }
  const m = /^("[^"]+"|'[^']+'|\S+)/.exec(resto)
  if (!m) return ''
  return base(m[1]).replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase()
}

function anunciarComando(entrada) {
  const comando = String(entrada.command || '')
  if (/scripts[\\/]voz\.js/.test(comando)) return null // os próprios comandos /voz:… ficam calados
  const desc = String(entrada.description || '').trim()
  if (desc && parecePortugues(desc)) return limparLinha(desc.slice(0, 140))
  const prog = primeiroPrograma(comando)
  for (const [re, frase] of PROGRAMAS) {
    const m = re.exec(prog)
    if (m) return typeof frase === 'function' ? frase(m[1]) : frase
  }
  return 'A executar um comando.'
}

const IGNORADAS = /^(TodoWrite|TodoRead|ToolSearch|TaskCreate|TaskUpdate|TaskList|TaskGet|TaskStop|ReadNotifications|EnterPlanMode|ListAgents|SendMessage|ScheduleWakeup|Monitor|ReportFindings)$/

/** Frase curta para uma chamada de ferramenta, ou null para ficar calado. */
function anunciarFerramenta(nome, entrada = {}) {
  nome = String(nome || '')
  entrada = entrada || {}
  if (IGNORADAS.test(nome)) return null
  switch (nome) {
    case 'Bash':
    case 'PowerShell':
      return anunciarComando(entrada)
    case 'Read':
      return entrada.file_path ? `A ler ${base(entrada.file_path)}.` : 'A ler um ficheiro.'
    case 'Edit':
    case 'MultiEdit':
      return entrada.file_path ? `A editar ${base(entrada.file_path)}.` : 'A editar um ficheiro.'
    case 'Write':
      return entrada.file_path ? `A escrever ${base(entrada.file_path)}.` : 'A escrever um ficheiro.'
    case 'NotebookEdit':
      return 'A editar um caderno.'
    case 'Glob':
      return 'A procurar ficheiros.'
    case 'Grep':
      return 'A pesquisar no código.'
    case 'WebSearch':
      return 'A pesquisar na internet.'
    case 'WebFetch':
      return entrada.url ? `A abrir ${hostDe(entrada.url)}.` : 'A abrir uma página web.'
    case 'Agent':
    case 'Task': {
      const d = String(entrada.description || '')
      return d && parecePortugues(d) ? `A pôr um assistente a ${limparLinha(d).replace(/\.$/, '')}.` : 'A lançar um assistente.'
    }
    case 'Workflow':
      return 'A lançar vários assistentes.'
    case 'AskUserQuestion':
      return 'Tenho uma pergunta para ti.'
    case 'ExitPlanMode':
      return 'O plano está pronto para aprovares.'
    case 'Skill':
      return entrada.skill ? `A usar a skill ${String(entrada.skill).split(':').pop()}.` : 'A usar uma skill.'
  }
  if (nome.startsWith('mcp__')) {
    if (/^mcp__(ccd_|smart-compact|savvy|visualize__read_me)/.test(nome)) return null // internos da app
    if (/claude-in-chrome|Claude_Browser/i.test(nome)) return 'A usar o navegador.'
    if (/computer-use/.test(nome)) return 'A controlar o ecrã.'
    return 'A usar uma ferramenta externa.'
  }
  if (/^[A-Za-z]{3,24}$/.test(nome)) return `A usar a ferramenta ${nome}.`
  return null
}

// ---------- pronúncia ----------

/**
 * Troca palavras pela forma como devem soar (só no áudio; a legenda mantém o original).
 * dicionario: { "Claude": "Cláude" } — palavra inteira, sem distinguir maiúsculas.
 */
function pronunciar(frase, dicionario) {
  let t = String(frase || '')
  for (const [palavra, som] of Object.entries(dicionario || {})) {
    if (!palavra || typeof som !== 'string') continue
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${palavra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'giu')
    t = t.replace(re, (_, antes) => antes + som)
  }
  return t
}

// ---------- notificações ----------

function frasesNotificacao(mensagem) {
  const m = String(mensagem || '').toLowerCase()
  if (/permission|permiss/.test(m)) return 'Preciso da tua autorização.'
  if (/waiting for your input|idle|à espera/.test(m)) return 'Estou à tua espera.'
  return 'Tenho uma notificação para ti.'
}

module.exports = {
  base,
  parecePortugues,
  limparLinha,
  novoEstado,
  processarDelta,
  anunciarFerramenta,
  primeiroPrograma,
  frasesNotificacao,
  pronunciar,
}
