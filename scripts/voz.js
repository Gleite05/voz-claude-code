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

// uv (Astral) traz o seu próprio Python: assim a voz funciona mesmo sem Python instalado.
const UV = {
  versao: '0.13.6',
  ficheiros: {
    'win32-x64': ['uv-x86_64-pc-windows-msvc.zip', 'a2a8820d5eea32f08ef467ef3b7f66883a9b076d5737a2fc2fbb5f458d1bb50f'],
    'linux-x64': ['uv-x86_64-unknown-linux-gnu.tar.gz', 'f29c3e94ffabd7e6f3ba521dba169a9b7ec12100bf3257087f0f24f6123f3645'],
    'linux-arm64': ['uv-aarch64-unknown-linux-gnu.tar.gz', '229e194255c7958d86d56e8790d969a6f74736592133f0dfd0076f754c642c1d'],
    'darwin-arm64': ['uv-aarch64-apple-darwin.tar.gz', '60fbd5c8a1ed681845eea28d9d622fcde03c51e91a43465b64a1e17db1ed3472'],
    'darwin-x64': ['uv-x86_64-apple-darwin.tar.gz', '63ba17fdda55ad1a230d4b37fc6017ffa10c23688c83818bd3bfdf914c652a02'],
  },
}
const PASTA_UV = path.join(CAMINHOS.pasta, 'uv')
const UV_EXE = path.join(PASTA_UV, WIN ? 'uv.exe' : 'uv')

async function obterUv() {
  if (fs.existsSync(UV_EXE)) return UV_EXE
  const par = UV.ficheiros[`${process.platform}-${process.arch}`]
  if (!par) return null
  const [nome, sha256] = par
  dizer(`  sem Python no sistema: a descarregar o uv ${UV.versao} (traz o seu próprio Python)…`)
  const r = await fetch(`https://github.com/astral-sh/uv/releases/download/${UV.versao}/${nome}`)
  if (!r.ok) throw new Error(`download do uv falhou (${r.status})`)
  const dados = Buffer.from(await r.arrayBuffer())
  if (crypto.createHash('sha256').update(dados).digest('hex') !== sha256) throw new Error('o uv descarregado não tem o SHA-256 esperado')
  garantirPasta(PASTA_UV)
  const arquivo = path.join(PASTA_UV, nome)
  fs.writeFileSync(arquivo, dados)
  const tar = WIN ? path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
  const ex = spawnSync(tar, ['-xf', arquivo, '-C', PASTA_UV, ...(WIN ? [] : ['--strip-components=1'])], { windowsHide: true })
  fs.rmSync(arquivo, { force: true })
  if (ex.status !== 0 || !fs.existsSync(UV_EXE)) throw new Error('não consegui extrair o uv')
  return UV_EXE
}

/** Garante o ambiente Python isolado em ~/.claude/voz/python (Python do sistema ou do uv). */
async function ambientePython() {
  if (fs.existsSync(CAMINHOS.pythonExe)) return
  const py = encontrarPython()
  if (py) {
    dizer(`  a criar o ambiente Python (${py[2]}) em ${CAMINHOS.python}`)
    const r = spawnSync(py[0], [...py[1], '-m', 'venv', CAMINHOS.python], { stdio: 'inherit' })
    if (r.status !== 0) throw new Error('não foi possível criar o ambiente Python (venv)')
    return
  }
  const uv = await obterUv()
  if (!uv) throw new Error('não há Python 3.9+ nem uv para este sistema — instala o Python (https://www.python.org/downloads/)')
  dizer('  a criar o ambiente Python 3.12 com o uv…')
  const r = spawnSync(uv, ['venv', '--python', '3.12', '--seed', CAMINHOS.python], { stdio: 'inherit', env: { ...process.env, UV_PYTHON_INSTALL_DIR: path.join(PASTA_UV, 'python') } })
  if (r.status !== 0) throw new Error('o uv não conseguiu criar o ambiente Python')
}

