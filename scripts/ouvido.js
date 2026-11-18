'use strict'
// Ditado: controla o trabalhador Python que grava o microfone e transcreve com o Whisper.

const fs = require('node:fs')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { CAMINHOS, log } = require('./comum')

const PASTA_MODELOS = path.join(CAMINHOS.pasta, 'whisper')

let proc = null
let pronto = null
let espera = []
let buffer = ''

function instalado() {
  if (!fs.existsSync(CAMINHOS.pythonExe)) return false
  const r = spawnSync(CAMINHOS.pythonExe, ['-I', '-c', 'import faster_whisper, sounddevice'], { windowsHide: true })
  return r.status === 0
}

function iniciar(modelo) {
  if (proc) return pronto
  proc = spawn(CAMINHOS.pythonExe, ['-I', '-X', 'utf8', path.join(__dirname, 'ouvir_trabalhador.py'), PASTA_MODELOS, modelo || 'small'], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, HF_HUB_DISABLE_SYMLINKS_WARNING: '1', HF_HUB_DISABLE_TELEMETRY: '1', HF_HUB_DISABLE_PROGRESS_BARS: '1' },
  })
  let aoPronto
  pronto = new Promise(r => (aoPronto = r))
  proc.stdout.setEncoding('utf8')
  proc.stdout.on('data', d => {
    buffer += d
    let i
    while ((i = buffer.indexOf('\n')) >= 0) {
      const linha = buffer.slice(0, i)
      buffer = buffer.slice(i + 1)
      let msg
      try {
        msg = JSON.parse(linha)
      } catch {
        continue
      }
      if (aoPronto) {
        aoPronto(msg)
        aoPronto = null
        log(`whisper: ${linha.slice(0, 200)}`)
        continue
      }
      const quem = espera.shift()
      if (quem) quem(msg)
    }
  })
  proc.stderr.setEncoding('utf8')
  proc.stderr.on('data', d => {
    const t = String(d).trim()
    if (t && !/warn|download|%\|/i.test(t)) log(`whisper stderr: ${t.slice(0, 200)}`)
  })
  proc.on('exit', () => {
    proc = null
    if (aoPronto) aoPronto({ pronto: false, erro: 'o trabalhador do Whisper terminou' })
    for (const q of espera.splice(0)) q({ ok: false, erro: 'terminou' })
  })
  proc.on('error', e => log(`whisper: ${e.message}`))
  return pronto
}

async function ordem(o, modelo) {
  const p = await iniciar(modelo)
  if (!p || p.pronto === false) return { ok: false, erro: (p && p.erro) || 'Whisper indisponível' }
  return new Promise(resolve => {
    espera.push(resolve)
    proc.stdin.write(JSON.stringify(o) + '\n')
  })
}

module.exports = {
  instalado,
  gravar: modelo => ordem({ ordem: 'gravar' }, modelo),
  parar: (idioma, modelo) => ordem({ ordem: 'parar', idioma }, modelo),
  cancelar: modelo => ordem({ ordem: 'cancelar' }, modelo),
  aquecer: modelo => iniciar(modelo),
  fechar: () => {
    if (proc) proc.kill()
  },
  PASTA_MODELOS,
}
