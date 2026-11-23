'use strict'
// O servidor da voz: um só por utilizador, arranca sozinho com o primeiro gancho e sai após 10 minutos parado.
// Recebe eventos dos ganchos por um pipe local, decide o que dizer e fala uma coisa de cada vez.

const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { CAMINHOS, WIN, garantirPasta, lerConfig, escreverConfig, log, piperInstalado } = require('./comum')
const texto = require('./texto')
const estado = require('./estado')
const { criarMotor, criarLeitorWav } = require('./motores')
const sons = require('./sons')
const { arrancarWeb, PASTA_BARRA, versao } = require('./web')
const vozes = require('./vozes')
const uso = require('./uso')
const ouvido = require('./ouvido')
const compilarBarra = require('./compilar-barra')

const OCIOSO_MS = 10 * 60 * 1000
const ACAO_VELHA_MS = 8000 // um anúncio que esperou mais do que isto já não interessa
const REPETIDA_MS = 15000 // não repetir o mesmo anúncio seguido
const LOTE_ATRASADO_MS = 1500 // espera por um lote fora de ordem antes de avançar

let motor = null
let motorChave = ''
const fila = [] // { tipo: 'fala' | 'acao' | 'aviso', texto, sessao, criado }
let aFalar = false
let geracao = 0
let sessaoFoco = null
let ultimaAcao = { texto: '', t: 0 }
let ultimaAtividade = Date.now()
const mensagens = new Map() // message_id -> { estado, proximo, pendentes: Map(index -> lote), sessao, t }
const turnoComTexto = new Set() // sessões em que já lemos texto neste turno
let falando = null // { texto, sessao } enquanto uma frase toca
let pausado = false
let aoRetomar = []
let web = null
const escutas = new Map() // sessão -> socket do gancho escuta.js (asyncRewake) à espera de uma resposta
const pendentes = new Map() // sessão -> [textos] escritos na barra enquanto a sessão trabalhava
const permissoes = new Map() // id -> { socket, sessao, ferramenta, resumo, descricao, criado }
const ordemSessoes = [] // pela ordem em que apareceram (para dar um tom diferente a cada conversa)
let aOuvir = false
let aOuvirAuto = false // a escuta automática (autorizar por voz, mãos-livres) — pára sozinha quando te calas
const aoAcabarDeFalar = [] // quem espera que a voz se cale (para começar a ouvir)

const { emSilencio: silencioMarcado, idiomaEfetivo } = require('./comum')

// ---------- ambiente (vindo do anfitrião da barra) ----------
// Microfone ocupado por outra app (Teams, Zoom…) ou um programa em ecrã inteiro / apresentação:
// com «silencioReunioes», a voz cala-se sozinha enquanto durar.
const AMBIENTE_VELHO_MS = 25 * 1000 // o anfitrião manda o estado a cada 10 s; sem notícias, deixa de contar
let ambiente = { micro: false, app: '', ecraInteiro: false, t: 0 }

function emReuniao(cfg) {
  if (cfg.silencioReunioes === false || Date.now() - ambiente.t > AMBIENTE_VELHO_MS) return null
  if (ambiente.micro) return { motivo: 'micro', app: ambiente.app }
  if (ambiente.ecraInteiro) return { motivo: 'ecra', app: '' }
  return null
}

/** Silêncio por botão, por horário ou por reunião. */
function emSilencio(cfg) {
  return silencioMarcado(cfg) || !!emReuniao(cfg)
}

function atualizarAmbiente(a) {
  const cfg = lerConfig()
  const antes = !!emReuniao(cfg)
  ambiente = { micro: !!a.micro, app: String(a.app || '').slice(0, 60), ecraInteiro: !!a.ecraInteiro, t: Date.now() }
  const agora = !!emReuniao(cfg)
  if (agora !== antes) {
    log(agora ? `reunião/apresentação (${ambiente.app || 'ecrã inteiro'}): voz em silêncio` : 'fim da reunião: voz de volta')
    if (agora) pararTudo()
    publicar()
  }
  return { ok: true }
}

/** Voltaste ao computador: diz (e mostra) o que aconteceu enquanto estavas fora. */
function regresso(desde) {
  const cfg = lerConfig()
  if (cfg.resumoAoVoltar === false || !Number.isFinite(desde)) return { ok: true }
  const idioma = idiomaEfetivo(cfg)
  const S = estado.lista()
  const pedem = new Set([...permissoes.values()].map(p => p.sessao))
  const r = {
    terminaram: S.filter(x => x.estado === 'terminou' && x.fim && x.fim >= desde).map(x => x.titulo),
    precisam: S.filter(x => x.estado === 'atencao' || pedem.has(x.id)).map(x => x.titulo),
    falhas: S.filter(x => x.falha && x.falha.t >= desde).map(x => ({ titulo: x.titulo, texto: x.falha.texto })),
    trabalham: S.filter(x => x.estado === 'trabalhar' && !pedem.has(x.id)).map(x => x.titulo),
  }
  const frase = texto.resumoAusencia(r, idioma)
  if (!frase) return { ok: true, nada: true }
  log(`regresso depois de ${Math.round((Date.now() - desde) / 60000)} min: ${frase}`)
  if (web) web.emitir('regresso', { ...r, desde })
  if (cfg.ligado && !emSilencio(cfg) && !aOuvir) {
    tocarSom('pronto', null)
    enfileirar('aviso', frase, null)
  }
  return { ok: true, frase }
}

function publicar() {
  if (web) web.publicar()
}

function esperarRetoma() {
  return new Promise(r => aoRetomar.push(r))
}

function retomar() {
  pausado = false
  for (const r of aoRetomar.splice(0)) r()
}

