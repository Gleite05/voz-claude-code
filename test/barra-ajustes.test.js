'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const AJ = require('../scripts/barra-ajustes')

test('valida listas, números e sim/não', () => {
  assert.deepEqual(AJ.validar('barraTema', 'Escuro'), { ok: true, valor: 'escuro' })
  assert.equal(AJ.validar('barraTema', 'roxo').ok, false)
  assert.deepEqual(AJ.validar('vidroRefracao', '12px'), { ok: true, valor: 12 })
  assert.equal(AJ.validar('vidroRefracao', '50').ok, false)
  assert.deepEqual(AJ.validar('barraAvisos', 'não'), { ok: true, valor: false })
  assert.deepEqual(AJ.validar('moeda', 'eur'), { ok: true, valor: 'EUR' })
  assert.equal(AJ.validar('porta', '80').ok, false) // só os ajustes da barra
})

test('um erro não grava nada', () => {
  const r = AJ.interpretar(['barraTema=claro', 'barraPosicao=lua'], {})
  assert.equal(r.ok, false)
  assert.equal(r.erros.length, 1)
})

test('afinar o vidro a partir de uma predefinição passa a personalizado', () => {
  const r = AJ.interpretar(['vidroRefracao=14'], { barraMaterial: 'fosco' })
  assert.equal(r.ok, true)
  assert.equal(r.alteracoes.barraMaterial, 'personalizado')
  assert.equal(r.alteracoes.vidroRefracao, 14)
  assert.equal(r.alteracoes.vidroDesfoque, AJ.VIDRO_PREDEF.fosco.vidroDesfoque)
  // já personalizado: só muda o que pediste
  assert.deepEqual(AJ.interpretar(['vidroBrilho=80'], { barraMaterial: 'personalizado' }).alteracoes, { vidroBrilho: 80 })
})

test('chaves sem olhar a maiúsculas', () => {
  assert.deepEqual(AJ.interpretar(['barratema=claro'], {}).alteracoes, { barraTema: 'claro' })
})

test('módulos: liga, desliga e acrescenta os que faltam', () => {
  const cfg = { barraModulos: [{ id: 'ilha', on: true }, { id: 'tempo', on: true }] }
  assert.equal(AJ.modulos(cfg).length, AJ.MODULOS.length)
  const r = AJ.alternarModulo(cfg, 'tempo', 'off')
  assert.equal(r.lista.find(m => m.id === 'tempo').on, false)
  assert.equal(r.lista[0].id, 'ilha') // mantém a ordem
  assert.ok(AJ.alternarModulo(cfg, 'relogio', 'on').erro)
})

test('design: atalho para estilo + material, sem gravar «design»', () => {
  assert.deepEqual(AJ.interpretar(['design=mica'], {}).alteracoes, { barraEstilo: 'windows' })
  assert.deepEqual(AJ.interpretar(['design=fosco'], { barraEstilo: 'windows' }).alteracoes, { barraEstilo: 'macos', barraMaterial: 'fosco' })
  // o vidro líquido afinado mantém as afinações
  assert.deepEqual(AJ.interpretar(['design=liquido'], { barraMaterial: 'personalizado' }).alteracoes, { barraEstilo: 'macos', barraMaterial: 'personalizado' })
  assert.equal(AJ.designAtual({ barraEstilo: 'windows-acrilico' }), 'acrilico')
  assert.equal(AJ.designAtual({ barraMaterial: 'personalizado' }), 'liquido')
  assert.equal(AJ.interpretar(['design=neon'], {}).ok, false)
  assert.deepEqual(AJ.interpretar(['design=retro'], {}).alteracoes, { barraEstilo: 'retro' })
  assert.equal(AJ.designAtual({ barraEstilo: 'plasma' }), 'plasma')
})
