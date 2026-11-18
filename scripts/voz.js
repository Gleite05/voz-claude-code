#!/usr/bin/env node
'use strict'
// Linha de comandos da voz. É o que os comandos /voz:… correm.
//   node voz.js ligar | desligar | parar | estado | testar [texto]
//   node voz.js velocidade 1.2 | modo tudo|acoes|respostas | sessao todas|ativa
//   node voz.js instalar        (voz neural pt-PT, gratuita e local)

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { CAMINHOS, WIN, garantirPasta, lerConfig, escreverConfig, piperInstalado } = require('./comum')
const { enviar } = require('./cliente')

const VERSAO_PIPER = '1.8.0'
const BASE_VOZ = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_PT/tug%C3%A3o/medium/'
const FICHEIROS_VOZ = [
  {
    url: BASE_VOZ + 'pt_PT-tug%C3%A3o-medium.onnx',
    destino: CAMINHOS.modelo,
    sha256: 'f90d87efaa88ba0d24018f7e74a0ea3feeddeb407bf46332322a3824e9451219',
  },
  {
    url: BASE_VOZ + 'pt_PT-tug%C3%A3o-medium.onnx.json',
    destino: CAMINHOS.modelo + '.json',
    sha256: '511b014b3baeeb7dabc0c96b35ebdc1a039e9436f6912ec94cd85e6a7a6a533e',
  },
]

const dizer = (...l) => console.log(...l)

async function semServidor(msg) {
  try {
    return await enviar(msg, { arrancar: false, resposta: true })
  } catch {
    return null
  }
}

function motorPrevisto(cfg) {
  if (cfg.motor !== 'sistema' && piperInstalado()) return 'piper (voz neural pt-PT «tugão»)'
  return WIN ? 'voz do Windows (SAPI)' : process.platform === 'darwin' ? 'voz do macOS (say)' : 'espeak-ng'
}

// ---------- instalação ----------

function encontrarPython() {
  const candidatos = WIN
    ? [['py', ['-3']], ['python', []], ['python3', []]]
    : [['python3', []], ['python', []]]
  for (const [prog, args] of candidatos) {
    const r = spawnSync(prog, [...args, '-c', 'import sys;print("%d.%d"%sys.version_info[:2])'], { encoding: 'utf8' })
    if (r.status === 0) {
      const [maior, menor] = r.stdout.trim().split('.').map(Number)
      if (maior === 3 && menor >= 9) return [prog, args, r.stdout.trim()]
    }
  }
  return null
}

async function descarregar({ url, destino, sha256 }) {
  if (fs.existsSync(destino) && hash(destino) === sha256) {
    dizer(`  já existe: ${path.basename(destino)}`)
    return
  }
  dizer(`  a descarregar ${path.basename(destino)}…`)
  const r = await fetch(url, { redirect: 'follow' })
  if (!r.ok) throw new Error(`download falhou (${r.status}) em ${url}`)
  const dados = Buffer.from(await r.arrayBuffer())
  const obtido = crypto.createHash('sha256').update(dados).digest('hex')
  if (obtido !== sha256) throw new Error(`o ficheiro ${path.basename(destino)} não corresponde ao esperado (sha256 ${obtido})`)
  fs.writeFileSync(destino, dados)
}

function hash(f) {
  return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
}

async function instalar() {
  garantirPasta()
  garantirPasta(CAMINHOS.vozes)
  dizer('Instalação da voz portuguesa (Piper + «tugão», tudo local e gratuito)')

  if (!fs.existsSync(CAMINHOS.pythonExe)) {
    const py = encontrarPython()
    if (!py) {
      dizer('Não encontrei o Python 3.9 ou mais recente. Instala-o (https://www.python.org/downloads/) e volta a correr /voz:instalar.')
      dizer('Até lá, a voz usa a voz do sistema.')
      process.exitCode = 1
      return
    }
    dizer(`1/3 A criar o ambiente Python (${py[2]}) em ${CAMINHOS.python}`)
    const r = spawnSync(py[0], [...py[1], '-m', 'venv', CAMINHOS.python], { stdio: 'inherit' })
    if (r.status !== 0) throw new Error('não foi possível criar o ambiente Python (venv)')
  } else {
    dizer('1/3 O ambiente Python já existe')
  }

  dizer(`2/3 A instalar o piper-tts ${VERSAO_PIPER} (pode demorar um ou dois minutos)`)
  const pip = spawnSync(
    CAMINHOS.pythonExe,
    ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', `piper-tts==${VERSAO_PIPER}`],
    { stdio: 'inherit' },
  )
  if (pip.status !== 0) throw new Error('o pip não conseguiu instalar o piper-tts')

  dizer('3/3 A descarregar a voz «tugão» (cerca de 63 MB, licença CC0)')
  for (const f of FICHEIROS_VOZ) await descarregar(f)

  escreverConfig({ motor: 'auto' })
  await semServidor({ controlo: 'recarregar' })
  dizer('Pronto! A voz portuguesa está instalada.')
  await enviar({ controlo: 'testar', texto: 'Olá! A voz em português de Portugal está instalada e pronta.' }, { resposta: true })
}