function pipInstalar(pacotes) {
  const r = spawnSync(CAMINHOS.pythonExe, ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', ...pacotes], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`o pip não conseguiu instalar: ${pacotes.join(' ')}`)
}

async function instalarVoz() {
  garantirPasta()
  garantirPasta(CAMINHOS.vozes)
  dizer('Voz portuguesa (Piper + «tugão», local e gratuita)')
  dizer('1/3 Ambiente Python')
  await ambientePython()
  dizer(`2/3 A instalar o piper-tts ${VERSAO_PIPER} (pode demorar um ou dois minutos)`)
  pipInstalar([`piper-tts==${VERSAO_PIPER}`])
  dizer('3/3 A descarregar a voz «tugão» (cerca de 63 MB, licença CC0)')
  for (const f of FICHEIROS_VOZ) await descarregar(f)
  escreverConfig({ motor: 'auto' })
  await semServidor({ controlo: 'recarregar' })
  dizer('Pronto! A voz portuguesa está instalada.')
  await enviar({ controlo: 'testar', texto: 'Olá, eu sou o Claude Code.' }, { resposta: true })
}

async function instalarOuvir() {
  dizer('Ditado (falar com o Claude): Whisper local + microfone')
  dizer('1/3 Ambiente Python')
  await ambientePython()
  dizer('2/3 A instalar o faster-whisper e o sounddevice')
  pipInstalar(['faster-whisper==1.2.1', 'sounddevice==0.5.6'])
  const modelo = lerConfig().ditadoModelo || 'small'
  dizer(`3/3 A descarregar o modelo Whisper «${modelo}» (uma vez; ~${{ tiny: 75, base: 145, small: 480, medium: 1500 }[modelo] || '?'} MB)`)
  const pasta = path.join(CAMINHOS.pasta, 'whisper')
  const r = spawnSync(
    CAMINHOS.pythonExe,
    ['-I', '-X', 'utf8', '-c', 'import sys; from faster_whisper import WhisperModel; WhisperModel(sys.argv[1], device="cpu", compute_type="int8", download_root=sys.argv[2])', modelo, pasta],
    { stdio: 'inherit', env: { ...process.env, HF_HUB_DISABLE_SYMLINKS_WARNING: '1', HF_HUB_DISABLE_TELEMETRY: '1' } },
  )
  if (r.status !== 0) throw new Error('não consegui descarregar o modelo Whisper')
  dizer('Pronto! Carrega no microfone da barra (ou Ctrl+Shift+Alt+V) para falares com o Claude.')
}

async function instalar(args) {
  const o = String(args[0] || 'voz').toLowerCase()
  if (o === 'ouvir' || o === 'ditado') return instalarOuvir()
  if (o === 'barra') return instalarBarra()
  if (o === 'tudo') {
    await instalarVoz()
    await instalarOuvir()
    if (WIN) await instalarBarra()
    return
  }
  return instalarVoz()
}

// ---------- barra (Windows) ----------

const compilarBarra = require('./compilar-barra')
const AJ = require('./barra-ajustes')
const EXE_BARRA = compilarBarra.EXE
const CHAVE_RUN = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'

function definirArranque(modo) {
  const args =
    modo === 'windows'
      ? ['add', CHAVE_RUN, '/v', 'VozBarra', '/t', 'REG_SZ', '/d', `"${EXE_BARRA}"`, '/f']
      : ['delete', CHAVE_RUN, '/v', 'VozBarra', '/f']
  spawnSync('reg.exe', args, { windowsHide: true, stdio: 'ignore' })
  escreverConfig({ barraArranque: modo })
}

const abrirBarra = () => compilarBarra.abrir()

async function instalarBarra() {
  if (!WIN) {
    dizer('A barra é só para Windows (por agora). Noutros sistemas, abre http://127.0.0.1:47821 no browser com o token de ~/.claude/voz/barra/barra.json.')
    return
  }
  dizer('Instalação da barra «Voz» (Windows)')
  const wv = compilarBarra.webview2Instalado()
  if (!wv) {
    dizer('Falta o Microsoft Edge WebView2 Runtime (vem com o Windows 11). Instala-o em https://developer.microsoft.com/microsoft-edge/webview2/ e volta a correr /voz:barra instalar.')
    process.exitCode = 1
    return
  }
  dizer('1/2 A preparar e compilar')
  await compilarBarra.compilar(t => dizer('  ' + t))
  dizer('2/2 A arrancar')
  await enviar({ controlo: 'estado' }, { resposta: true }) // garante o servidor (e o barra.json)
  definirArranque(lerConfig().barraArranque || 'windows')
  abrirBarra()
  dizer(`Pronto! A barra está no ecrã (WebView2 ${wv}). Clique direito na barra para a esconder, mudar a posição e os ajustes; escondida, fica um ícone ao pé do relógio.`)
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
    case 'ajustes': {
      // Lista legível (também para o Claude, quando lhe pedes algo sobre a barra em linguagem normal).
      const c = lerConfig()
      dizer('Ajustes da barra (chave = valor atual · valores possíveis · o que é):')
      for (const [k, a] of Object.entries(AJ.AJUSTES)) {
        const v = c[k]
        const possiveis = a.tipo === 'lista' ? a.valores.join('|') : a.tipo === 'num' ? `${a.min}–${a.max}` : 'sim|nao'
        dizer(`  ${k} = ${typeof v === 'boolean' ? (v ? 'sim' : 'nao') : String(v).toLowerCase()} · ${possiveis} · ${a.desc}`)
      }
      dizer(`  arranque = ${c.barraArranque} · windows|claude|mao · quando abre (muda com: barra arranque <valor>)`)
      dizer(`Módulos (pela ordem): ${AJ.modulos(c).map(m => `${m.id}:${m.on ? 'on' : 'off'}`).join(' ')}`)
      dizer(`Barra ${fs.existsSync(EXE_BARRA) ? 'instalada' : 'NÃO instalada'}.`)
      return
    }
    case 'ajustar': {
      const r = AJ.interpretar(args.slice(1), lerConfig())
      if (!r.ok) {
        process.exitCode = 1
        return dizer('Nada mudou: ' + r.erros.join('; ') + '.')
      }
      escreverConfig(r.alteracoes)
      await semServidor({ controlo: 'publicar' })
      return dizer('Mudado: ' + Object.entries(r.alteracoes).map(([k, v]) => `${k}=${typeof v === 'boolean' ? (v ? 'sim' : 'nao') : v}`).join(', ') + '.')
    }
    case 'modulos':
    case 'módulos':
      return dizer(`Módulos: ${AJ.modulos(lerConfig()).map(m => `${m.id}:${m.on ? 'on' : 'off'}`).join(' ')}`)
    case 'modulo':
    case 'módulo': {
      const r = AJ.alternarModulo(lerConfig(), valor, args[2])
      if (r.erro) {
        process.exitCode = 1
        return dizer('Nada mudou: ' + r.erro + '.')
      }
      escreverConfig({ barraModulos: r.lista })
      await semServidor({ controlo: 'publicar' })
      return dizer(`Módulo ${valor}: ${r.lista.find(m => m.id === valor).on ? 'ligado' : 'desligado'}.`)
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
      dizer('Subcomandos: instalar, ligar, desligar, posicao <topo|escondida|flutuante|esquerda|direita|fundo>, arranque <windows|claude|mao>, ajustes, ajustar <chave=valor…>, modulos, modulo <id> on|off, desinstalar')
    }
  }
}

