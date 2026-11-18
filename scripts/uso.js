'use strict'
// Tokens por dia, lidos dos históricos locais do Claude Code (~/.claude/projects/**/*.jsonl).
// Leitura incremental: guarda até onde leu cada ficheiro e só processa o que é novo.
// Cada mensagem do assistente é contada uma vez (o histórico repete o mesmo message.id por bloco).

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { CAMINHOS, log } = require('./comum')

const PROJETOS = process.env.VOZ_PROJETOS || path.join(os.homedir(), '.claude', 'projects')
const CACHE = path.join(CAMINHOS.pasta, 'uso.json')
const DIAS_GUARDADOS = 35

let dados = null

function carregar() {
  if (dados) return dados
  try {
    dados = JSON.parse(fs.readFileSync(CACHE, 'utf8'))
  } catch {
    dados = { versao: 1, ficheiros: {}, dias: {} }
  }
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

function somar(dia, sessao, u) {
  const d = (dados.dias[dia] = dados.dias[dia] || { entrada: 0, saida: 0, cache: 0, sessoes: {} })
  const entrada = (Number(u.input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0)
  const cache = Number(u.cache_read_input_tokens) || 0
  const saida = Number(u.output_tokens) || 0
  d.entrada += entrada
  d.cache += cache
  d.saida += saida
  const s = (d.sessoes[sessao] = d.sessoes[sessao] || { saida: 0, entrada: 0 })
  s.saida += saida
  s.entrada += entrada
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
          const id = e.message.id || e.requestId
          if (id && id === info.ultimoId) continue
          info.ultimoId = id
          const dia = diaLocal(e.timestamp)
          if (!dia) continue
          somar(dia, sessao, e.message.usage)
          mudou = true
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

/** Resumo para a barra: os últimos 7 dias e as conversas de hoje que mais gastaram. */
function resumo(titulos = {}) {
  carregar()
  const hoje = diaLocal(new Date().toISOString())
  const dias = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const k = diaLocal(d.toISOString())
    const v = dados.dias[k] || { entrada: 0, saida: 0, cache: 0 }
    dias.push({ dia: k, entrada: v.entrada, saida: v.saida, cache: v.cache })
  }
  const h = dados.dias[hoje] || { entrada: 0, saida: 0, cache: 0, sessoes: {} }
  const topo = Object.entries(h.sessoes || {})
    .map(([id, v]) => ({ id, titulo: titulos[id] || (dados.titulos || {})[id] || null, saida: v.saida, entrada: v.entrada }))
    .sort((a, b) => b.saida - a.saida)
    .slice(0, 5)
  return { hoje: { dia: hoje, entrada: h.entrada, saida: h.saida, cache: h.cache }, dias, topo }
}

let aCorrer = false
function arrancarVigia(aoMudar) {
  const passo = async () => {
    if (aCorrer) return
    aCorrer = true
    try {
      if (await atualizar()) aoMudar()
    } catch (erro) {
      log(`uso: ${erro.message}`)
    } finally {
      aCorrer = false
    }
  }
  setTimeout(passo, 3000)
  setInterval(passo, 60 * 1000).unref()
}

module.exports = { atualizar, resumo, arrancarVigia }