// ---------- comandos ----------

async function principal(argv) {
  const [comando = 'estado', ...resto] = argv
  const arg = resto.join(' ').trim()

  switch (comando) {
    case 'ligar':
      escreverConfig({ ligado: true })
      dizer('Voz ligada em todas as sessões.')
      await enviar({ controlo: 'testar', texto: 'Voz ligada.' }, { resposta: true })
      return

    case 'desligar':
      escreverConfig({ ligado: false })
      await semServidor({ controlo: 'parar' })
      dizer('Voz desligada em todas as sessões.')
      return

    case 'parar':
      await semServidor({ controlo: 'parar' })
      dizer('Parei de falar (a voz continua ligada).')
      return

    case 'testar':
      await enviar({ controlo: 'testar', texto: arg || undefined }, { resposta: true })
      dizer(`A testar com: ${motorPrevisto(lerConfig())}`)
      return

    case 'velocidade': {
      const v = Number(arg.replace(',', '.'))
      if (!(v >= 0.5 && v <= 2)) {
        dizer(`Velocidade atual: ${lerConfig().velocidade}. Usa um número entre 0.5 e 2.0, por exemplo: velocidade 1.2`)
        return
      }
      escreverConfig({ velocidade: v })
      dizer(`Velocidade: ${v}.`)
      await enviar({ controlo: 'testar', texto: 'Assim está bem?' }, { resposta: true })
      return
    }

    case 'modo': {
      const modos = { tudo: [true, true], acoes: [true, false], ações: [true, false], respostas: [false, true] }
      const m = modos[arg.toLowerCase()]
      if (!m) {
        const c = lerConfig()
        const atual = c.anunciarAcoes && c.lerRespostas ? 'tudo' : c.anunciarAcoes ? 'acoes' : 'respostas'
        dizer(`Modo atual: ${atual}. Opções: tudo, acoes (só o que está a fazer), respostas (só o que escreve).`)
        return
      }
      escreverConfig({ anunciarAcoes: m[0], lerRespostas: m[1] })
      dizer(`Modo: ${arg.toLowerCase()}.`)
      return
    }

    case 'sessao':
    case 'sessão': {
      const a = arg.toLowerCase()
      if (a !== 'todas' && a !== 'ativa') {
        dizer(`Agora: ${lerConfig().soSessaoAtiva ? 'só a sessão ativa fala tudo' : 'todas as sessões falam tudo'}. Opções: ativa, todas.`)
        return
      }
      escreverConfig({ soSessaoAtiva: a === 'ativa' })
      dizer(a === 'ativa' ? 'Só a sessão onde escreveste por último fala tudo.' : 'Todas as sessões falam tudo.')
      return
    }

    case 'motor': {
      const a = arg.toLowerCase()
      if (!['auto', 'piper', 'sistema'].includes(a)) {
        dizer(`Motor: ${lerConfig().motor} (${motorPrevisto(lerConfig())}). Opções: auto, piper, sistema.`)
        return
      }
      escreverConfig({ motor: a })
      await semServidor({ controlo: 'recarregar' })
      dizer(`Motor: ${a} → ${motorPrevisto(lerConfig())}.`)
      return
    }

    case 'instalar':
      return instalar()

    case 'estado': {
      const c = lerConfig()
      const s = await semServidor({ controlo: 'estado' })
      dizer(`Voz: ${c.ligado ? 'ligada' : 'desligada'}`)
      dizer(`Motor: ${motorPrevisto(c)}${piperInstalado() ? '' : '  (para a voz pt-PT natural: /voz:instalar)'}`)
      dizer(`Diz: ${[c.anunciarAcoes && 'o que está a fazer', c.lerRespostas && 'o que escreve'].filter(Boolean).join(' e ') || 'nada'}`)
      dizer(`Velocidade: ${c.velocidade} · máx. ${c.maxCaracteres} caracteres por mensagem`)
      dizer(`Sessões: ${c.soSessaoAtiva ? 'só a ativa fala tudo; as outras avisam quando terminam' : 'todas falam tudo'}`)
      dizer(`Servidor: ${s ? `a correr (pid ${s.pid}, ${s.naFila} na fila)` : 'parado (arranca sozinho no próximo evento)'}`)
      dizer(`Configuração: ${CAMINHOS.config}`)
      return
    }

    default:
      dizer('Comandos: ligar, desligar, parar, estado, testar [texto], velocidade <0.5-2>, modo <tudo|acoes|respostas>, sessao <ativa|todas>, motor <auto|piper|sistema>, instalar')
  }
}

principal(process.argv.slice(2)).catch(erro => {
  console.error(`Erro: ${erro.message}`)
  process.exitCode = 1
})
