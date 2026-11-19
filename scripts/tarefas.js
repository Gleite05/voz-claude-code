'use strict'
// Progresso das listas de tarefas de cada conversa, para o anel «4/7» da barra.
// Percebe as várias formas de o Claude Code guardar um plano:
//   TodoWrite { todos: [{ content, status, activeForm }] }       (terminal, versões antigas)
//   TaskCreate { subject } / TaskUpdate { taskId, status }        (tarefas numeradas)
//   mcp__ccd_turn__update_plan { items | advance | done/start }   (app do Claude)
//   mcp__ccd_turn__wrap_up                                        (fecha o plano da app)
// Funções puras: recebem o plano anterior e devolvem o novo (ou o mesmo, se a ferramenta não for de tarefas).

const ESTADOS = new Set(['pending', 'in_progress', 'completed'])

const curto = v => String(v == null ? '' : v).slice(0, 120)
const estadoDe = s => (ESTADOS.has(s) ? s : 'pending')

function deLista(lista) {
  if (!Array.isArray(lista)) return null
  return lista.slice(0, 40).map(x => ({ t: curto(x && (x.t || x.activeForm || x.content)), s: estadoDe(x && (x.s || x.status)) }))
}

/** Devolve o plano depois da chamada `ferramenta(entrada)`. */
function atualizar(plano, ferramenta, entrada) {
  const e = entrada || {}
  const itens = plano ? plano.map(x => ({ ...x })) : []
  switch (ferramenta) {
    case 'TodoWrite':
      return deLista(e.todos) || plano
    case 'TaskCreate':
      itens.push({ t: curto(e.subject || e.activeForm || e.description), s: 'pending' })
      return itens
    case 'TaskUpdate': {
      const i = Number(e.taskId) - 1
      if (!Number.isInteger(i) || i < 0 || i >= itens.length) return plano
      if (e.status === 'deleted') itens[i].s = 'apagada'
      else if (ESTADOS.has(e.status)) itens[i].s = e.status
      if (e.subject) itens[i].t = curto(e.subject)
      return itens
    }
    case 'mcp__ccd_turn__update_plan': {
      if (Array.isArray(e.items)) return deLista(e.items)
      if (!itens.length) return plano
      if (e.advance) {
        const i = itens.findIndex(x => x.s === 'in_progress')
        if (i >= 0) itens[i].s = 'completed'
        const j = itens.findIndex((x, k) => k > i && x.s === 'pending')
        if (j >= 0) itens[j].s = 'in_progress'
      }
      for (const n of Array.isArray(e.done) ? e.done : []) if (itens[n - 1]) itens[n - 1].s = 'completed'
      if (Number.isInteger(e.start) && itens[e.start - 1]) {
        for (const x of itens) if (x.s === 'in_progress') x.s = 'pending'
        itens[e.start - 1].s = 'in_progress'
      }
      return itens
    }
    case 'mcp__ccd_turn__wrap_up':
      if (!itens.length) return plano
      for (const x of itens) if (x.s !== 'apagada') x.s = 'completed'
      return itens
  }
  return plano
}

/** É uma ferramenta de tarefas? (para o gancho saber que campos guardar) */
const eDeTarefas = nome => /^(TodoWrite|TaskCreate|TaskUpdate|mcp__ccd_turn__update_plan|mcp__ccd_turn__wrap_up)$/.test(String(nome || ''))

/** { feitas, total, atual } para a barra, ou null sem plano. */
function resumir(plano) {
  if (!plano || !plano.length) return null
  const validos = plano.filter(x => x.s !== 'apagada')
  if (!validos.length) return null
  const atual = validos.find(x => x.s === 'in_progress')
  return {
    feitas: validos.filter(x => x.s === 'completed').length,
    total: validos.length,
    atual: atual ? atual.t : '',
    itens: validos.slice(0, 12),
  }
}

module.exports = { atualizar, resumir, eDeTarefas }
