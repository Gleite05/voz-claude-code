'use strict'
// Testes da 1.3: resultados dos comandos, progresso das tarefas, diff das autorizações e o estado
// das conversas com os ganchos novos (PostToolUse, sub-agentes, compactação).
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
process.env.VOZ_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'voz-teste-'))

const test = require('node:test')
const assert = require('node:assert/strict')
const texto = require('../scripts/texto')
const tarefas = require('../scripts/tarefas')
const diff = require('../scripts/diff')
const estado = require('../scripts/estado')

test('tipoComando: testes, compilação, push, instalação e o resto', () => {
  assert.equal(texto.tipoComando('npm test'), 'testes')
  assert.equal(texto.tipoComando('cd app && npm run test -- --watch=false'), 'testes')
  assert.equal(texto.tipoComando('node --test test/'), 'testes')
  assert.equal(texto.tipoComando('python -m pytest -q'), 'testes')
  assert.equal(texto.tipoComando('npm run build'), 'compilar')
  assert.equal(texto.tipoComando('dotnet build -c Release'), 'compilar')
  assert.equal(texto.tipoComando('git push origin main'), 'push')
  assert.equal(texto.tipoComando('npm ci'), 'instalar')
  assert.equal(texto.tipoComando('vercel --prod'), 'deploy')
  assert.equal(texto.tipoComando('grep -rn foo src'), null)
  assert.equal(texto.tipoComando('git status'), null)
  assert.equal(texto.tipoComando('node "C:/x/scripts/voz.js" estado'), null)
})

test('contarTestes: node --test, jest, pytest, mocha, dotnet', () => {
  assert.deepEqual(texto.contarTestes('ℹ tests 12\nℹ pass 12\nℹ fail 0'), { passaram: 12, falharam: 0 })
  assert.deepEqual(texto.contarTestes('# pass 3\n# fail 2'), { passaram: 3, falharam: 2 })
  assert.deepEqual(texto.contarTestes('Tests:       2 failed, 10 passed, 12 total'), { passaram: 10, falharam: 2 })
  assert.deepEqual(texto.contarTestes('==== 1 failed, 41 passed in 2.31s ===='), { passaram: 41, falharam: 1 })
  assert.deepEqual(texto.contarTestes('  9 passing (40ms)\n  1 failing'), { passaram: 9, falharam: 1 })
  assert.deepEqual(texto.contarTestes('Passed!  - Failed:     0, Passed:    17, Skipped: 0'), { passaram: 17, falharam: 0 })
  assert.deepEqual(texto.contarTestes('nada de útil'), { passaram: null, falharam: null })
})

test('anunciarResultado: só fala do que interessa', () => {
  const bash = c => ({ command: c })
  assert.equal(texto.anunciarResultado('Bash', bash('npm test'), { ok: true, saida: 'ℹ pass 12\nℹ fail 0' }), 'Os 12 testes passaram.')
  assert.equal(texto.anunciarResultado('Bash', bash('npm test'), { ok: false, erro: 'Exit code 1\n# pass 9\n# fail 3' }), 'Falharam 3 testes.')
  assert.equal(texto.anunciarResultado('Bash', bash('npm test'), { ok: false, erro: 'Exit code 1' }), 'Os testes falharam.')
  assert.equal(texto.anunciarResultado('Bash', bash('npm run build'), { ok: false }), 'A compilação falhou.')
  assert.equal(texto.anunciarResultado('Bash', bash('npm run build'), { ok: true, duracaoMs: 2000 }), null) // rápido: calado
  assert.equal(texto.anunciarResultado('Bash', bash('npm run build'), { ok: true, duracaoMs: 40000 }), 'Compilação concluída.')
  assert.equal(texto.anunciarResultado('Bash', bash('git push'), { ok: true }), 'Push feito.')
  assert.equal(texto.anunciarResultado('Bash', bash('grep x y'), { ok: false, erro: 'Exit code 1' }), null) // grep sem resultados não é notícia
  assert.equal(texto.anunciarResultado('Bash', bash('sleep 90'), { ok: true, duracaoMs: 80000 }), 'Comando concluído, demorou 1 minuto e 20 segundos.')
  assert.equal(texto.anunciarResultado('Bash', bash('npm test'), { ok: false, interrompido: true }), null)
  assert.equal(texto.anunciarResultado('Edit', {}, { ok: false }), null)
  assert.equal(texto.anunciarResultado('Bash', bash('npm test'), { ok: true, saida: '# pass 4\n# fail 0' }, 'en'), 'All 4 tests passed.')
  assert.equal(texto.anunciarResultado('Bash', bash('git push'), { ok: false }, 'es'), 'El push falló.')
})

