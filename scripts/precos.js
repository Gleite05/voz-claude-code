'use strict'
// Custo equivalente na API (preços públicos da Anthropic, em dólares por milhão de tokens).
// É uma estimativa: quem usa uma subscrição (Pro/Max) não paga isto, mas dá a ideia do valor gasto.
// Escrita em cache: 1,25× a entrada (5 min) ou 2× (1 hora). Leitura de cache: preço próprio de cada modelo.

// [padrão no id do modelo, entrada, saída, leitura de cache]
const TABELA = [
  [/fable-5-2|mythos-5-2/, 8, 40, 0.2],
  [/fable-5|mythos-5/, 10, 50, 1],
  [/opus-5-5/, 4, 20, 0.2],
  [/opus-5|opus-4-[5-9]/, 5, 25, 0.5],
  [/opus-4|opus-3/, 15, 75, 1.5],
  [/sonnet-5-5/, 2, 10, 0.1],
  [/sonnet-5/, 2, 10, 0.2],
  [/sonnet-4|sonnet-3/, 3, 15, 0.3],
  [/haiku-5-5/, 0.1, 0.5, 0.01],
  [/haiku-4/, 1, 5, 0.1],
  [/haiku-3-5/, 0.8, 4, 0.08],
  [/haiku-3/, 0.25, 1.25, 0.03],
]

/** { entrada, saida, leitura } em $/milhão, ou null para um modelo desconhecido. */
function precoDe(modelo) {
  const m = String(modelo || '').toLowerCase()
  if (!m.includes('claude') && !/fable|mythos|opus|sonnet|haiku/.test(m)) return null
  for (const [re, entrada, saida, leitura] of TABELA) if (re.test(m)) return { entrada, saida, leitura }
  return null
}

/** Custo em dólares de uma resposta (o `usage` do histórico), ou null se o modelo não tiver preço. */
function custo(modelo, u) {
  const p = precoDe(modelo)
  if (!p || !u) return null
  const n = k => Number(u[k]) || 0
  const cc = u.cache_creation && typeof u.cache_creation === 'object' ? u.cache_creation : null
  const escrita5 = cc ? Number(cc.ephemeral_5m_input_tokens) || 0 : n('cache_creation_input_tokens')
  const escrita1h = cc ? Number(cc.ephemeral_1h_input_tokens) || 0 : 0
  return (
    (n('input_tokens') * p.entrada + escrita5 * p.entrada * 1.25 + escrita1h * p.entrada * 2 + n('cache_read_input_tokens') * p.leitura + n('output_tokens') * p.saida) / 1e6
  )
}

module.exports = { precoDe, custo }
