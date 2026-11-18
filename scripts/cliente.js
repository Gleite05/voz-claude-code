'use strict'
// Fala com o servidor pelo pipe local e arranca-o quando ainda não existe.

const net = require('node:net')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { CAMINHOS, garantirPasta } = require('./comum')

function ligar() {
  return new Promise((resolve, reject) => {
    const s = net.connect(CAMINHOS.canal)
    s.once('connect', () => resolve(s))
    s.once('error', reject)
  })
}

function arrancarServidor() {
  garantirPasta()
  const filho = spawn(process.execPath, [path.join(__dirname, 'servidor.js')], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  filho.unref()
}

const esperar = ms => new Promise(r => setTimeout(r, ms))

/** Liga-se ao servidor; com `arrancar`, lança-o e tenta durante até 4 segundos. */
async function obterLigacao({ arrancar = true } = {}) {
  try {
    return await ligar()
  } catch (erro) {
    if (!arrancar) throw erro
  }
  arrancarServidor()
  const limite = Date.now() + 4000
  for (;;) {
    await esperar(80)
    try {
      return await ligar()
    } catch (erro) {
      if (Date.now() > limite) throw erro
    }
  }
}

/** Envia uma mensagem. Com `resposta`, espera por uma linha de volta (até 3 s). */
async function enviar(msg, { arrancar = true, resposta = false } = {}) {
  const s = await obterLigacao({ arrancar })
  return new Promise(resolve => {
    if (!resposta) {
      s.end(JSON.stringify(msg) + '\n', () => resolve(null))
      return
    }
    let buffer = ''
    const fim = valor => {
      clearTimeout(t)
      s.destroy()
      resolve(valor)
    }
    const t = setTimeout(() => fim(null), 3000)
    s.setEncoding('utf8')
    s.on('data', d => {
      buffer += d
      const i = buffer.indexOf('\n')
      if (i >= 0) {
        try {
          fim(JSON.parse(buffer.slice(0, i)))
        } catch {
          fim(null)
        }
      }
    })
    s.on('error', () => fim(null))
    s.write(JSON.stringify(msg) + '\n')
  })
}

module.exports = { enviar }