test('legendaFalha: o comando curto, sem o cd', () => {
  assert.equal(texto.legendaFalha('Bash', { command: 'cd "C:/a b" && npm test -- --x' }), 'npm test -- --x falhou')
  assert.equal(texto.legendaFalha('Bash', { command: 'ls' }), null)
})

test('duracaoFalada', () => {
  assert.equal(texto.duracaoFalada(42000), '42 segundos')
  assert.equal(texto.duracaoFalada(60000), '1 minuto')
  assert.equal(texto.duracaoFalada(7 * 60000 + 5000), '7 minutos')
  assert.equal(texto.duracaoFalada(61000, 'en'), '1 minute and 1 second')
})

test('tarefas: TodoWrite, TaskCreate/Update e o plano da app', () => {
  let p = tarefas.atualizar(null, 'TodoWrite', { todos: [{ t: 'a', s: 'completed' }, { t: 'b', s: 'in_progress' }, { t: 'c', s: 'pending' }] })
  assert.deepEqual(tarefas.resumir(p).feitas, 1)
  assert.equal(tarefas.resumir(p).atual, 'b')
  p = null
  p = tarefas.atualizar(p, 'TaskCreate', { subject: 'um' })
  p = tarefas.atualizar(p, 'TaskCreate', { subject: 'dois' })
  p = tarefas.atualizar(p, 'TaskUpdate', { taskId: '1', status: 'completed' })
  p = tarefas.atualizar(p, 'TaskUpdate', { taskId: '2', status: 'in_progress' })
  assert.deepEqual([tarefas.resumir(p).feitas, tarefas.resumir(p).total, tarefas.resumir(p).atual], [1, 2, 'dois'])
  p = tarefas.atualizar(p, 'TaskUpdate', { taskId: '9', status: 'completed' }) // inexistente: igual
  assert.equal(tarefas.resumir(p).feitas, 1)
  p = tarefas.atualizar(null, 'mcp__ccd_turn__update_plan', { items: [{ t: 'x', s: 'in_progress' }, { t: 'y', s: 'pending' }, { t: 'z', s: 'pending' }] })
  p = tarefas.atualizar(p, 'mcp__ccd_turn__update_plan', { advance: true })
  assert.deepEqual([tarefas.resumir(p).feitas, tarefas.resumir(p).atual], [1, 'y'])
  p = tarefas.atualizar(p, 'mcp__ccd_turn__update_plan', { done: [2], start: 3 })
  assert.deepEqual([tarefas.resumir(p).feitas, tarefas.resumir(p).atual], [2, 'z'])
  p = tarefas.atualizar(p, 'mcp__ccd_turn__wrap_up', {})
  assert.equal(tarefas.resumir(p).feitas, 3)
  assert.equal(tarefas.atualizar(p, 'Bash', { command: 'ls' }), p) // outras ferramentas não mexem
  assert.equal(tarefas.resumir(null), null)
})

