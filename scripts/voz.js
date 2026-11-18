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

// ---------- barra (Windows) ----------

const WEBVIEW2 = {
  versao: '1.0.4314.35',
  sha512: 'cOaiVqP3BmQHMnxGpZzANM22tUXgycrisyJHjIGNzIaMsm8iXj7Kx+ceYg+RbYwJtzT009qfcFTocvVLY+ekMw==',
}
const PASTA_BARRA = path.join(CAMINHOS.pasta, 'barra')
const EXE_BARRA = path.join(PASTA_BARRA, 'VozBarra.exe')
const CSC = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
const CHAVE_RUN = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'

function webview2Instalado() {
  const id = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
  for (const raiz of [`HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\${id}`, `HKCU\\Software\\Microsoft\\EdgeUpdate\\Clients\\${id}`]) {
    const r = spawnSync('reg.exe', ['query', raiz, '/v', 'pv'], { encoding: 'utf8', windowsHide: true })
    const m = /pv\s+REG_SZ\s+([\d.]+)/.exec(r.stdout || '')
    if (m && m[1] !== '0.0.0.0') return m[1]
  }
  return null
}

function definirArranque(modo) {
  const args =
    modo === 'windows'
      ? ['add', CHAVE_RUN, '/v', 'VozBarra', '/t', 'REG_SZ', '/d', `"${EXE_BARRA}"`, '/f']
      : ['delete', CHAVE_RUN, '/v', 'VozBarra', '/f']
  spawnSync('reg.exe', args, { windowsHide: true, stdio: 'ignore' })
  escreverConfig({ barraArranque: modo })
}

function abrirBarra() {
  const { spawn } = require('node:child_process')
  spawn(EXE_BARRA, [], { detached: true, stdio: 'ignore' }).unref()
}

