'use strict'
// Voz · interface da barra. A mesma página serve a barra (?vista=barra) e os menus (?vista=menu).
// Fala com o servidor da voz por SSE (/eventos) e POST (/api), e com o anfitrião Windows
// por window.chrome.webview.postMessage (abrir menus, mudar de posição, arrastar, sair).
;(() => {
  const q = new URLSearchParams(location.search)
  const TOKEN = q.get('t') || ''
  const VISTA = q.get('vista') || 'barra'
  // ?previa=1: comporta-se como pré-visualização mesmo dentro de um WebView2 (para capturas).
  const host = !q.get('previa') && window.chrome && window.chrome.webview ? window.chrome.webview : null
  const raiz = document.getElementById('raiz')
  document.body.classList.add('vista-' + VISTA)
  if (host) document.body.classList.add('anfitriao')
  if (q.get('vidro') === '0') document.body.classList.add('sem-vidro')

  let E = null
  let menuAtual = q.get('menu') || null
  let posicaoEnviada = null
  let ecraEnviado = null
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
    sol: '<circle cx="12" cy="12" r="4.2" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></g>',
    lua: '<path fill="currentColor" d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.6 8.6 0 1 0 11.1 11.1z"/>',
    auto: '<circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="2"/><path fill="currentColor" d="M12 3.6a8.4 8.4 0 0 1 0 16.8z"/>',
    sino: '<path fill="currentColor" d="M12 3a6 6 0 0 0-6 6v3.6L4.4 15.4c-.4.7.1 1.6.9 1.6h13.4c.8 0 1.3-.9.9-1.6L18 12.6V9a6 6 0 0 0-6-6zM9.5 18.5a2.5 2.5 0 0 0 5 0z"/>',
    semSino: '<path fill="currentColor" d="M12 3a6 6 0 0 0-6 6v3.6L4.4 15.4c-.4.7.1 1.6.9 1.6h13.4c.8 0 1.3-.9.9-1.6L18 12.6V9a6 6 0 0 0-6-6zM9.5 18.5a2.5 2.5 0 0 0 5 0z" opacity=".35"/><path d="M4 3.5l16 17" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    lua2: '<path fill="currentColor" d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    micro: '<rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    escudo: '<path fill="currentColor" d="M12 2.5l7.5 3v6c0 4.6-3.2 8.7-7.5 10-4.3-1.3-7.5-5.4-7.5-10v-6z"/>',
    grafico: '<path fill="currentColor" d="M4 20h16v-1.6H4zM5.5 17h2.6V10H5.5zm5.2 0h2.6V5h-2.6zm5.2 0h2.6v-5h-2.6z"/>',
    balao: '<path fill="currentColor" d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5z"/>',
    raio: '<path fill="currentColor" d="M13.5 2L5 13.5h6L9.8 22 19 10h-6.2z"/>',
    globo: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.5 12h17M12 3.5c2.6 2.6 2.6 14.4 0 17M12 3.5c-2.6 2.6-2.6 14.4 0 17" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  }
  // Temas: [valor, ícone, nome na língua atual]
  const temas = () => [['sistema', 'auto'], ['claro', 'sol'], ['escuro', 'lua']].map(([v, ic]) => [v, ic, t('tema.' + v)])
  const svg = n => `<svg class="i" viewBox="0 0 24 24">${ICONES[n]}</svg>`
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const mil = n =>
    n >= 1e6
      ? (n / 1e6).toLocaleString(localeAtual(), { maximumFractionDigits: n >= 1e8 ? 0 : 1 }) + ' M'
      : n >= 1000
        ? (n / 1000).toLocaleString(localeAtual(), { maximumFractionDigits: n >= 100000 ? 0 : 1 }) + (IDIOMA === 'en' ? 'k' : ' mil')
        : String(n)
  const num = (v, d) => Number(v).toLocaleString(localeAtual(), { minimumFractionDigits: d, maximumFractionDigits: d })
  // ESTADOS[x] devolve o nome do estado na língua atual.
  const ESTADOS = new Proxy({}, { get: (_, k) => t('estado.' + String(k)) })
  const posicoes = () => ['topo', 'escondida', 'flutuante', 'esquerda', 'direita', 'fundo'].map(v => [v, t('pos.' + v)])
  // Módulos: id -> chave do nome (o nome vem de t()).
  const MODULOS = {
    ilha: 'mod.ilha',
    sessao: 'mod.sessao', acao: 'mod.acao', legenda: 'mod.legenda', onda: 'mod.onda', conversas: 'mod.conversas', sessoes: 'mod.sessoes',
    contexto: 'mod.contexto', microfone: 'mod.microfone', silencio: 'mod.silencio', tema: 'mod.tema', som: 'mod.som', tempo: 'mod.tempo',
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
    // A ilha dinâmica (v1.2) entra ligada e substitui a ação, a legenda e a onda soltas.
    if (!mods.some(m => m.id === 'ilha')) {
      for (const m of mods) if (m.id === 'acao' || m.id === 'legenda' || m.id === 'onda') m.on = false
      mods.unshift({ id: 'ilha', on: true })
    }
    // Módulos novos entram logo antes do Centro de Controlo.
    for (const id of ['microfone', 'silencio', 'tema']) {
      if (!mods.some(m => m.id === id)) {
        const i = mods.findIndex(m => m.id === 'som')
        mods.splice(i >= 0 ? i : mods.length, 0, { id, on: true })
      }
    }
    for (const id of Object.keys(MODULOS)) if (!mods.some(m => m.id === id)) mods.push({ id, on: id === 'conversas' })
    return mods
  }

  const CORES = ['#ff9b73', '#7dd3fc', '#a78bfa', '#4ade80', '#f472b6', '#fbbf24', '#60a5fa', '#34d399']
  const cor = id => CORES[[...String(id)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7) % CORES.length]
  const inicial = t => (String(t || '?').trim().match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase()
  const vistos = new Set()
  /** Avatar com anel: a cor é da conversa e o anel enche com o contexto usado. */
  function avatar(x, grande) {
    const novo = !vistos.has(x.id)
    vistos.add(x.id)
    const p = x.uso && Number.isFinite(x.uso.pct) ? Math.max(4, Math.min(100, x.uso.pct)) : 100
    const clique = grande ? '' : ` data-conv="${esc(x.id)}" title="${esc(x.titulo + ' · ' + (ESTADOS[x.estado] || x.estado))}"`
    return `<span class="av ${x.estado}${grande ? ' g' : ''}${novo ? ' novo' : ''}" style="--c:${cor(x.id)};--p:${p}%"${clique}><i>${esc(inicial(x.titulo))}</i></span>`
  }

  // ---------------- ilha dinâmica ----------------
  // Cápsula de vidro no centro da barra: repouso → a trabalhar → a falar → precisa de ti → terminou → ditado.
  let ilhaEl = null
  let ilhaChave = ''
  let fimRecente = null // { id, ate }
  const estadoIlhaAnt = {}
  const posHorizontal = () => ['topo', 'escondida', 'fundo', 'flutuante'].includes((E && E.cfg.barraPosicao) || 'topo')
  const ilhaLigada = () => !!E && posHorizontal() && modulosCompletos().some(m => m.id === 'ilha' && m.on)

  /** Deteta conversas que acabaram agora (para o «terminou» na ilha durante 5 s). */
  function detetarFins() {
    for (const x of E.sessoes) {
      const antes = estadoIlhaAnt[x.id]
      estadoIlhaAnt[x.id] = x.estado
      if (antes === 'trabalhar' && x.estado === 'terminou') {
        fimRecente = { id: x.id, ate: Date.now() + 5000 }
        setTimeout(render, 5100)
      }
    }
  }

  const ondaIlha = () =>
    '<span class="i-onda">' + Array.from({ length: 12 }, (_, i) => `<b style="animation-delay:${-((i * 137) % 900)}ms;animation-duration:${700 + ((i * 53) % 400)}ms"></b>`).join('') + '</span>'
  const chip = x => `<span class="i-chip" style="--c:${cor(x.id)}"><i></i><span>${esc(x.titulo)}</span></span>`

  function estadoIlha() {
    const S = E.sessoes
    if (E.aOuvir) {
      return { k: 'dit', cls: 'dit', clique: 'dit', html: `<span class="i-rec">${svg('micro')}</span><span>${t('ilha.aOuvir')}</span><span class="i-kbd">Ctrl Shift Alt V</span>` }
    }
    const p = (E.permissoes || [])[0]
    if (p) {
      const s = S.find(x => x.id === p.sessao)
      return { k: 'perm:' + p.id, cls: 'perm', clique: 'perm:' + p.id, html: `<span class="i-esc">${svg('escudo')}</span><b>${esc(t('ilha.pede', { nome: s ? s.titulo : t('perm.conversa') }))}</b><span class="i-t2">${esc(p.ferramenta)}</span>` }
    }
    const at = S.find(x => x.estado === 'atencao')
    if (at) return { k: 'at:' + at.id, cls: 'perm', clique: 'aviso:' + at.id, html: `<span class="i-esc">${svg('sino')}</span><b>${esc(t('ilha.precisa', { nome: at.titulo }))}</b>` }
    if (E.falando) {
      const s = S.find(x => x.id === E.falando.sessao)
      return { k: 'fala', cls: 'fala', clique: 'saltar', titulo: t('ilha.saltar'), html: `${s ? chip(s) : ''}<span class="i-leg"><span>${esc(E.falando.texto)}</span></span>${ondaIlha()}` }
    }
    if (fimRecente && fimRecente.ate > Date.now()) {
      const s = S.find(x => x.id === fimRecente.id)
      if (s) return { k: 'fim:' + s.id, cls: 'fim', clique: 'conv:' + s.id, html: `<span class="i-ok"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><b>${esc(t('ilha.terminou', { nome: s.titulo }))}</b>${s.inicio ? `<span class="i-t2 num">· ${duracao(s)}</span>` : ''}` }
    }
    const s = foco()
    if (s && s.estado === 'trabalhar' && s.acao) {
      return { k: 'acao', cls: 'acao', clique: 'conv:' + s.id, html: `${chip(s)}<span class="i-leg"><span>${esc(s.acao)}</span></span><span class="aescrever"><b></b><b></b><b></b></span>` }
    }
    return {
      k: 'repouso',
      cls: 'repouso',
      clique: S.length ? 'conversas' : 'definicoes',
      html: `${svg('estrela')}${S.length ? `<span class="i-pontos">${S.slice(0, 6).map(x => `<i class="${x.estado}" style="--c:${cor(x.id)}"></i>`).join('')}</span>` : ''}`,
    }
  }

  const ILHA_FLUTUANTE = 260 // px: lugar fixo da ilha na barra flutuante
  // A ilha vive fora da barra (que é redesenhada a cada atualização) para as animações não recomeçarem.
  function desenharIlha(lugar, flut) {
    const st = estadoIlha()
    if (!ilhaEl) {
      ilhaEl = document.createElement('div')
      ilhaEl.innerHTML = '<div class="ilha-c"></div>'
      document.body.appendChild(ilhaEl)
    }
    ilhaEl.hidden = false
    ilhaEl.className = `ilha clic ${st.cls}`
    ilhaEl.dataset.ilha = st.clique
    ilhaEl.title = st.titulo || ''
    let c = ilhaEl.firstElementChild
    if (st.k !== ilhaChave) {
      // Estado novo: o conteúdo entra depois de a forma mudar.
      const novo = document.createElement('div')
      novo.className = 'ilha-c entra'
      novo.addEventListener('animationend', ev => ev.target === novo && novo.classList.remove('entra'))
      ilhaEl.replaceChild(novo, c)
      c = novo
      ilhaChave = st.k
    }
    if (c._html !== st.html) {
      c.innerHTML = st.html
      c._html = st.html
    }
    // Largura: a do conteúdo, até um máximo; acima disso a legenda corre.
    c.classList.remove('aperta')
    // Na flutuante, a janela tem a largura da barra: o máximo não pode depender de innerWidth (a ilha
    // alargava a janela, que alargava a ilha…) e o lugar é fixo, para a barra não mudar de tamanho.
    const max = flut ? ILHA_FLUTUANTE : Math.min(480, Math.max(220, innerWidth * 0.38))
    const natural = Math.ceil(c.scrollWidth) + 2 // + a borda da cápsula
    if (natural > max) c.classList.add('aperta')
    const largura = Math.min(max, natural)
    ilhaEl.style.width = largura + 'px'
    // Posição: centrada na barra; na flutuante, no centro do lugar reservado entre os módulos.
    const barra = raiz.firstElementChild.getBoundingClientRect()
    ilhaEl.style.top = Math.round(barra.top + barra.height / 2) + 'px'
    if (flut) {
      lugar.style.width = ILHA_FLUTUANTE + 'px'
      ilhaEl.style.left = Math.round(lugar.getBoundingClientRect().left + ILHA_FLUTUANTE / 2) + 'px'
    } else ilhaEl.style.left = Math.round(barra.left + barra.width / 2) + 'px'
    const leg = c.querySelector('.i-leg')
    if (leg) {
      const desl = leg.firstElementChild.scrollWidth - leg.clientWidth
      leg.classList.toggle('corre', desl > 4)
      leg.style.setProperty('--desl', -Math.max(0, desl) + 'px')
      leg.style.setProperty('--dur', Math.max(4, desl / 28) + 's')
    }
  }

  function modulo(id, s, vertical, flut) {
    switch (id) {
      case 'sessao':
        return s
          ? `<div class="it sessao clic" data-menu="sessao" title="${esc(s.pasta)}"><span>${esc(s.pasta)}</span></div>`
          : `<div class="it fraco clic" data-menu="sessao"><span>${t('barra.semSessoes')}</span></div>`
      case 'acao':
        if (!s || !s.acao) return ''
        return `<div class="it ${s.estado === 'atencao' ? 'alerta' : 'fraco'}" title="${esc(s.acao)}">${s.estado === 'atencao' ? '●' : ''}<span class="acao-txt">${esc(s.acao)}</span></div>`
      case 'legenda':
        if (vertical || flut || !E.falando) return ''
        return `<div class="it legenda"><span>«${esc(E.falando.texto)}»</span></div>`
      case 'onda':
        if (E.pausado) return `<div class="it clic" data-acao="pausa" title="${t('barra.pausa')}">${svg('pausa')}</div>`
        if (!E.falando) return ''
        return `<div class="it clic" data-acao="saltar" title="${t('barra.aFalar')}"><span class="onda viva"><b></b><b></b><b></b><b></b><b></b></span></div>`
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
        return `<div class="it contexto clic" data-menu="uso" title="${esc(t('barra.contexto', { modelo: s.uso.modelo, usados: mil(s.uso.usados), limite: mil(s.uso.limite), saida: mil(s.uso.saidaPedido) }))}"><span class="anel" style="--p:${s.uso.pct}%"></span><span class="num">${s.uso.pct}%</span></div>`
      case 'microfone':
        return `<div class="it clic ${E.aOuvir ? 'a-ouvir' : ''}" data-falar="1" title="${E.aOuvir ? t('barra.aOuvir') : t('barra.falar')}">${svg('micro')}${E.aOuvir ? '<span class="ponto-rec"></span>' : ''}</div>`
      case 'silencio':
        return `<div class="it clic ${E.silencio ? 'silencio-on' : ''}" data-alternar-silencio="1" title="${E.silencio ? (E.cfg.naoIncomodar ? t('barra.silencioOn') : t('barra.silencioHorario')) : t('barra.silencioOff')}">${svg(E.silencio ? 'lua2' : 'sino')}</div>`
      case 'tema': {
        const L = temas()
        const atual = L.find(x => x[0] === (E.cfg.barraTema || 'sistema')) || L[0]
        const prox = L[(L.indexOf(atual) + 1) % L.length]
        const dica = t('barra.tema', { atual: atual[2], sistema: atual[0] === 'sistema' ? t('barra.segueWindows') : '', prox: prox[2].toLowerCase() })
        return `<div class="it clic" data-ciclo-tema="${prox[0]}" title="${esc(dica)}">${svg(atual[1])}</div>`
      }
      case 'som':
        return `<div class="it clic" data-menu="som" title="${t('barra.som')}">${svg(E.cfg.ligado ? 'sliders' : 'mudo')}</div>`
      case 'tempo': {
        const d = duracao(s)
        return d ? `<div class="it tempo num" title="${t('barra.tempo')}">${d}</div>` : ''
      }
    }
    return ''
  }

  function renderBarra() {
    const pos = E.cfg.barraPosicao || 'topo'
    const vertical = pos === 'esquerda' || pos === 'direita'
    const flut = pos === 'flutuante'
    const s = foco()
    detetarFins()
    const mods = modulosCompletos().filter(m => m.on && m.id !== 'ilha').map(m => m.id)
    const esq = mods.filter(id => ESQUERDA.has(id)).map(id => modulo(id, s, vertical, flut))
    const dir = mods.filter(id => !ESQUERDA.has(id)).map(id => modulo(id, s, vertical, flut))
    const marca = `<div class="it marca clic" data-menu="definicoes" title="${t('barra.marca')}">${svg('estrela')}<b>Claude</b></div>`
    const classe = vertical ? 'barra v' : flut ? 'barra flut' : 'barra'
    const comIlha = ilhaLigada()
    raiz.innerHTML = `<div class="${classe}">${marca}${esq.join('')}${comIlha ? '<i class="ilha-lugar"></i>' : ''}${flut ? '' : '<div class="espaco"></div>'}${dir.join('')}</div>`
    if (comIlha) desenharIlha(raiz.querySelector('.ilha-lugar'), flut)
    else {
      ilhaChave = ''
      if (ilhaEl) ilhaEl.hidden = true
    }

    if (pos !== posicaoEnviada) {
      posicaoEnviada = pos
      enviarHost({ tipo: 'posicao', valor: pos })
    }
    const ecra = Number.isInteger(E.cfg.barraEcra) ? E.cfg.barraEcra : -1
    if (ecra !== ecraEnviado) {
      ecraEnviado = ecra
      enviarHost({ tipo: 'ecra', valor: ecra })
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
    const linhas = ['<div class="menu">', `<div class="tit">${t('sessao.titulo')}</div>`]
    if (!E.sessoes.length) linhas.push(`<div class="op inativo"><span class="chk"></span>${t('sessao.nenhuma')}</div>`)
    for (const x of E.sessoes) {
      linhas.push(
        `<div class="op" data-foco="${esc(x.id)}"><span class="chk">${s && x.id === s.id ? '✓' : ''}</span><span class="ponto ${x.estado}"></span><span>${esc(x.pasta)}</span><small>${esc(x.estado === 'trabalhar' && x.acao ? x.acao : ESTADOS[x.estado] || '')}</small></div>`,
      )
    }
    if (E.falando) {
      linhas.push(`<hr><div class="tit">${t('sessao.aDizer')}</div>`, `<div class="leg">«${esc(E.falando.texto)}»</div>`)
    }
    if (s && s.uso) {
      linhas.push(
        '<hr>',
        `<div class="op inativo"><span class="chk"></span><span>${esc(s.uso.modelo)} · ${mil(s.uso.saidaPedido)} tokens</span><small>${t('sessao.contexto', { pct: s.uso.pct })}</small></div>`,
      )
    }
    linhas.push(
      '<hr>',
      `<div class="op" data-acao="pausa"><span class="chk"></span>${E.pausado ? t('sessao.retomar') : t('sessao.pausar')}</div>`,
      `<div class="op" data-acao="saltar"><span class="chk"></span>${t('sessao.saltar')}</div>`,
      `<div class="op" data-acao="parar"><span class="chk"></span>${t('sessao.calar')}</div>`,
      '<hr>',
      `<div class="op" data-ir="som"><span class="chk"></span>${t('menu.som')}</div>`,
      `<div class="op" data-ir="definicoes"><span class="chk"></span>${t('menu.definicoesVoz')}</div>`,
      '</div>',
    )
    return linhas.join('')
  }

  function deslizador(chave, rotulo, min, max, passo, fmt, grosso) {
    const v = Number(E.cfg[chave])
    return `<div class="rot"><span>${rotulo}</span><span class="num" data-valor="${chave}">${fmt(v)}</span></div><input type="range" ${grosso ? 'class="grosso"' : ''} data-chave="${chave}" min="${min}" max="${max}" step="${passo}" value="${v}">`
  }

  let ccEq = false // equalizador aberto no Centro de Controlo

  /** Centro de Controlo: mosaicos ao estilo macOS (voz, não incomodar, sliders, tokens, língua, aspeto, posição). */
  function menuSom() {
    const c = E.cfg
    const pre = Object.keys(PREDEF).find(k => Object.entries(PREDEF[k]).every(([kk, vv]) => Number(c[kk]) === vv))
    const sinal = v => (v > 0 ? '+' : '') + num(v, 0)
    const linha = (chave, ic, on, rot, sub, extra) =>
      `<div class="cc-l clic" data-alternar="${chave}"><span class="cc-bola ${on ? 'on' : ''} ${extra || ''}">${svg(ic)}</span><div><b>${rot}</b><small>${sub}</small></div></div>`
    const h = { ativo: false, inicio: '22:00', fim: '08:00', ...(c.silencioHorario || {}) }
    const subSil = c.naoIncomodar ? t('cc.ligado') : h.ativo ? t('cc.ate', { h: esc(h.fim) }) : t('cc.desligado')
    const u = E.uso
    const dias = u ? u.dias.map(d => d.entrada + d.saida) : []
    const maxDia = Math.max(1, ...dias)
    const nomeLing = { auto: t('def.idiomaAuto'), pt: 'Português', en: 'English', es: 'Español' }[c.idioma || 'auto']
    const L = temas()
    const temaAtual = L.find(x => x[0] === (c.barraTema || 'sistema')) || L[0]
    const temaProx = L[(L.indexOf(temaAtual) + 1) % L.length]
    const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    const padrao = (E.vozes && E.vozes.padrao) || ''
    const instalada = ((E.vozes && E.vozes.instaladas) || []).find(v => semAcento(v.id) === semAcento(padrao))
    const vozNome = String(instalada ? instalada.nome : padrao.split('-')[1] || '').replace(/^tugao$/, 'tugão') // o ficheiro não tem acento
    const precisam = E.sessoes.filter(x => x.estado === 'atencao').length
    const nConv = E.sessoes.length
    const posAtual = c.barraPosicao || 'topo'
    const resumoConv = nConv
      ? (nConv === 1 ? t('cc.conversa1') : t('cc.conversas', { n: nConv })) + (precisam ? ` · <b>${precisam === 1 ? t('cc.precisa1') : t('cc.precisamN', { n: precisam })}</b>` : '')
      : t('barra.semSessoes')
    return `<div class="cc">
      <div class="cc-t w2 h2">
        ${linha('ligado', c.ligado ? 'altifalante' : 'mudo', c.ligado, t('som.voz'), c.ligado ? esc(vozNome || t('som.ligada')) : t('som.desligada'))}
        ${linha('lerRespostas', 'balao', c.lerRespostas, t('cc.ler'), c.lerRespostas ? t('cc.ligado') : t('cc.desligado'))}
        ${linha('anunciarAcoes', 'raio', c.anunciarAcoes, t('cc.anunciar'), c.anunciarAcoes ? t('cc.ligado') : t('cc.desligado'))}
      </div>
      <div class="cc-t w2">${linha('naoIncomodar', 'lua', c.naoIncomodar || E.silencio, t('cc.silencio'), subSil, 'roxo')}</div>
      <div class="cc-t centro clic" data-acao="pausa"><span class="cc-bola">${svg(E.pausado ? 'tocar' : 'pausa')}</span>${E.pausado ? t('cc.retomar') : t('cc.pausar')}</div>
      <div class="cc-t centro clic" data-acao="saltar"><span class="cc-bola">${svg('saltar')}</span>${t('cc.saltar')}</div>
      <div class="cc-t w4">${deslizador('volume', t('cc.volume'), 0, 2, 0.05, v => Math.round(v * 100) + '%', true)}</div>
      <div class="cc-t w4">${deslizador('velocidade', t('cc.velocidade'), 0.6, 1.4, 0.02, v => num(v, 2))}${deslizador('altura', t('cc.tom'), -6, 6, 1, sinal)}</div>
      <div class="cc-t w2 clic" data-ir="uso"><div class="cc-rot">${t('cc.tokens')}</div><div class="cc-num num">${u ? mil(u.hoje.entrada + u.hoje.saida) : '—'}</div>
        <div class="cc-spark">${dias.map((d, i) => `<i class="${i === dias.length - 1 ? 'hoje' : ''}" style="height:${Math.max(6, Math.round((d / maxDia) * 100))}%"></i>`).join('')}</div></div>
      <div class="cc-t centro clic" data-ciclo-idioma="1"><span class="cc-bola">${svg('globo')}</span>${esc(nomeLing)}</div>
      <div class="cc-t centro clic" data-ciclo-tema="${temaProx[0]}"><span class="cc-bola">${svg(temaAtual[1])}</span>${temaAtual[2]}</div>
      <div class="cc-t w4"><div class="cc-rot">${t('cc.posicao')}<span>${(posicoes().find(p => p[0] === posAtual) || ['', ''])[1]}</span></div>
        <div class="cc-pos">${posicoes().map(([v, r]) => `<div class="p-${v} ${posAtual === v ? 'on' : ''}" data-posicao="${v}" title="${esc(r)}"></div>`).join('')}</div></div>
      <div class="cc-t w4"><div class="cc-rot clic" data-cc-eq="1">${t('cc.eq')}<span>${ccEq ? '▴' : '▾'}</span></div>
        <div class="pre">${Object.keys(PREDEF).map(k => `<button class="chip ${k === pre ? 'sel' : ''}" data-predef="${k}">${t('pre.' + k)}</button>`).join('')}</div>
        ${ccEq ? `<div class="eq">${['graves', 'medios', 'agudos'].map((k, i) => `<label><input type="range" data-chave="${k}" min="-12" max="12" step="1" value="${Number(c[k])}"><span>${[t('som.graves'), t('som.medios'), t('som.agudos')][i]} <span class="num" data-valor="${k}">${sinal(Number(c[k]))}</span></span></label>`).join('')}</div>` : ''}
      </div>
      <div class="cc-rod"><span>${resumoConv}</span><span><a class="clic" data-acao="testar">${t('som.testar')}</a> · <a class="clic" data-ir="definicoes">${t('cc.definicoes')}</a></span></div>
    </div>`
  }

  // Lista de ecrãs, enviada pelo anfitrião (para escolher o monitor da barra).
  let ecras = []

  function opcoesEcra(c) {
    if (ecras.length < 2) return ''
    const atual = Number.isInteger(c.barraEcra) ? c.barraEcra : -1
    return `<div class="tit">${t('ecra.titulo')}</div>
      <div class="op" data-ecra="-1"><span class="chk">${atual === -1 ? '✓' : ''}</span>${t('ecra.principal')}</div>
      ${ecras.map((e, i) => `<div class="op" data-ecra="${i}"><span class="chk">${atual === i ? '✓' : ''}</span>${t('ecra.n', { n: i + 1 })}${e.principal ? t('ecra.ePrincipal') : ''}<small>${esc(e.largura)}×${esc(e.altura)}</small></div>`).join('')}
      <hr>`
  }

  // Voz recomendada para cada língua da interface (para o botão «descarregar»).
  const VOZ_RECOMENDADA = { pt: ['pt_PT-tugão-medium', 'tugão'], en: ['en_US-lessac-medium', 'lessac'], es: ['es_ES-davefx-medium', 'davefx'] }

  function blocoIdioma(c) {
    const atual = c.idioma || 'auto'
    const opcoes = [['auto', t('def.idiomaAuto')], ['pt', 'Português'], ['en', 'English'], ['es', 'Español']]
    const temVoz = ((E.vozes && E.vozes.instaladas) || []).some(v => v.lingua.startsWith(IDIOMA))
    const rec = VOZ_RECOMENDADA[IDIOMA]
    const p = rec && progressoVoz[rec[0]]
    const aviso = temVoz || !rec
      ? ''
      : `<div class="aviso-voz">${t('def.semVozIdioma')} ${
          p ? `<span class="barra-prog"><i style="width:${p.pct || 0}%"></i></span>` : `<button class="chip azul" data-voz-baixar="${esc(rec[0])}">${t('def.baixarVoz', { nome: esc(rec[1]) })}</button>`
        }</div>`
    return `<div class="tit">${t('def.idioma')}</div>
      ${opcoes.map(([v, r]) => `<div class="op" data-idioma="${v}"><span class="chk">${atual === v ? '✓' : ''}</span>${r}</div>`).join('')}
      ${aviso}`
  }

  function blocoSilencio(c) {
    const h = { ativo: false, inicio: '22:00', fim: '08:00', ...(c.silencioHorario || {}) }
    return `<div class="tit">${t('sil.titulo')}</div>
      <div class="op" data-alternar="naoIncomodar"><span class="chk">${c.naoIncomodar ? '✓' : ''}</span>${t('sil.agora')}</div>
      <div class="op" data-horario-ativo="1"><span class="chk">${h.ativo ? '✓' : ''}</span>${t('sil.horario')}</div>
      <div class="linha-horas ${h.ativo ? '' : 'inativo'}">${t('sil.das')} <input type="time" data-hora="inicio" value="${esc(h.inicio)}"> ${t('sil.as')} <input type="time" data-hora="fim" value="${esc(h.fim)}"></div>`
  }

  function menuDefinicoes() {
    const c = E.cfg
    const chk = b => (b ? '✓' : '')
    return `<div class="menu">
      <div class="tit">${t('def.posicao')}</div>
      ${posicoes().map(([v, r]) => `<div class="op" data-posicao="${v}"><span class="chk">${chk(c.barraPosicao === v)}</span>${r}</div>`).join('')}
      <hr>
      ${opcoesEcra(c)}
      <div class="op" data-ir="modulos"><span class="chk"></span>${t('def.modulos')}<small>›</small></div>
      <div class="op" data-ir="vozes"><span class="chk"></span>${t('def.vozes')}<small>›</small></div>
      <hr>
      ${blocoIdioma(c)}
      <hr>
      ${blocoSilencio(c)}
      <hr>
      <div class="tit">${t('def.conversas')}</div>
      <div class="op" data-alternar="barraAvisos"><span class="chk">${chk(c.barraAvisos !== false)}</span>${t('def.avisos')}</div>
      <div class="op" data-alternar="respostasPelaBarra"><span class="chk">${chk(c.respostasPelaBarra !== false)}</span>${t('def.responder')}</div>
      <div class="op" data-alternar="aprovarPelaBarra"><span class="chk">${chk(c.aprovarPelaBarra !== false)}</span>${t('def.aprovar')}</div>
      <hr>
      <div class="tit">${t('def.arranque')}</div>
      <div class="op" data-arranque="windows"><span class="chk">${chk(c.barraArranque === 'windows')}</span>${t('def.comWindows')}</div>
      <div class="op" data-arranque="claude"><span class="chk">${chk(c.barraArranque === 'claude')}</span>${t('def.comClaude')}</div>
      <div class="op" data-arranque="mao"><span class="chk">${chk(c.barraArranque === 'mao')}</span>${t('def.aMao')}</div>
      <hr>
      <div class="tit">${t('def.aspeto')}</div>
      <div class="op" data-tema="sistema"><span class="chk">${chk(c.barraTema === 'sistema')}</span>${t('def.seguirWindows')}</div>
      <div class="op" data-tema="escuro"><span class="chk">${chk(c.barraTema === 'escuro')}</span>${t('tema.escuro')}</div>
      <div class="op" data-tema="claro"><span class="chk">${chk(c.barraTema === 'claro')}</span>${t('tema.claro')}</div>
      <hr>
      <div class="op" data-acao="testar"><span class="chk"></span>${t('def.testar')}</div>
      <div class="op" data-sair="1"><span class="chk"></span>${t('def.sair')}</div>
    </div>`
  }

  /** Menu do clique direito: curto; o resto está no Centro de Controlo e nas Definições. */
  function menuDireito() {
    const c = E.cfg
    const chk = b => (b ? '✓' : '')
    return `<div class="menu">
      <div class="op" data-ir="conversas"><span class="chk"></span>${t('dir.conversas')}<small>Ctrl+Shift+Alt+C</small></div>
      <div class="op" data-ir="som"><span class="chk"></span>${t('dir.cc')}</div>
      <div class="op" data-ir="uso"><span class="chk"></span>${t('dir.tokens')}</div>
      <hr>
      <div class="op" data-alternar="naoIncomodar"><span class="chk">${chk(c.naoIncomodar)}</span>${t('dir.silencio')}<small>Ctrl+Shift+Alt+D</small></div>
      <div class="op" data-alternar="ligado"><span class="chk">${chk(c.ligado)}</span>${t('dir.vozLigada')}</div>
      <hr>
      <div class="op" data-ir="definicoes"><span class="chk"></span>${t('dir.definicoes')}</div>
      <div class="op" data-esconder="1"><span class="chk"></span>${t('dir.fechar')}</div>
    </div>`
  }

  // ---------------- vozes ----------------
  let catalogoVozes = null
  let filtroLingua = 'pt_PT'
  const progressoVoz = {}

  function menuVozes() {
    const v = E.vozes || { instaladas: [] }
    const padrao = (v.padrao || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    const ePadrao = id => id.normalize('NFD').replace(/[̀-ͯ]/g, '') === padrao
    const linguas = catalogoVozes ? [...new Map(catalogoVozes.map(x => [x.lingua, x.linguaNome])).entries()] : []
    const lista = (catalogoVozes || []).filter(x => x.lingua === filtroLingua)
    return `<div class="painel vozes">
      <div class="tit">${t('vozes.instaladas')}</div>
      ${v.instaladas
        .map(
          x => `<div class="voz ${ePadrao(x.id) ? 'principal' : ''}"><div><b>${esc(x.nome)}</b><small>${esc(nomeLingua(x.lingua))} · ${esc(x.qualidade)}${ePadrao(x.id) ? ' · ' + t('vozes.principal') : ''}</small></div>
            <button class="chip" data-voz-experimentar="${esc(x.id)}" title="${t('vozes.ouvir')}">▶</button>
            ${ePadrao(x.id) ? '' : `<button class="chip" data-voz-padrao="${esc(x.id)}">${t('vozes.tornarPrincipal')}</button><button class="chip" data-voz-remover="${esc(x.id)}" title="${t('vozes.apagar')}">✕</button>`}</div>`,
        )
        .join('')}
      <div class="lig" data-alternar="idiomaAuto"><span>${t('vozes.idiomaAuto')}</span><span class="interruptor ${E.cfg.idiomaAuto !== false ? 'on' : ''}"></span></div>
      <div class="lig" data-alternar-por-conversa="1"><span>${t('vozes.tomConversa')}</span><span class="interruptor ${E.cfg.vozPorConversa !== 'igual' ? 'on' : ''}"></span></div>
      <div class="tit" style="margin-top:6px">${t('vozes.mais')}</div>
      ${
        catalogoVozes
          ? `<select data-filtro-lingua="1">${linguas.map(([l]) => `<option value="${esc(l)}" ${l === filtroLingua ? 'selected' : ''}>${esc(nomeLingua(l))}</option>`).join('')}</select>
             <div class="catalogo">${lista
               .map(x => {
                 const p = progressoVoz[x.id]
                 const estadoBt = x.instalada
                   ? `<span class="ok-txt">${t('vozes.instalada')}</span>`
                   : p && p.erro
                     ? `<span class="erro-txt">${esc(p.erro)}</span>`
                     : p
                       ? `<span class="barra-prog"><i style="width:${p.pct || 0}%"></i></span>`
                       : `<button class="chip azul" data-voz-baixar="${esc(x.id)}">${t('vozes.descarregar', { mb: x.mb })}</button>`
                 return `<div class="voz"><div><b>${esc(x.nome)}</b><small>${esc(x.qualidade)}${x.oradores > 1 ? ' · ' + t('vozes.oradores', { n: x.oradores }) : ''}</small></div>${estadoBt}</div>`
               })
               .join('')}</div>`
          : `<div class="vazio">${t('vozes.aCarregar')}</div>`
      }
      <div class="op" data-ir="definicoes"><span class="chk">‹</span>${t('menu.voltar')}</div>
    </div>`
  }

  async function carregarCatalogo() {
    const r = await api({ acao: 'vozes', op: 'catalogo' })
    catalogoVozes = (r && r.vozes) || []
    redesenharMenuAtual()
  }

  // ---------------- uso (tokens) ----------------
  let graficoVisto = false
  function menuUso() {
    const u = E.uso
    setTimeout(() => (graficoVisto = true), 700)
    if (!u) return `<div class="painel"><div class="vazio">${t('uso.semDados')}</div></div>`
    const total = d => d.entrada + d.saida
    const max = Math.max(1, ...u.dias.map(total))
    const nomeDia = k => t('uso.dias').split(',')[new Date(k + 'T12:00:00').getDay()]
    const s = foco()
    return `<div class="painel uso">
      <div class="tit">${t('uso.titulo')}</div>
      <div class="grafico${graficoVisto ? '' : ' entra'}">${u.dias
        .map(
          d => `<div class="col" title="${esc(t('uso.dica', { dia: d.dia, entrada: mil(d.entrada), saida: mil(d.saida), cache: mil(d.cache) }))}"><div class="b" style="height:${Math.round((total(d) / max) * 100)}%"><i style="height:${total(d) ? Math.round((d.saida / total(d)) * 100) : 0}%"></i></div><small>${nomeDia(d.dia)}</small></div>`,
        )
        .join('')}</div>
      <div class="kpis">
        <div><b class="num">${mil(u.hoje.entrada)}</b><small>${t('uso.entrada')}</small></div>
        <div><b class="num">${mil(u.hoje.saida)}</b><small>${t('uso.gerados')}</small></div>
        <div><b class="num">${mil(u.hoje.cache)}</b><small>${t('uso.cache')}</small></div>
      </div>
      ${
        u.topo.length
          ? `<div class="tit">${t('uso.conversas')}</div>${u.topo
              .map(x => `<div class="linha-uso"><span>${esc(x.titulo || x.id.slice(0, 8))}</span><small class="num">${t('uso.geradosN', { n: mil(x.saida) })}</small></div>`)
              .join('')}`
          : ''
      }
      ${s && s.uso ? `<div class="tit">${t('uso.esta')}</div><div class="linha-uso"><span>${esc(s.uso.modelo)} · ${t('uso.contexto')}</span><small class="num">${mil(s.uso.usados)} / ${mil(s.uso.limite)} (${s.uso.pct}%)</small></div>` : ''}
    </div>`
  }

  // ---------------- permissões ----------------
  function cartaoPermissao(p, aviso) {
    const s = E.sessoes.find(x => x.id === p.sessao)
    return `<div class="cartao permissao" data-perm="${esc(p.id)}">
      <div class="cab"><span class="escudo">${svg('escudo')}</span><div class="tt"><b>${esc(t('ilha.pede', { nome: s ? s.titulo : t('perm.conversa') }))}</b><small>${esc(t('perm.sub', { f: p.ferramenta }))}</small></div>${aviso ? `<button class="x" data-fechar="1" title="${t('perm.fecharDepois')}">✕</button>` : ''}</div>
      ${p.descricao ? `<div class="ultima">${esc(p.descricao)}</div>` : ''}
      <pre class="cmd"><span class="pr">$</span> ${esc(p.resumo)}</pre>
      <div class="botoes"><button class="recusar" data-decidir="deny" data-id="${esc(p.id)}">${t('perm.recusar')}</button><button class="permitir" data-decidir="allow" data-id="${esc(p.id)}">${t('perm.permitir')}</button></div>
    </div>`
  }

  function menuModulos() {
    const mods = modulosCompletos()
    return `<div class="menu mods">
      <div class="tit">${t('mods.titulo')}</div>
      ${mods
        .map(
          (m, i) =>
            `<div class="op" draggable="true" data-mod="${i}"><span class="chk">⋮⋮</span><span>${t(MODULOS[m.id])}</span><small><span class="interruptor ${m.on ? 'on' : ''}"></span></small></div>`,
        )
        .join('')}
      <hr><div class="op" data-ir="definicoes"><span class="chk">‹</span>${t('menu.voltar')}</div>
    </div>`
  }

  // ---------------- conversas ----------------
  /** Texto curto e limpo (sem markdown) para pré-visualizar uma mensagem. */
  function resumo(txt, max) {
    const s = String(txt || '')
      .replace(/```[\s\S]*?```/g, ' ' + t('conv.codigo') + ' ')
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
  const cartoesVistos = new Set() // a animação de entrada só corre a primeira vez
  const envios = {} // sessão -> { texto, t } do último envio (para mostrar «enviado»)

  function estadoEnvio(x) {
    const e = envios[x.id]
    if (e && Date.now() - e.t < 15000) {
      return `<div class="envio ok">${e.entregue ? t('conv.enviado') : t('conv.emFila')}</div>`
    }
    if (x.pendentes) return `<div class="envio">${x.pendentes > 1 ? t('conv.nFila', { n: x.pendentes }) : t('conv.nFila1')}</div>`
    return ''
  }

  /** Linha temporal das últimas ações e uma linha com o contexto, os tokens e a voz. */
  function detalheConversa(x) {
    const h = x.historico || []
    const hora = ms => new Date(ms).toLocaleTimeString(localeAtual(), { hour: '2-digit', minute: '2-digit' })
    const linhas = h
      .map((a, i) => {
        const agora = i === h.length - 1 && x.estado === 'trabalhar'
        return `<li class="${agora ? 'agora' : ''}"><span>${esc(a.acao)}</span><small class="num">${agora ? t('conv.agora') : hora(a.t)}</small></li>`
      })
      .join('')
    const voz = x.voz && x.voz.manual && x.voz.voz ? x.voz.voz.split('-')[1] || x.voz.voz : null
    const uso = x.uso
      ? `<div class="uso-linha"><span>${t('conv.contexto')} <b class="num">${x.uso.pct}%</b></span><span><b class="num">${mil(x.uso.saidaPedido || 0)}</b> tokens</span>${voz ? `<span>${t('conv.voz')} <b>${esc(voz)}</b></span>` : ''}</div>`
      : ''
    return `${linhas ? `<div class="tl-tit">${t('conv.acoes')}</div><ul class="tl-acoes">${linhas}</ul>` : ''}${uso}`
  }

  function cartao(x, aviso, detalhe) {
    const linhaEstado =
      x.estado === 'trabalhar'
        ? `<span class="aescrever"><b></b><b></b><b></b></span>${esc(x.acao || t('conv.aTrabalhar'))}`
        : x.estado === 'atencao'
          ? `<span class="alerta">● ${esc(x.acao || t('conv.precisaDeTi'))}</span>`
          : esc(ESTADOS[x.estado] || '')
    const msg = x.resposta ? resumo(x.resposta, aviso ? 260 : 340) : ''
    const podeResponder = E.cfg.respostasPelaBarra !== false
    const pedidos = (E.permissoes || []).filter(p => p.sessao === x.id)
    const instaladas = (E.vozes && E.vozes.instaladas) || []
    const vozAtual = x.voz && x.voz.manual ? x.voz.voz || '' : ''
    const tomAtual = x.voz && x.voz.manual ? Number(x.voz.altura) || 0 : 0
    const escolhaVoz = aviso
      ? ''
      : `<div class="linha-voz"><label>${t('conv.voz')} <select data-voz-sessao="${esc(x.id)}"><option value="">${t('conv.automatica')}</option>${instaladas
          .map(v => `<option value="${esc(v.id)}" ${v.id === vozAtual ? 'selected' : ''}>${esc(v.nome)} · ${esc(v.lingua.replace('_', '-'))}</option>`)
          .join('')}</select></label><label>${t('conv.tom')} <select data-tom-sessao="${esc(x.id)}">${[-4, -3, -2, -1, 0, 1, 2, 3, 4]
          .map(t => `<option value="${t}" ${t === tomAtual ? 'selected' : ''}>${t > 0 ? '+' : ''}${t}</option>`)
          .join('')}</select></label></div>`
    const micro = `<button type="button" class="mic ${E.aOuvir && ditadoSessao === x.id ? 'a-ouvir' : ''}" data-falar-sessao="${esc(x.id)}" title="${t('conv.ditar')}">${svg('micro')}</button>`
    const chave = (aviso ? 'a:' : 'p:') + x.id
    const entra = !cartoesVistos.has(chave)
    cartoesVistos.add(chave)
    return `<div class="cartao ${x.estado}${entra ? ' entra' : ''}" data-cartao="${esc(x.id)}">
      <div class="cab">${avatar(x, true)}<div class="tt"><b>${esc(x.titulo)}</b><small>${linhaEstado}${x.inicio ? ` · <span class="num">${duracao(x)}</span>` : ''}</small></div>${aviso ? `<button class="x" data-fechar="1" title="${t('conv.fechar')}">✕</button>` : ''}</div>
      ${detalhe ? detalheConversa(x) : ''}
      ${msg ? `<div class="ultima">${esc(msg)}</div>` : x.estado === 'trabalhar' ? '' : `<div class="ultima vazia">${t('conv.semResposta')}</div>`}
      ${x.pedido && !aviso ? `<div class="eu"><span>${t('conv.tu')}</span> ${esc(resumo(x.pedido, 140))}</div>` : ''}
      ${pedidos.map(p => cartaoPermissao(p, false)).join('')}
      ${escolhaVoz}
      ${
        podeResponder
          ? `<form class="resp" data-sessao="${esc(x.id)}"><textarea rows="1" placeholder="${E.aOuvir && ditadoSessao === x.id ? t('conv.aOuvir') : t('conv.responder')}" data-sessao="${esc(x.id)}"></textarea>${micro}<button type="submit" title="${t('conv.enviar')}">↑</button></form>${estadoEnvio(x)}`
          : ''
      }
    </div>`
  }

  function menuConversas() {
    if (!E.sessoes.length) return `<div class="painel"><div class="tit">${t('conv.titulo')}</div><div class="vazio">${t('conv.nenhuma')}</div></div>`
    const ordem = { atencao: 0, trabalhar: 1, terminou: 2, parada: 3 }
    const lista = [...E.sessoes].sort((a, b) => (ordem[a.estado] ?? 9) - (ordem[b.estado] ?? 9))
    return `<div class="painel"><div class="tit">${t('conv.titulo')} <span class="num">${E.sessoes.length}</span></div>${lista.map(x => cartao(x, false)).join('')}</div>`
  }

  function menuAviso(id) {
    const x = E.sessoes.find(s => s.id === id)
    if (!x) return '<div class="painel aviso"></div>'
    return `<div class="painel aviso">${cartao(x, true)}</div>`
  }

  function menuConversa(id) {
    const x = E.sessoes.find(s => s.id === id)
    if (!x) return `<div class="painel conversa"><div class="vazio">${t('conv.nenhuma')}</div></div>`
    return `<div class="painel conversa">${cartao(x, false, true)}</div>`
  }

  function menuPermissao(id) {
    const p = (E.permissoes || []).find(x => x.id === id)
    return `<div class="painel aviso">${p ? cartaoPermissao(p, true) : `<div class="vazio">${t('perm.jaRespondido')}</div>`}</div>`
  }

  function menuDitado(sessao) {
    const x = E.sessoes.find(s => s.id === sessao) || foco()
    if (!x) return `<div class="painel aviso"><div class="vazio">${t('conv.semDestino')}</div></div>`
    return `<div class="painel aviso ditado">${cartao(x, true)}</div>`
  }

  function htmlMenu(m) {
    if (m && m.startsWith('aviso:')) return menuAviso(m.slice(6))
    if (m && m.startsWith('perm:')) return menuPermissao(m.slice(5))
    if (m && m.startsWith('ditado:')) return menuDitado(m.slice(7))
    if (m && m.startsWith('conv:')) return menuConversa(m.slice(5))
    if (m === 'direito') return menuDireito()
    if (m === 'vozes') return menuVozes()
    if (m === 'uso') return menuUso()
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
    marcarEntradaIlha(el, menuAtual)
    const t = `${Math.ceil(el.offsetWidth)}x${Math.ceil(el.offsetHeight)}`
    if (t !== tamanhoEnviado) {
      tamanhoEnviado = t
      enviarHost({ tipo: 'tamanho', w: Math.ceil(el.offsetWidth), h: Math.ceil(el.offsetHeight) })
    }
  }

  // Cartões que saem da ilha caem dela, só na primeira vez que aparecem.
  let menuAnimado = null
  function marcarEntradaIlha(el, menu) {
    if (!el || !menu || !/^(aviso|perm|ditado|conv):/.test(menu) || !ilhaLigada()) return
    if (menuAnimado === menu) return
    menuAnimado = menu
    el.classList.add('entra-ilha')
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
    if (menuEmLinha.centro != null) marcarEntradaIlha(el, menuEmLinha.menu)
    if (menuEmLinha.centro != null) {
      el.style.left = Math.max(4, Math.min(menuEmLinha.centro - el.offsetWidth / 2, innerWidth - el.offsetWidth - 8)) + 'px'
      el.style.right = 'auto'
      el.style.top = '36px'
    } else if (menuEmLinha.menu.startsWith('aviso:')) {
      el.style.left = 'auto'
      el.style.right = '8px'
    } else if (menuEmLinha.menu !== 'som') el.style.left = Math.max(4, Math.min(menuEmLinha.x, innerWidth - el.offsetWidth - 8)) + 'px'
  }

  // ---------------- avisos ----------------
  const estadoAnterior = {}
  let avisoAtual = null
  let avisoTemporizador = null

  const permissoesVistas = new Set()
  let ditadoSessao = null

  /** Quando uma conversa acaba (ou passa a precisar de ti), mostra um aviso no canto. */
  function verificarAvisos() {
    const calado = E.silencio || E.cfg.barraAvisos === false
    for (const x of E.sessoes) {
      const antes = estadoAnterior[x.id]
      estadoAnterior[x.id] = x.estado
      if (!antes || antes === x.estado || calado) continue
      // Um pedido de autorização tem o seu próprio aviso (com Permitir/Recusar).
      if (x.estado === 'atencao' && (E.permissoes || []).some(p => p.sessao === x.id)) continue
      if ((antes === 'trabalhar' && x.estado === 'terminou') || x.estado === 'atencao') abrirAviso(x.id)
    }
    for (const p of E.permissoes || []) {
      if (permissoesVistas.has(p.id)) continue
      permissoesVistas.add(p.id)
      if (!E.silencio && E.cfg.aprovarPelaBarra !== false) abrirMenuAviso('perm:' + p.id, false)
    }
  }

  function abrirAviso(id) {
    avisoAtual = id
    abrirMenuAviso('aviso:' + id, false)
  }

  /** Abre um cartão no canto direito (aviso, permissão ou ditado). ativar = dar-lhe o foco do teclado. */
  function abrirMenuAviso(menu, ativar) {
    // Com a ilha, o cartão sai dela (centrado por baixo); sem ela, encosta ao canto direito.
    const ilha = ilhaEl && !ilhaEl.hidden ? ilhaEl.getBoundingClientRect() : null
    if (host) {
      if (ilha) enviarHost({ tipo: 'abrir', menu, x: ilha.left, y: 0, w: ilha.width, h: innerHeight, ativar: !!ativar, centrar: true })
      else enviarHost({ tipo: 'abrir', menu, x: innerWidth - 4, y: 0, w: 0, h: innerHeight, ativar: !!ativar })
    } else {
      menuEmLinha = { menu, x: innerWidth, centro: ilha ? ilha.left + ilha.width / 2 : null }
      renderMenuEmLinha()
      armarFechoDoAviso()
    }
  }

  // ---------------- ditado ----------------
  async function alternarDitado(sessao) {
    if (E.aOuvir) {
      return api({ acao: 'ouvir', ordem: 'parar', sessao: ditadoSessao || sessao })
    }
    ditadoSessao = sessao || (foco() && foco().id) || null
    const r = await api({ acao: 'ouvir', ordem: 'iniciar', sessao: ditadoSessao })
    if (r && !r.ok) mostrarErro(r.erro || t('erro.microfone'))
  }

  function mostrarErro(texto) {
    const el = document.createElement('div')
    el.className = 'toast-erro'
    el.textContent = texto
    document.body.appendChild(el)
    setTimeout(() => el.remove(), 4500)
  }

  /** Texto ditado: vai para a caixa de resposta da conversa, para reveres e carregares Enter. */
  function aoDitado(d) {
    if (d.aTranscrever) return
    const sessao = d.sessao || ditadoSessao
    ditadoSessao = null
    if (d.erro) return mostrarErro(d.erro)
    if (!d.texto || !sessao) return
    rascunhos[sessao] = (rascunhos[sessao] ? rascunhos[sessao] + ' ' : '') + d.texto
    const aberto = VISTA === 'menu' ? menuAtual : menuEmLinha && menuEmLinha.menu
    if (aberto === 'conversas' || (aberto || '').endsWith(':' + sessao)) return redesenharMenuAtual()
    if (VISTA === 'barra') abrirMenuAviso('ditado:' + sessao, true)
  }

  function redesenharMenuAtual() {
    if (VISTA === 'menu') {
      tamanhoEnviado = ''
      renderMenu()
    } else renderMenuEmLinha()
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
      aviso.textContent = t('erro.enviar')
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

  function abrirMenu(menu, el, centrar) {
    const r = el.getBoundingClientRect()
    if (host) {
      if (VISTA === 'menu') {
        menuAtual = menu
        tamanhoEnviado = ''
        renderMenu()
      } else {
        if (!centrar) el.classList.add('aberto')
        enviarHost({ tipo: 'abrir', menu, x: r.left, y: r.top, w: r.width, h: r.height, centrar: !!centrar })
      }
    } else {
      menuEmLinha = { menu, x: r.left, centro: centrar ? r.left + r.width / 2 : null }
      renderMenuEmLinha()
    }
  }

  /** Clique na ilha: decide pelo estado (autorizar, saltar a fala, parar o ditado, abrir a conversa). */
  function clicarIlha(acao) {
    if (acao === 'saltar') return controlo('saltar')
    if (acao === 'dit') return alternarDitado(null)
    if (acao.startsWith('perm:') || acao.startsWith('aviso:')) return abrirMenuAviso(acao, true)
    return abrirMenu(acao, ilhaEl, true)
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
    const alvo = ev.target.closest(
      '[data-menu],[data-acao],[data-foco],[data-ir],[data-posicao],[data-arranque],[data-tema],[data-ciclo-tema],[data-predef],[data-alternar],[data-sair],[data-esconder],[data-mod],' +
        '[data-falar],[data-falar-sessao],[data-alternar-silencio],[data-decidir],[data-voz-baixar],[data-voz-padrao],[data-voz-remover],' +
        '[data-voz-experimentar],[data-ecra],[data-horario-ativo],[data-alternar-por-conversa],[data-idioma],[data-conv],[data-ilha],[data-ciclo-idioma],[data-cc-eq]',
    )
    if (!alvo) {
      if (!host && menuEmLinha && !ev.target.closest('#menu-em-linha')) {
        menuEmLinha = null
        renderMenuEmLinha()
      }
      return
    }
    const d = alvo.dataset
    if (d.ilha) return clicarIlha(d.ilha)
    if (d.conv) return abrirMenu('conv:' + d.conv, alvo)
    if (d.cicloIdioma) {
      const L = ['auto', 'pt', 'en', 'es']
      return config({ idioma: L[(L.indexOf(E.cfg.idioma || 'auto') + 1) % L.length] })
    }
    if (d.ccEq) {
      ccEq = !ccEq
      return redesenharMenuAtual()
    }
    if (d.menu) return abrirMenu(d.menu, alvo)
    if (d.ir) {
      if (d.ir === 'vozes') carregarCatalogo()
      if (host && VISTA === 'menu') return abrirMenu(d.ir, alvo)
      menuEmLinha = { menu: d.ir, x: menuEmLinha ? menuEmLinha.x : 8 }
      return renderMenuEmLinha()
    }
    if (d.falar) return alternarDitado(null)
    if (d.falarSessao) return alternarDitado(d.falarSessao)
    if (d.alternarSilencio) {
      // Durante o horário de silêncio, o botão liga/desliga o «não incomodar» manual por cima.
      const p = config({ naoIncomodar: !E.cfg.naoIncomodar })
      render()
      return p
    }
    if (d.decidir) {
      return api({ acao: 'permissao', id: d.id, decisao: d.decidir }).then(r => {
        if (r && !r.ok) mostrarErro(r.erro)
        if ((menuAtual || '').startsWith('perm:') || (menuEmLinha && menuEmLinha.menu.startsWith('perm:'))) fecharMenu()
      })
    }
    if (d.vozBaixar) {
      progressoVoz[d.vozBaixar] = { pct: 0 }
      redesenharMenuAtual()
      return api({ acao: 'vozes', op: 'descarregar', id: d.vozBaixar })
    }
    if (d.vozPadrao) return api({ acao: 'vozes', op: 'padrao', id: d.vozPadrao })
    if (d.vozRemover) return api({ acao: 'vozes', op: 'remover', id: d.vozRemover }).then(carregarCatalogo)
    if (d.vozExperimentar) return api({ acao: 'vozes', op: 'experimentar', id: d.vozExperimentar })
    if (d.ecra !== undefined) return config({ barraEcra: Number(d.ecra) })
    if (d.idioma) return config({ idioma: d.idioma })
    if (d.horarioAtivo) {
      const h = { ativo: false, inicio: '22:00', fim: '08:00', ...(E.cfg.silencioHorario || {}) }
      return config({ silencioHorario: { ...h, ativo: !h.ativo } }).then(redesenharMenuAtual)
    }
    if (d.alternarPorConversa) return config({ vozPorConversa: E.cfg.vozPorConversa === 'igual' ? 'auto' : 'igual' }).then(redesenharMenuAtual)
    if (d.acao) {
      if (d.acao === 'testar') api({ acao: 'controlo', controlo: 'testar', texto: t('frase.teste') })
      else controlo(d.acao)
      return
    }
    if (d.foco) return api({ acao: 'foco', sessao: d.foco })
    if (d.posicao) return config({ barraPosicao: d.posicao }).then(fecharMenu)
    if (d.arranque) return config({ barraArranque: d.arranque })
    if (d.tema || d.cicloTema) {
      const p = config({ barraTema: d.tema || d.cicloTema })
      render() // muda já, sem esperar pelo servidor
      return p
    }
    if (d.predef) return config(PREDEF[d.predef])
    if (d.alternar) return config({ [d.alternar]: !E.cfg[d.alternar] })
    if (d.sair) return enviarHost({ tipo: 'sair' })
    if (d.esconder) return enviarHost({ tipo: 'esconder' })
    if (d.mod !== undefined) {
      const mods = modulosCompletos()
      mods[Number(d.mod)].on = !mods[Number(d.mod)].on
      return config({ barraModulos: mods }).then(() => render())
    }
  })

  // Seletores e horas (voz por conversa, tom, idioma do catálogo, horário de silêncio).
  document.addEventListener('change', ev => {
    const el = ev.target
    if (el.dataset.vozSessao !== undefined || el.dataset.tomSessao !== undefined) {
      const id = el.dataset.vozSessao || el.dataset.tomSessao
      const cartao = el.closest('[data-cartao]')
      const voz = cartao.querySelector('[data-voz-sessao]').value
      const tom = Number(cartao.querySelector('[data-tom-sessao]').value)
      api({ acao: 'vozes', op: 'sessao', sessao: id, voz, altura: tom })
      return
    }
    if (el.dataset.filtroLingua) {
      filtroLingua = el.value
      return redesenharMenuAtual()
    }
    if (el.dataset.hora) {
      const h = { ativo: true, inicio: '22:00', fim: '08:00', ...(E.cfg.silencioHorario || {}) }
      h[el.dataset.hora] = el.value
      config({ silencioHorario: h })
    }
  })

  // Clique direito na barra: menu com fechar, posição, ecrã, aspeto e definições.
  document.addEventListener('contextmenu', ev => {
    ev.preventDefault()
    if (VISTA !== 'barra' || !E) return
    if (host) enviarHost({ tipo: 'abrir', menu: 'direito', x: ev.clientX, y: ev.clientY, w: 1, h: 1 })
    else {
      menuEmLinha = { menu: 'direito', x: ev.clientX }
      renderMenuEmLinha()
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
  addEventListener('resize', () => VISTA === 'barra' && render())

  if (host) {
    host.addEventListener('message', ev => {
      const d = ev.data || {}
      if (d.tipo === 'menu') {
        menuAtual = d.menu
        menuAnimado = null
        cartoesVistos.clear()
        graficoVisto = false
        tamanhoEnviado = ''
        interagindo = false
        renderMenu()
        armarFechoDoAviso()
        if (d.menu === 'conversas') {
          const ta = raiz.querySelector('.cartao.atencao textarea, .cartao.terminou textarea')
          if (ta) ta.focus()
        }
      } else if (d.tipo === 'menu-fechado') {
        menuAnimado = null
        cartoesVistos.clear()
        graficoVisto = false
        document.querySelectorAll('.it.aberto').forEach(x => x.classList.remove('aberto'))
      } else if (d.tipo === 'ecras') {
        ecras = Array.isArray(d.lista) ? d.lista : []
      } else if (d.tipo === 'atalho' && E) {
        // Atalhos globais (Ctrl+Shift+Alt+…), registados pelo anfitrião.
        if (d.qual === 'pausa') controlo('pausa')
        else if (d.qual === 'saltar') controlo('saltar')
        else if (d.qual === 'silencio') config({ naoIncomodar: !E.cfg.naoIncomodar }).then(render)
        else if (d.qual === 'falar') alternarDitado(null)
        else if (d.qual === 'conversas') {
          const el = raiz.querySelector('[data-menu="conversas"]') || raiz.querySelector('.it.marca')
          if (el) abrirMenu('conversas', el)
        }
      }
    })
  }

  // Textos (na língua da interface) e estado do «não incomodar» para o ícone da área de notificação.
  let bandejaEnviada = ''
  function enviarBandeja() {
    if (!host || VISTA !== 'barra' || !E) return
    const textos = {}
    for (const k of ['mostrar', 'esconder', 'silencio', 'sair', 'dica', 'aviso']) textos[k] = t('bandeja.' + k)
    const msg = { tipo: 'bandeja', textos, silencio: !!(E.cfg.naoIncomodar || E.silencio) }
    const json = JSON.stringify(msg)
    if (json === bandejaEnviada) return
    bandejaEnviada = json
    enviarHost(msg)
  }

  // ---------------- ligação ao servidor ----------------
  let falhasDesde = null
  function ligar() {
    const es = new EventSource(`/eventos?t=${encodeURIComponent(TOKEN)}`)
    let primeira = true
    es.addEventListener('estado', ev => {
      falhasDesde = null
      E = JSON.parse(ev.data)
      window.IDIOMA = (!host && q.get('lingua')) || E.idioma || 'pt'
      document.documentElement.lang = { pt: 'pt-PT', en: 'en', es: 'es' }[IDIOMA] || 'pt-PT'
      // Pré-visualização (sem anfitrião): ?tema=claro|escuro e ?abrir=<menu> para capturas e testes.
      if (!host && q.get('tema')) E.cfg.barraTema = q.get('tema')
      if (!host && q.get('falando') && !E.falando) E.falando = { texto: q.get('falando'), sessao: E.foco }
      render()
      enviarBandeja()
      if (primeira && !host && q.get('abrir')) {
        primeira = false
        const m = q.get('abrir')
        if (m === 'vozes') carregarCatalogo()
        menuEmLinha = { menu: m, x: m === 'sessao' ? 90 : m === 'direito' ? 420 : innerWidth }
        renderMenuEmLinha()
      }
    })
    es.addEventListener('sair', () => enviarHost({ tipo: 'sair' }))
    es.addEventListener('ditado', ev => aoDitado(JSON.parse(ev.data)))
    es.addEventListener('progresso-voz', ev => {
      const p = JSON.parse(ev.data)
      if (p.fim) {
        delete progressoVoz[p.id]
        carregarCatalogo()
      } else progressoVoz[p.id] = p
      const aberto = VISTA === 'menu' ? menuAtual : menuEmLinha && menuEmLinha.menu
      if (aberto === 'vozes') redesenharMenuAtual()
    })
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