test('diff: Edit, MultiEdit e Write (novo e existente)', () => {
  const d = diff.daFerramenta('Edit', { file_path: 'C:/p/app.js', old_string: 'a\nb\nc', new_string: 'a\nB\nc' })
  assert.equal(d.ficheiro, 'app.js')
  assert.deepEqual(d.linhas, [[' ', 'a'], ['-', 'b'], ['+', 'B'], [' ', 'c']])
  assert.deepEqual([d.add, d.rem], [1, 1])
  // Uma linha que só desceu não aparece como apagada e escrita outra vez.
  const mov = diff.daFerramenta('Edit', { file_path: 'e.js', old_string: 'f() {\n  return x\n}', new_string: 'f() {\n  limpar()\n  return x\n  .y\n}' })
  assert.deepEqual(mov.linhas, [[' ', 'f() {'], ['+', '  limpar()'], [' ', '  return x'], ['+', '  .y'], [' ', '}']])
  assert.deepEqual([mov.add, mov.rem], [2, 0])
  const m = diff.daFerramenta('MultiEdit', { file_path: 'x.ts', edits: [{ old_string: 'um', new_string: 'dois' }, { old_string: 'tres', new_string: 'quatro' }] })
  assert.equal(m.linhas.filter(l => l[0] === '…').length, 1)
  const novo = diff.daFerramenta('Write', { file_path: 'n.md', content: 'ola\nmundo' }, () => null)
  assert.equal(novo.novo, true)
  assert.equal(novo.add, 2)
  const exist = diff.daFerramenta('Write', { file_path: 'e.md', content: 'a\nB' }, () => 'a\nb')
  assert.deepEqual([exist.add, exist.rem, exist.novo], [1, 1, undefined])
  assert.equal(diff.daFerramenta('Edit', { file_path: 'x', old_string: 'igual', new_string: 'igual' }), null)
  assert.equal(diff.daFerramenta('Bash', { command: 'ls' }), null)
  const longo = diff.daFerramenta('Write', { content: Array.from({ length: 100 }, (_, i) => 'l' + i).join('\n') }, () => null)
  assert.equal(longo.linhas.length, 40)
  assert.equal(longo.mais, 60)
})

test('estado: cronómetro, falhas, sub-agentes, compactação e tarefas', () => {
  const S = 'sessao-teste-13'
  const ev = (evento, extra) => estado.registar({ evento, sessao: S, cwd: 'C:/proj/app', idioma: 'pt', ...extra })
  const eu = () => estado.lista().find(x => x.id === S)
  ev('UserPromptSubmit', { pedido: 'corre os testes' })
  ev('PreToolUse', { ferramenta: 'Bash', entrada: { command: 'npm test' }, id: 't1' })
  assert.equal(eu().emCursoDesde, null) // ainda não sabemos se esta versão manda PostToolUse
  ev('PostToolUseFailure', { ferramenta: 'Bash', entrada: { command: 'npm test' }, id: 't1', duracao: 4200 })
  assert.equal(eu().falha.texto, 'npm test falhou')
  assert.equal(eu().historico.at(-1).ok, false)
  assert.equal(eu().historico.at(-1).dur, 4200)
  ev('PreToolUse', { ferramenta: 'Bash', entrada: { command: 'npm run build' }, id: 't2' })
  assert.ok(eu().emCursoDesde > 0) // agora sim: cronómetro
  ev('PostToolUse', { ferramenta: 'Bash', entrada: { command: 'npm run build' }, id: 't2' })
  assert.equal(eu().emCursoDesde, null)
  ev('SubagentStart', { subagente: 'ag1', tipoAgente: 'Explore' })
  assert.deepEqual(eu().subagentes.map(a => a.tipo), ['Explore'])
  ev('SubagentStop', { subagente: 'ag1', tipoAgente: 'Explore' })
  assert.equal(eu().subagentes.length, 0)
  ev('PreCompact', { gatilho: 'auto' })
  assert.equal(eu().compactar, true)
  ev('PostCompact', { gatilho: 'auto' })
  assert.equal(eu().compactar, false)
  ev('PreToolUse', { ferramenta: 'TodoWrite', entrada: { todos: [{ t: 'a', s: 'completed' }, { t: 'b', s: 'pending' }] }, id: 't3' })
  assert.deepEqual([eu().tarefas.feitas, eu().tarefas.total], [1, 2])
  ev('Stop', { ultima: 'feito' })
  assert.equal(eu().emCursoDesde, null)
})

