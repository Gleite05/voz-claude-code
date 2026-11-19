'use strict'
// Tokens por dia, lidos dos históricos locais do Claude Code (~/.claude/projects/**/*.jsonl).
// Leitura incremental: guarda até onde leu cada ficheiro e só processa o que é novo.
// Cada mensagem do assistente é contada uma vez (o histórico repete o mesmo message.id por bloco).

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { CAMINHOS, log } = require('./comum')
const precos = require('./precos')

const VERSAO = 2 // 2: custo, ferramentas, horas e projetos por dia (a cache antiga é relida do zero)

const PROJETOS = process.env.VOZ_PROJETOS || path.join(os.homedir(), '.claude', 'projects')
const CACHE = path.join(CAMINHOS.pasta, 'uso.json')
const DIAS_GUARDADOS = 35

let dados = null

function carregar() {
  if (dados) return dados
  try {
    dados = JSON.parse(fs.readFileSync(CACHE, 'utf8'))
  } catch {
    dados = null
  }
  if (!dados || dados.versao !== VERSAO) dados = { versao: VERSAO, ficheiros: {}, dias: {}, titulos: (dados && dados.titulos) || {} }
  return dados
}

function gravar() {
  try {
    fs.writeFileSync(CACHE, JSON.stringify(dados))
  } catch {}
}

const diaLocal = iso => {
  const d = new Date(iso)
  if (isNaN(d)) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function diaVazio() {
  return { entrada: 0, saida: 0, cache: 0, custo: 0, semPreco: 0, sessoes: {}, ferramentas: {}, horas: Array(24).fill(0), projetos: {} }
}

function somar(dia, sessao, u, e) {
  const d = (dados.dias[dia] = dados.dias[dia] || diaVazio())
  const entrada = (Number(u.input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0)
  const cache = Number(u.cache_read_input_tokens) || 0
  const saida = Number(u.output_tokens) || 0
  const c = precos.custo(e.message.model, u)
  d.entrada += entrada
  d.cache += cache
  d.saida += saida
  if (c === null) d.semPreco += entrada + saida
  else d.custo += c
  const s = (d.sessoes[sessao] = d.sessoes[sessao] || { saida: 0, entrada: 0, custo: 0 })
  s.saida += saida
  s.entrada += entrada
  s.custo = (s.custo || 0) + (c || 0)
  const h = new Date(e.timestamp).getHours()
  if (h >= 0) d.horas[h]++
  if (e.cwd) {
    const pasta = String(e.cwd).split(/[\\/]/).filter(Boolean).pop() // Windows ou Unix, venha de onde vier
    d.projetos[pasta] = (d.projetos[pasta] || 0) + saida
  }
}

/** Ferramentas usadas numa linha do histórico (cada bloco tool_use da mensagem do assistente). */
function contarFerramentas(dia, e) {
  const c = e.message && e.message.content
  if (!Array.isArray(c)) return
  const d = (dados.dias[dia] = dados.dias[dia] || diaVazio())
  for (const b of c) {
    if (!b || b.type !== 'tool_use' || !b.name) continue
    const nome = String(b.name).startsWith('mcp__') ? 'MCP' : String(b.name).slice(0, 40)
    d.ferramentas[nome] = (d.ferramentas[nome] || 0) + 1
  }
}

function listarFicheiros() {
  const lista = []
  let pastas = []
  try {
    pastas = fs.readdirSync(PROJETOS)
  } catch {
    return lista
  }
  for (const p of pastas) {
    let fs2 = []
    try {
      fs2 = fs.readdirSync(path.join(PROJETOS, p))
    } catch {
      continue
    }
    for (const f of fs2) if (f.endsWith('.jsonl')) lista.push(path.join(PROJETOS, p, f))
  }
  return lista
}

/** Lê o que há de novo em cada histórico. Devolve true se algo mudou. */
async function atualizar() {
  carregar()
  let mudou = false
  const limite = Date.now() - DIAS_GUARDADOS * 24 * 3600 * 1000
  for (const f of listarFicheiros()) {
    let st
    try {
      st = fs.statSync(f)
    } catch {
      continue
    }
    if (st.mtimeMs < limite) continue
    const info = (dados.ficheiros[f] = dados.ficheiros[f] || { pos: 0, ultimoId: null })
    if (st.size < info.pos) info.pos = 0 // ficheiro reescrito
    if (st.size === info.pos) continue
    const sessao = path.basename(f, '.jsonl')
    await new Promise(resolve => {
      let resto = ''
      const leitor = fs.createReadStream(f, { start: info.pos, end: st.size - 1, encoding: 'utf8' })
      leitor.on('data', pedaco => {
        const linhas = (resto + pedaco).split('\n')
        resto = linhas.pop()
        for (const l of linhas) {
          info.pos += Buffer.byteLength(l, 'utf8') + 1
          if (l.includes('"custom-title"')) {
            try {
              const t = JSON.parse(l).customTitle
              if (t) (dados.titulos = dados.titulos || {})[sessao] = String(t).slice(0, 120)
            } catch {}
            continue
          }
          if (!l.includes('"usage"') || !l.includes('"assistant"')) continue
          let e
          try {
            e = JSON.parse(l)
          } catch {
            continue
          }
          if (e.type !== 'assistant' || !e.message || !e.message.usage) continue
          const dia = diaLocal(e.timestamp)
          if (!dia) continue
          // O histórico escreve uma linha por bloco: as ferramentas contam-se em todas, os tokens só uma vez.
          contarFerramentas(dia, e)
          mudou = true
          const id = e.message.id || e.requestId
          if (id && id === info.ultimoId) continue
          info.ultimoId = id
          somar(dia, sessao, e.message.usage, e)
        }
      })
      leitor.on('end', resolve)
      leitor.on('error', resolve)
    })
  }
  // Esquece dias antigos.
  for (const d of Object.keys(dados.dias)) if (new Date(d).getTime() < limite) delete dados.dias[d]
  if (mudou) gravar()
  return mudou
}

const somaMapas = mapas => {
  const r = {}
  for (const m of mapas) for (const [k, v] of Object.entries(m || {})) r[k] = (r[k] || 0) + v
  return r
}
const topoDe = (m, n) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([nome, valor]) => ({ nome, valor }))

/** A semana em números, para o «Voz Wrapped»: totais, horas ativas, dias seguidos, projetos e ferramentas. */
function semana(dias) {
  const vs = dias.map(x => dados.dias[x.dia] || diaVazio())
  const horasAtivas = vs.reduce((t, v) => t + (v.horas || []).filter(n => n > 0).length, 0)
  let seguidos = 0
  let melhor = 0
  for (const v of vs) {
    seguidos = v.saida > 0 ? seguidos + 1 : 0
    melhor = Math.max(melhor, seguidos)
  }
  const horas = Array(24).fill(0)
  for (const v of vs) (v.horas || []).forEach((n, i) => (horas[i] += n))
  const horaPico = horas.some(n => n > 0) ? horas.indexOf(Math.max(...horas)) : null
  const diaPico = dias.reduce((a, b) => (b.entrada + b.saida > a.entrada + a.saida ? b : a), dias[0])
  const conversas = new Set(vs.flatMap(v => Object.keys(v.sessoes || {}))).size
  return {
    entrada: vs.reduce((t, v) => t + v.entrada, 0),
    saida: vs.reduce((t, v) => t + v.saida, 0),
    cache: vs.reduce((t, v) => t + v.cache, 0),
    custo: vs.reduce((t, v) => t + (v.custo || 0), 0),
    horasAtivas,
    diasSeguidos: melhor,
    horaPico,
    diaPico: diaPico && diaPico.entrada + diaPico.saida > 0 ? diaPico.dia : null,
    conversas,
    projetos: topoDe(somaMapas(vs.map(v => v.projetos)), 3),
    ferramentas: topoDe(somaMapas(vs.map(v => v.ferramentas)), 6),
  }
}

/** Resumo para a barra: os últimos 7 dias, as conversas de hoje que mais gastaram e a semana. */
function resumo(titulos = {}) {
  carregar()
  const hoje = diaLocal(new Date().toISOString())
  const dias = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const k = diaLocal(d.toISOString())
    const v = dados.dias[k] || diaVazio()
    dias.push({ dia: k, entrada: v.entrada, saida: v.saida, cache: v.cache, custo: v.custo || 0 })
  }
  const h = dados.dias[hoje] || diaVazio()
  const topo = Object.entries(h.sessoes || {})
    .map(([id, v]) => ({ id, titulo: titulos[id] || (dados.titulos || {})[id] || null, saida: v.saida, entrada: v.entrada, custo: v.custo || 0 }))
    .sort((a, b) => b.saida - a.saida)
    .slice(0, 5)
  return {
    hoje: { dia: hoje, entrada: h.entrada, saida: h.saida, cache: h.cache, custo: h.custo || 0, semPreco: h.semPreco || 0 },
    dias,
    topo,
    semana: semana(dias),
    cambio: cambio(),
  }
}

