'use strict'
// Testes das funcionalidades da versão 1.0: idiomas e vozes, horário de silêncio e tokens por dia.
// Cada ficheiro de teste corre num processo próprio: estas variáveis isolam tudo numa pasta temporária.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const PASTA = fs.mkdtempSync(path.join(os.tmpdir(), 'voz-teste-'))
process.env.VOZ_DIR = PASTA
process.env.VOZ_PROJETOS = path.join(PASTA, 'projetos')

const test = require('node:test')
const assert = require('node:assert/strict')
const vozes = require('../scripts/vozes')
const { emSilencio } = require('../scripts/comum')
const uso = require('../scripts/uso')

test('detetarIdioma: português, inglês, espanhol e frases curtas', () => {
  assert.equal(vozes.detetarIdioma('Corrigi o erro no servidor e os testes já passam todos.'), 'pt')
  assert.equal(vozes.detetarIdioma('I have fixed the bug and all the tests are passing now.'), 'en')
  assert.equal(vozes.detetarIdioma('He arreglado el error del servidor y ya pasan todas las pruebas.'), 'es')
  assert.equal(vozes.detetarIdioma('A editar app.ts.'), null) // curta demais para decidir
})

test('vozes: nomes com barras ou «..» são recusados (não viram caminhos de ficheiro)', async () => {
  assert.equal(vozes.caminhoModelo('../../segredo'), null)
  assert.equal(vozes.caminhoModelo('a\\b'), null)
  assert.equal(vozes.remover('../config'), false)
  await assert.rejects(() => vozes.descarregar('../x'), /inválido/)
})

test('linguaDe: idioma a partir do nome da voz', () => {
  assert.equal(vozes.linguaDe('pt_PT-tugão-medium'), 'pt_PT')
  assert.equal(vozes.linguaDe('en_US-lessac-medium'), 'en_US')
})

test('escolher: idioma automático e tom diferente por conversa', () => {
  fs.mkdirSync(path.join(PASTA, 'vozes'), { recursive: true })
  for (const v of ['pt_PT-tugao-medium', 'en_US-lessac-medium']) {
    fs.writeFileSync(path.join(PASTA, 'vozes', v + '.onnx'), '')
    fs.writeFileSync(path.join(PASTA, 'vozes', v + '.onnx.json'), '{}')
  }
  const cfg = { vozPadrao: 'pt_PT-tugao-medium', vozPorConversa: 'auto', idiomaAuto: true, idioma: 'pt' }
  const ordem = ['s1', 's2']
  const a = vozes.escolher(cfg, 's1', 'I have fixed the bug and all the tests are passing now.', 'fala', ordem)
  assert.match(a.modelo, /en_US-lessac/)
  const b = vozes.escolher(cfg, 's2', 'Corrigi o erro no servidor e os testes já passam.', 'fala', ordem)
  assert.match(b.modelo, /pt_PT-tugao/)
  assert.notEqual(a.altura, b.altura) // conversas diferentes, tons diferentes
  // anúncios de ações ficam sempre na voz principal
  assert.match(vozes.escolher(cfg, 's1', 'I have fixed the bug and all the tests are passing.', 'acao', ordem).modelo, /pt_PT-tugao/)
  // interface em inglês: os anúncios passam para a voz inglesa instalada
  assert.match(vozes.escolher({ ...cfg, idioma: 'en' }, 's2', 'Reading config.ts.', 'acao', ordem).modelo, /en_US-lessac/)
  // escolha manual para uma conversa
  vozes.definirVozSessao('s1', 'en_US-lessac-medium', 2)
  const c = vozes.escolher(cfg, 's1', 'Olá, isto é uma frase em português para testar.', 'acao', ordem)
  assert.match(c.modelo, /en_US-lessac/)
  assert.equal(c.altura, 2)
})

test('emSilencio: botão manual e horário que atravessa a meia-noite', () => {
  const as = (h, m) => new Date(2026, 10, 18, h, m)
  assert.equal(emSilencio({ naoIncomodar: true }, as(12, 0)), true)
  const cfg = { naoIncomodar: false, silencioHorario: { ativo: true, inicio: '22:00', fim: '08:00' } }
  assert.equal(emSilencio(cfg, as(23, 30)), true)
  assert.equal(emSilencio(cfg, as(7, 59)), true)
  assert.equal(emSilencio(cfg, as(8, 0)), false)
  assert.equal(emSilencio(cfg, as(15, 0)), false)
  const dia = { silencioHorario: { ativo: true, inicio: '13:00', fim: '14:00' } }
  assert.equal(emSilencio(dia, as(13, 30)), true)
  assert.equal(emSilencio({ silencioHorario: { ...dia.silencioHorario, ativo: false } }, as(13, 30)), false)
})

test('uso: soma tokens por dia, conta cada mensagem uma vez e lê títulos', async () => {
  const dir = path.join(PASTA, 'projetos', 'p')
  fs.mkdirSync(dir, { recursive: true })
  const hoje = new Date()
  hoje.setHours(12)
  const msg = (id, saida) => ({ type: 'assistant', timestamp: hoje.toISOString(), message: { id, model: 'claude-opus-5-5', usage: { input_tokens: 10, cache_read_input_tokens: 100, output_tokens: saida } } })
  const linhas = [
    { type: 'custom-title', customTitle: 'Conversa de teste' },
    msg('m1', 50),
    msg('m1', 50), // o mesmo message.id repetido (um bloco por linha): conta uma vez
    msg('m2', 30),
  ]
  fs.writeFileSync(path.join(dir, 'sessao-x.jsonl'), linhas.map(l => JSON.stringify(l)).join('\n') + '\n')
  await uso.atualizar()
  const r = uso.resumo({})
  assert.equal(r.hoje.saida, 80)
  assert.equal(r.hoje.entrada, 20)
  assert.equal(r.hoje.cache, 200)
  assert.equal(r.topo[0].titulo, 'Conversa de teste')
  assert.equal(r.dias.length, 7)
  // leitura incremental: só o que é novo
  fs.appendFileSync(path.join(dir, 'sessao-x.jsonl'), JSON.stringify(msg('m3', 5)) + '\n')
  await uso.atualizar()
  assert.equal(uso.resumo({}).hoje.saida, 85)
})
