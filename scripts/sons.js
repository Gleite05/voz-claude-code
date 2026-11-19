'use strict'
// Sons curtos por evento (ao estilo do macOS), gerados aqui mesmo — o plugin não traz ficheiros de áudio.
//   ok       duas notas a subir   (testes passaram, push feito)
//   falha    duas notas a descer  (testes/compilação falharam)
//   atencao  «ding-dong»          (pedido de autorização, precisa de ti)
//   pronto   acorde suave         (uma conversa terminou)
// Cada som sai num WAV estéreo com o volume e o lado (pan) da conversa; ficam em cache na pasta da voz.

const fs = require('node:fs')
const path = require('node:path')
const { CAMINHOS } = require('./comum')

const TAXA = 44100
// [frequência Hz, início s, duração s]
const NOTAS = {
  ok: [[784, 0, 0.11], [1175, 0.09, 0.2]],
  falha: [[415, 0, 0.14], [311, 0.13, 0.26]],
  atencao: [[880, 0, 0.16], [660, 0.17, 0.3]],
  pronto: [[523.25, 0, 0.42], [659.25, 0.07, 0.42], [783.99, 0.14, 0.5]],
  ouvir: [[880, 0, 0.07], [1318.5, 0.06, 0.12]], // «estou a ouvir-te»
}
const NOMES = Object.keys(NOTAS)

/** Ganhos esquerda/direita para um pan de -1 (esquerda) a 1 (direita); o ouvido mais perto fica a 100%. */
function ganhos(pan) {
  const p = Math.max(-1, Math.min(1, Number(pan) || 0))
  if (!p) return [1, 1]
  const th = ((p + 1) * Math.PI) / 4
  const e = Math.cos(th)
  const d = Math.sin(th)
  const m = Math.max(e, d)
  return [e / m, d / m]
}

/** WAV estéreo de 16 bits com o som `nome`. */
function gerarWav(nome, { volume = 1, pan = 0 } = {}) {
  const notas = NOTAS[nome]
  if (!notas) throw new Error(`som desconhecido: ${nome}`)
  const fim = Math.max(...notas.map(([, i, d]) => i + d)) + 0.05
  const n = Math.ceil(fim * TAXA)
  const x = new Float32Array(n)
  for (const [f, ini, dur] of notas) {
    const a = Math.floor(ini * TAXA)
    const len = Math.floor(dur * TAXA)
    for (let k = 0; k < len && a + k < n; k++) {
      const t = k / TAXA
      const ataque = Math.min(1, t / 0.006)
      const queda = Math.exp((-t * 5.2) / dur)
      const s = Math.sin(2 * Math.PI * f * t) + 0.28 * Math.sin(4 * Math.PI * f * t) + 0.08 * Math.sin(6 * Math.PI * f * t)
      x[a + k] += s * ataque * queda
    }
  }
  let pico = 0
  for (const v of x) pico = Math.max(pico, Math.abs(v))
  const amp = (0.32 * Math.max(0, Math.min(2, Number(volume)))) / (pico || 1)
  const [ge, gd] = ganhos(pan)
  const dados = Buffer.alloc(n * 4)
  for (let k = 0; k < n; k++) {
    const v = x[k] * amp
    dados.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * ge)) * 32767), k * 4)
    dados.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * gd)) * 32767), k * 4 + 2)
  }
  const cab = Buffer.alloc(44)
  cab.write('RIFF', 0)
  cab.writeUInt32LE(36 + dados.length, 4)
  cab.write('WAVEfmt ', 8)
  cab.writeUInt32LE(16, 16)
  cab.writeUInt16LE(1, 20) // PCM
  cab.writeUInt16LE(2, 22) // estéreo
  cab.writeUInt32LE(TAXA, 24)
  cab.writeUInt32LE(TAXA * 4, 28)
  cab.writeUInt16LE(4, 32)
  cab.writeUInt16LE(16, 34)
  cab.write('data', 36)
  cab.writeUInt32LE(dados.length, 40)
  return Buffer.concat([cab, dados])
}

/** Caminho do WAV (gera-o da primeira vez). Volume e pan arredondados para a cache não crescer sem fim. */
function caminho(nome, { volume = 1, pan = 0 } = {}) {
  const v = Math.round(Math.max(0, Math.min(2, Number(volume) || 0)) * 10)
  const p = Math.round(Math.max(-1, Math.min(1, Number(pan) || 0)) * 10)
  const pasta = path.join(CAMINHOS.pasta, 'sons')
  const f = path.join(pasta, `${nome}-v${v}-p${p}.wav`)
  if (!fs.existsSync(f)) {
    fs.mkdirSync(pasta, { recursive: true })
    fs.writeFileSync(f, gerarWav(nome, { volume: v / 10, pan: p / 10 }))
  }
  return f
}

module.exports = { gerarWav, caminho, ganhos, NOMES }
