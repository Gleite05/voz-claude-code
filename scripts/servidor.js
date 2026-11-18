'use strict'
// O servidor da voz: um só por utilizador, arranca sozinho com o primeiro gancho e sai após 10 minutos parado.
// Recebe eventos dos ganchos por um pipe local, decide o que dizer e fala uma coisa de cada vez.

const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const { CAMINHOS, WIN, garantirPasta, lerConfig, log, piperInstalado } = require('./comum')
const texto = require('./texto')
const { criarMotor } = require('./motores')

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

// ---------- fila ----------

function enfileirar(tipo, frase, sessao) {
  if (!frase) return
  fila.push({ tipo, texto: frase, sessao, criado: Date.now() })
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
  const preparar = item => m.preparar(item.texto, lerConfig()).catch(erro => (log(`preparar: ${erro.message}`), null))
  try {
    let atual = tirarProximo()
    let prep = atual && preparar(atual)
    while (atual && g === geracao) {
      const pedaco = await prep
      // Enquanto este toca, o próximo já está a ser sintetizado.
      const seguinte = tirarProximo()
      const prepSeguinte = seguinte && preparar(seguinte)
      if (g !== geracao) {
        if (pedaco) m.descartar(pedaco)
        if (prepSeguinte) prepSeguinte.then(p => p && m.descartar(p))
        break
      }
      if (pedaco) await m.tocar(pedaco).catch(erro => log(`tocar: ${erro.message}`))
      atual = seguinte
      prep = prepSeguinte
      if (!atual && g === geracao) {
        atual = tirarProximo()
        prep = atual && preparar(atual)
      }
      if (g !== geracao && prep) prep.then(p => p && m.descartar(p))
    }
  } finally {
    aFalar = false
    ultimaAtividade = Date.now()
    if (fila.length) setImmediate(bombear)
  }
}

function pararTudo() {
  geracao++
  fila.length = 0
  if (motor) motor.parar()
}

// ---------- eventos ----------

function emFoco(sessao, cfg) {
  if (!cfg.soSessaoAtiva || !sessao) return true
  if (!sessaoFoco) sessaoFoco = sessao
  return sessao === sessaoFoco
}

function nomePasta(cwd) {
  return cwd ? texto.base(cwd) : 'outra pasta'
}

function textoDeMensagem(msg, cfg) {
  // Os lotes de uma mensagem podem chegar fora de ordem (cada gancho é um processo): reordena pelo index.
  const id = msg.message_id || `${msg.sessao}-sem-id`
  let m = mensagens.get(id)
  if (!m) {
    m = { estado: texto.novoEstado(cfg.maxCaracteres), proximo: 0, pendentes: new Map(), sessao: msg.sessao, t: Date.now() }
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
  enfileirar('aviso', 'Para a voz em português de Portugal, escreve barra voz, dois pontos, instalar.', null)
}

const DEPURAR = Boolean(process.env.VOZ_DEBUG)

function tratarEvento(msg) {
  const cfg = lerConfig()
  if (DEPURAR) log(`evento ${msg.evento} sessão=${String(msg.sessao).slice(0, 8)}${msg.ferramenta ? ' ' + msg.ferramenta : ''}${msg.delta !== undefined ? ` #${msg.index}${msg.final ? ' final' : ''} ${JSON.stringify(String(msg.delta).slice(0, 60))}` : ''}`)
  if (!cfg.ligado) return
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
      enfileirar('acao', texto.anunciarFerramenta(msg.ferramenta, msg.entrada), s)
      return

    case 'MessageDisplay':
      if (!cfg.lerRespostas || !emFoco(s, cfg)) return
      turnoComTexto.add(s)
      textoDeMensagem(msg, cfg)
      return

    case 'Notification': {
      const frase = texto.frasesNotificacao(msg.mensagem)
      if (emFoco(s, cfg)) enfileirar('aviso', frase, s)
      else if (cfg.avisarOutrasSessoes) enfileirar('aviso', `Na sessão de ${nomePasta(msg.cwd)}: ${frase}`, s)
      return
    }

    case 'Stop':
      if (emFoco(s, cfg)) {
        // Versões sem MessageDisplay: lê a resposta final de uma vez.
        if (!turnoComTexto.has(s) && cfg.lerRespostas && msg.ultima) {
          const estado = texto.novoEstado(cfg.maxCaracteres)
          for (const frase of texto.processarDelta(estado, msg.ultima)) enfileirar('fala', frase, s)
        }
      } else if (cfg.avisarOutrasSessoes) {
        enfileirar('aviso', `A sessão de ${nomePasta(msg.cwd)} terminou.`, s)
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
    case 'testar':
      pararTudo()
      for (const frase of texto.processarDelta(texto.novoEstado(4000), msg.texto || 'Olá! A voz está a funcionar.')) {
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

// ---------- canal ----------

function sair() {
  try {
    if (motor) motor.fechar()
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
          if (msg.controlo) tratarControlo(msg, r => socket.write(JSON.stringify(r) + '\n'))
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

  servidor.listen(CAMINHOS.canal, () => log(`servidor a ouvir (pid ${process.pid})`))

  setInterval(() => {
    limparTemporarios()
    for (const [id, m] of mensagens) if (Date.now() - m.t > 5 * 60 * 1000) mensagens.delete(id)
    if (!aFalar && !fila.length && Date.now() - ultimaAtividade > OCIOSO_MS) {
      log('parado há 10 minutos: a sair')
      servidor.close()
      sair()
    }
  }, 30 * 1000).unref()

  process.on('uncaughtException', erro => log(`exceção: ${erro.stack || erro.message}`))
  process.on('unhandledRejection', erro => log(`rejeição: ${(erro && erro.stack) || erro}`))
}

arrancar()