async function instalarBarra() {
  if (!WIN) {
    dizer('A barra é só para Windows (por agora). Noutros sistemas, abre http://127.0.0.1:47821 no browser com o token de ~/.claude/voz/barra/barra.json.')
    return
  }
  dizer('Instalação da barra «Voz» (Windows)')
  const wv = webview2Instalado()
  if (!wv) {
    dizer('Falta o Microsoft Edge WebView2 Runtime (vem com o Windows 11). Instala-o em https://developer.microsoft.com/microsoft-edge/webview2/ e volta a correr /voz:barra instalar.')
    process.exitCode = 1
    return
  }
  if (!fs.existsSync(CSC)) {
    dizer(`Não encontrei o compilador do .NET Framework 4.x (${CSC}).`)
    process.exitCode = 1
    return
  }
  garantirPasta(PASTA_BARRA)
  const pacote = path.join(PASTA_BARRA, 'pacote')
  const nupkg = path.join(pacote, 'webview2.nupkg')
  garantirPasta(pacote)
  const hashOk = f => fs.existsSync(f) && crypto.createHash('sha512').update(fs.readFileSync(f)).digest('base64') === WEBVIEW2.sha512
  if (!hashOk(nupkg)) {
    dizer(`1/4 A descarregar o kit WebView2 ${WEBVIEW2.versao} do NuGet da Microsoft (~9 MB)…`)
    const url = `https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/${WEBVIEW2.versao}/microsoft.web.webview2.${WEBVIEW2.versao}.nupkg`
    const r = await fetch(url)
    if (!r.ok) throw new Error(`download do WebView2 falhou (${r.status})`)
    fs.writeFileSync(nupkg, Buffer.from(await r.arrayBuffer()))
    if (!hashOk(nupkg)) throw new Error('o pacote WebView2 descarregado não tem o SHA-512 esperado')
  } else dizer('1/4 Kit WebView2 já descarregado')

  dizer('2/4 A extrair as bibliotecas')
  // A barra aberta bloqueia as DLLs e o .exe: fecha-a antes de os substituir.
  spawnSync('taskkill.exe', ['/IM', 'VozBarra.exe', '/F'], { windowsHide: true, stdio: 'ignore' })
  await new Promise(r => setTimeout(r, 700))
  const tar = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'tar.exe')
  const ex = spawnSync(tar, ['-xf', nupkg, '-C', pacote, 'lib/net462', 'runtimes/win-x64/native'], { windowsHide: true })
  if (ex.status !== 0) throw new Error('não consegui extrair o pacote WebView2')
  for (const [orig, nome] of [
    ['lib/net462/Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.Core.dll'],
    ['lib/net462/Microsoft.Web.WebView2.WinForms.dll', 'Microsoft.Web.WebView2.WinForms.dll'],
    ['runtimes/win-x64/native/WebView2Loader.dll', 'WebView2Loader.dll'],
  ]) {
    fs.copyFileSync(path.join(pacote, ...orig.split('/')), path.join(PASTA_BARRA, nome))
  }

  dizer('3/4 A compilar o anfitrião (compilador do .NET que já vem com o Windows)')
  spawnSync('taskkill.exe', ['/IM', 'VozBarra.exe', '/F'], { windowsHide: true, stdio: 'ignore' })
  const fonte = path.join(__dirname, '..', 'barra', 'anfitriao', 'VozBarra.cs')
  const c = spawnSync(
    CSC,
    [
      '/nologo', '/target:winexe', '/platform:x64', '/optimize+', `/out:${EXE_BARRA}`,
      '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.Web.Extensions.dll',
      `/r:${path.join(PASTA_BARRA, 'Microsoft.Web.WebView2.Core.dll')}`,
      `/r:${path.join(PASTA_BARRA, 'Microsoft.Web.WebView2.WinForms.dll')}`,
      fonte,
    ],
    { encoding: 'utf8', windowsHide: true },
  )
  const erros = (c.stdout || '').split('\n').filter(l => /error/i.test(l))
  if (c.status !== 0 || erros.length) throw new Error(`a compilação falhou:\n${erros.join('\n') || c.stdout}`)

  dizer('4/4 A arrancar')
  await enviar({ controlo: 'estado' }, { resposta: true }) // garante o servidor (e o barra.json)
  definirArranque(lerConfig().barraArranque || 'windows')
  abrirBarra()
  dizer(`Pronto! A barra está no topo do ecrã (WebView2 ${wv}). Clica na estrela para as definições: posição, módulos e arranque.`)
}

async function barra(args) {
  const [sub = 'estado', valor = ''] = args.map(a => String(a).toLowerCase())
  switch (sub) {
    case 'instalar':
      return instalarBarra()
    case 'ligar':
    case 'abrir':
      if (!fs.existsSync(EXE_BARRA)) return dizer('A barra ainda não está instalada: corre /voz:barra instalar.')
      await enviar({ controlo: 'estado' }, { resposta: true })
      abrirBarra()
      return dizer('Barra aberta.')
    case 'desligar':
    case 'fechar': {
      const r = await semServidor({ controlo: 'barra-sair' })
      return dizer(r && r.barras ? 'Barra fechada.' : 'A barra não estava aberta.')
    }
    case 'posicao':
    case 'posição': {
      const ok = ['topo', 'escondida', 'flutuante', 'esquerda', 'direita', 'fundo']
      if (!ok.includes(valor)) return dizer(`Posições: ${ok.join(', ')}.`)
      escreverConfig({ barraPosicao: valor })
      await semServidor({ controlo: 'publicar' })
      return dizer(`Posição: ${valor}.`)
    }
    case 'arranque': {
      const ok = { windows: 'windows', claude: 'claude', mao: 'mao', 'mão': 'mao' }
      if (!ok[valor]) return dizer('Arranque: windows (com o Windows), claude (só com o Claude Code) ou mao (só à mão).')
      definirArranque(ok[valor])
      return dizer({ windows: 'A barra arranca com o Windows.', claude: 'A barra abre quando começa uma sessão do Claude Code.', mao: 'A barra só abre com /voz:barra ligar.' }[ok[valor]])
    }
    case 'desinstalar':
      await semServidor({ controlo: 'barra-sair' })
      spawnSync('reg.exe', ['delete', CHAVE_RUN, '/v', 'VozBarra', '/f'], { windowsHide: true, stdio: 'ignore' })
      spawnSync('taskkill.exe', ['/IM', 'VozBarra.exe', '/F'], { windowsHide: true, stdio: 'ignore' })
      try {
        fs.unlinkSync(EXE_BARRA)
      } catch {}
      return dizer('Barra desinstalada (a pasta ~/.claude/voz/barra pode ser apagada).')
    default: {
      const c = lerConfig()
      dizer(`Barra: ${fs.existsSync(EXE_BARRA) ? 'instalada' : 'não instalada (/voz:barra instalar)'}`)
      dizer(`Posição: ${c.barraPosicao} · arranque: ${c.barraArranque} · tema: ${c.barraTema}`)
      dizer('Subcomandos: instalar, ligar, desligar, posicao <topo|escondida|flutuante|esquerda|direita|fundo>, arranque <windows|claude|mao>, desinstalar')
    }
  }
}