test('sons: WAV estéreo válido e lado certo', () => {
  const sons = require('../scripts/sons')
  for (const nome of sons.NOMES) {
    const w = sons.gerarWav(nome, { volume: 1, pan: 0 })
    assert.equal(w.toString('ascii', 0, 4), 'RIFF')
    assert.equal(w.readUInt16LE(22), 2) // estéreo
    assert.equal(w.readUInt32LE(40), w.length - 44)
  }
  assert.deepEqual(sons.ganhos(0), [1, 1])
  const [e, d] = sons.ganhos(-0.6)
  assert.ok(e === 1 && d < 0.5) // à esquerda: o ouvido direito ouve menos
  const esq = sons.gerarWav('ok', { pan: -1 })
  let somaD = 0
  for (let k = 44; k < esq.length; k += 4) somaD += Math.abs(esq.readInt16LE(k + 2))
  assert.ok(somaD < 50) // tudo à esquerda
  assert.throws(() => sons.gerarWav('inexistente'))
  const f = sons.caminho('pronto', { volume: 0.8, pan: 0.6 })
  assert.ok(fs.existsSync(f) && /pronto-v8-p6\.wav$/.test(f))
})

test('fecharMensagem: temas que ficaram por dizer e a pergunta final', () => {
  const est = texto.novoEstado(60, 'pt')
  const ditas = texto.processarDelta(est, 'Fiz várias alterações no servidor da voz.\nE também na barra, que agora mostra mais coisas.\n## Instalação\nCorre o comando.\n## Testes\nPassam todos.\n**Publicação**\nQueres que publique a versão 1.3?')
  assert.equal(ditas.at(-1), 'O resto está no ecrã.')
  assert.deepEqual(texto.fecharMensagem(est), ['Também fala de Instalação, Testes e Publicação.', 'E no fim pergunta: Queres que publique a versão 1.3?'])
  const curta = texto.novoEstado(1200, 'pt')
  texto.processarDelta(curta, 'Feito.')
  assert.deepEqual(texto.fecharMensagem(curta), []) // coube tudo: nada a acrescentar
})

test('avaliarResultado: bom ou mau, para escolher o som', () => {
  assert.equal(texto.avaliarResultado('Bash', { command: 'npm test' }, { ok: true, saida: '# pass 2\n# fail 0' }).bom, true)
  assert.equal(texto.avaliarResultado('Bash', { command: 'npm test' }, { ok: true, saida: '# pass 2\n# fail 1' }).bom, false)
  assert.equal(texto.avaliarResultado('Bash', { command: 'git push' }, { ok: false }).bom, false)
})

test('precos: custo equivalente na API por modelo', () => {
  const precos = require('../scripts/precos')
  assert.deepEqual(precos.precoDe('claude-opus-5-5'), { entrada: 4, saida: 20, leitura: 0.2 })
  assert.deepEqual(precos.precoDe('claude-opus-4-8'), { entrada: 5, saida: 25, leitura: 0.5 })
  assert.deepEqual(precos.precoDe('claude-fable-5-2'), { entrada: 8, saida: 40, leitura: 0.2 })
  assert.equal(precos.precoDe('claude-sonnet-5-5').entrada, 2)
  assert.equal(precos.precoDe('claude-haiku-4-5').saida, 5)
  assert.equal(precos.precoDe('<synthetic>'), null)
  // 1M de entrada + 1M de saída no Opus 5.5 = 4 + 20 dólares
  assert.equal(precos.custo('claude-opus-5-5', { input_tokens: 1e6, output_tokens: 1e6 }), 24)
  // cache: escrita de 1 h custa 2× a entrada, leitura ao preço próprio
  const c = precos.custo('claude-opus-5-5', { cache_creation_input_tokens: 1e6, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1e6 }, cache_read_input_tokens: 1e6 })
  assert.ok(Math.abs(c - 8.2) < 1e-9)
  assert.equal(precos.custo('modelo-x', { input_tokens: 5 }), null)
})