// ---------- vozes ----------

async function comandoVozes(args) {
  const vozes = require('./vozes')
  const [sub = 'listar', ...resto] = args
  const id = resto.join(' ').trim()
  switch (String(sub).toLowerCase()) {
    case 'catalogo':
    case 'catálogo': {
      const filtro = id.toLowerCase()
      const lista = (await vozes.listarCatalogo()).filter(v => !filtro || v.lingua.toLowerCase().includes(filtro) || v.linguaNome.toLowerCase().includes(filtro))
      let lingua = ''
      for (const v of lista) {
        if (v.lingua !== lingua) dizer(`\n${(lingua = v.lingua)} — ${v.linguaNome}`)
        dizer(`  ${v.instalada ? '✓' : ' '} ${v.id}  (${v.qualidade}, ${v.mb} MB${v.oradores > 1 ? `, ${v.oradores} oradores` : ''})`)
      }
      dizer('\nPara instalar: /voz:vozes instalar <id>   (ex.: /voz:vozes instalar en_US-lessac-medium)')
      return
    }
    case 'instalar': {
      if (!id) return dizer('Indica a voz: /voz:vozes instalar <id> (vê a lista com /voz:vozes catalogo).')
      if (!fs.existsSync(CAMINHOS.pythonExe)) return dizer('Primeiro instala o motor de voz: /voz:instalar')
      let ultimo = -10
      await vozes.descarregar(id, pct => {
        if (pct - ultimo >= 20 || pct === 100) dizer(`  ${id}: ${(ultimo = pct)}%`)
      })
      await semServidor({ controlo: 'publicar' })
      return dizer(`Voz ${id} instalada. Usa-a com /voz:vozes padrao ${id}, ou escolhe-a para uma conversa na barra.`)
    }
    case 'remover':
      if (!id) return dizer('Indica a voz a remover.')
      if (vozes.caminhoModelo(id) === vozes.caminhoModelo(lerConfig().vozPadrao)) return dizer('Essa é a voz principal: escolhe outra primeiro.')
      dizer(vozes.remover(id) ? `Voz ${id} removida.` : 'Essa voz não está instalada.')
      return semServidor({ controlo: 'publicar' })
    case 'padrao':
    case 'padrão':
      if (!vozes.caminhoModelo(id)) return dizer('Essa voz não está instalada (vê /voz:vozes).')
      escreverConfig({ vozPadrao: id })
      await semServidor({ controlo: 'publicar' })
      return dizer(`Voz principal: ${id}.`)
    case 'conversas': {
      const v = String(id).toLowerCase()
      if (v !== 'auto' && v !== 'igual') return dizer(`Agora: ${lerConfig().vozPorConversa}. Opções: auto (cada conversa com um tom diferente) ou igual.`)
      escreverConfig({ vozPorConversa: v })
      return dizer(v === 'auto' ? 'Cada conversa passa a ter um tom diferente.' : 'Todas as conversas usam a mesma voz.')
    }
    default: {
      const c = lerConfig()
      dizer('Vozes instaladas:')
      for (const v of vozes.instaladas()) dizer(`  ${vozes.caminhoModelo(c.vozPadrao) === v.modelo ? '★' : ' '} ${v.id}  — ${v.linguaNome}`)
      dizer(`Voz por conversa: ${c.vozPorConversa} · idioma automático: ${c.idiomaAuto !== false ? 'sim' : 'não'}`)
      dizer('Subcomandos: catalogo [língua], instalar <id>, remover <id>, padrao <id>, conversas auto|igual')
    }
  }
}