// ---------- motor ----------

function obterMotor() {
  const cfg = lerConfig()
  const chave = `${cfg.motor}|${cfg.vozSistema}|${piperInstalado()}`
  if (!motor || chave !== motorChave) {
    if (motor) motor.fechar()
    motor = criarMotor(cfg)
    motorChave = chave
    log(`motor: ${motor.nome}`)
  }
  return motor
}

// ---------- sons e som espacial ----------

let leitorSons = null
function obterLeitorSons() {
  if (!leitorSons) {
    leitorSons = criarLeitorWav()
    leitorSons.aquecer()
  }
  return leitorSons
}

// Lado de cada conversa: a primeira ao centro, as outras alternam esquerda/direita.
const PANS = [0, -0.6, 0.6, -0.3, 0.3]
function panDe(sessao, cfg) {
  if (!sessao || cfg.somEspacial === false) return 0
  const vivas = new Set(estado.lista().map(x => x.id))
  const ordem = ordemSessoes.filter(id => vivas.has(id))
  if (ordem.length < 2) return 0
  const i = ordem.indexOf(sessao)
  return i < 0 ? 0 : PANS[i % PANS.length]
}

/** Um som curto antes de um aviso (se os sons estiverem ligados). */
function tocarSom(nome, sessao) {
  const cfg = lerConfig()
  if (cfg.sons === false || !cfg.ligado || emSilencio(cfg) || aOuvir) return
  enfileirar('som', nome, sessao)
}

// ---------- fila ----------

function enfileirar(tipo, frase, sessao, modelo) {
  if (!frase) return
  fila.push({ tipo, texto: frase, sessao, criado: Date.now(), modelo })
  bombear()
}

function tirarProximo() {
  while (fila.length) {
    const item = fila.shift()
    if (item.tipo === 'acao') {
      const agora = Date.now()
      if (agora - item.criado > ACAO_VELHA_MS) continue
      if (fila.some(x => x.tipo === 'acao')) continue // há um anúncio mais recente: salta este
      if (item.texto === ultimaAcao.texto && agora - ultimaAcao.t < REPETIDA_MS) continue
      ultimaAcao = { texto: item.texto, t: agora }
    }
    return item
  }
  return null
}

async function bombear() {
  if (aFalar) return
  aFalar = true
  const g = geracao
  let m
  try {
    m = obterMotor()
  } catch (erro) {
    log(`sem motor: ${erro.message}`)
    aFalar = false
    return
  }
  const preparar = item => {
    const cfg = lerConfig()
    if (item.tipo === 'som') {
      try {
        return Promise.resolve({ som: sons.caminho(item.texto, { volume: cfg.volume, pan: panDe(item.sessao, cfg) }) })
      } catch (erro) {
        log(`som: ${erro.message}`)
        return Promise.resolve(null)
      }
    }
    // Voz da frase: a escolhida para a conversa (ou uma variação de tom automática) e o idioma do texto.
    const v = item.modelo ? { modelo: item.modelo, altura: 0 } : vozes.escolher(cfg, item.sessao, item.texto, item.tipo, ordemSessoes)
    v.pan = panDe(item.sessao, cfg)
    return m.preparar(texto.pronunciar(item.texto, cfg.pronuncias), cfg, v).catch(erro => (log(`preparar: ${erro.message}`), null))
  }
  const tocar = p => (p.som ? obterLeitorSons().tocar(p.som) : m.tocar(p))
  const descartar = p => p && !p.som && m.descartar(p)
  try {
    let atual = tirarProximo()
    let prep = atual && preparar(atual)
    while (atual && g === geracao) {
      const pedaco = await prep
      // Enquanto este toca, o próximo já está a ser sintetizado.
      const seguinte = tirarProximo()
      const prepSeguinte = seguinte && preparar(seguinte)
      if (g !== geracao) {
        descartar(pedaco)
        if (prepSeguinte) prepSeguinte.then(descartar)
        break
      }
      while (pausado && g === geracao) await esperarRetoma()
      if (pedaco && g === geracao) {
        const som = !!pedaco.som
        if (!som) {
          falando = { texto: atual.texto, sessao: atual.sessao, tipo: atual.tipo }
          publicar()
        }
        await Promise.resolve(tocar(pedaco)).catch(erro => log(`tocar: ${erro.message}`))
        if (!som) {
          falando = null
          publicar()
        }
      } else {
        descartar(pedaco)
      }
      atual = seguinte
      prep = prepSeguinte
      if (!atual && g === geracao) {
        atual = tirarProximo()
        prep = atual && preparar(atual)
      }
      if (g !== geracao && prep) prep.then(descartar)
    }
  } finally {
    aFalar = false
    ultimaAtividade = Date.now()
    if (fila.length) setImmediate(bombear)
    else for (const fn of aoAcabarDeFalar.splice(0)) setImmediate(fn)
  }
}

/** Corre fn quando a voz acabar de falar (ou já, se estiver calada). */
function depoisDeFalar(fn) {
  if (!aFalar && !fila.length) setImmediate(fn)
  else aoAcabarDeFalar.push(fn)
}

function pararTudo() {
  geracao++
  fila.length = 0
  for (const r of aoRetomar.splice(0)) r() // solta um ciclo em pausa (a pausa mantém-se)
  if (motor) motor.parar()
  falando = null
  publicar()
}

// ---------- eventos ----------

function emFoco(sessao, cfg) {
  if (!cfg.soSessaoAtiva || !sessao) return true
  if (!sessaoFoco) sessaoFoco = sessao
  return sessao === sessaoFoco
}

