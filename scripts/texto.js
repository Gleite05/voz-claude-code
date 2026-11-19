'use strict'
// Tudo o que transforma o que o Claude escreve ou faz em frases para dizer em voz alta.
// Funções puras: não tocam no disco nem em processos (são o que os testes cobrem).

// ---------- frases em várias línguas ----------

const FRASES = {
  pt: {
    git: 'A usar o git.', gh: 'A falar com o GitHub.', npm: p => `A correr o ${p}.`, node: 'A correr um script em Node.',
    python: 'A correr um script em Python.', pip: 'A instalar pacotes Python.', web: 'A fazer um pedido à internet.',
    remoto: 'A ligar a um servidor remoto.', contentores: 'A usar contentores.', verFich: 'A ver ficheiros.', lerFich: 'A ler ficheiros.',
    pesquisarTexto: 'A pesquisar texto.', apagar: 'A apagar ficheiros.', criar: 'A criar ficheiros.', copiar: 'A copiar ficheiros.',
    arquivo: 'A tratar de um arquivo.', claude: 'A usar o Claude Code.', instalarProg: 'A instalar programas.', compilar: 'A compilar.',
    servicos: 'A ver serviços e processos.', rede: 'A verificar a rede.', comando: 'A executar um comando.',
    ler: f => `A ler ${f}.`, lerUm: 'A ler um ficheiro.', editar: f => `A editar ${f}.`, editarUm: 'A editar um ficheiro.',
    escrever: f => `A escrever ${f}.`, escreverUm: 'A escrever um ficheiro.', caderno: 'A editar um caderno.',
    procurarFich: 'A procurar ficheiros.', pesquisarCodigo: 'A pesquisar no código.', pesquisarNet: 'A pesquisar na internet.',
    abrir: h => `A abrir ${h}.`, abrirPagina: 'A abrir uma página web.', assistente: d => `A pôr um assistente a ${d}.`,
    assistenteSo: 'A lançar um assistente.', workflow: 'A lançar vários assistentes.', pergunta: 'Tenho uma pergunta para ti.',
    plano: 'O plano está pronto para aprovares.', skill: s => `A usar a skill ${s}.`, skillUma: 'A usar uma skill.',
    navegador: 'A usar o navegador.', ecra: 'A controlar o ecrã.', externa: 'A usar uma ferramenta externa.', ferramenta: n => `A usar a ferramenta ${n}.`,
    notifPerm: 'Preciso da tua autorização.', notifEspera: 'Estou à tua espera.', notifOutra: 'Tenho uma notificação para ti.',
    tabela: 'Há uma tabela no ecrã.', resto: 'O resto está no ecrã.', codigo: '(código)', link: 'um link', ou: 'ou',
    naSessao: (p, f) => `Na sessão de ${p}: ${f}`, sessaoTerminou: p => `A sessão de ${p} terminou.`, outraPasta: 'outra pasta',
    instalar: 'Para a voz natural, escreve barra voz, dois pontos, instalar.', testar: 'Olá! A voz está a funcionar.',
    aPensar: 'A pensar', aEscrever: 'A escrever', terminou: 'Terminou',
    testesOk: n => (n === 1 ? 'O teste passou.' : n ? `Os ${n} testes passaram.` : 'Os testes passaram.'),
    testesFalha: n => (n === 1 ? 'Falhou um teste.' : n ? `Falharam ${n} testes.` : 'Os testes falharam.'),
    compilarOk: 'Compilação concluída.', compilarFalha: 'A compilação falhou.', pushOk: 'Push feito.', pushFalha: 'O push falhou.',
    instalarOk: 'Instalação concluída.', instalarFalha: 'A instalação falhou.', deployOk: 'Publicação concluída.', deployFalha: 'A publicação falhou.',
    longoOk: d => `Comando concluído, demorou ${d}.`, compactar: 'A compactar a conversa para libertar contexto.', aCompactar: 'A compactar a conversa',
    falhou: p => `${p} falhou`, seg: n => (n === 1 ? '1 segundo' : `${n} segundos`), min: n => (n === 1 ? '1 minuto' : `${n} minutos`), e: 'e',
    topicos: l => `Também fala de ${l}.`, perguntaFim: q => `E no fim pergunta: ${q}`,
    ditadoNaoInstalado: 'O ditado não está instalado: corre /voz:instalar ouvir.', jaRespondido: 'este pedido já foi respondido',
  },
  en: {
    git: 'Using git.', gh: 'Talking to GitHub.', npm: p => `Running ${p}.`, node: 'Running a Node script.',
    python: 'Running a Python script.', pip: 'Installing Python packages.', web: 'Making a web request.',
    remoto: 'Connecting to a remote server.', contentores: 'Using containers.', verFich: 'Looking at files.', lerFich: 'Reading files.',
    pesquisarTexto: 'Searching text.', apagar: 'Deleting files.', criar: 'Creating files.', copiar: 'Copying files.',
    arquivo: 'Handling an archive.', claude: 'Using Claude Code.', instalarProg: 'Installing programs.', compilar: 'Building.',
    servicos: 'Checking services and processes.', rede: 'Checking the network.', comando: 'Running a command.',
    ler: f => `Reading ${f}.`, lerUm: 'Reading a file.', editar: f => `Editing ${f}.`, editarUm: 'Editing a file.',
    escrever: f => `Writing ${f}.`, escreverUm: 'Writing a file.', caderno: 'Editing a notebook.',
    procurarFich: 'Finding files.', pesquisarCodigo: 'Searching the code.', pesquisarNet: 'Searching the web.',
    abrir: h => `Opening ${h}.`, abrirPagina: 'Opening a web page.', assistente: d => `Starting an agent: ${d}.`,
    assistenteSo: 'Starting an agent.', workflow: 'Starting several agents.', pergunta: 'I have a question for you.',
    plano: 'The plan is ready for your approval.', skill: s => `Using the ${s} skill.`, skillUma: 'Using a skill.',
    navegador: 'Using the browser.', ecra: 'Controlling the screen.', externa: 'Using an external tool.', ferramenta: n => `Using the ${n} tool.`,
    notifPerm: 'I need your permission.', notifEspera: "I'm waiting for you.", notifOutra: 'I have a notification for you.',
    tabela: "There's a table on the screen.", resto: 'The rest is on the screen.', codigo: '(code)', link: 'a link', ou: 'or',
    naSessao: (p, f) => `In the ${p} session: ${f}`, sessaoTerminou: p => `The ${p} session has finished.`, outraPasta: 'another folder',
    instalar: 'For a natural voice, type slash voz, colon, instalar.', testar: 'Hello! The voice is working.',
    aPensar: 'Thinking', aEscrever: 'Writing', terminou: 'Done',
    testesOk: n => (n === 1 ? 'The test passed.' : n ? `All ${n} tests passed.` : 'The tests passed.'),
    testesFalha: n => (n === 1 ? 'One test failed.' : n ? `${n} tests failed.` : 'The tests failed.'),
    compilarOk: 'Build finished.', compilarFalha: 'The build failed.', pushOk: 'Push done.', pushFalha: 'The push failed.',
    instalarOk: 'Install finished.', instalarFalha: 'The install failed.', deployOk: 'Deploy finished.', deployFalha: 'The deploy failed.',
    longoOk: d => `Command finished, it took ${d}.`, compactar: 'Compacting the conversation to free up context.', aCompactar: 'Compacting the conversation',
    falhou: p => `${p} failed`, seg: n => (n === 1 ? '1 second' : `${n} seconds`), min: n => (n === 1 ? '1 minute' : `${n} minutes`), e: 'and',
    topicos: l => `It also covers ${l}.`, perguntaFim: q => `And at the end it asks: ${q}`,
    ditadoNaoInstalado: 'Dictation is not installed: run /voz:instalar ouvir.', jaRespondido: 'this request has already been answered',
  },
  es: {
    git: 'Usando git.', gh: 'Hablando con GitHub.', npm: p => `Ejecutando ${p}.`, node: 'Ejecutando un script de Node.',
    python: 'Ejecutando un script de Python.', pip: 'Instalando paquetes de Python.', web: 'Haciendo una petición a internet.',
    remoto: 'Conectando con un servidor remoto.', contentores: 'Usando contenedores.', verFich: 'Mirando archivos.', lerFich: 'Leyendo archivos.',
    pesquisarTexto: 'Buscando texto.', apagar: 'Borrando archivos.', criar: 'Creando archivos.', copiar: 'Copiando archivos.',
    arquivo: 'Trabajando con un archivo comprimido.', claude: 'Usando Claude Code.', instalarProg: 'Instalando programas.', compilar: 'Compilando.',
    servicos: 'Revisando servicios y procesos.', rede: 'Comprobando la red.', comando: 'Ejecutando un comando.',
    ler: f => `Leyendo ${f}.`, lerUm: 'Leyendo un archivo.', editar: f => `Editando ${f}.`, editarUm: 'Editando un archivo.',
    escrever: f => `Escribiendo ${f}.`, escreverUm: 'Escribiendo un archivo.', caderno: 'Editando un cuaderno.',
    procurarFich: 'Buscando archivos.', pesquisarCodigo: 'Buscando en el código.', pesquisarNet: 'Buscando en internet.',
    abrir: h => `Abriendo ${h}.`, abrirPagina: 'Abriendo una página web.', assistente: d => `Iniciando un asistente: ${d}.`,
    assistenteSo: 'Iniciando un asistente.', workflow: 'Iniciando varios asistentes.', pergunta: 'Tengo una pregunta para ti.',
    plano: 'El plan está listo para que lo apruebes.', skill: s => `Usando la skill ${s}.`, skillUma: 'Usando una skill.',
    navegador: 'Usando el navegador.', ecra: 'Controlando la pantalla.', externa: 'Usando una herramienta externa.', ferramenta: n => `Usando la herramienta ${n}.`,
    notifPerm: 'Necesito tu permiso.', notifEspera: 'Te estoy esperando.', notifOutra: 'Tengo una notificación para ti.',
    tabela: 'Hay una tabla en la pantalla.', resto: 'El resto está en la pantalla.', codigo: '(código)', link: 'un enlace', ou: 'o',
    naSessao: (p, f) => `En la sesión de ${p}: ${f}`, sessaoTerminou: p => `La sesión de ${p} ha terminado.`, outraPasta: 'otra carpeta',
    instalar: 'Para una voz natural, escribe barra voz, dos puntos, instalar.', testar: '¡Hola! La voz funciona.',
    aPensar: 'Pensando', aEscrever: 'Escribiendo', terminou: 'Terminado',
    testesOk: n => (n === 1 ? 'La prueba pasó.' : n ? `Las ${n} pruebas pasaron.` : 'Las pruebas pasaron.'),
    testesFalha: n => (n === 1 ? 'Ha fallado una prueba.' : n ? `Han fallado ${n} pruebas.` : 'Las pruebas fallaron.'),
    compilarOk: 'Compilación terminada.', compilarFalha: 'La compilación falló.', pushOk: 'Push hecho.', pushFalha: 'El push falló.',
    instalarOk: 'Instalación terminada.', instalarFalha: 'La instalación falló.', deployOk: 'Despliegue terminado.', deployFalha: 'El despliegue falló.',
    longoOk: d => `Comando terminado, tardó ${d}.`, compactar: 'Compactando la conversación para liberar contexto.', aCompactar: 'Compactando la conversación',
    falhou: p => `${p} falló`, seg: n => (n === 1 ? '1 segundo' : `${n} segundos`), min: n => (n === 1 ? '1 minuto' : `${n} minutos`), e: 'y',
    topicos: l => `También habla de ${l}.`, perguntaFim: q => `Y al final pregunta: ${q}`,
    ditadoNaoInstalado: 'El dictado no está instalado: ejecuta /voz:instalar ouvir.', jaRespondido: 'esta petición ya se respondió',
  },
}

