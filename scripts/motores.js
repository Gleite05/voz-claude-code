'use strict'
// Motores de voz. Todos expõem a mesma forma:
//   preparar(texto) -> Promise<pedaço>   (sintetiza; pode correr enquanto outro pedaço toca)
//   tocar(pedaço)   -> Promise           (resolve quando acaba ou quando é cortado)
//   descartar(pedaço), parar(), fechar()
//
//   piper   — voz neural pt-PT «tugão», local, através de um processo Python que fica carregado.
//   sistema — a voz do sistema operativo (Windows SAPI, macOS say, Linux espeak-ng).

const fs = require('node:fs')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')
const { CAMINHOS, WIN, log, piperInstalado } = require('./comum')

const PLATAFORMA = process.platform

// ---------- um processo que responde a uma linha com outra linha ----------

class ProcessoDeLinhas {
  constructor(nome, fabrica, { saudacao = false } = {}) {
    this.nome = nome
    this.fabrica = fabrica
    this.saudacao = saudacao
    this.proc = null
    this.espera = []
    this.buffer = ''
    this.pronto = null
  }

  iniciar() {
    if (this.proc) return this.pronto
    const proc = this.fabrica()
    this.proc = proc
    this.buffer = ''
    let aoSaudar
    this.pronto = this.saudacao ? new Promise(r => (aoSaudar = r)) : Promise.resolve()
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', dados => {
      this.buffer += dados
      let i
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const linha = this.buffer.slice(0, i).replace(/\r$/, '')
        this.buffer = this.buffer.slice(i + 1)
        if (aoSaudar) {
          aoSaudar(linha)
          aoSaudar = null
          log(`${this.nome}: ${linha}`)
          continue
        }
        const quem = this.espera.shift()
        if (quem) quem.resolve(linha)
      }
    })
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', d => {
      const t = String(d).trim()
      if (t && !t.startsWith('#< CLIXML')) log(`${this.nome} stderr: ${t.slice(0, 300)}`)
    })
    const terminar = motivo => {
      if (this.proc !== proc) return
      this.proc = null
      if (aoSaudar) aoSaudar('terminou')
      for (const quem of this.espera.splice(0)) quem.reject(new Error(motivo))
    }
    proc.on('exit', codigo => terminar(`${this.nome} terminou (${codigo})`))
    proc.on('error', erro => {
      log(`${this.nome} erro: ${erro.message}`)
      terminar(erro.message)
    })
    proc.stdin.on('error', () => {})
    return this.pronto
  }

  async enviar(linha) {
    await this.iniciar()
    if (!this.proc) throw new Error(`${this.nome} não arrancou`)
    return new Promise((resolve, reject) => {
      this.espera.push({ resolve, reject })
      this.proc.stdin.write(linha.replace(/[\r\n]+/g, ' ') + '\n')
    })
  }

  matar() {
    const proc = this.proc
    if (!proc) return
    this.proc = null
    for (const quem of this.espera.splice(0)) quem.resolve('parado')
    try {
      proc.kill()
    } catch {}
  }
}

// ---------- PowerShell (Windows) ----------

function powershell(script, env = {}) {
  const codificado = Buffer.from(script, 'utf16le').toString('base64')
  return spawn(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', codificado],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } },
  )
}

const PS_UTF8 = `
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
`

const PS_LEITOR_WAV = `${PS_UTF8}
while ($null -ne ($l = [Console]::In.ReadLine())) {
  try { $p = New-Object System.Media.SoundPlayer $l; $p.PlaySync(); $p.Dispose(); [Console]::Out.WriteLine('ok') }
  catch { [Console]::Out.WriteLine('erro ' + $_.Exception.Message) }
  [Console]::Out.Flush()
}
`

const PS_SAPI = `${PS_UTF8}
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$v = @($s.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo })
$pick = $null
if ($env:VOZ_NOME) { $pick = $v | Where-Object { $_.Name -like "*$($env:VOZ_NOME)*" } | Select-Object -First 1 }
if (-not $pick) { $pick = $v | Where-Object { $_.Culture.Name -eq 'pt-PT' } | Select-Object -First 1 }
if (-not $pick) { $pick = $v | Where-Object { $_.Culture.Name -like 'pt*' } | Select-Object -First 1 }
if ($pick) { $s.SelectVoice($pick.Name) }
[Console]::Out.WriteLine('voz ' + $s.Voice.Name + ' ' + $s.Voice.Culture.Name); [Console]::Out.Flush()
while ($null -ne ($l = [Console]::In.ReadLine())) {
  try { $i = $l.IndexOf('|'); $s.Rate = [int]$l.Substring(0, $i); $s.Speak($l.Substring($i + 1)); [Console]::Out.WriteLine('ok') }
  catch { [Console]::Out.WriteLine('erro ' + $_.Exception.Message) }
  [Console]::Out.Flush()
}
`

// ---------- um processo por pedaço (macOS / Linux) ----------

class ProcessoUnico {
  constructor() {
    this.atual = null
  }
  correr(comandos) {
    // comandos: lista de [programa, args]; tenta o seguinte se o anterior não existir.
    return new Promise(resolve => {
      const tentar = i => {
        if (i >= comandos.length) return resolve()
        const [prog, args] = comandos[i]
        const p = spawn(prog, args, { stdio: 'ignore' })
        this.atual = p
        p.on('error', () => {
          if (this.atual === p) this.atual = null
          tentar(i + 1)
        })
        p.on('exit', () => {
          if (this.atual === p) this.atual = null
          resolve()
        })
      }
      tentar(0)
    })
  }
  matar() {
    const p = this.atual
    this.atual = null
    if (p) {
      try {
        p.kill('SIGKILL')
      } catch {}
    }
  }
}

