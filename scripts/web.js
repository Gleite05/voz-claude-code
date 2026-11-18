'use strict'
// Servidor web local (só 127.0.0.1) para a barra: serve a interface, envia o estado
// em tempo real (Server-Sent Events) e recebe ordens (config, parar, saltar, pausa).
// Tudo o que mexe em dados exige o token guardado em ~/.claude/voz/barra/barra.json.

const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const crypto = require('node:crypto')
const { CAMINHOS, garantirPasta, log } = require('./comum')

const PASTA_BARRA = path.join(CAMINHOS.pasta, 'barra')
const FICHEIRO_BARRA = path.join(PASTA_BARRA, 'barra.json')
const PASTA_APP = path.join(CAMINHOS.pasta, 'app')
const RAIZ = path.join(__dirname, '..')
const PORTA_PREDEFINIDA = 47821

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
}

function versao() {
  try {
    return JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8')).version
  } catch {
    return '0'
  }
}

function lerJson(f) {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch {
    return null
  }
}

/** Copia scripts e interface para ~/.claude/voz/app, para a barra arrancar o servidor mesmo
 *  depois de uma atualização do plugin mudar a pasta de instalação. */
function sincronizarApp() {
  const v = versao()
  try {
    if (path.resolve(RAIZ) === path.resolve(PASTA_APP)) return
    const marca = path.join(PASTA_APP, 'versao.txt')
    if (fs.existsSync(marca) && fs.readFileSync(marca, 'utf8').trim() === v) return
    for (const sub of ['scripts', 'barra']) {
      const origem = path.join(RAIZ, sub)
      if (fs.existsSync(origem)) fs.cpSync(origem, path.join(PASTA_APP, sub), { recursive: true, force: true })
    }
    fs.copyFileSync(path.join(RAIZ, 'package.json'), path.join(PASTA_APP, 'package.json'))
    fs.writeFileSync(marca, v)
    log(`app sincronizada (${v}) em ${PASTA_APP}`)
  } catch (erro) {
    log(`sincronizar app: ${erro.message}`)
  }
}

function prepararFicheiroBarra(porta) {
  garantirPasta(PASTA_BARRA)
  const atual = lerJson(FICHEIRO_BARRA) || {}
  const dados = {
    porta,
    token: atual.token || crypto.randomBytes(24).toString('hex'),
    node: process.execPath,
    servidor: path.join(PASTA_APP, 'scripts', 'servidor.js'),
    versao: versao(),
  }
  fs.writeFileSync(FICHEIRO_BARRA, JSON.stringify(dados, null, 2))
  return dados
}

function iguais(a, b) {
  const x = Buffer.from(String(a || ''))
  const y = Buffer.from(String(b || ''))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

/**
 * Arranca o servidor web.
 * ligacoes: { estado(): objeto, aoReceber(pedido): resposta, aoMudarClientes(n) }
 */
function arrancarWeb(ligacoes, cfg) {
  sincronizarApp()
  const porta = Number(cfg.porta) || PORTA_PREDEFINIDA
  const barra = prepararFicheiroBarra(porta)
  const clientes = new Set()
  let pendente = null

  const servidor = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${porta}`)
    // Contra DNS rebinding: só aceita os nomes locais.
    const host = String(req.headers.host || '')
    if (host !== `127.0.0.1:${porta}` && host !== `localhost:${porta}`) {
      res.writeHead(403).end()
      return
    }
    const autorizado = iguais(url.searchParams.get('t'), barra.token)

    if (url.pathname === '/saude') {
      res.writeHead(200, { 'content-type': TIPOS['.json'] }).end(JSON.stringify({ ok: true, versao: versao() }))
      return
    }

    if (url.pathname === '/eventos') {
      if (!autorizado) return void res.writeHead(401).end()
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      res.write(`retry: 1500\nevent: estado\ndata: ${JSON.stringify(ligacoes.estado())}\n\n`)
      clientes.add(res)
      ligacoes.aoMudarClientes(clientes.size)
      req.on('close', () => {
        clientes.delete(res)
        ligacoes.aoMudarClientes(clientes.size)
      })
      return
    }

    if (url.pathname === '/api' && req.method === 'POST') {
      if (!autorizado) return void res.writeHead(401).end()
      let corpo = ''
      req.setEncoding('utf8')
      req.on('data', d => {
        corpo += d
        if (corpo.length > 64 * 1024) req.destroy()
      })
      req.on('end', () => {
        let resposta
        try {
          resposta = ligacoes.aoReceber(JSON.parse(corpo || '{}'))
        } catch (erro) {
          resposta = { ok: false, erro: erro.message }
        }
        res.writeHead(200, { 'content-type': TIPOS['.json'] }).end(JSON.stringify(resposta || { ok: true }))
      })
      return
    }

    // Ficheiros da interface (sem dados): /barra/…
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname.startsWith('/barra/'))) {
      const rel = url.pathname === '/' ? 'barra.html' : url.pathname.slice('/barra/'.length)
      const pastaUi = path.join(RAIZ, 'barra')
      const f = path.resolve(pastaUi, rel)
      if (!f.startsWith(path.resolve(pastaUi) + path.sep) || !fs.existsSync(f)) return void res.writeHead(404).end()
      res.writeHead(200, { 'content-type': TIPOS[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' })
      fs.createReadStream(f).pipe(res)
      return
    }

    res.writeHead(404).end()
  })

  servidor.on('error', erro => log(`web: ${erro.code || erro.message} na porta ${porta}`))
  servidor.listen(porta, '127.0.0.1', () => log(`web em http://127.0.0.1:${porta}`))

  function emitir(evento, dados) {
    const linha = `event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`
    for (const c of clientes) c.write(linha)
  }

  return {
    clientes: () => clientes.size,
    /** Envia o estado aos clientes, no máximo 10 vezes por segundo. */
    publicar() {
      if (pendente) return
      pendente = setTimeout(() => {
        pendente = null
        emitir('estado', ligacoes.estado())
      }, 100)
    },
    emitir,
    fechar: () => servidor.close(),
  }
}

module.exports = { arrancarWeb, FICHEIRO_BARRA, PASTA_BARRA, PASTA_APP, versao }
