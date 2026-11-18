'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const t = require('../scripts/texto')

test('base: último segmento de caminhos Windows e Unix', () => {
  assert.equal(t.base('C:\\Users\\eu\\projeto\\config.json'), 'config.json')
  assert.equal(t.base('/usr/local/bin/node'), 'node')
  assert.equal(t.base('src/app.ts:42'), 'app.ts')
  assert.equal(t.base('"C:/a b/c.txt"'), 'c.txt')
})

test('limparLinha: tira markdown, links, caminhos e emojis', () => {
  assert.equal(t.limparLinha('## Resumo final'), 'Resumo final.')
  assert.equal(t.limparLinha('- **Corrigi** o [ficheiro](src/a/b.ts:10) ✅'), 'Corrigi o ficheiro.')
  assert.equal(t.limparLinha('Vê em https://www.github.com/x/y'), 'Vê em github.com.')
  assert.equal(t.limparLinha('Editei C:\\Users\\eu\\app\\main.js e src/util/texto.js.'), 'Editei main.js e texto.js.')
  assert.equal(t.limparLinha('Usa `npm test` agora'), 'Usa npm test agora.')
  assert.equal(t.limparLinha('isto → aquilo'), 'isto para aquilo.')
  assert.equal(t.limparLinha('liga e/ou desliga'), 'liga e ou desliga.')
  assert.equal(t.limparLinha('Data: 18/11/2026'), 'Data: 18/11/2026.')
  assert.equal(t.limparLinha('   '), '')
  assert.equal(t.limparLinha('---'), '')
})

test('processarDelta: salta código e tabelas, corta no máximo', () => {
  const e = t.novoEstado(60)
  const a = t.processarDelta(e, 'Vou mostrar:\n```js\nconst x = 1\n```\nFeito.\n')
  assert.deepEqual(a, ['Vou mostrar:', 'Feito.'])
  const b = t.processarDelta(t.novoEstado(), '| a | b |\n|---|---|\n| 1 | 2 |\nDepois da tabela.\n')
  assert.deepEqual(b, ['Há uma tabela no ecrã.', 'Depois da tabela.'])
  // código aberto num lote e fechado no seguinte
  const e2 = t.novoEstado()
  assert.deepEqual(t.processarDelta(e2, 'Antes.\n```\nlinha 1\n'), ['Antes.'])
  assert.deepEqual(t.processarDelta(e2, 'linha 2\n```\nDepois.\n'), ['Depois.'])
  // corte
  const e3 = t.novoEstado(30)
  const c = t.processarDelta(e3, 'Primeira frase curta.\nSegunda frase que já passa o limite.\nTerceira.\n')
  assert.deepEqual(c, ['Primeira frase curta.', 'O resto está no ecrã.'])
  assert.deepEqual(t.processarDelta(e3, 'Mais texto.\n'), [])
})

test('anunciarFerramenta: frases em português', () => {
  assert.equal(t.anunciarFerramenta('Edit', { file_path: 'C:\\p\\src\\app.ts' }), 'A editar app.ts.')
  assert.equal(t.anunciarFerramenta('Read', { file_path: '/x/README.md' }), 'A ler README.md.')
  assert.equal(t.anunciarFerramenta('Bash', { command: 'git status', description: 'Show working tree status' }), 'A usar o git.')
  assert.equal(
    t.anunciarFerramenta('Bash', { command: 'npm test', description: 'Correr os testes do projeto' }),
    'Correr os testes do projeto.',
  )
  assert.equal(t.anunciarFerramenta('PowerShell', { command: 'Get-ChildItem C:\\' }), 'A ver ficheiros.')
  assert.equal(t.anunciarFerramenta('Bash', { command: 'cd /tmp && curl -s x' }), 'A fazer um pedido à internet.')
  assert.equal(t.anunciarFerramenta('Bash', { command: '"C:\\Program Files\\PuTTY\\plink.exe" -ssh x' }), 'A ligar a um servidor remoto.')
  assert.equal(t.anunciarFerramenta('Bash', { command: 'node "C:/x/scripts/voz.js" parar' }), null)
  assert.equal(t.anunciarFerramenta('WebFetch', { url: 'https://www.example.com/a' }), 'A abrir example.com.')
  assert.equal(t.anunciarFerramenta('TodoWrite', {}), null)
  assert.equal(t.anunciarFerramenta('mcp__ccd_turn__update_plan', {}), null)
  assert.equal(t.anunciarFerramenta('mcp__claude-in-chrome__navigate', {}), 'A usar o navegador.')
  assert.equal(t.anunciarFerramenta('AskUserQuestion', {}), 'Tenho uma pergunta para ti.')
})

test('primeiroPrograma: ignora cd, variáveis e extensões', () => {
  assert.equal(t.primeiroPrograma('cd "C:/a b" && npm run build'), 'npm')
  assert.equal(t.primeiroPrograma('FOO=1 python -I x.py'), 'python')
  assert.equal(t.primeiroPrograma('$x = 3; Get-Process'), 'get-process')
  assert.equal(t.primeiroPrograma('/usr/bin/env node a.js'), 'env')
})

test('parecePortugues', () => {
  assert.equal(t.parecePortugues('Instalar as dependências do projeto'), true)
  assert.equal(t.parecePortugues('Install project dependencies'), false)
})

test('pronunciar: troca palavras inteiras, sem mexer noutras', () => {
  const d = { Claude: 'Cláude' }
  assert.equal(t.pronunciar('Olá, eu sou o Claude Code.', d), 'Olá, eu sou o Cláude Code.')
  assert.equal(t.pronunciar('claude, CLAUDE e Claude!', d), 'Cláude, Cláude e Cláude!')
  assert.equal(t.pronunciar('ClaudeX e MeuClaude ficam', d), 'ClaudeX e MeuClaude ficam')
  assert.equal(t.pronunciar('sem dicionário', undefined), 'sem dicionário')
})

test('frasesNotificacao', () => {
  assert.equal(t.frasesNotificacao('Claude needs your permission to use Bash'), 'Preciso da tua autorização.')
  assert.equal(t.frasesNotificacao('Claude is waiting for your input'), 'Estou à tua espera.')
})