// ---------- leitor de WAV ----------

function criarLeitorWav() {
  if (WIN) {
    const ps = new ProcessoDeLinhas('leitor', () => powershell(PS_LEITOR_WAV))
    return { aquecer: () => ps.iniciar(), tocar: f => ps.enviar(f), parar: () => ps.matar(), fechar: () => ps.matar() }
  }
  const unico = new ProcessoUnico()
  const comandos = f =>
    PLATAFORMA === 'darwin'
      ? [['afplay', [f]]]
      : [['paplay', [f]], ['aplay', ['-q', f]], ['ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', f]]]
  return { aquecer: () => {}, tocar: f => unico.correr(comandos(f)), parar: () => unico.matar(), fechar: () => unico.matar() }
}

// ---------- motor Piper ----------

function criarMotorPiper() {
  const trabalhador = path.join(__dirname, 'piper_trabalhador.py')
  const sintetizador = new ProcessoDeLinhas(
    'piper',
    () =>
      spawn(CAMINHOS.pythonExe, ['-I', '-X', 'utf8', trabalhador, CAMINHOS.modelo], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      }),
    { saudacao: true },
  )
  const leitor = criarLeitorWav()
  let n = 0
  fs.mkdirSync(CAMINHOS.tmp, { recursive: true })
  const apagar = f => fs.promises.unlink(f).catch(() => {})

  return {
    nome: 'piper (tugão, pt-PT)',
    aquecer() {
      sintetizador.iniciar()
      leitor.aquecer()
    },
    async preparar(texto, cfg) {
      const ficheiro = path.join(CAMINHOS.tmp, `v-${process.pid}-${++n}.wav`)
      const escala = 1 / Math.min(2, Math.max(0.5, Number(cfg.velocidade) || 1))
      const resposta = await sintetizador.enviar(
        JSON.stringify({ texto, ficheiro, escala, ruido: Number(cfg.ruido), ruidoDuracao: Number(cfg.ruidoDuracao) }),
      )
      let r
      try {
        r = JSON.parse(resposta)
      } catch {
        throw new Error(`resposta inesperada do piper: ${resposta.slice(0, 120)}`)
      }
      if (!r.ok) throw new Error(`piper: ${r.erro || 'falhou'}`)
      return ficheiro
    },
    async tocar(ficheiro) {
      try {
        await leitor.tocar(ficheiro)
      } finally {
        apagar(ficheiro)
      }
    },
    descartar: apagar,
    parar: () => leitor.parar(),
    fechar() {
      leitor.fechar()
      sintetizador.matar()
    },
  }
}

// ---------- motor do sistema ----------

let vozMac
function vozPortuguesaMac() {
  if (vozMac !== undefined) return vozMac
  vozMac = null
  try {
    const lista = execFileSync('say', ['-v', '?'], { encoding: 'utf8' })
    const linha = lista.split('\n').find(l => /\bpt[_-]PT\b/.test(l)) || lista.split('\n').find(l => /\bpt[_-]/.test(l))
    if (linha) vozMac = linha.split(/\s{2,}/)[0].trim()
  } catch {}
  return vozMac
}

function criarMotorSistema(cfg) {
  // O pedaço leva a velocidade do momento em que foi preparado.
  const preparar = async (texto, c) => ({ texto, vel: Math.min(2, Math.max(0.5, Number(c.velocidade) || 1)) })
  if (WIN) {
    const sapi = new ProcessoDeLinhas('sapi', () => powershell(PS_SAPI, { VOZ_NOME: cfg.vozSistema || '' }), {
      saudacao: true,
    })
    return {
      nome: 'sistema (Windows SAPI)',
      aquecer: () => sapi.iniciar(),
      preparar,
      tocar: ({ texto, vel }) => sapi.enviar(`${Math.max(-10, Math.min(10, Math.round((vel - 1) * 10)))}|${texto}`),
      descartar: () => {},
      parar: () => sapi.matar(),
      fechar: () => sapi.matar(),
    }
  }
  const unico = new ProcessoUnico()
  return {
    nome: PLATAFORMA === 'darwin' ? 'sistema (macOS say)' : 'sistema (espeak-ng)',
    aquecer: () => {},
    preparar,
    tocar({ texto, vel }) {
      if (PLATAFORMA === 'darwin') {
        const voz = cfg.vozSistema || vozPortuguesaMac()
        return unico.correr([['say', [...(voz ? ['-v', voz] : []), '-r', String(Math.round(185 * vel)), texto]]])
      }
      return unico.correr([
        ['espeak-ng', ['-v', 'pt', '-s', String(Math.round(165 * vel)), texto]],
        ['espeak', ['-v', 'pt', '-s', String(Math.round(165 * vel)), texto]],
        ['spd-say', ['-l', 'pt', '-w', texto]],
      ])
    },
    descartar: () => {},
    parar: () => unico.matar(),
    fechar: () => unico.matar(),
  }
}

function criarMotor(cfg) {
  const querPiper = cfg.motor === 'piper' || (cfg.motor !== 'sistema' && piperInstalado())
  if (querPiper && piperInstalado()) return criarMotorPiper()
  return criarMotorSistema(cfg)
}

module.exports = { criarMotor }
