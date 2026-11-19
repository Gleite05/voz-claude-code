'use strict'
// Diferenças curtas para o cartão de autorização: o que um Edit/Write vai mudar, linha a linha.
// Não é um diff completo (não procura o alinhamento ótimo): corta o que é igual no início e no fim
// e mostra o miolo — chega para ver de relance o que muda numa edição típica.

const MAX_LINHAS = 40
const MAX_COL = 240
const CONTEXTO = 2

const corta = l => (l.length > MAX_COL ? l.slice(0, MAX_COL - 1) + '…' : l)
const linhasDe = s => String(s == null ? '' : s).replace(/\r\n?/g, '\n').split('\n')

/** Um bloco de diferenças entre dois textos: [[tipo, linha]] com tipo ' ', '-' ou '+'. */
function bloco(antes, depois) {
  const a = linhasDe(antes)
  const b = linhasDe(depois)
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  let fa = a.length
  let fb = b.length
  while (fa > i && fb > i && a[fa - 1] === b[fb - 1]) {
    fa--
    fb--
  }
  const out = []
  for (let k = Math.max(0, i - CONTEXTO); k < i; k++) out.push([' ', a[k]])
  out.push(...miolo(a.slice(i, fa), b.slice(i, fb)))
  for (let k = fa; k < Math.min(a.length, fa + CONTEXTO); k++) out.push([' ', a[k]])
  return out
}

const MAX_CELULAS = 60000 // acima disto (miolos enormes) não vale a pena alinhar: tudo sai e tudo entra

/** O miolo que muda, alinhado pela maior subsequência comum (linhas que só mudaram de sítio ficam iguais). */
function miolo(a, b) {
  if (!a.length || !b.length || a.length * b.length > MAX_CELULAS) return [...a.map(l => ['-', l]), ...b.map(l => ['+', l])]
  const n = a.length
  const m = b.length
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let x = n - 1; x >= 0; x--) for (let y = m - 1; y >= 0; y--) L[x][y] = a[x] === b[y] ? L[x + 1][y + 1] + 1 : Math.max(L[x + 1][y], L[x][y + 1])
  const out = []
  let x = 0
  let y = 0
  while (x < n && y < m) {
    if (a[x] === b[y]) {
      out.push([' ', a[x++]])
      y++
    } else if (L[x + 1][y] >= L[x][y + 1]) out.push(['-', a[x++]])
    else out.push(['+', b[y++]])
  }
  while (x < n) out.push(['-', a[x++]])
  while (y < m) out.push(['+', b[y++]])
  return out
}

/** Junta blocos, conta linhas e limita o tamanho. */
function fechar(blocos, extra) {
  const todas = []
  blocos.forEach((b, n) => {
    if (n && b.length) todas.push(['…', ''])
    todas.push(...b)
  })
  const add = todas.filter(x => x[0] === '+').length
  const rem = todas.filter(x => x[0] === '-').length
  if (!add && !rem) return null
  return {
    linhas: todas.slice(0, MAX_LINHAS).map(([t, l]) => [t, corta(l)]),
    mais: Math.max(0, todas.length - MAX_LINHAS),
    add,
    rem,
    ...extra,
  }
}

/**
 * Diferenças de uma chamada de ferramenta, ou null se não for uma edição.
 * lerAtual(caminho) devolve o conteúdo atual do ficheiro (ou null) — para o Write mostrar o que muda.
 */
function daFerramenta(ferramenta, entrada, lerAtual) {
  const e = entrada || {}
  const ficheiro = String(e.file_path || e.notebook_path || '')
  const nome = ficheiro.split(/[\\/]/).pop()
  switch (ferramenta) {
    case 'Edit':
      if (typeof e.old_string !== 'string' || typeof e.new_string !== 'string') return null
      return fechar([bloco(e.old_string, e.new_string)], { ficheiro: nome, todas: !!e.replace_all })
    case 'MultiEdit':
      if (!Array.isArray(e.edits)) return null
      return fechar(
        e.edits.filter(x => x && typeof x.old_string === 'string').map(x => bloco(x.old_string, String(x.new_string || ''))),
        { ficheiro: nome },
      )
    case 'Write': {
      if (typeof e.content !== 'string') return null
      const atual = lerAtual ? lerAtual(ficheiro) : null
      if (atual == null) return fechar([linhasDe(e.content).map(l => ['+', l])], { ficheiro: nome, novo: true })
      return fechar([bloco(atual, e.content)], { ficheiro: nome })
    }
  }
  return null
}

module.exports = { bloco, daFerramenta }