function nomePasta(cwd, idioma) {
  return cwd ? texto.base(cwd) : texto.frase(idioma, 'outraPasta')
}

function textoDeMensagem(msg, cfg) {
  // Os lotes de uma mensagem podem chegar fora de ordem (cada gancho é um processo): reordena pelo index.
  const id = msg.message_id || `${msg.sessao}-sem-id`
  let m = mensagens.get(id)
  if (!m) {
    m = { estado: texto.novoEstado(cfg.maxCaracteres, idiomaEfetivo(cfg)), proximo: 0, pendentes: new Map(), sessao: msg.sessao, t: Date.now() }
    mensagens.set(id, m)
  }
  m.t = Date.now()
  m.pendentes.set(Number(msg.index) || 0, { delta: msg.delta || '', final: !!msg.final })
  const despejar = () => {
    while (m.pendentes.has(m.proximo)) {
      const lote = m.pendentes.get(m.proximo)
      m.pendentes.delete(m.proximo)
      m.proximo++
      for (const frase of texto.processarDelta(m.estado, lote.delta)) enfileirar('fala', frase, msg.sessao)
      if (lote.final) {
        for (const frase of texto.fecharMensagem(m.estado)) enfileirar('fala', frase, msg.sessao)
        mensagens.delete(id)
        return
      }
    }
  }
  despejar()
  if (m.pendentes.size) {
    clearTimeout(m.temporizador)
    m.temporizador = setTimeout(() => {
      // Um lote perdeu-se: avança para o menor que temos.
      if (!mensagens.has(id) || !m.pendentes.size) return
      m.proximo = Math.min(...m.pendentes.keys())
      despejar()
    }, LOTE_ATRASADO_MS)
  }
}

let avisouInstalar = false
function avisarInstalacao() {
  if (avisouInstalar || piperInstalado()) return
  avisouInstalar = true
  try {
    if (fs.existsSync(CAMINHOS.avisoMostrado)) return
    garantirPasta()
    fs.writeFileSync(CAMINHOS.avisoMostrado, new Date().toISOString())
  } catch {}
  enfileirar('aviso', texto.frase(idiomaEfetivo(lerConfig()), 'instalar'), null)
}

const DEPURAR = Boolean(process.env.VOZ_DEBUG)

const TURNO_LONGO_MS = 45 * 1000
const inicioTurno = new Map() // sessão -> quando escreveste o último pedido
function duracaoTurno(s) {
  const t = inicioTurno.get(s)
  return t ? Date.now() - t : 0
}
const permissoesDaSessao = s => [...permissoes.values()].some(p => p.sessao === s)

