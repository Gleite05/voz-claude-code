'use strict'
// Caminhos, configuração e registo partilhados pelo gancho, pelo servidor e pela linha de comandos.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const PASTA = process.env.VOZ_DIR || path.join(os.homedir(), '.claude', 'voz')
const WIN = process.platform === 'win32'

const CAMINHOS = {
  pasta: PASTA,
  config: path.join(PASTA, 'config.json'),
  log: path.join(PASTA, 'voz.log'),
  tmp: path.join(PASTA, 'tmp'),
  vozes: path.join(PASTA, 'vozes'),
  python: path.join(PASTA, 'python'),
  pythonExe: path.join(PASTA, 'python', WIN ? 'Scripts' : 'bin', WIN ? 'python.exe' : 'python'),
  modelo: path.join(PASTA, 'vozes', 'pt_PT-tugao-medium.onnx'),
  avisoMostrado: path.join(PASTA, '.aviso-instalar'),
  // Um servidor por utilizador: pipe com nome no Windows, socket Unix nos outros.
  canal: WIN
    ? `\\\\.\\pipe\\voz-claude-code-${(os.userInfo().username || 'user').replace(/[^\w.-]/g, '_')}`
    : path.join(PASTA, 'voz.sock'),
}

const PREDEFINICOES = {
  ligado: true,
  anunciarAcoes: true, // "A editar config.ts", "A usar o git"...
  lerRespostas: true, // lê o texto do Claude enquanto ele escreve
  velocidade: 1.1, // 0.5 a 2.0
  maxCaracteres: 1200, // por mensagem; o resto fica só no ecrã
  soSessaoAtiva: true, // só a sessão onde escreveste por último fala tudo
  avisarOutrasSessoes: true, // as outras só dizem quando terminam ou precisam de ti
  motor: 'auto', // auto | piper | sistema
  vozSistema: '', // parte do nome de uma voz do sistema (ex.: "Helia"), opcional
}

function garantirPasta(p = PASTA) {
  fs.mkdirSync(p, { recursive: true })
}

let cache = { mtime: -1, valor: { ...PREDEFINICOES } }

/** Lê a configuração (com cache pelo mtime). Um ficheiro em falta ou partido dá as predefinições. */
function lerConfig() {
  try {
    const st = fs.statSync(CAMINHOS.config)
    if (st.mtimeMs === cache.mtime) return cache.valor
    const lido = JSON.parse(fs.readFileSync(CAMINHOS.config, 'utf8'))
    cache = { mtime: st.mtimeMs, valor: { ...PREDEFINICOES, ...lido } }
  } catch {
    cache = { mtime: -1, valor: { ...PREDEFINICOES } }
  }
  return cache.valor
}

function escreverConfig(alteracoes) {
  garantirPasta()
  const atual = { ...lerConfig(), ...alteracoes }
  fs.writeFileSync(CAMINHOS.config, JSON.stringify(atual, null, 2) + '\n')
  cache = { mtime: -1, valor: atual }
  return atual
}

function log(...partes) {
  try {
    garantirPasta()
    try {
      if (fs.statSync(CAMINHOS.log).size > 256 * 1024) fs.writeFileSync(CAMINHOS.log, '')
    } catch {}
    const linha = `${new Date().toISOString()} ${partes.map(p => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`
    fs.appendFileSync(CAMINHOS.log, linha)
  } catch {}
}

function piperInstalado() {
  return fs.existsSync(CAMINHOS.pythonExe) && fs.existsSync(CAMINHOS.modelo) && fs.existsSync(CAMINHOS.modelo + '.json')
}

module.exports = { CAMINHOS, PREDEFINICOES, WIN, garantirPasta, lerConfig, escreverConfig, log, piperInstalado }
