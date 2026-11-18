'use strict'
// Compila o anfitrião da barra (VozBarra.cs) com o csc.exe do .NET Framework 4.8 e o kit WebView2.
// Usado pelo instalador (/voz:barra instalar) e pelo servidor, que recompila sozinho quando uma
// atualização do plugin traz um VozBarra.cs diferente.

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync, spawn } = require('node:child_process')
const { CAMINHOS, garantirPasta, log } = require('./comum')

const WEBVIEW2 = {
  versao: '1.0.4314.35',
  sha512: 'cOaiVqP3BmQHMnxGpZzANM22tUXgycrisyJHjIGNzIaMsm8iXj7Kx+ceYg+RbYwJtzT009qfcFTocvVLY+ekMw==',
}
const PASTA = path.join(CAMINHOS.pasta, 'barra')
const EXE = path.join(PASTA, 'VozBarra.exe')
const FONTE = path.join(__dirname, '..', 'barra', 'anfitriao', 'VozBarra.cs')
const MARCA = path.join(PASTA, 'fonte.sha256')
const WINDIR = process.env.WINDIR || 'C:\\Windows'
const CSC = path.join(WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
const DLLS = [
  ['lib/net462/Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.Core.dll'],
  ['lib/net462/Microsoft.Web.WebView2.WinForms.dll', 'Microsoft.Web.WebView2.WinForms.dll'],
  ['runtimes/win-x64/native/WebView2Loader.dll', 'WebView2Loader.dll'],
]

const hashFonte = () => crypto.createHash('sha256').update(fs.readFileSync(FONTE)).digest('hex')

function webview2Instalado() {
  const id = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
  for (const raiz of [`HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\${id}`, `HKCU\\Software\\Microsoft\\EdgeUpdate\\Clients\\${id}`]) {
    const r = spawnSync('reg.exe', ['query', raiz, '/v', 'pv'], { encoding: 'utf8', windowsHide: true })
    const m = /pv\s+REG_SZ\s+([\d.]+)/.exec(r.stdout || '')
    if (m && m[1] !== '0.0.0.0') return m[1]
  }
  return null
}

const aCorrer = () => {
  const r = spawnSync('tasklist.exe', ['/FI', 'IMAGENAME eq VozBarra.exe', '/NH'], { encoding: 'utf8', windowsHide: true })
  return /VozBarra\.exe/i.test(r.stdout || '')
}

function fechar() {
  spawnSync('taskkill.exe', ['/IM', 'VozBarra.exe', '/F'], { windowsHide: true, stdio: 'ignore' })
}

function abrir() {
  spawn(EXE, [], { detached: true, stdio: 'ignore' }).unref()
}

/** Descarrega (se preciso) o kit WebView2, extrai as DLLs e compila. dizer(texto) mostra o progresso. */
async function compilar(dizer = () => {}) {
  if (!fs.existsSync(CSC)) throw new Error(`não encontrei o compilador do .NET Framework 4.x (${CSC})`)
  garantirPasta(PASTA)
  const pacote = path.join(PASTA, 'pacote')
  const nupkg = path.join(pacote, 'webview2.nupkg')
  garantirPasta(pacote)
  const hashOk = f => fs.existsSync(f) && crypto.createHash('sha512').update(fs.readFileSync(f)).digest('base64') === WEBVIEW2.sha512
  if (!hashOk(nupkg)) {
    dizer(`A descarregar o kit WebView2 ${WEBVIEW2.versao} do NuGet da Microsoft (~9 MB)…`)
    const url = `https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/${WEBVIEW2.versao}/microsoft.web.webview2.${WEBVIEW2.versao}.nupkg`
    const r = await fetch(url)
    if (!r.ok) throw new Error(`download do WebView2 falhou (${r.status})`)
    fs.writeFileSync(nupkg, Buffer.from(await r.arrayBuffer()))
    if (!hashOk(nupkg)) throw new Error('o pacote WebView2 descarregado não tem o SHA-512 esperado')
  }
  const estavaAberta = aCorrer()
  fechar() // a barra aberta bloqueia as DLLs e o .exe
  await new Promise(r => setTimeout(r, 700))
  const ex = spawnSync(path.join(WINDIR, 'System32', 'tar.exe'), ['-xf', nupkg, '-C', pacote, 'lib/net462', 'runtimes/win-x64/native'], { windowsHide: true })
  if (ex.status !== 0) throw new Error('não consegui extrair o pacote WebView2')
  for (const [orig, nome] of DLLS) fs.copyFileSync(path.join(pacote, ...orig.split('/')), path.join(PASTA, nome))
  dizer('A compilar o anfitrião (compilador do .NET que já vem com o Windows)…')
  const c = spawnSync(
    CSC,
    [
      '/nologo', '/target:winexe', '/platform:x64', '/optimize+', `/out:${EXE}`,
      '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.Web.Extensions.dll',
      `/r:${path.join(PASTA, 'Microsoft.Web.WebView2.Core.dll')}`, `/r:${path.join(PASTA, 'Microsoft.Web.WebView2.WinForms.dll')}`,
      FONTE,
    ],
    { encoding: 'utf8', windowsHide: true },
  )
  const erros = (c.stdout || '').split('\n').filter(l => /error/i.test(l))
  if (c.status !== 0 || erros.length) throw new Error(`a compilação falhou:\n${erros.join('\n') || c.stdout}`)
  fs.writeFileSync(MARCA, hashFonte())
  return { estavaAberta }
}

/** Depois de uma atualização do plugin: recompila se a fonte mudou, e volta a abrir a barra se estava aberta. */
async function recompilarSePreciso() {
  if (process.platform !== 'win32' || !fs.existsSync(EXE) || !fs.existsSync(FONTE)) return false
  let marca = ''
  try {
    marca = fs.readFileSync(MARCA, 'utf8').trim()
  } catch {}
  if (marca === hashFonte()) return false
  log('a fonte da barra mudou: a recompilar')
  try {
    const { estavaAberta } = await compilar(t => log(t))
    if (estavaAberta) abrir()
    log('barra recompilada')
    return true
  } catch (erro) {
    log(`recompilar a barra: ${erro.message}`)
    return false
  }
}

module.exports = { compilar, recompilarSePreciso, webview2Instalado, abrir, fechar, aCorrer, EXE, PASTA, CSC }