function tratarEvento(msg) {
  const cfg = lerConfig()
  if (DEPURAR) log(`evento ${msg.evento} sessão=${String(msg.sessao).slice(0, 8)}${msg.ferramenta ? ' ' + msg.ferramenta : ''}${msg.delta !== undefined ? ` #${msg.index}${msg.final ? ' final' : ''} ${JSON.stringify(String(msg.delta).slice(0, 60))}` : ''}`)
  const idioma = idiomaEfetivo(cfg)
  msg.idioma = idioma
  estado.registar(msg) // a barra vê tudo, mesmo com a voz desligada
  if (msg.sessao && !msg.agente && !ordemSessoes.includes(msg.sessao)) ordemSessoes.push(msg.sessao)
  if (msg.evento === 'UserPromptSubmit' && !msg.agente) {
    inicioTurno.set(msg.sessao, Date.now())
    sessaoFoco = msg.sessao
    largarEscuta(msg.sessao) // escreveste na conversa: a escuta da barra já não é precisa
  }
  if (msg.evento === 'SessionEnd') {
    largarEscuta(msg.sessao)
    pendentes.delete(msg.sessao)
  }
  if (msg.evento === 'SessionStart') talvezAbrirBarra(cfg)
  // Antes de olhar para a voz: o aviso «à espera de autorização» prova que o Claude mostra o pedido.
  if (msg.evento === 'Notification' && (msg.tipoNotificacao === 'permission_prompt' || /permission|permiss/i.test(String(msg.mensagem || ''))))
    claudeMostraPedido(msg.sessao)
  if (!cfg.ligado || emSilencio(cfg) || aOuvir) return
  if (msg.agente) return // subagentes ficam calados
  const s = msg.sessao

  switch (msg.evento) {
    case 'SessionStart':
      if (!sessaoFoco) sessaoFoco = s
      try {
        obterMotor().aquecer()
      } catch {}
      avisarInstalacao()
      return

    case 'UserPromptSubmit':
      sessaoFoco = s
      turnoComTexto.delete(s)
      pararTudo()
      return

    case 'PreToolUse':
      if (!cfg.anunciarAcoes || !emFoco(s, cfg)) return
      enfileirar('acao', texto.anunciarFerramenta(msg.ferramenta, msg.entrada, idioma), s)
      return

    case 'PostToolUse':
    case 'PostToolUseFailure': {
      if (cfg.anunciarResultados === false) return
      const ok = msg.evento === 'PostToolUse'
      const r = texto.avaliarResultado(msg.ferramenta, msg.entrada, { ok, erro: msg.erro, saida: msg.saida, duracaoMs: msg.duracao, interrompido: msg.interrompido }, idioma)
      if (!r) return
      if (emFoco(s, cfg)) {
        tocarSom(r.bom ? 'ok' : 'falha', s)
        enfileirar('aviso', r.frase, s)
      } else if (!r.bom && cfg.avisarOutrasSessoes) {
        tocarSom('falha', s)
        enfileirar('aviso', texto.frase(idioma, 'naSessao', nomePasta(msg.cwd, idioma), r.frase), s)
      }
      return
    }

    case 'PreCompact':
      if (msg.gatilho === 'auto' && emFoco(s, cfg) && cfg.anunciarAcoes) enfileirar('aviso', texto.frase(idioma, 'compactar'), s)
      return

    case 'MessageDisplay':
      if (!cfg.lerRespostas || !emFoco(s, cfg)) return
      turnoComTexto.add(s)
      textoDeMensagem(msg, cfg)
      return

    case 'Notification': {
      const frase = texto.frasesNotificacao(msg.mensagem, idioma)
      // O pedido de autorização já tocou o seu som quando chegou à barra.
      const pedeAutorizacao =
        (msg.tipoNotificacao === 'permission_prompt' || /permission|permiss/i.test(String(msg.mensagem || ''))) && permissoesDaSessao(s)
      if (!pedeAutorizacao) tocarSom('atencao', s)
      if (pedeAutorizacao && cfg.aprovarPorVoz) return // a pergunta falada já diz o que é
      if (emFoco(s, cfg)) enfileirar('aviso', frase, s)
      else if (cfg.avisarOutrasSessoes) enfileirar('aviso', texto.frase(idioma, 'naSessao', nomePasta(msg.cwd, idioma), frase), s)
      return
    }

    case 'Stop':
      if (emFoco(s, cfg)) {
        // Versões sem MessageDisplay: lê a resposta final de uma vez.
        if (!turnoComTexto.has(s) && cfg.lerRespostas && msg.ultima) {
          const est = texto.novoEstado(cfg.maxCaracteres, idioma)
          for (const frase of texto.processarDelta(est, msg.ultima)) enfileirar('fala', frase, s)
          for (const frase of texto.fecharMensagem(est)) enfileirar('fala', frase, s)
        }
        // Um pedido demorado acaba com um acorde (depois de ler a resposta): sabes que podes voltar.
        if (duracaoTurno(s) >= TURNO_LONGO_MS && !cfg.maosLivres) tocarSom('pronto', s)
        // Mãos-livres: depois de ler a resposta, ouve-te para continuares a conversa.
        if (cfg.maosLivres && !msg.agente) depoisDeFalar(() => conversarPorVoz(s).catch(erro => log(`mãos-livres: ${erro.message}`)))
      } else if (cfg.avisarOutrasSessoes) {
        tocarSom('pronto', s)
        enfileirar('aviso', texto.frase(idioma, 'sessaoTerminou', nomePasta(msg.cwd, idioma)), s)
      }
      turnoComTexto.delete(s)
      return

    case 'SessionEnd':
      if (s === sessaoFoco) sessaoFoco = null
      return
  }
}

function tratarControlo(msg, responder) {
  switch (msg.controlo) {
    case 'parar':
      pararTudo()
      return responder({ ok: true })
    case 'saltar':
      if (motor) motor.parar() // corta só a frase atual; a fila continua
      return responder({ ok: true })
    case 'pausa':
      if (pausado) retomar()
      else {
        pausado = true
        if (motor) motor.parar()
      }
      publicar()
      return responder({ ok: true, pausado })
    case 'publicar': // a configuração mudou fora da barra (linha de comandos)
      publicar()
      return responder({ ok: true })
    case 'barra-sair':
      if (web) web.emitir('sair', {})
      return responder({ ok: true, barras: web ? web.clientes() : 0 })
    case 'testar':
      pararTudo()
      const idiomaTeste = idiomaEfetivo(lerConfig())
      for (const frase of texto.processarDelta(texto.novoEstado(4000, idiomaTeste), msg.texto || texto.frase(idiomaTeste, 'testar'))) {
        enfileirar('fala', frase, null)
      }
      return responder({ ok: true })
    case 'recarregar':
      pararTudo()
      if (motor) motor.fechar()
      motor = null
      return responder({ ok: true })
    case 'estado':
      return responder({
        ok: true,
        pid: process.pid,
        motor: motor ? motor.nome : '(ainda não arrancou)',
        naFila: fila.length,
        aFalar,
        sessaoFoco,
      })
    case 'sair':
      responder({ ok: true })
      return sair()
  }
  responder({ ok: false, erro: 'controlo desconhecido' })
}

// ---------- respostas pela barra ----------

function enviarEscuta(socket, msg) {
  try {
    socket.write(JSON.stringify(msg) + '\n')
  } catch {}
}

function registarEscuta(msg, socket) {
  const id = msg.escuta
  const antiga = escutas.get(id)
  if (antiga && antiga !== socket) enviarEscuta(antiga, { sair: true })
  const fila = pendentes.get(id)
  if (fila && fila.length) {
    // Havia respostas à espera: entrega já e a escuta acaba (o Claude acorda).
    pendentes.delete(id)
    enviarEscuta(socket, { resposta: fila.join('\n\n') })
    estado.anotar(id, { escuta: false, pendentes: 0 })
    return
  }
  escutas.set(id, socket)
  estado.anotar(id, { escuta: true })
  socket.on('close', () => {
    if (escutas.get(id) === socket) {
      escutas.delete(id)
      estado.anotar(id, { escuta: false })
    }
  })
}

function largarEscuta(id) {
  const s = escutas.get(id)
  if (!s) return
  escutas.delete(id)
  enviarEscuta(s, { sair: true })
  estado.anotar(id, { escuta: false })
}

function responder(id, texto) {
  texto = String(texto || '').trim().slice(0, 4000)
  if (!id || !texto) return { ok: false, erro: 'falta a sessão ou o texto' }
  estado.pedidoPelaBarra(id, texto)
  const s = escutas.get(id)
  if (s) {
    escutas.delete(id)
    enviarEscuta(s, { resposta: texto })
    estado.anotar(id, { escuta: false })
    log('resposta pela barra entregue a ' + id.slice(0, 8))
    return { ok: true, entregue: true }
  }
  const fila = pendentes.get(id) || []
  fila.push(texto)
  pendentes.set(id, fila)
  estado.anotar(id, { pendentes: fila.length })
  log('resposta pela barra em fila para ' + id.slice(0, 8))
  return { ok: true, entregue: false }
}

// ---------- permissões pela barra ----------

// O pedido tem de aparecer SEMPRE no Claude. Nalguns ambientes o Claude mostra o seu diálogo ao mesmo
// tempo que o gancho corre; noutros só depois de o gancho acabar (e esperar pela barra prendia-o).
// Enquanto não se sabe («sonda»), o pedido fica na barra no máximo SONDA_MS: se entretanto chegar o
// aviso do Claude «à espera de autorização» (prova de que o diálogo está à vista), é «paralelo» e
// pode continuar; senão é «bloqueia» e o pedido volta logo para o Claude. Fica guardado por ambiente.
const SONDA_MS = 8000
const FICHEIRO_MODO = path.join(CAMINHOS.pasta, 'autorizacoes-modo.json')
const sondas = new Map() // id -> temporizador (fora de `permissoes`, que é publicado em JSON)

function aprenderModo(chave, modo) {
  if (!chave) return
  let m = {}
  try {
    m = JSON.parse(fs.readFileSync(FICHEIRO_MODO, 'utf8')) || {}
  } catch {}
  if (m[chave] && m[chave].modo === modo && Date.now() - m[chave].em < 24 * 3600 * 1000) return
  m[chave] = { modo, em: Date.now() }
  try {
    fs.writeFileSync(FICHEIRO_MODO, JSON.stringify(m, null, 2))
  } catch {}
  log(
    modo === 'paralelo'
      ? `autorizações (${chave}): o Claude mostra o pedido ao mesmo tempo — a barra pode responder`
      : `autorizações (${chave}): o Claude só mostra o pedido depois do gancho — a partir de agora vão direto para o Claude`,
  )
}

/** Devolve o pedido ao Claude sem decidir (o gancho sai e o Claude mostra o seu diálogo). */
function libertarPermissao(id) {
  const p = permissoes.get(id)
  if (!p) return
  permissoes.delete(id)
  try {
    p.socket.write(JSON.stringify({ libertar: true }) + '\n')
  } catch {}
  log(`pedido de autorização (${p.ferramenta}) devolvido ao Claude`)
  publicar()
}

function pararSonda(id) {
  clearTimeout(sondas.get(id))
  sondas.delete(id)
}

function registarPermissao(p, socket) {
  if (!p || !p.id) return
  permissoes.set(p.id, { ...p, socket, criado: Date.now() })
  log(`pedido de autorização (${p.ferramenta}) da sessão ${String(p.sessao).slice(0, 8)}${p.sonda ? ' (a confirmar se o Claude também o mostra)' : ''}`)
  tocarSom('atencao', p.sessao)
  perguntarPorVoz(p)
  publicar()
  if (p.sonda) {
    sondas.set(
      p.id,
      setTimeout(() => {
        sondas.delete(p.id)
        if (!permissoes.has(p.id)) return
        aprenderModo(p.chave, 'bloqueia')
        libertarPermissao(p.id)
      }, SONDA_MS),
    )
  }
  // Se o Claude Code decidir por outro lado (diálogo da app) ou desistir, o gancho fecha a ligação.
  socket.on('close', () => {
    pararSonda(p.id)
    if (permissoes.delete(p.id)) publicar()
  })
}

/** O Claude avisou que está à espera de autorização: o diálogo dele está à vista ao mesmo tempo. */
function claudeMostraPedido(sessao) {
  for (const p of permissoes.values()) {
    if (p.sessao !== sessao || !sondas.has(p.id)) continue
    pararSonda(p.id)
    aprenderModo(p.chave, 'paralelo')
  }
}

function decidirPermissao(id, decisao, respostas) {
  const p = permissoes.get(id)
  if (!p) return { ok: false, erro: texto.frase(idiomaEfetivo(lerConfig()), 'jaRespondido') }
  if (decisao !== 'allow' && decisao !== 'deny' && decisao !== 'always') return { ok: false, erro: 'decisão inválida' }
  if (decisao === 'always' && !p.sempre) decisao = 'allow'
  // Pergunta do Claude: só se responde com uma resposta (texto) para cada pergunta.
  let resp
  if (p.perguntas && decisao !== 'deny') {
    if (!Array.isArray(respostas) || respostas.length !== p.perguntas.length || respostas.some(r => typeof r !== 'string' || !r.trim()))
      return { ok: false, erro: 'falta responder' }
    resp = respostas.map(r => r.trim().slice(0, 4000))
    decisao = 'allow'
  }
  permissoes.delete(id)
  pararSonda(id)
  try {
    p.socket.write(JSON.stringify(resp ? { decisao, respostas: resp } : { decisao }) + '\n')
  } catch {}
  if (p.perguntas) log(`pergunta ${decisao === 'deny' ? 'ignorada' : 'respondida'} pela barra`)
  else log(`autorização ${decisao === 'always' ? 'dada para sempre' : decisao === 'allow' ? 'dada' : 'recusada'} pela barra (${p.ferramenta})`)
  publicar()
  return { ok: true }
}

// ---------- escuta automática: autorizar por voz e mãos-livres ----------

/** Um «bip» e depois ouve até te calares. Devolve { texto, semFala } ou null se não der para ouvir. */
async function escutarVoz(o, sessao) {
  const cfg = lerConfig()
  if (aOuvir || !ouvido.instalado() || emSilencio(cfg)) return null
  if (cfg.sons !== false && cfg.ligado) await new Promise(r => (enfileirar('som', 'ouvir', sessao), depoisDeFalar(r)))
  if (aOuvir) return null
  aOuvir = true
  aOuvirAuto = true
  publicar()
  const idioma = cfg.ditadoIdioma && cfg.ditadoIdioma !== 'auto' ? cfg.ditadoIdioma : idiomaEfetivo(cfg)
  let r
  try {
    r = await ouvido.escutar({ idioma, ...o }, cfg.ditadoModelo)
  } finally {
    aOuvir = false
    aOuvirAuto = false
    publicar()
  }
  return r && r.ok ? r : null
}

/** Pedido de autorização falado: diz o que é, ouve «sim», «não» ou «sempre» e decide. */
function perguntarPorVoz(p) {
  const cfg = lerConfig()
  if (p.perguntas) return // uma pergunta com opções não se responde com «sim» ou «não»
  if (!cfg.aprovarPorVoz || !cfg.ligado || emSilencio(cfg) || !ouvido.instalado()) return
  const idioma = idiomaEfetivo(cfg)
  const s = estado.lista().find(x => x.id === p.sessao)
  enfileirar('aviso', texto.perguntaAutorizacao(p.ferramenta, p.resumo, s ? s.titulo : null, idioma), p.sessao)
  depoisDeFalar(async () => {
    if (!permissoes.has(p.id) || aOuvir) return
    const r = await escutarVoz({ espera: 6, silencio: 0.9, max: 8 }, p.sessao)
    if (!r || !r.texto || !permissoes.has(p.id)) return
    const d = texto.classificarResposta(r.texto, idioma)
    log(`autorizar por voz: «${r.texto}» → ${d || 'não percebi'}`)
    if (!d) return
    const res = decidirPermissao(p.id, d)
    if (res.ok) enfileirar('aviso', texto.fraseVoz(idioma, d === 'deny' ? 'recusado' : d === 'always' && p.sempre ? 'autorizadoSempre' : 'autorizado'), p.sessao)
  })
}

/** Mãos-livres: ouve-te e envia o que disseres para a conversa (sem teres de rever nem carregar Enter). */
async function conversarPorVoz(sessao, o = {}) {
  const cfg = lerConfig()
  if (!sessao || !cfg.maosLivres) return
  if ([...permissoes.values()].some(p => p.sessao === sessao)) return // primeiro responde à autorização
  const r = await escutarVoz({ espera: o.espera || 8, silencio: 1.3, max: 45 }, sessao)
  if (!r || !r.texto) return
  const idioma = idiomaEfetivo(cfg)
  if (texto.eFimDeConversa(r.texto)) {
    log(`mãos-livres: «${r.texto}» → fim`)
    enfileirar('aviso', texto.fraseVoz(idioma, 'fim'), sessao)
    return
  }
  const res = responder(sessao, r.texto)
  log(`mãos-livres: enviado para ${String(sessao).slice(0, 8)} (${r.texto.length} car.)`)
  if (web) web.emitir('ditado', { texto: r.texto, enviado: true, entregue: !!(res && res.entregue), sessao })
}

// ---------- ditado (Whisper) ----------

async function ouvir(ordem, sessao) {
  const cfg = lerConfig()
  if (!ouvido.instalado()) return { ok: false, erro: texto.frase(idiomaEfetivo(cfg), 'ditadoNaoInstalado') }
  // Durante uma escuta automática, o botão/atalho termina-a já (ou cancela-a).
  if (aOuvirAuto && (ordem === 'parar' || ordem === 'iniciar')) {
    ouvido.acabar(cfg.ditadoModelo)
    return { ok: true }
  }
  if (aOuvirAuto && ordem === 'cancelar') {
    ouvido.cancelar(cfg.ditadoModelo)
    return { ok: true }
  }
  // Mãos-livres: o atalho ouve até te calares e envia logo.
  if (ordem === 'iniciar' && cfg.maosLivres) {
    pararTudo()
    conversarPorVoz(sessao || sessaoFoco, { espera: 10 }).catch(erro => log(`mãos-livres: ${erro.message}`))
    return { ok: true, aOuvir: true }
  }
  if (ordem === 'iniciar') {
    pararTudo() // não grava a própria voz
    aOuvir = true
    publicar()
    const r = await ouvido.gravar(cfg.ditadoModelo)
    if (!r.ok) {
      aOuvir = false
      publicar()
    }
    return r
  }
  if (ordem === 'cancelar') {
    aOuvir = false
    publicar()
    return ouvido.cancelar(cfg.ditadoModelo)
  }
  // parar: transcreve e entrega o texto à barra (que o mostra para confirmares).
  if (web) web.emitir('ditado', { aTranscrever: true, sessao: sessao || sessaoFoco })
  const r = await ouvido.parar(cfg.ditadoIdioma && cfg.ditadoIdioma !== 'auto' ? cfg.ditadoIdioma : idiomaEfetivo(cfg), cfg.ditadoModelo)
  aOuvir = false
  publicar()
  if (web) web.emitir('ditado', { texto: (r && r.texto) || '', erro: r && !r.ok ? r.erro : null, sessao: sessao || sessaoFoco })
  return r
}

// ---------- vozes ----------

async function pedidoVozes(p) {
  switch (p.op) {
    case 'catalogo':
      return { ok: true, vozes: await vozes.listarCatalogo() }
    case 'descarregar':
      vozes
        .descarregar(p.id, pct => web && web.emitir('progresso-voz', { id: p.id, pct }))
        .then(() => {
          if (web) web.emitir('progresso-voz', { id: p.id, pct: 100, fim: true })
          publicar()
        })
        .catch(erro => web && web.emitir('progresso-voz', { id: p.id, erro: erro.message }))
      return { ok: true, aComecar: true }
    case 'remover':
      if (vozes.caminhoModelo(p.id) === vozes.caminhoModelo(lerConfig().vozPadrao)) return { ok: false, erro: 'não podes apagar a voz principal' }
      vozes.remover(p.id)
      publicar()
      return { ok: true }
    case 'padrao':
      if (!vozes.caminhoModelo(p.id)) return { ok: false, erro: 'voz não instalada' }
      escreverConfig({ vozPadrao: p.id })
      publicar()
      return { ok: true }
    case 'sessao':
      vozes.definirVozSessao(p.sessao, p.voz || null, p.altura || 0)
      publicar()
      return { ok: true }
    case 'experimentar': {
      const m = vozes.caminhoModelo(p.id)
      if (!m) return { ok: false, erro: 'voz não instalada' }
      pararTudo()
      const frases = { pt: 'Olá, eu sou o Claude Code.', en: 'Hello, I am Claude Code.', es: 'Hola, soy Claude Code.', fr: 'Bonjour, je suis Claude Code.', de: 'Hallo, ich bin Claude Code.', it: 'Ciao, sono Claude Code.' }
      enfileirar('fala', frases[vozes.linguaDe(p.id).slice(0, 2)] || frases.en, null, m)
      return { ok: true }
    }
  }
  return { ok: false, erro: 'operação desconhecida' }
}

// ---------- barra ----------

// Cor de destaque do Windows (para o estilo Windows 11 da barra): a paleta que o próprio Windows
// calcula (AccentPalette). Lida em segundo plano, no máximo uma vez por minuto; muda quando a mudas.
let acento = { em: 0, valor: null }
function acentoWindows() {
  if (WIN && Date.now() - acento.em > 60000) {
    acento.em = Date.now()
    require('node:child_process').execFile(
      'reg.exe',
      ['query', String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Accent`, '/v', 'AccentPalette'],
      { windowsHide: true, timeout: 4000 },
      (err, out) => {
        const m = !err && /AccentPalette\s+REG_BINARY\s+([0-9A-F]{64})/i.exec(String(out))
        if (!m) return
        const cor = i => '#' + m[1].slice(i * 8, i * 8 + 6).toLowerCase()
        const novo = { claro: cor(1), base: cor(3), escuro: cor(4) } // tema escuro usa o «claro 2», o claro o «escuro 1»
        if (JSON.stringify(novo) !== JSON.stringify(acento.valor)) {
          acento.valor = novo
          publicar()
        }
      },
    )
  }
  return acento.valor
}

const CHAVES_BARRA = new Set([
  'ligado', 'anunciarAcoes', 'lerRespostas', 'velocidade', 'volume', 'altura', 'graves', 'medios', 'agudos',
  'soSessaoAtiva', 'avisarOutrasSessoes', 'barraPosicao', 'barraModulos', 'barraArranque', 'barraTema',
  'barraAvisos', 'respostasPelaBarra', 'naoIncomodar', 'silencioHorario', 'vozPorConversa', 'idiomaAuto',
  'vozPadrao', 'aprovarPelaBarra', 'barraEcra', 'ditadoIdioma', 'ditadoModelo', 'idioma', 'anunciarResultados', 'sons', 'somEspacial', 'silencioReunioes', 'resumoAoVoltar', 'moeda', 'aprovarPorVoz', 'maosLivres',
  'barraEstilo', 'barraMaterial', 'vidroTransparencia', 'vidroDesfoque', 'vidroRefracao', 'vidroBorda', 'vidroDispersao', 'vidroBrilho', 'vidroSombra',
])

function estadoParaBarra() {
  const c = lerConfig()
  const cfg = {}
  for (const k of CHAVES_BARRA) cfg[k] = c[k]
  const sessoes = estado.lista()
  const titulos = {}
  for (const s of sessoes) titulos[s.id] = s.titulo
  return {
    versao: versao(),
    agora: Date.now(),
    idioma: idiomaEfetivo(c),
    cfg,
    acento: acentoWindows(),
    motor: motor ? motor.nome : null,
    sessoes: sessoes.map(s => ({ ...s, voz: vozes.vozDaSessao(s.id) })),
    foco: sessaoFoco,
    falando,
    pausado,
    silencio: emSilencio(c),
    reuniao: emReuniao(c),
    aOuvir,
    aOuvirAuto,
    ditadoInstalado: ouvido.instalado(),
    naFila: fila.length,
    permissoes: [...permissoes.values()].map(({ socket, ...p }) => p),
    vozes: {
      instaladas: vozes.instaladas().map(({ modelo, ...v }) => v),
      padrao: c.vozPadrao,
      aDescarregar: Object.fromEntries(vozes.emCurso),
    },
    uso: uso.resumo(titulos),
  }
}

function pedidoDaBarra(p) {
  if (p.acao === 'config' && p.valores && typeof p.valores === 'object') {
    const v = {}
    for (const [k, val] of Object.entries(p.valores)) if (CHAVES_BARRA.has(k)) v[k] = val
    const antes = lerConfig()
    escreverConfig(v)
    if (v.ligado === false || v.naoIncomodar === true) pararTudo()
    if (v.barraArranque && v.barraArranque !== antes.barraArranque) aplicarArranque(v.barraArranque)
    publicar()
    return { ok: true }
  }
  if (p.acao === 'controlo') {
    let r = { ok: true }
    tratarControlo({ controlo: p.controlo, texto: p.texto }, x => (r = x))
    return r
  }
  if (p.acao === 'responder') return responder(p.sessao, p.texto)
  if (p.acao === 'permissao') return decidirPermissao(p.id, p.decisao, p.respostas)
  if (p.acao === 'ouvir') return ouvir(p.ordem, p.sessao)
  if (p.acao === 'vozes') return pedidoVozes(p)
  if (p.acao === 'ambiente') return atualizarAmbiente(p)
  if (p.acao === 'regresso') return regresso(Number(p.desde))
  if (p.acao === 'foco' && p.sessao) {
    sessaoFoco = p.sessao
    publicar()
    return { ok: true }
  }
  return { ok: false, erro: 'pedido desconhecido' }
}

const EXE_BARRA = path.join(PASTA_BARRA, 'VozBarra.exe')

/** Com o arranque «só com o Claude Code», abre a barra quando começa uma sessão. */
function talvezAbrirBarra(cfg) {
  if (!WIN || cfg.barraArranque !== 'claude' || !fs.existsSync(EXE_BARRA)) return
  if (web && web.clientes() > 0) return
  try {
    spawn(EXE_BARRA, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref()
  } catch (erro) {
    log(`abrir barra: ${erro.message}`)
  }
}

/** «Com o Windows» = entrada em HKCU\…\Run (não precisa de administrador). */
function aplicarArranque(modo) {
  if (!WIN) return
  const chave = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
  const args =
    modo === 'windows' && fs.existsSync(EXE_BARRA)
      ? ['add', chave, '/v', 'VozBarra', '/t', 'REG_SZ', '/d', `"${EXE_BARRA}"`, '/f']
      : ['delete', chave, '/v', 'VozBarra', '/f']
  const p = spawn('reg.exe', args, { windowsHide: true, stdio: 'ignore' })
  p.on('error', () => {})
}

// ---------- canal ----------

function sair() {
  try {
    if (motor) motor.fechar()
    if (leitorSons) leitorSons.fechar()
    ouvido.fechar()
  } catch {}
  setTimeout(() => process.exit(0), 50)
}

function limparTemporarios() {
  try {
    const agora = Date.now()
    for (const nome of fs.readdirSync(CAMINHOS.tmp)) {
      const f = path.join(CAMINHOS.tmp, nome)
      try {
        if (agora - fs.statSync(f).mtimeMs > 2 * 60 * 1000) fs.unlinkSync(f)
      } catch {}
    }
  } catch {}
}

function arrancar() {
  garantirPasta()
  garantirPasta(CAMINHOS.tmp)
  limparTemporarios()

  const servidor = net.createServer(socket => {
    socket.setEncoding('utf8')
    let buffer = ''
    socket.on('data', dados => {
      buffer += dados
      let i
      while ((i = buffer.indexOf('\n')) >= 0) {
        const linha = buffer.slice(0, i)
        buffer = buffer.slice(i + 1)
        if (!linha.trim()) continue
        ultimaAtividade = Date.now()
        let msg
        try {
          msg = JSON.parse(linha)
        } catch {
          continue
        }
        try {
          if (msg.escuta) registarEscuta(msg, socket)
          else if (msg.permissao) registarPermissao(msg.permissao, socket)
          else if (msg.controlo) tratarControlo(msg, r => socket.write(JSON.stringify(r) + '\n'))
          else tratarEvento(msg)
        } catch (erro) {
          log(`erro ao tratar ${msg.evento || msg.controlo}: ${erro.stack || erro.message}`)
        }
      }
    })
    socket.on('error', () => {})
  })

  servidor.on('error', erro => {
    if (erro.code === 'EADDRINUSE') {
      if (WIN) process.exit(0) // já há outro servidor: este sai calado
      // Unix: pode ser um socket velho. Se ninguém responde, apaga-o e tenta outra vez.
      const teste = net.connect(CAMINHOS.canal)
      teste.on('connect', () => process.exit(0))
      teste.on('error', () => {
        try {
          fs.unlinkSync(CAMINHOS.canal)
        } catch {}
        servidor.listen(CAMINHOS.canal)
      })
      return
    }
    log(`servidor: ${erro.message}`)
    process.exit(1)
  })

  servidor.listen(CAMINHOS.canal, () => {
    log(`servidor a ouvir (pid ${process.pid})`)
    web = arrancarWeb(
      {
        estado: estadoParaBarra,
        aoReceber: pedidoDaBarra,
        aoMudarClientes: () => (ultimaAtividade = Date.now()),
      },
      lerConfig(),
    )
    estado.aoMudar(publicar)
    uso.arrancarVigia(publicar)
    // Uma atualização do plugin pode trazer uma barra nova: recompila-a sozinho.
    setTimeout(() => compilarBarra.recompilarSePreciso().catch(() => {}), 2000)
  })

  setInterval(() => {
    limparTemporarios()
    estado.limparVelhas()
    for (const [id, m] of mensagens) if (Date.now() - m.t > 5 * 60 * 1000) mensagens.delete(id)
    const barraLigada = web && web.clientes() > 0
    if (!barraLigada && !aFalar && !fila.length && Date.now() - ultimaAtividade > OCIOSO_MS) {
      log('parado há 10 minutos: a sair')
      servidor.close()
      sair()
    }
  }, 30 * 1000).unref()

  process.on('uncaughtException', erro => log(`exceção: ${erro.stack || erro.message}`))
  process.on('unhandledRejection', erro => log(`rejeição: ${(erro && erro.stack) || erro}`))
}

arrancar()