// ---------- não incomodar ----------

async function comandoSilencio(args) {
  const [sub = '', a = '', b = ''] = args.map(x => String(x).toLowerCase())
  const c = lerConfig()
  const h = { ativo: false, inicio: '22:00', fim: '08:00', ...(c.silencioHorario || {}) }
  const hora = s => /^\d{1,2}:\d{2}$/.test(s)
  if (sub === 'ligar' || sub === 'on') {
    escreverConfig({ naoIncomodar: true })
    await semServidor({ controlo: 'parar' })
  } else if (sub === 'desligar' || sub === 'off') {
    escreverConfig({ naoIncomodar: false })
  } else if (sub === 'horario' || sub === 'horário') {
    if (a === 'desligar' || a === 'off') escreverConfig({ silencioHorario: { ...h, ativo: false } })
    else if (hora(a) && hora(b)) escreverConfig({ silencioHorario: { ativo: true, inicio: a, fim: b } })
    else return dizer('Uso: /voz:silencio horario 22:00 08:00   ou   /voz:silencio horario desligar')
  }
  await semServidor({ controlo: 'publicar' })
  const n = lerConfig()
  const hh = n.silencioHorario || {}
  dizer(`Não incomodar: ${n.naoIncomodar ? 'LIGADO' : 'desligado'} · horário de silêncio: ${hh.ativo ? `${hh.inicio} → ${hh.fim}` : 'desligado'}`)
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

    case 'vozes':
      return comandoVozes(resto)

    case 'silencio':
    case 'silêncio':
      return comandoSilencio(resto)

    case 'instalar':
      return instalar(resto)

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
