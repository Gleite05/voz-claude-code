'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const estado = require('../scripts/estado')

test('nomeModelo: ids da API para nomes curtos', () => {
  assert.equal(estado.nomeModelo('claude-opus-5-5'), 'Opus 5.5')
  assert.equal(estado.nomeModelo('claude-sonnet-5-5-20261001'), 'Sonnet 5.5')
  assert.equal(estado.nomeModelo('claude-haiku-5-5'), 'Haiku 5.5')
  assert.equal(estado.nomeModelo(''), '')
})

test('lerUso: contexto do último pedido e tokens gerados desde o último prompt', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'voz-')), 'sessao.jsonl')
  const linhas = [
    { type: 'user', message: { content: 'primeiro pedido' } },
    { type: 'assistant', message: { model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 500 } } },
    { type: 'user', message: { content: 'segundo pedido' } },
    { type: 'assistant', message: { model: 'claude-opus-5-5', usage: { input_tokens: 5, cache_read_input_tokens: 40000, output_tokens: 100 } } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
    {
      type: 'assistant',
      message: { model: 'claude-opus-5-5', usage: { input_tokens: 2, cache_creation_input_tokens: 1000, cache_read_input_tokens: 40100, output_tokens: 300 } },
    },
  ]
  fs.writeFileSync(f, linhas.map(l => JSON.stringify(l)).join('\n') + '\n')
  const u = estado.lerUso(f)
  assert.equal(u.modelo, 'Opus 5.5')
  assert.equal(u.usados, 2 + 1000 + 40100 + 300)
  assert.equal(u.limite, 200000)
  assert.equal(u.pct, 21)
  assert.equal(u.saidaPedido, 400) // 100 + 300, sem os 500 do pedido anterior
  assert.equal(estado.lerUso(path.join(path.dirname(f), 'nao-existe.jsonl')), null)
})

test('registar: estados de uma sessão', () => {
  const s = 'teste-estado'
  estado.registar({ evento: 'UserPromptSubmit', sessao: s, cwd: 'C:\\p\\meu-projeto' })
  let x = estado.lista().find(v => v.id === s)
  assert.equal(x.pasta, 'meu-projeto')
  assert.equal(x.estado, 'trabalhar')
  estado.registar({ evento: 'PreToolUse', sessao: s, ferramenta: 'Edit', entrada: { file_path: '/a/b/app.ts' } })
  assert.equal(estado.lista().find(v => v.id === s).acao, 'A editar app.ts')
  estado.registar({ evento: 'Notification', sessao: s, mensagem: 'Claude needs your permission to use Bash' })
  assert.equal(estado.lista().find(v => v.id === s).estado, 'atencao')
  estado.registar({ evento: 'Stop', sessao: s })
  x = estado.lista().find(v => v.id === s)
  assert.equal(x.estado, 'terminou')
  assert.ok(x.fim >= x.inicio)
  estado.registar({ evento: 'PreToolUse', sessao: s, agente: 'sub-1', ferramenta: 'Read', entrada: {} })
  assert.equal(estado.lista().find(v => v.id === s).estado, 'terminou') // subagentes não contam
  estado.registar({ evento: 'SessionEnd', sessao: s })
  assert.equal(estado.lista().find(v => v.id === s), undefined)
})
