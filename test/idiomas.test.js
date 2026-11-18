'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const t = require('../scripts/texto')
const { idiomaEfetivo } = require('../scripts/comum')

test('anunciarFerramenta: inglês e espanhol', () => {
  assert.equal(t.anunciarFerramenta('Read', { file_path: 'C:/x/config.ts' }, 'en'), 'Reading config.ts.')
  assert.equal(t.anunciarFerramenta('Edit', { file_path: '/a/b.js' }, 'es'), 'Editando b.js.')
  assert.equal(t.anunciarFerramenta('Bash', { command: 'git status' }, 'en'), t.frase('en', 'git'))
  assert.equal(t.anunciarFerramenta('Bash', { command: 'npm test', description: 'Run the tests' }, 'en'), 'Run the tests.')
  // descrição em inglês numa voz espanhola: usa a frase do programa
  assert.equal(t.anunciarFerramenta('Bash', { command: 'npm test', description: 'Run the tests' }, 'es'), t.frase('es', 'npm', 'npm'))
})

test('frasesNotificacao: inglês e espanhol', () => {
  assert.equal(t.frasesNotificacao('Claude needs your permission to use Bash', 'en'), t.frase('en', 'notifPerm'))
  assert.equal(t.frasesNotificacao('Claude is waiting for your input', 'es'), t.frase('es', 'notifEspera'))
  assert.notEqual(t.frase('en', 'notifPerm'), t.frase('pt', 'notifPerm'))
})

test('processarDelta: tabela e corte na língua certa', () => {
  const e = t.novoEstado(1200, 'en')
  const s = t.processarDelta(e, 'Hello there.\n| a | b |\n|---|---|\n| 1 | 2 |\n\nDone.\n')
  assert.ok(s.includes(t.frase('en', 'tabela')))
  assert.ok(!s.some(x => x.includes('ecrã')))
})

test('frase: todas as chaves existem nas três línguas', () => {
  for (const l of ['en', 'es']) for (const k of Object.keys(t.FRASES.pt)) assert.ok(t.FRASES[l][k] !== undefined, l + ':' + k)
  assert.match(t.frase('es', 'naSessao', 'proj', 'Hola.'), /proj/)
})

test('idiomaEfetivo', () => {
  assert.equal(idiomaEfetivo({ idioma: 'en' }), 'en')
  process.env.VOZ_LOCALE = 'pt-PT'
  assert.equal(idiomaEfetivo({ idioma: 'auto' }), 'pt')
  process.env.VOZ_LOCALE = 'fr-FR'
  assert.equal(idiomaEfetivo({}), 'en')
  delete process.env.VOZ_LOCALE
})