test('uso: custo, ferramentas, horas e projetos lidos dos históricos', async () => {
  const pasta = path.join(process.env.VOZ_DIR, 'projetos', 'C--proj-app')
  fs.mkdirSync(pasta, { recursive: true })
  process.env.VOZ_PROJETOS = path.join(process.env.VOZ_DIR, 'projetos')
  delete require.cache[require.resolve('../scripts/uso')]
  const uso = require('../scripts/uso')
  const agora = new Date().toISOString()
  const linha = (id, blocos, usage) => JSON.stringify({ type: 'assistant', timestamp: agora, cwd: 'C:\\proj\\app', message: { id, model: 'claude-opus-5-5', usage, content: blocos } })
  const u = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0 }
  fs.writeFileSync(
    path.join(pasta, 'sessao1.jsonl'),
    [
      linha('m1', [{ type: 'text', text: 'olá' }], u),
      linha('m1', [{ type: 'tool_use', name: 'Bash' }], u), // mesma mensagem: tokens só uma vez, ferramenta conta
      linha('m2', [{ type: 'tool_use', name: 'Edit' }, { type: 'tool_use', name: 'mcp__x__y' }], u),
    ].join('\n') + '\n',
  )
  await uso.atualizar()
  const r = uso.resumo()
  assert.equal(r.hoje.saida, 1000)
  assert.ok(Math.abs(r.hoje.custo - 2 * (1000 * 4 + 500 * 20) / 1e6) < 1e-12)
  assert.deepEqual(r.semana.ferramentas.map(f => f.nome).sort(), ['Bash', 'Edit', 'MCP'])
  assert.equal(r.semana.projetos[0].nome, 'app')
  assert.equal(r.semana.horasAtivas, 1)
  assert.equal(r.semana.diasSeguidos, 1)
  assert.ok(r.cambio.eurPorDolar > 0)
})

test('voz: perceber «sim», «não» e «sempre» nas três línguas', () => {
  const c = (d, i) => texto.classificarResposta(d, i)
  assert.equal(c('Sim.', 'pt'), 'allow')
  assert.equal(c('Pode avançar.', 'pt'), 'allow')
  assert.equal(c('Não, espera.', 'pt'), 'deny')
  assert.equal(c('Não pode.', 'pt'), 'deny') // o «não» ganha ao «pode»
  assert.equal(c('Sim, sempre.', 'pt'), 'always')
  assert.equal(c('Yes please', 'en'), 'allow')
  assert.equal(c("No, don't.", 'en'), 'deny')
  assert.equal(c('Sí, dale', 'es'), 'allow')
  assert.equal(c('Siempre', 'es'), 'always')
  assert.equal(c('Okay', 'pt'), 'allow') // inglês serve em qualquer língua
  assert.equal(c('banana', 'pt'), null)
  assert.equal(c('Hmm, deixa ver o que é isso primeiro antes de decidir.', 'pt'), null)
})

test('voz: pergunta de autorização e fim de conversa no mãos-livres', () => {
  assert.equal(texto.perguntaAutorizacao('Bash', 'cd x && git push origin main', 'Site'), 'Site pede autorização para correr git. Autorizas?')
  assert.equal(texto.perguntaAutorizacao('Edit', 'C:/a/estado.js', null, 'en'), 'I want to edit estado.js. Allow?')
  assert.equal(texto.perguntaAutorizacao('mcp__github__create_issue', '', 'X', 'es'), 'X pide permiso para usar create issue. ¿Lo permites?')
  for (const fim of ['Obrigado.', 'Para.', 'Chega, obrigado', "That's all", 'Gracias']) assert.equal(texto.eFimDeConversa(fim), true, fim)
  assert.equal(texto.eFimDeConversa('Para com isso e corrige o teste'), false)
  assert.equal(texto.eFimDeConversa('Agora corre os testes'), false)
})

test('resumoAusencia: o que aconteceu enquanto estavas fora', () => {
  assert.equal(
    texto.resumoAusencia({ terminaram: ['Voz', 'Site'], precisam: ['Veezy'], falhas: [{ titulo: 'Voz', texto: 'npm test falhou' }], trabalham: ['CV'] }),
    'Olá de novo. Enquanto estiveste fora: Voz e Site terminaram; em Voz, npm test falhou; Veezy precisa de ti; CV continua a trabalhar.',
  )
  assert.equal(texto.resumoAusencia({ terminaram: ['Voz'] }, 'en'), 'Welcome back. While you were away: Voz finished.')
  assert.equal(texto.resumoAusencia({ trabalham: ['x'] }), null) // nada de novo: fica calada
})