// ---------- som ----------

const AJUSTES_SOM = {
  volume: { min: 0, max: 2, desc: 'volume (0 a 2, 1 = normal)' },
  altura: { min: -6, max: 6, desc: 'tom em meios-tons (-6 a +6)' },
  graves: { min: -12, max: 12, desc: 'graves em dB (-12 a +12)' },
  medios: { min: -12, max: 12, desc: 'médios em dB (-12 a +12)' },
  agudos: { min: -12, max: 12, desc: 'agudos em dB (-12 a +12)' },
}

function descreverSom(c) {
  return `volume ${c.volume} · altura ${c.altura} · graves ${c.graves} · médios ${c.medios} · agudos ${c.agudos} · velocidade ${c.velocidade}`
}

async function som(args) {
  const [chave = '', valor = ''] = args.map(a => String(a).toLowerCase())
  const { PREDEFINICOES_SOM } = require('./comum')
  const nomeSemAcento = chave.normalize('NFD').replace(/[̀-ͯ]/g, '')

  if (!chave) {
    dizer(`Som: ${descreverSom(lerConfig())}`)
    dizer(`Ajustes: ${Object.entries(AJUSTES_SOM).map(([k, a]) => `${k} — ${a.desc}`).join('; ')}`)
    dizer(`Predefinições: ${Object.keys(PREDEFINICOES_SOM).join(', ')} (ex.: som calma)`)
    return
  }
  if (PREDEFINICOES_SOM[nomeSemAcento] || nomeSemAcento === 'predefinicao') {
    const nome = PREDEFINICOES_SOM[nomeSemAcento] ? nomeSemAcento : valor.normalize('NFD').replace(/[̀-ͯ]/g, '')
    if (!PREDEFINICOES_SOM[nome]) {
      dizer(`Predefinições: ${Object.keys(PREDEFINICOES_SOM).join(', ')}`)
      return
    }
    const c = escreverConfig(PREDEFINICOES_SOM[nome])
    dizer(`Predefinição «${nome}»: ${descreverSom(c)}`)
    await enviar({ controlo: 'testar', texto: 'Assim soa esta predefinição.' }, { resposta: true })
    return
  }
  const ajuste = AJUSTES_SOM[nomeSemAcento]
  const v = Number(valor.replace(',', '.'))
  if (!ajuste || !Number.isFinite(v) || v < ajuste.min || v > ajuste.max) {
    dizer(ajuste ? `Usa um valor para ${ajuste.desc}.` : `Ajustes: ${Object.keys(AJUSTES_SOM).join(', ')}; predefinições: ${Object.keys(PREDEFINICOES_SOM).join(', ')}`)
    return
  }
  const c = escreverConfig({ [nomeSemAcento]: v })
  dizer(`Som: ${descreverSom(c)}`)
  await enviar({ controlo: 'testar', texto: 'Assim está melhor?' }, { resposta: true })
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

    case 'som':
      return som(resto)

    case 'barra':
      return barra(resto)

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
