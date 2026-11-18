'use strict'
// Voz · interface da barra. A mesma página serve a barra (?vista=barra) e os menus (?vista=menu).
// Fala com o servidor da voz por SSE (/eventos) e POST (/api), e com o anfitrião Windows
// por window.chrome.webview.postMessage (abrir menus, mudar de posição, arrastar, sair).
;(() => {
  const q = new URLSearchParams(location.search)
  const TOKEN = q.get('t') || ''
  const VISTA = q.get('vista') || 'barra'
  const host = window.chrome && window.chrome.webview ? window.chrome.webview : null
  const raiz = document.getElementById('raiz')
  document.body.classList.add('vista-' + VISTA)
  if (host) document.body.classList.add('anfitriao')
  if (q.get('vidro') === '0') document.body.classList.add('sem-vidro')

  let E = null
  let menuAtual = q.get('menu') || null
  let posicaoEnviada = null
  let temaEnviado = null
  let interagindo = false
  let semSessoesDesde = null
  let ultimaAtencao = ''

  // ---------------- utilitários ----------------
  const ICONES = {
    estrela:
      '<path fill="currentColor" d="M12 1.8c.5 0 .9.4 1 .9l.9 5.2 4.3-3.1c.4-.3 1-.3 1.3.1.4.4.4.9.1 1.3l-3.1 4.3 5.2.9c.5.1.9.5.9 1s-.4.9-.9 1l-5.2.9 3.1 4.3c.3.4.3 1-.1 1.3-.4.4-.9.4-1.3.1l-4.3-3.1-.9 5.2c-.1.5-.5.9-1 .9s-.9-.4-1-.9l-.9-5.2-4.3 3.1c-.4.3-1 .3-1.3-.1-.4-.4-.4-.9-.1-1.3l3.1-4.3-5.2-.9c-.5-.1-.9-.5-.9-1s.4-.9.9-1l5.2-.9-3.1-4.3c-.3-.4-.3-1 .1-1.3.4-.4.9-.4 1.3-.1l4.3 3.1.9-5.2c.1-.5.5-.9 1-.9z"/>',
    sliders:
      '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/></g>',
    altifalante:
      '<path fill="currentColor" d="M4 9h3.5L12 5v14l-4.5-4H4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    mudo: '<path fill="currentColor" d="M4 9h3.5L12 5v14l-4.5-4H4z"/><path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    pausa: '<path fill="currentColor" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>',
    tocar: '<path fill="currentColor" d="M7 4.5v15l12-7.5z"/>',
    saltar: '<path fill="currentColor" d="M5 6l8 6-8 6zM13 6l6 6-6 6zM19 6h2v12h-2z"/>',
  }
  const svg = n => `<svg class="i" viewBox="0 0 24 24">${ICONES[n]}</svg>`
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const mil = n => (n >= 1000 ? (n / 1000).toLocaleString('pt-PT', { maximumFractionDigits: n >= 100000 ? 0 : 1 }) + ' mil' : String(n))
  const num = (v, d) => Number(v).toLocaleString('pt-PT', { minimumFractionDigits: d, maximumFractionDigits: d })
  const ESTADOS = { trabalhar: 'a trabalhar', atencao: 'precisa de ti', terminou: 'terminou', parada: 'parada' }
  const POSICOES = [
    ['topo', 'Topo'], ['escondida', 'Escondida no topo'], ['flutuante', 'Flutuante'],
    ['esquerda', 'Esquerda'], ['direita', 'Direita'], ['fundo', 'Fundo (sobre a barra do Windows)'],
  ]
  const MODULOS = {
    sessao: 'Sessão', acao: 'O que está a fazer', legenda: 'Legenda do que diz', onda: 'Onda da voz',
    conversas: 'Conversas ativas', sessoes: 'Pontos das sessões', contexto: 'Contexto e tokens', som: 'Centro de Controlo', tempo: 'Tempo do pedido',
  }
  const ESQUERDA = new Set(['sessao', 'acao', 'legenda'])
  const PREDEF = {
    natural: { velocidade: 0.88, altura: 0, graves: 0, medios: 0, agudos: 0 },
    calma: { velocidade: 0.82, altura: -1, graves: 3, medios: 0, agudos: -3 },
    clara: { velocidade: 0.92, altura: 0, graves: -1, medios: 3, agudos: 2 },
    quente: { velocidade: 0.86, altura: -2, graves: 4, medios: 1, agudos: -4 },
    radio: { velocidade: 0.95, altura: 0, graves: -6, medios: 5, agudos: -2 },
  }

  const enviarHost = msg => host && host.postMessage(msg)
  const api = corpo =>
    fetch(`/api?t=${encodeURIComponent(TOKEN)}`, { method: 'POST', body: JSON.stringify(corpo) })
      .then(r => r.json())
      .catch(() => null)
  const config = valores => {
    if (E) Object.assign(E.cfg, valores)
    return api({ acao: 'config', valores })
  }
  const controlo = c => api({ acao: 'controlo', controlo: c })

  function aplicarTema() {
    const t = (E && E.cfg.barraTema) || 'sistema'
    const escuro = t === 'escuro' || (t === 'sistema' && matchMedia('(prefers-color-scheme: dark)').matches)
    document.body.classList.toggle('claro', !escuro)
    if (escuro !== temaEnviado) {
      temaEnviado = escuro
      enviarHost({ tipo: 'tema', escuro })
    }
  }

  function foco() {
    if (!E || !E.sessoes.length) return null
    return E.sessoes.find(s => s.id === E.foco) || E.sessoes[0]
  }

  function duracao(s) {
    if (!s || !s.inicio) return ''
    const seg = Math.max(0, Math.floor(((s.fim || Date.now()) - s.inicio) / 1000))
    const h = Math.floor(seg / 3600)
    const m = Math.floor((seg % 3600) / 60)
    const ss = String(seg % 60).padStart(2, '0')
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`
  }

  // ---------------- barra ----------------
  /** A lista de módulos da configuração, com os módulos novos acrescentados no fim. */
  function modulosCompletos() {
    const mods = (E.cfg.barraModulos || []).filter(m => m && MODULOS[m.id]).map(m => ({ ...m }))
    // Configuração antiga sem «conversas»: entra no lugar dos pontos das sessões (que ficam escondidos).
    if (!mods.some(m => m.id === 'conversas')) {
      const i = mods.findIndex(m => m.id === 'sessoes')
      if (i >= 0) {
        mods[i].on = false
        mods.splice(i, 0, { id: 'conversas', on: true })
      }
    }
    for (const id of Object.keys(MODULOS)) if (!mods.some(m => m.id === id)) mods.push({ id, on: id === 'conversas' })
    return mods
  }

  const CORES = ['#ff9b73', '#7dd3fc', '#a78bfa', '#4ade80', '#f472b6', '#fbbf24', '#60a5fa', '#34d399']
  const cor = id => CORES[[...String(id)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7) % CORES.length]
  const inicial = t => (String(t || '?').trim().match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase()
  const vistos = new Set()
  function avatar(x, grande) {
    const novo = !vistos.has(x.id)
    vistos.add(x.id)
    return `<span class="av ${x.estado}${grande ? ' g' : ''}${novo ? ' novo' : ''}" style="--c:${cor(x.id)}"><i>${esc(inicial(x.titulo))}</i></span>`
  }

  function modulo(id, s, vertical, flut) {
    switch (id) {
      case 'sessao':
        return s
          ? `<div class="it sessao clic" data-menu="sessao" title="${esc(s.pasta)}"><span>${esc(s.pasta)}</span></div>`
          : `<div class="it fraco clic" data-menu="sessao"><span>Sem sessões</span></div>`
      case 'acao':
        if (!s || !s.acao) return ''
        return `<div class="it ${s.estado === 'atencao' ? 'alerta' : 'fraco'}" title="${esc(s.acao)}">${s.estado === 'atencao' ? '●' : ''}<span class="acao-txt">${esc(s.acao)}</span></div>`
      case 'legenda':
        if (vertical || flut || !E.falando) return ''
        return `<div class="it legenda"><span>«${esc(E.falando.texto)}»</span></div>`
      case 'onda':
        if (E.pausado) return `<div class="it clic" data-acao="pausa" title="Em pausa — clica para retomar">${svg('pausa')}</div>`
        if (!E.falando) return ''
        return `<div class="it clic" data-acao="saltar" title="A falar — clica para saltar a frase"><span class="onda viva"><b></b><b></b><b></b><b></b><b></b></span></div>`
      case 'conversas': {
        if (!E.sessoes.length) return ''
        const titulo = E.sessoes.map(x => `${x.titulo}: ${ESTADOS[x.estado] || x.estado}`).join('\n')
        const ativas = E.sessoes.filter(x => x.estado === 'trabalhar').length
        return `<div class="it clic conversas" data-menu="conversas" title="${esc(titulo)}"><span class="avs">${E.sessoes
          .slice(0, 6)
          .map(x => avatar(x))
          .join('')}</span>${!vertical && ativas ? `<span class="num fraco-n">${ativas}</span>` : ''}</div>`
      }
      case 'sessoes': {
        const outras = E.sessoes.filter(x => !s || x.id !== s.id)
        if (!outras.length) return ''
        const titulo = outras.map(x => `${x.pasta}: ${ESTADOS[x.estado] || x.estado}`).join('\n')
        return `<div class="it clic" data-menu="sessao" title="${esc(titulo)}"><span class="pontos">${outras
          .slice(0, 6)
          .map(x => `<i class="${x.estado}"></i>`)
          .join('')}</span></div>`
      }
      case 'contexto':
        if (!s || !s.uso) return ''
        return `<div class="it contexto" title="${esc(`${s.uso.modelo} · contexto ${mil(s.uso.usados)} de ${mil(s.uso.limite)} tokens · ${mil(s.uso.saidaPedido)} gerados neste pedido`)}"><span class="anel" style="--p:${s.uso.pct}%"></span><span class="num">${s.uso.pct}%</span></div>`
      case 'som':
        return `<div class="it clic" data-menu="som" title="Centro de Controlo da voz">${svg(E.cfg.ligado ? 'sliders' : 'mudo')}</div>`
      case 'tempo': {
        const d = duracao(s)
        return d ? `<div class="it tempo num" title="Tempo deste pedido">${d}</div>` : ''
      }
    }
    return ''
  }

  function renderBarra() {
    const pos = E.cfg.barraPosicao || 'topo'
    const vertical = pos === 'esquerda' || pos === 'direita'
    const flut = pos === 'flutuante'
    const s = foco()
    const mods = modulosCompletos().filter(m => m.on).map(m => m.id)
    const esq = mods.filter(id => ESQUERDA.has(id)).map(id => modulo(id, s, vertical, flut))
    const dir = mods.filter(id => !ESQUERDA.has(id)).map(id => modulo(id, s, vertical, flut))
    const marca = `<div class="it marca clic" data-menu="definicoes" title="Voz para o Claude Code">${svg('estrela')}<b>Claude</b></div>`
    const classe = vertical ? 'barra v' : flut ? 'barra flut' : 'barra'
    raiz.innerHTML = `<div class="${classe}">${marca}${esq.join('')}${flut ? '' : '<div class="espaco"></div>'}${dir.join('')}</div>`

    if (pos !== posicaoEnviada) {
      posicaoEnviada = pos
      enviarHost({ tipo: 'posicao', valor: pos })
    }
    if (flut) {
      const b = raiz.firstElementChild
      enviarHost({ tipo: 'largura', w: Math.ceil(b.scrollWidth) + 4 })
    }
    // Pede atenção (barra escondida desce) quando uma sessão passa a precisar de ti.
    const atencao = E.sessoes.filter(x => x.estado === 'atencao').map(x => x.id).join(',')
    if (atencao && atencao !== ultimaAtencao) enviarHost({ tipo: 'atencao' })
    ultimaAtencao = atencao
    verificarAvisos()
  }

  // ---------------- menus ----------------
  function menuSessao() {
    const s = foco()
    const linhas = ['<div class="menu">', '<div class="tit">Sessões</div>']
    if (!E.sessoes.length) linhas.push('<div class="op inativo"><span class="chk"></span>Nenhuma sessão do Claude Code aberta</div>')
    for (const x of E.sessoes) {
      linhas.push(
        `<div class="op" data-foco="${esc(x.id)}"><span class="chk">${s && x.id === s.id ? '✓' : ''}</span><span class="ponto ${x.estado}"></span><span>${esc(x.pasta)}</span><small>${esc(x.estado === 'trabalhar' && x.acao ? x.acao : ESTADOS[x.estado] || '')}</small></div>`,
      )
    }
    if (E.falando) {
      linhas.push('<hr><div class="tit">A dizer agora</div>', `<div class="leg">«${esc(E.falando.texto)}»</div>`)
    }
    if (s && s.uso) {
      linhas.push(
        '<hr>',
        `<div class="op inativo"><span class="chk"></span><span>${esc(s.uso.modelo)} · ${mil(s.uso.saidaPedido)} tokens</span><small>contexto ${s.uso.pct}%</small></div>`,
      )
    }
    linhas.push(
      '<hr>',
      `<div class="op" data-acao="pausa"><span class="chk"></span>${E.pausado ? 'Retomar a voz' : 'Pausar a voz'}</div>`,
      '<div class="op" data-acao="saltar"><span class="chk"></span>Saltar a frase</div>',
      '<div class="op" data-acao="parar"><span class="chk"></span>Calar tudo agora</div>',
      '<hr>',
      '<div class="op" data-ir="som"><span class="chk"></span>Som…</div>',
      '<div class="op" data-ir="definicoes"><span class="chk"></span>Definições da Voz…</div>',
      '</div>',
    )
    return linhas.join('')
  }

  function deslizador(chave, rotulo, min, max, passo, fmt, grosso) {
    const v = Number(E.cfg[chave])
    return `<div class="rot"><span>${rotulo}</span><span class="num" data-valor="${chave}">${fmt(v)}</span></div><input type="range" ${grosso ? 'class="grosso"' : ''} data-chave="${chave}" min="${min}" max="${max}" step="${passo}" value="${v}">`
  }

  function menuSom() {
    const c = E.cfg
    const pre = Object.keys(PREDEF).find(k => Object.entries(PREDEF[k]).every(([kk, vv]) => Number(c[kk]) === vv))
    const sinal = v => (v > 0 ? '+' : '') + num(v, 0)
    const interruptor = (chave, rot) =>
      `<div class="lig" data-alternar="${chave}"><span>${rot}</span><span class="interruptor ${c[chave] ? 'on' : ''}"></span></div>`
    return `<div class="cc">
      <div class="bloco"><div class="bt"><button class="redondo ${c.ligado ? 'on' : ''}" data-alternar="ligado">${svg(c.ligado ? 'altifalante' : 'mudo')}</button><div>Voz<small>${c.ligado ? 'Ligada' : 'Desligada'}</small></div></div></div>
      <div class="bloco"><div class="bt"><button class="redondo" data-acao="pausa" title="${E.pausado ? 'Retomar' : 'Pausar'}">${svg(E.pausado ? 'tocar' : 'pausa')}</button><button class="redondo" data-acao="saltar" title="Saltar a frase">${svg('saltar')}</button><div>Fala<small>${E.pausado ? 'Em pausa' : E.falando ? 'A falar' : 'Em silêncio'}</small></div></div></div>
      <button class="bloco l2 testar" data-acao="testar">${svg('tocar')}<span>Testar a voz<small>«Olá, eu sou o Claude Code»</small></span></button>
      <div class="bloco l2"><h6>Volume</h6>${deslizador('volume', '', 0, 2, 0.05, v => Math.round(v * 100) + '%', true)}</div>
      <div class="bloco l2">${deslizador('velocidade', 'Velocidade', 0.6, 1.4, 0.02, v => num(v, 2))}${deslizador('altura', 'Altura', -6, 6, 1, sinal)}</div>
      <div class="bloco l2"><h6>Equalizador</h6><div class="eq">
        ${['graves', 'medios', 'agudos']
          .map(
            (k, i) =>
              `<label><input type="range" data-chave="${k}" min="-12" max="12" step="1" value="${Number(c[k])}"><span>${['Graves', 'Médios', 'Agudos'][i]} <span class="num" data-valor="${k}">${sinal(Number(c[k]))}</span></span></label>`,
          )
          .join('')}
      </div></div>
      <div class="bloco l2"><h6>Predefinição</h6><div class="pre">${Object.keys(PREDEF)
        .map(k => `<button class="chip ${k === pre ? 'sel' : ''}" data-predef="${k}">${k === 'radio' ? 'Rádio' : k[0].toUpperCase() + k.slice(1)}</button>`)
        .join('')}</div></div>
      <div class="bloco l2">${interruptor('anunciarAcoes', 'Diz o que está a fazer')}${interruptor('lerRespostas', 'Lê as respostas')}${interruptor('soSessaoAtiva', 'Só a sessão ativa fala tudo')}</div>
    </div>`
  }

  function menuDefinicoes() {
    const c = E.cfg
    const chk = b => (b ? '✓' : '')
    return `<div class="menu">
      <div class="tit">Posição da barra</div>
      ${POSICOES.map(([v, r]) => `<div class="op" data-posicao="${v}"><span class="chk">${chk(c.barraPosicao === v)}</span>${r}</div>`).join('')}
      <hr>
      <div class="op" data-ir="modulos"><span class="chk"></span>Módulos visíveis…<small>›</small></div>
      <hr>
      <div class="tit">Conversas</div>
      <div class="op" data-alternar="barraAvisos"><span class="chk">${chk(c.barraAvisos !== false)}</span>Avisar quando uma conversa termina</div>
      <div class="op" data-alternar="respostasPelaBarra"><span class="chk">${chk(c.respostasPelaBarra !== false)}</span>Responder às conversas pela barra</div>
      <hr>
      <div class="tit">Arranque</div>
      <div class="op" data-arranque="windows"><span class="chk">${chk(c.barraArranque === 'windows')}</span>Arrancar com o Windows</div>
      <div class="op" data-arranque="claude"><span class="chk">${chk(c.barraArranque === 'claude')}</span>Só com o Claude Code aberto</div>
      <div class="op" data-arranque="mao"><span class="chk">${chk(c.barraArranque === 'mao')}</span>Só à mão</div>
      <hr>
      <div class="tit">Aspeto</div>
      <div class="op" data-tema="sistema"><span class="chk">${chk(c.barraTema === 'sistema')}</span>Seguir o tema do Windows</div>
      <div class="op" data-tema="escuro"><span class="chk">${chk(c.barraTema === 'escuro')}</span>Escuro</div>
      <div class="op" data-tema="claro"><span class="chk">${chk(c.barraTema === 'claro')}</span>Claro</div>
      <hr>
      <div class="op" data-acao="testar"><span class="chk"></span>Testar a voz</div>
      <div class="op" data-sair="1"><span class="chk"></span>Sair da barra</div>
    </div>`
  }

  function menuModulos() {
    const mods = modulosCompletos()
    return `<div class="menu mods">
      <div class="tit">Módulos visíveis — arrasta para ordenar</div>
      ${mods
        .map(
          (m, i) =>
            `<div class="op" draggable="true" data-mod="${i}"><span class="chk">⋮⋮</span><span>${MODULOS[m.id]}</span><small><span class="interruptor ${m.on ? 'on' : ''}"></span></small></div>`,
        )
        .join('')}
      <hr><div class="op" data-ir="definicoes"><span class="chk">‹</span>Voltar</div>
    </div>`
  }

  // ---------------- conversas ----------------
  /** Texto curto e limpo (sem markdown) para pré-visualizar uma mensagem. */
  function resumo(t, max) {
    const s = String(t || '')
      .replace(/```[\s\S]*?```/g, ' [código] ')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^\s*(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
      .replace(/^\s*\|.*\|\s*$/gm, '')
      .replace(/\*\*|__|~~/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s
  }

  const rascunhos = {}
  const envios = {} // sessão -> { texto, t } do último envio (para mostrar «enviado»)

  function estadoEnvio(x) {
    const e = envios[x.id]
    if (e && Date.now() - e.t < 15000) {
      return `<div class="envio ok">${e.entregue ? '✓ Enviado — o Claude vai responder.' : '⏳ Em fila — chega quando a conversa acabar o passo atual.'}</div>`
    }
    if (x.pendentes) return `<div class="envio">⏳ ${x.pendentes} resposta${x.pendentes > 1 ? 's' : ''} em fila</div>`
    return ''
  }

  function cartao(x, aviso) {
    const linhaEstado =
      x.estado === 'trabalhar'
        ? `<span class="aescrever"><b></b><b></b><b></b></span>${esc(x.acao || 'A trabalhar')}`
        : x.estado === 'atencao'
          ? `<span class="alerta">● ${esc(x.acao || 'Precisa de ti')}</span>`
          : esc(ESTADOS[x.estado] || '')
    const msg = x.resposta ? resumo(x.resposta, aviso ? 260 : 340) : ''
    const podeResponder = E.cfg.respostasPelaBarra !== false
    return `<div class="cartao ${x.estado}" data-cartao="${esc(x.id)}">
      <div class="cab">${avatar(x, true)}<div class="tt"><b>${esc(x.titulo)}</b><small>${linhaEstado}${x.inicio ? ` · <span class="num">${duracao(x)}</span>` : ''}</small></div>${aviso ? '<button class="x" data-fechar="1" title="Fechar">✕</button>' : ''}</div>
      ${msg ? `<div class="ultima">${esc(msg)}</div>` : x.estado === 'trabalhar' ? '' : '<div class="ultima vazia">Ainda sem resposta nesta sessão.</div>'}
      ${x.pedido && !aviso ? `<div class="eu"><span>Tu:</span> ${esc(resumo(x.pedido, 140))}</div>` : ''}
      ${
        podeResponder
          ? `<form class="resp" data-sessao="${esc(x.id)}"><textarea rows="1" placeholder="Responder a esta conversa…" data-sessao="${esc(x.id)}"></textarea><button type="submit" title="Enviar (Enter)">↑</button></form>${estadoEnvio(x)}`
          : ''
      }
    </div>`
  }

  function menuConversas() {
    if (!E.sessoes.length) return '<div class="painel"><div class="tit">Conversas</div><div class="vazio">Nenhuma conversa do Claude Code aberta.</div></div>'
    const ordem = { atencao: 0, trabalhar: 1, terminou: 2, parada: 3 }
    const lista = [...E.sessoes].sort((a, b) => (ordem[a.estado] ?? 9) - (ordem[b.estado] ?? 9))
    return `<div class="painel"><div class="tit">Conversas <span class="num">${E.sessoes.length}</span></div>${lista.map(x => cartao(x, false)).join('')}</div>`
  }

  function menuAviso(id) {
    const x = E.sessoes.find(s => s.id === id)
    if (!x) return '<div class="painel aviso"></div>'
    return `<div class="painel aviso">${cartao(x, true)}</div>`
  }

  function htmlMenu(m) {
    if (m && m.startsWith('aviso:')) return menuAviso(m.slice(6))
    return m === 'som'
      ? menuSom()
      : m === 'definicoes'
        ? menuDefinicoes()
        : m === 'modulos'
          ? menuModulos()
          : m === 'conversas'
            ? menuConversas()
            : menuSessao()
  }

  let tamanhoEnviado = ''
  function renderMenu() {
    if (!menuAtual) {
      raiz.innerHTML = ''
      return
    }
    // Guarda o que estás a escrever (e onde está o cursor) antes de redesenhar.
    const ativo = document.activeElement
    const focoSessao = ativo && ativo.matches && ativo.matches('textarea[data-sessao]') ? ativo.dataset.sessao : null
    const cursor = focoSessao ? [ativo.selectionStart, ativo.selectionEnd] : null
    raiz.innerHTML = htmlMenu(menuAtual)
    restaurarRascunhos(raiz, focoSessao, cursor)
    const el = raiz.firstElementChild
    const t = `${Math.ceil(el.offsetWidth)}x${Math.ceil(el.offsetHeight)}`
    if (t !== tamanhoEnviado) {
      tamanhoEnviado = t
      enviarHost({ tipo: 'tamanho', w: Math.ceil(el.offsetWidth), h: Math.ceil(el.offsetHeight) })
    }
  }

  function restaurarRascunhos(caixa, focoSessao, cursor) {
    for (const ta of caixa.querySelectorAll('textarea[data-sessao]')) {
      const r = rascunhos[ta.dataset.sessao]
      if (r) {
        ta.value = r
        ajustarAltura(ta)
      }
      if (ta.dataset.sessao === focoSessao) {
        ta.focus()
        if (cursor) ta.setSelectionRange(cursor[0], cursor[1])
      }
    }
  }

  function ajustarAltura(ta) {
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 110) + 'px'
  }

  // Pré-visualização sem anfitrião: o menu abre dentro da própria página.
  let menuEmLinha = null
  function renderMenuEmLinha() {
    let caixa = document.getElementById('menu-em-linha')
    if (!menuEmLinha) {
      if (caixa) caixa.remove()
      return
    }
    if (!caixa) {
      caixa = document.createElement('div')
      caixa.id = 'menu-em-linha'
      document.body.appendChild(caixa)
    }
    const ativo = document.activeElement
    const focoSessao = ativo && ativo.matches && ativo.matches('textarea[data-sessao]') ? ativo.dataset.sessao : null
    const cursor = focoSessao ? [ativo.selectionStart, ativo.selectionEnd] : null
    caixa.innerHTML = htmlMenu(menuEmLinha.menu)
    restaurarRascunhos(caixa, focoSessao, cursor)
    const el = caixa.firstElementChild
    if (menuEmLinha.menu.startsWith('aviso:')) {
      el.style.left = 'auto'
      el.style.right = '8px'
    } else if (menuEmLinha.menu !== 'som') el.style.left = Math.max(4, Math.min(menuEmLinha.x, innerWidth - el.offsetWidth - 8)) + 'px'
  }

  // ---------------- avisos ----------------
  const estadoAnterior = {}
  let avisoAtual = null
  let avisoTemporizador = null

  /** Quando uma conversa acaba (ou passa a precisar de ti), mostra um aviso no canto. */
  function verificarAvisos() {
    for (const x of E.sessoes) {
      const antes = estadoAnterior[x.id]
      estadoAnterior[x.id] = x.estado
      if (!antes || antes === x.estado || E.cfg.barraAvisos === false) continue
      if ((antes === 'trabalhar' && x.estado === 'terminou') || x.estado === 'atencao') abrirAviso(x.id)
    }
  }

  function abrirAviso(id) {
    avisoAtual = id
    if (host) {
      // Âncora: canto direito da barra (o anfitrião encosta o aviso à direita, sem roubar o foco).
      enviarHost({ tipo: 'abrir', menu: 'aviso:' + id, x: innerWidth - 4, y: 0, w: 0, h: innerHeight, ativar: false })
    } else {
      menuEmLinha = { menu: 'aviso:' + id, x: innerWidth }
      renderMenuEmLinha()
      armarFechoDoAviso()
    }
  }

  /** No aviso (janela do menu): fecha sozinho ao fim de 12 s, se não estiveres a mexer nele. */
  function armarFechoDoAviso() {
    clearTimeout(avisoTemporizador)
    if (!(menuAtual || '').startsWith('aviso:') && !(menuEmLinha && menuEmLinha.menu.startsWith('aviso:'))) return
    avisoTemporizador = setTimeout(() => {
      const ta = document.querySelector('.aviso textarea')
      const ocupado = (ta && (ta.value || document.activeElement === ta)) || document.querySelector('.aviso:hover')
      if (ocupado) return armarFechoDoAviso()
      fecharMenu()
    }, 12000)
  }

  // ---------------- responder ----------------
  async function enviarResposta(form) {
    const id = form.dataset.sessao
    const ta = form.querySelector('textarea')
    const texto = ta.value.trim()
    if (!texto) return
    ta.disabled = true
    const r = await api({ acao: 'responder', sessao: id, texto })
    ta.disabled = false
    if (r && r.ok) {
      envios[id] = { entregue: r.entregue, t: Date.now() }
      delete rascunhos[id]
      ta.value = ''
      ajustarAltura(ta)
      if (VISTA === 'menu') renderMenu()
      else renderMenuEmLinha()
      if ((menuAtual || '').startsWith('aviso:') || (menuEmLinha && menuEmLinha.menu.startsWith('aviso:'))) setTimeout(fecharMenu, 1800)
    } else {
      const aviso = form.parentElement.querySelector('.envio') || form.insertAdjacentElement('afterend', document.createElement('div'))
      aviso.className = 'envio erro'
      aviso.textContent = 'Não foi possível enviar.'
    }
  }

  function render() {
    if (!E) return
    aplicarTema()
    if (VISTA === 'menu') {
      if (!interagindo) renderMenu()
      return
    }
    renderBarra()
    if (!host && !interagindo) renderMenuEmLinha()
    // «Só com o Claude Code»: fecha-se sozinha 10 minutos depois de não haver sessões.
    if (E.cfg.barraArranque === 'claude' && host) {
      if (E.sessoes.length) semSessoesDesde = null
      else if (!semSessoesDesde) semSessoesDesde = Date.now()
      else if (Date.now() - semSessoesDesde > 10 * 60 * 1000) enviarHost({ tipo: 'sair' })
    }
  }

  function abrirMenu(menu, el) {
    const r = el.getBoundingClientRect()
    if (host) {
      if (VISTA === 'menu') {
        menuAtual = menu
        tamanhoEnviado = ''
        renderMenu()
      } else {
        el.classList.add('aberto')
        enviarHost({ tipo: 'abrir', menu, x: r.left, y: r.top, w: r.width, h: r.height })
      }
    } else {
      menuEmLinha = { menu, x: r.left }
      renderMenuEmLinha()
    }
  }

  // ---------------- eventos da página ----------------
  document.addEventListener('submit', ev => {
    const form = ev.target.closest('form.resp')
    if (!form) return
    ev.preventDefault()
    enviarResposta(form)
  })
  document.addEventListener('keydown', ev => {
    const ta = ev.target.closest && ev.target.closest('textarea[data-sessao]')
    if (ta && ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault()
      enviarResposta(ta.closest('form'))
    } else if (ev.key === 'Escape') fecharMenu()
  })
  document.addEventListener('input', ev => {
    const ta = ev.target.closest && ev.target.closest('textarea[data-sessao]')
    if (!ta) return
    rascunhos[ta.dataset.sessao] = ta.value
    ajustarAltura(ta)
    armarFechoDoAviso()
  })

  document.addEventListener('click', ev => {
    if (ev.target.closest('[data-fechar]')) return fecharMenu()
    const t = ev.target.closest('[data-menu],[data-acao],[data-foco],[data-ir],[data-posicao],[data-arranque],[data-tema],[data-predef],[data-alternar],[data-sair],[data-mod]')
    if (!t) {
      if (!host && menuEmLinha && !ev.target.closest('#menu-em-linha')) {
        menuEmLinha = null
        renderMenuEmLinha()
      }
      return
    }
    const d = t.dataset
    if (d.menu) return abrirMenu(d.menu, t)
    if (d.ir) {
      if (host && VISTA === 'menu') return abrirMenu(d.ir, t)
      menuEmLinha = { menu: d.ir, x: menuEmLinha ? menuEmLinha.x : 8 }
      return renderMenuEmLinha()
    }
    if (d.acao) {
      if (d.acao === 'testar') api({ acao: 'controlo', controlo: 'testar', texto: 'Olá, eu sou o Claude Code.' })
      else controlo(d.acao)
      return
    }
    if (d.foco) return api({ acao: 'foco', sessao: d.foco })
    if (d.posicao) return config({ barraPosicao: d.posicao }).then(fecharMenu)
    if (d.arranque) return config({ barraArranque: d.arranque })
    if (d.tema) return config({ barraTema: d.tema })
    if (d.predef) return config(PREDEF[d.predef])
    if (d.alternar) return config({ [d.alternar]: !E.cfg[d.alternar] })
    if (d.sair) return enviarHost({ tipo: 'sair' })
    if (d.mod !== undefined) {
      const mods = modulosCompletos()
      mods[Number(d.mod)].on = !mods[Number(d.mod)].on
      return config({ barraModulos: mods }).then(() => render())
    }
  })

  function fecharMenu() {
    if (host && VISTA === 'menu') enviarHost({ tipo: 'fechar-menu' })
    if (!host) {
      menuEmLinha = null
      renderMenuEmLinha()
    }
  }

  // Deslizadores: atualiza o número ao arrastar e grava ao largar.
  document.addEventListener('pointerdown', ev => {
    if (ev.target.matches('input[type=range]')) interagindo = true
  })
  document.addEventListener('input', ev => {
    const el = ev.target
    if (!el.dataset.chave) return
    const v = Number(el.value)
    const rot = document.querySelector(`[data-valor="${el.dataset.chave}"]`)
    if (rot) {
      const k = el.dataset.chave
      rot.textContent =
        k === 'volume' ? Math.round(v * 100) + '%' : k === 'velocidade' ? num(v, 2) : (v > 0 ? '+' : '') + num(v, 0)
    }
  })
  document.addEventListener('change', ev => {
    const el = ev.target
    if (!el.dataset.chave) return
    config({ [el.dataset.chave]: Number(el.value) })
    setTimeout(() => (interagindo = false), 400)
  })
  document.addEventListener('pointerup', () => setTimeout(() => (interagindo = false), 400))

  // Ordenar módulos arrastando.
  let deIndice = null
  document.addEventListener('dragstart', ev => {
    const op = ev.target.closest('[data-mod]')
    if (!op) return
    deIndice = Number(op.dataset.mod)
    op.classList.add('arrastar')
    interagindo = true
  })
  document.addEventListener('dragover', ev => {
    if (deIndice !== null && ev.target.closest('[data-mod]')) ev.preventDefault()
  })
  document.addEventListener('drop', ev => {
    const op = ev.target.closest('[data-mod]')
    if (!op || deIndice === null) return
    ev.preventDefault()
    const para = Number(op.dataset.mod)
    const mods = modulosCompletos()
    const [m] = mods.splice(deIndice, 1)
    mods.splice(para, 0, m)
    deIndice = null
    interagindo = false
    config({ barraModulos: mods }).then(() => render())
  })
  document.addEventListener('dragend', () => {
    deIndice = null
    interagindo = false
  })

  // Flutuante: arrastar a cápsula pelo fundo.
  document.addEventListener('mousedown', ev => {
    if (VISTA !== 'barra' || !E || E.cfg.barraPosicao !== 'flutuante' || ev.button !== 0) return
    if (ev.target.closest('.clic')) return
    enviarHost({ tipo: 'arrastar' })
  })

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render)

  if (host) {
    host.addEventListener('message', ev => {
      const d = ev.data || {}
      if (d.tipo === 'menu') {
        menuAtual = d.menu
        tamanhoEnviado = ''
        interagindo = false
        renderMenu()
        armarFechoDoAviso()
        if (d.menu === 'conversas') {
          const ta = raiz.querySelector('.cartao.atencao textarea, .cartao.terminou textarea')
          if (ta) ta.focus()
        }
      } else if (d.tipo === 'menu-fechado') {
        document.querySelectorAll('.it.aberto').forEach(x => x.classList.remove('aberto'))
      }
    })
  }

  // ---------------- ligação ao servidor ----------------
  let falhasDesde = null
  function ligar() {
    const es = new EventSource(`/eventos?t=${encodeURIComponent(TOKEN)}`)
    es.addEventListener('estado', ev => {
      falhasDesde = null
      E = JSON.parse(ev.data)
      render()
    })
    es.addEventListener('sair', () => enviarHost({ tipo: 'sair' }))
    es.onerror = () => {
      if (!falhasDesde) falhasDesde = Date.now()
      else if (Date.now() - falhasDesde > 5000) {
        enviarHost({ tipo: 'servidor-em-baixo' })
        falhasDesde = Date.now()
      }
    }
  }
  ligar()
  setInterval(() => {
    if (!E || VISTA !== 'barra') return
    const el = raiz.querySelector('.tempo')
    if (el) el.textContent = duracao(foco())
  }, 1000)
  enviarHost({ tipo: 'pronta', vista: VISTA })
})()