/** A frase `chave` na língua pedida (pt, en, es); funções recebem os argumentos extra. */
function frase(idioma, chave, ...args) {
  const d = FRASES[idioma] || FRASES.pt
  const v = d[chave] !== undefined ? d[chave] : FRASES.pt[chave]
  return typeof v === 'function' ? v(...args) : v
}

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

function trocarCaminho(m, idioma = 'pt') {
  if (/^\d+\/\d+(\/\d+)?$/.test(m)) return m // datas e frações (18/11/2026, 3/4)
  const partes = m.split(/[\\/]+/).filter(Boolean)
  // "e/ou", "on/off": duas palavras curtas sem pontos nem barra invertida.
  if (partes.length === 2 && !m.includes('\\') && !m.includes('.') && partes.every(p => p.length <= 6)) {
    return partes.join(' ' + frase(idioma, 'ou') + ' ')
  }
  return base(m)
}

function hostDe(url, idioma = 'pt') {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return frase(idioma, 'link')
  }
}

/** Limpa uma linha de markdown para a voz. Devolve '' quando não há nada para dizer. */
function limparLinha(linha, idioma = 'pt') {
  const P = { para: { pt: 'para', en: 'to', es: 'a' }, cerca: { pt: 'cerca de', en: 'about', es: 'cerca de' }, e: { pt: 'e', en: 'and', es: 'y' } }
  const pal = k => P[k][idioma] || P[k].pt
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
    .replace(/`([^`]*)`/g, (_, dentro) => (dentro.length <= 40 ? dentro : ' ' + frase(idioma, 'codigo') + ' '))
    .replace(RE_URL, url => hostDe(url, idioma))
    .replace(/\be\/ou\b/gi, 'e ou')
    .replace(RE_CAMINHO, m => trocarCaminho(m, idioma))
    .replace(/\*\*|__|~~|\*/g, '')
    .replace(/(^|\s)_([^_\s][^_]*)_(?=\s|$|[.,;:!?])/g, '$1$2')
    .replace(/\s*(?:→|->|=>|⇒)\s*/g, ' ' + pal('para') + ' ')
    .replace(/[←⇐]/g, ' ')
    .replace(/≈/g, ' ' + pal('cerca') + ' ')
    .replace(/\s&\s/g, ' ' + pal('e') + ' ')
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

function novoEstado(maxCaracteres = 1200, idioma = 'pt') {
  return { emCodigo: false, emTabela: false, caracteres: 0, cortado: false, max: maxCaracteres, idioma, titulos: [], ultima: '' }
}

const RE_TITULO = /^\s{0,3}#{1,6}\s+|^\s*\*\*[^*]{2,80}\*\*:?\s*$/

/**
 * Recebe um bloco de linhas acabadas e devolve as frases a dizer.
 * Guarda no estado se está dentro de um bloco de código ou tabela, e quanto já disse.
 * Depois do limite fica calado, mas continua a tomar nota dos títulos e da última frase
 * (para fecharMensagem dizer de que mais fala e a pergunta do fim).
 */
function processarDelta(estado, delta) {
  const saida = []
  for (const linha of String(delta || '').split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(linha)) {
      estado.emCodigo = !estado.emCodigo
      continue
    }
    if (estado.emCodigo) continue
    if (/^\s*\|/.test(linha)) {
      if (!estado.emTabela && !estado.cortado) saida.push(frase(estado.idioma, 'tabela'))
      estado.emTabela = true
      continue
    }
    estado.emTabela = false
    if (/^\s*([-*_]\s*){3,}$/.test(linha)) continue
    const dita = limparLinha(linha, estado.idioma)
    if (!dita) continue
    if (estado.cortado) {
      if (RE_TITULO.test(linha)) estado.titulos.push(dita.replace(/[.:]$/, ''))
      else estado.ultima = dita
      continue
    }
    if (estado.caracteres + dita.length > estado.max && estado.caracteres > 0) {
      saida.push(frase(estado.idioma, 'resto'))
      estado.cortado = true
      if (RE_TITULO.test(linha)) estado.titulos.push(dita.replace(/[.:]$/, ''))
      else estado.ultima = dita
      continue
    }
    estado.caracteres += dita.length
    saida.push(dita)
  }
  return saida
}

/** «A, B e C» */
function juntarLista(itens, idioma) {
  if (itens.length <= 1) return itens.join('')
  return itens.slice(0, -1).join(', ') + ' ' + frase(idioma, 'e') + ' ' + itens[itens.length - 1]
}

/**
 * Fim de uma mensagem longa: os temas que ficaram por dizer e, se a mensagem acaba numa pergunta, a pergunta.
 * Mensagens que couberam no limite não acrescentam nada.
 */
function fecharMensagem(estado) {
  if (!estado || !estado.cortado) return []
  const saida = []
  const titulos = [...new Set(estado.titulos)].filter(t => t.length <= 60).slice(0, 5)
  if (titulos.length) saida.push(frase(estado.idioma, 'topicos', juntarLista(titulos, estado.idioma)))
  const u = estado.ultima
  if (u && /\?$/.test(u) && u.length <= 300) saida.push(frase(estado.idioma, 'perguntaFim', u))
  return saida
}

// ---------- anúncios de ações (PreToolUse) ----------

const PROGRAMAS = [
  [/^(git)$/, 'git'],
  [/^(gh)$/, 'gh'],
  [/^(npm|npx|pnpm|yarn|bun)$/, 'npm'],
  [/^(node|deno|tsx|ts-node)$/, 'node'],
  [/^(python3?|py|uv|uvx)$/, 'python'],
  [/^(pip3?)$/, 'pip'],
  [/^(curl|wget|invoke-webrequest|invoke-restmethod|iwr|irm)$/, 'web'],
  [/^(ssh|plink|scp|sftp|pscp|rsync|enter-pssession|invoke-command)$/, 'remoto'],
  [/^(docker|docker-compose|podman|kubectl)$/, 'contentores'],
  [/^(ls|dir|get-childitem|gci|find|tree|fd|du)$/, 'verFich'],
  [/^(cat|head|tail|less|get-content|gc|type|sed|awk)$/, 'lerFich'],
  [/^(grep|rg|select-string|findstr)$/, 'pesquisarTexto'],
  [/^(rm|del|rmdir|remove-item)$/, 'apagar'],
  [/^(mkdir|new-item|md|touch)$/, 'criar'],
  [/^(cp|mv|copy|move|copy-item|move-item|robocopy|xcopy)$/, 'copiar'],
  [/^(tar|unzip|zip|7z|expand-archive|compress-archive)$/, 'arquivo'],
  [/^(claude)$/, 'claude'],
  [/^(winget|choco|scoop|brew|apt|apt-get|dnf|pacman)$/, 'instalarProg'],
  [/^(cargo|go|dotnet|mvn|gradle|gradlew|make|cmake|msbuild)$/, 'compilar'],
  [/^(get-service|get-process|tasklist|ps|systemctl|sc)$/, 'servicos'],
  [/^(ping|test-netconnection|tracert|traceroute|nslookup|resolve-dnsname|ipconfig|ip|netstat)$/, 'rede'],
]

/** Língua provável de uma frase curta (pt, en, es) — para decidir se a descrição do Claude serve. */
function idiomaDe(texto) {
  const t = ' ' + String(texto || '').toLowerCase().replace(/[^a-zà-ÿ\s]/g, ' ') + ' '
  if (/[ãõç]/.test(t)) return 'pt'
  const conta = lista => lista.split(' ').filter(p => t.includes(' ' + p + ' ')).length
  const n = {
    pt: conta('o a os as de do da dos das em no na um uma para com que não ficheiro ficheiros pasta correr instalar verificar ver'),
    en: conta('the and to of for with in on from list check run install show read create update delete files file folder'),
    es: conta('el la los las de del en un una para con que no archivo archivos carpeta ejecutar instalar comprobar ver'),
  }
  const melhor = Object.entries(n).sort((a, b) => b[1] - a[1])[0]
  return melhor[1] > 0 ? melhor[0] : null
}

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

function anunciarComando(entrada, idioma = 'pt') {
  const comando = String(entrada.command || '')
  if (/scripts[\\/]voz\.js/.test(comando)) return null // os próprios comandos /voz:… ficam calados
  const desc = String(entrada.description || '').trim()
  // A descrição do Claude só serve se estiver na língua da voz.
  if (desc && idiomaDe(desc) === idioma) return limparLinha(desc.slice(0, 140), idioma)
  const prog = primeiroPrograma(comando)
  for (const [re, chave] of PROGRAMAS) {
    const m = re.exec(prog)
    if (m) return frase(idioma, chave, m[1])
  }
  return frase(idioma, 'comando')
}

const IGNORADAS = /^(TodoWrite|TodoRead|ToolSearch|TaskCreate|TaskUpdate|TaskList|TaskGet|TaskStop|ReadNotifications|EnterPlanMode|ListAgents|SendMessage|ScheduleWakeup|Monitor|ReportFindings)$/

/** Frase curta para uma chamada de ferramenta, ou null para ficar calado. */
function anunciarFerramenta(nome, entrada = {}, idioma = 'pt') {
  const f = (chave, ...a) => frase(idioma, chave, ...a)
  nome = String(nome || '')
  entrada = entrada || {}
  if (IGNORADAS.test(nome)) return null
  switch (nome) {
    case 'Bash':
    case 'PowerShell':
      return anunciarComando(entrada, idioma)
    case 'Read':
      return entrada.file_path ? f('ler', base(entrada.file_path)) : f('lerUm')
    case 'Edit':
    case 'MultiEdit':
      return entrada.file_path ? f('editar', base(entrada.file_path)) : f('editarUm')
    case 'Write':
      return entrada.file_path ? f('escrever', base(entrada.file_path)) : f('escreverUm')
    case 'NotebookEdit':
      return f('caderno')
    case 'Glob':
      return f('procurarFich')
    case 'Grep':
      return f('pesquisarCodigo')
    case 'WebSearch':
      return f('pesquisarNet')
    case 'WebFetch':
      return entrada.url ? f('abrir', hostDe(entrada.url, idioma)) : f('abrirPagina')
    case 'Agent':
    case 'Task': {
      const d = String(entrada.description || '')
      return d && idiomaDe(d) === idioma ? f('assistente', limparLinha(d, idioma).replace(/\.$/, '')) : f('assistenteSo')
    }
    case 'Workflow':
      return f('workflow')
    case 'AskUserQuestion':
      return f('pergunta')
    case 'ExitPlanMode':
      return f('plano')
    case 'Skill':
      return entrada.skill ? f('skill', String(entrada.skill).split(':').pop()) : f('skillUma')
  }
  if (nome.startsWith('mcp__')) {
    if (/^mcp__(ccd_|smart-compact|savvy|visualize__read_me)/.test(nome)) return null // internos da app
    if (/claude-in-chrome|Claude_Browser/i.test(nome)) return f('navegador')
    if (/computer-use/.test(nome)) return f('ecra')
    return f('externa')
  }
  if (/^[A-Za-z]{3,24}$/.test(nome)) return f('ferramenta', nome)
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

// ---------- resultados (PostToolUse / PostToolUseFailure) ----------

// O tipo de comando decide se o resultado merece voz: um grep sem resultados também «falha».
const TIPOS_COMANDO = [
  ['testes', /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\b(?:jest|vitest|mocha|ava|phpunit|rspec|ctest|pytest|tox)\b|\bplaywright\s+test\b|\bcypress\s+run\b|\bpython3?\s+-m\s+(?:pytest|unittest)\b|\bnode\s+--test\b|\b(?:go|cargo|dotnet|swift|deno|bun)\s+test\b|\b(?:mvn|gradlew?)\b[^|;&]*\btest\b|\binvoke-pester\b/i],
  ['deploy', /\b(?:vercel|netlify|firebase|fly|wrangler)\s+(?:deploy|--prod)\b|\bvercel\s+--prod\b|\bkubectl\s+apply\b|\bdocker\s+(?:compose\s+up|push)\b|\bgh\s+release\s+create\b/i],
  ['push', /\bgit\s+push\b/i],
  ['instalar', /\b(?:npm|pnpm|yarn|bun)\s+(?:install|i|ci|add)\b|\b(?:pip3?|uv\s+pip|cargo|winget|choco|scoop|brew)\s+install\b|\buv\s+(?:sync|add)\b|\bapt(?:-get)?\s+install\b/i],
  ['compilar', /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b|\b(?:vite|next|astro|nuxt|webpack|rollup|esbuild)\s+build\b|\btsc\b|\b(?:cargo|go|swift)\s+build\b|\bdotnet\s+(?:build|publish)\b|\bmsbuild\b|\bmake\b|\bcmake\s+--build\b|\b(?:mvn|gradlew?)\b[^|;&]*\b(?:package|assemble|build|install)\b|\bcsc(?:\.exe)?\b|\bcompilar-barra\b|\bgradlew?\s+assemble/i],
]

/** testes | deploy | push | instalar | compilar | null */
function tipoComando(comando) {
  const c = String(comando || '')
  if (/scripts[\\/]voz\.js/.test(c)) return null
  for (const [tipo, re] of TIPOS_COMANDO) if (re.test(c)) return tipo
  return null
}

/** Quantos testes passaram/falharam, lido da saída dos executores mais comuns (o último número ganha). */
function contarTestes(saida) {
  const s = String(saida || '')
  const ultimo = re => {
    let m
    let v = null
    re.lastIndex = 0
    while ((m = re.exec(s))) v = Number(m[1])
    return v
  }
  const passaram =
    ultimo(/(?:^|[\s#ℹ✔])pass(?:ed)?\s+(\d+)\b/gim) ??
    ultimo(/\b(\d+)\s+(?:passed|passing)\b/gi) ??
    ultimo(/\bPassed:\s*(\d+)/g)
  const falharam =
    ultimo(/(?:^|[\s#ℹ✖])fail(?:ed)?\s+(\d+)\b/gim) ??
    ultimo(/\b(\d+)\s+(?:failed|failing)\b/gi) ??
    ultimo(/\bFailed:\s*(\d+)/g)
  return { passaram, falharam }
}

/** «42 segundos», «1 minuto e 20 segundos», «3 minutos». */
function duracaoFalada(ms, idioma = 'pt') {
  const total = Math.max(1, Math.round(Number(ms) / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  if (!m) return frase(idioma, 'seg', s)
  if (!s || m >= 5) return frase(idioma, 'min', m)
  return `${frase(idioma, 'min', m)} ${frase(idioma, 'e')} ${frase(idioma, 'seg', s)}`
}

const LONGO_MS = 60 * 1000

/**
 * Frase para o fim de um comando, ou null para ficar calado.
 * r = { ok, erro, saida, duracaoMs, interrompido }
 */
function avaliarResultado(ferramenta, entrada, r, idioma = 'pt') {
  if (ferramenta !== 'Bash' && ferramenta !== 'PowerShell') return null
  if (!r || r.interrompido) return null
  const tipo = tipoComando(entrada && entrada.command)
  const f = (k, ...a) => frase(idioma, k, ...a)
  const dur = Number(r.duracaoMs) || 0
  const bom = frase => ({ frase, bom: true })
  const mau = frase => ({ frase, bom: false })
  if (tipo === 'testes') {
    const n = contarTestes(r.ok ? r.saida : r.erro || r.saida)
    if (r.ok && !n.falharam) return bom(f('testesOk', n.passaram))
    return mau(f('testesFalha', n.falharam))
  }
  if (tipo === 'compilar') return r.ok ? (dur >= 15000 ? bom(f('compilarOk')) : null) : mau(f('compilarFalha'))
  if (tipo === 'instalar') return r.ok ? (dur >= 20000 ? bom(f('instalarOk')) : null) : mau(f('instalarFalha'))
  if (tipo === 'push') return r.ok ? bom(f('pushOk')) : mau(f('pushFalha'))
  if (tipo === 'deploy') return r.ok ? bom(f('deployOk')) : mau(f('deployFalha'))
  if (r.ok && dur >= LONGO_MS) return bom(f('longoOk', duracaoFalada(dur, idioma)))
  return null
}

function anunciarResultado(ferramenta, entrada, r, idioma = 'pt') {
  const a = avaliarResultado(ferramenta, entrada, r, idioma)
  return a ? a.frase : null
}

/** Legenda curta de uma falha para a ilha («npm test falhou»), ou null se não interessa mostrar. */
function legendaFalha(ferramenta, entrada, idioma = 'pt') {
  if (ferramenta !== 'Bash' && ferramenta !== 'PowerShell') return null
  const comando = String((entrada && entrada.command) || '')
  if (!tipoComando(comando)) return null
  const limpo = comando.replace(/^cd\s+("[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/i, '').split(/\s*(?:&&|\|\||;|\|)\s*/)[0].trim()
  const curto = limpo.length > 40 ? limpo.slice(0, 39) + '…' : limpo
  return frase(idioma, 'falhou', curto || primeiroPrograma(comando))
}

// ---------- «enquanto estiveste fora» ----------

const FORA = {
  pt: {
    inicio: l => `Olá de novo. Enquanto estiveste fora: ${l}.`,
    terminou: t => `${t} terminou`, terminaram: l => `${l} terminaram`,
    precisa: t => `${t} precisa de ti`, precisam: l => `${l} precisam de ti`,
    falhou: (t, f) => `em ${t}, ${f}`, trabalha: t => `${t} continua a trabalhar`, trabalham: n => `${n} conversas continuam a trabalhar`,
  },
  en: {
    inicio: l => `Welcome back. While you were away: ${l}.`,
    terminou: t => `${t} finished`, terminaram: l => `${l} finished`,
    precisa: t => `${t} needs you`, precisam: l => `${l} need you`,
    falhou: (t, f) => `in ${t}, ${f}`, trabalha: t => `${t} is still working`, trabalham: n => `${n} conversations are still working`,
  },
  es: {
    inicio: l => `Hola de nuevo. Mientras estabas fuera: ${l}.`,
    terminou: t => `${t} terminó`, terminaram: l => `${l} terminaron`,
    precisa: t => `${t} te necesita`, precisam: l => `${l} te necesitan`,
    falhou: (t, f) => `en ${t}, ${f}`, trabalha: t => `${t} sigue trabajando`, trabalham: n => `${n} conversaciones siguen trabajando`,
  },
}

/**
 * Frase de regresso, ou null se nada aconteceu.
 * r = { terminaram: [títulos], precisam: [títulos], falhas: [{ titulo, texto }], trabalham: [títulos] }
 */
function resumoAusencia(r, idioma = 'pt') {
  const F = FORA[idioma] || FORA.pt
  const lista = l => juntarLista(l, idioma)
  const partes = []
  const term = r.terminaram || []
  const prec = r.precisam || []
  const falhas = r.falhas || []
  if (!term.length && !prec.length && !falhas.length) return null
  if (term.length) partes.push(term.length === 1 ? F.terminou(term[0]) : F.terminaram(lista(term)))
  for (const f of falhas.slice(0, 2)) partes.push(F.falhou(f.titulo, f.texto))
  if (prec.length) partes.push(prec.length === 1 ? F.precisa(prec[0]) : F.precisam(lista(prec)))
  const trab = r.trabalham || []
  if (trab.length) partes.push(trab.length === 1 ? F.trabalha(trab[0]) : F.trabalham(trab.length))
  return F.inicio(partes.join('; '))
}

// ---------- voz: autorizar e mãos-livres ----------

const VOZ = {
  pt: {
    pede: (c, a) => `${c ? c + ' pede' : 'Peço'} autorização para ${a}. Autorizas?`,
    correr: p => `correr ${p}`, editar: f => `editar ${f}`, usar: f => `usar ${f}`, comando: 'correr um comando',
    autorizado: 'Autorizado.', autorizadoSempre: 'Autorizado, e não volto a perguntar.', recusado: 'Recusado.', fim: 'Está bem, fico à espera.',
  },
  en: {
    pede: (c, a) => `${c || 'I'} ${c ? 'wants' : 'want'} to ${a}. Allow?`,
    correr: p => `run ${p}`, editar: f => `edit ${f}`, usar: f => `use ${f}`, comando: 'run a command',
    autorizado: 'Allowed.', autorizadoSempre: "Allowed, and I won't ask again.", recusado: 'Denied.', fim: "Okay, I'll wait.",
  },
  es: {
    pede: (c, a) => `${c ? c + ' pide' : 'Pido'} permiso para ${a}. ¿Lo permites?`,
    correr: p => `ejecutar ${p}`, editar: f => `editar ${f}`, usar: f => `usar ${f}`, comando: 'ejecutar un comando',
    autorizado: 'Permitido.', autorizadoSempre: 'Permitido, y no volveré a preguntar.', recusado: 'Rechazado.', fim: 'Vale, me quedo esperando.',
  },
}

/** Frase da voz para os pedidos falados (`chave` em VOZ). */
function fraseVoz(idioma, chave, ...args) {
  const d = VOZ[idioma] || VOZ.pt
  const v = d[chave]
  return typeof v === 'function' ? v(...args) : v
}

/** «Voz 1.3 pede autorização para correr git. Autorizas?» */
function perguntaAutorizacao(ferramenta, resumo, conversa, idioma = 'pt') {
  const r = String(resumo || '')
  let acao
  if (ferramenta === 'Bash' || ferramenta === 'PowerShell') {
    const p = primeiroPrograma(r)
    acao = p ? fraseVoz(idioma, 'correr', p) : fraseVoz(idioma, 'comando')
  } else if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(ferramenta || '')) acao = fraseVoz(idioma, 'editar', base(r) || r)
  else acao = fraseVoz(idioma, 'usar', String(ferramenta || '').replace(/^mcp__[^_]+__/, '').replace(/_/g, ' '))
  return fraseVoz(idioma, 'pede', conversa, acao)
}

const RESPOSTAS = {
  pt: { nao: /\b(n[aã]o|recus\w*|cancel\w*|neg\w*|espera|p[aá]ra)\b/, sempre: /\bsempre\b/, sim: /\b(sim|pode|podes|autoriz\w*|permit\w*|ok|okay|claro|for[cç]a|avan[cç]a|vai|faz|confirm\w*|d[aá])\b/ },
  en: { nao: /\b(no|nope|deny|denied|don'?t|stop|cancel|wait)\b/, sempre: /\balways\b/, sim: /\b(yes|yeah|yep|sure|ok|okay|allow\w*|go ahead|do it|approve\w*|fine)\b/ },
  es: { nao: /\b(no|rechaz\w*|cancel\w*|espera|para|niega)\b/, sempre: /\bsiempre\b/, sim: /\b(s[ií]|vale|claro|dale|adelante|permit\w*|autoriz\w*|ok|okay|hazlo)\b/ },
}
const normalizar = t => ' ' + String(t || '').toLowerCase().replace(/[.,!?¿¡;:«»"“”]/g, ' ').replace(/\s+/g, ' ').trim() + ' '

/** O que disseste a um pedido de autorização: 'allow', 'always', 'deny' ou null (não percebi). */
function classificarResposta(dito, idioma = 'pt') {
  const t = normalizar(dito)
  if (t.trim().split(' ').length > 8) return null // uma frase comprida não é um «sim»
  for (const R of [RESPOSTAS[idioma] || RESPOSTAS.pt, RESPOSTAS.en]) {
    if (R.nao.test(t)) return 'deny'
    if (R.sempre.test(t)) return 'always'
    if (R.sim.test(t)) return 'allow'
  }
  return null
}

/** No mãos-livres, «para», «chega», «obrigado»… terminam a conversa em vez de serem enviados. */
function eFimDeConversa(dito) {
  const t = normalizar(dito).trim()
  return t.split(' ').length <= 4 && /^(para|p[aá]ra|chega|basta|obrigad[oa]|termina|acabou|[eé] tudo|por agora [eé] tudo|stop|that'?s all|thanks|thank you|gracias|eso es todo|nada mais|nada m[aá]s)( obrigad[oa]| thanks| gracias)?$/.test(t)
}

// ---------- notificações ----------

function frasesNotificacao(mensagem, idioma = 'pt') {
  const m = String(mensagem || '').toLowerCase()
  if (/permission|permiss/.test(m)) return frase(idioma, 'notifPerm')
  if (/waiting for your input|idle|à espera/.test(m)) return frase(idioma, 'notifEspera')
  return frase(idioma, 'notifOutra')
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
  frase,
  FRASES,
  idiomaDe,
  tipoComando,
  contarTestes,
  duracaoFalada,
  anunciarResultado,
  legendaFalha,
  fecharMensagem,
  resumoAusencia,
  fraseVoz,
  perguntaAutorizacao,
  classificarResposta,
  eFimDeConversa,
  avaliarResultado,
}