// ---------- câmbio dólar → euro (taxa diária do Banco Central Europeu) ----------
// Pedido público, sem chave e sem dados do utilizador; uma vez por dia. Sem rede, fica a última taxa conhecida.
const CAMBIO_RESERVA = 0.86
const URL_BCE = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'

function cambio() {
  const c = (dados && dados.cambio) || null
  return c && c.eurPorDolar ? c : { eurPorDolar: CAMBIO_RESERVA, data: null, reserva: true }
}

async function atualizarCambio() {
  carregar()
  const c = dados.cambio
  if (c && c.obtido && Date.now() - c.obtido < 12 * 3600 * 1000) return false
  try {
    const r = await fetch(URL_BCE, { signal: AbortSignal.timeout(8000) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const xml = await r.text()
    const usd = /currency=['"]USD['"]\s+rate=['"]([\d.]+)['"]/.exec(xml)
    const data = /time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)
    if (!usd) throw new Error('sem a taxa do dólar')
    dados.cambio = { eurPorDolar: 1 / Number(usd[1]), data: data ? data[1] : null, obtido: Date.now() }
    gravar()
    return true
  } catch (erro) {
    log(`câmbio do BCE: ${erro.message}`)
    if (c) c.obtido = Date.now() // tenta outra vez daqui a 12 h
    return false
  }
}

let aCorrer = false
function arrancarVigia(aoMudar) {
  const passo = async () => {
    if (aCorrer) return
    aCorrer = true
    try {
      const a = await atualizar()
      const b = await atualizarCambio()
      if (a || b) aoMudar()
    } catch (erro) {
      log(`uso: ${erro.message}`)
    } finally {
      aCorrer = false
    }
  }
  setTimeout(passo, 3000)
  setInterval(passo, 60 * 1000).unref()
}

module.exports = { atualizar, resumo, arrancarVigia, atualizarCambio }
