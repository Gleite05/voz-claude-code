'use strict'
// Voz · vidro líquido. A barra encaixada reserva a sua faixa do ecrã, por isso por trás dela só há o
// fundo do ambiente de trabalho: o anfitrião capta esse pedaço e a página desenha-o (a faixa fica
// «transparente») e, por cima, cápsulas de vidro que o refratam a sério — lente nas bordas (mapa de
// deslocamento gerado para o tamanho de cada cápsula), dispersão (vermelho, verde e azul deslocados
// em quantidades diferentes), desfoque, brilho na aresta, sombra e tinta.
;(() => {
  const SVGNS = 'http://www.w3.org/2000/svg'

  // Predefinições (como as do Atrium). «personalizado» usa os valores guardados nas definições.
  const PREDEF = {
    liquido: { transparencia: 90, desfoque: 15, refracao: 8, borda: 10, dispersao: 6, brilho: 55, sombra: 30 },
    fosco: { transparencia: 58, desfoque: 100, refracao: 3, borda: 8, dispersao: 0, brilho: 35, sombra: 25 },
  }
  const CHAVES = ['transparencia', 'desfoque', 'refracao', 'borda', 'dispersao', 'brilho', 'sombra']
  const CFG = { transparencia: 'vidroTransparencia', desfoque: 'vidroDesfoque', refracao: 'vidroRefracao', borda: 'vidroBorda', dispersao: 'vidroDispersao', brilho: 'vidroBrilho', sombra: 'vidroSombra' }
  const OMISSAO = { transparencia: 87, desfoque: 100, refracao: 6, borda: 10, dispersao: 4, brilho: 45, sombra: 30 }

  /** Valores efetivos do material escolhido. */
  function parametros(cfg) {
    const m = (cfg && cfg.barraMaterial) || 'liquido'
    if (PREDEF[m]) return { ...PREDEF[m] }
    const p = {}
    for (const k of CHAVES) {
      const v = Number(cfg && cfg[CFG[k]])
      p[k] = Number.isFinite(v) ? v : OMISSAO[k]
    }
    return p
  }

  let defs = null
  function garantirDefs() {
    if (defs) return defs
    const svg = document.createElementNS(SVGNS, 'svg')
    svg.setAttribute('width', '0')
    svg.setAttribute('height', '0')
    svg.setAttribute('aria-hidden', 'true')
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'
    defs = document.createElementNS(SVGNS, 'defs')
    svg.appendChild(defs)
    document.body.appendChild(svg)
    return defs
  }

  // Mapa de deslocamento de uma cápsula (retângulo arredondado de raio r): perto da borda, cada píxel
  // vai buscar a imagem mais para dentro (como uma lente), com um perfil circular suave.
  const mapas = new Map()
  function mapa(w, h, r, borda) {
    const chave = `${w}x${h}x${r}x${borda}`
    if (mapas.has(chave)) return mapas.get(chave)
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const g = c.getContext('2d')
    const img = g.createImageData(w, h)
    const d = img.data
    const hx = w / 2
    const hy = h / 2
    const bx = hx - r
    const by = hy - r
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = x + 0.5 - hx
        const py = y + 0.5 - hy
        const qx = Math.abs(px) - bx
        const qy = Math.abs(py) - by
        // distância (com sinal) à borda e a normal para fora
        let nx
        let ny
        let dist
        if (qx > 0 && qy > 0) {
          const l = Math.hypot(qx, qy) || 1
          dist = l - r
          nx = (qx / l) * Math.sign(px)
          ny = (qy / l) * Math.sign(py)
        } else if (qx > qy) {
          dist = qx - r
          nx = Math.sign(px)
          ny = 0
        } else {
          dist = qy - r
          nx = 0
          ny = Math.sign(py)
        }
        const dentro = -dist // > 0 dentro da cápsula
        let mag = 0
        if (dentro < borda) {
          const t = 1 - Math.max(0, dentro) / borda // 1 na aresta, 0 no fim da borda
          mag = 1 - Math.sqrt(1 - t * t) // perfil de lente
        }
        const i = (y * w + x) * 4
        d[i] = Math.round(128 - nx * mag * 127)
        d[i + 1] = Math.round(128 - ny * mag * 127)
        d[i + 2] = 128
        d[i + 3] = 255
      }
    }
    g.putImageData(img, 0, 0)
    const url = c.toDataURL()
    mapas.set(chave, url)
    if (mapas.size > 40) mapas.delete(mapas.keys().next().value)
    return url
  }

  // Um filtro SVG por tamanho de cápsula + parâmetros.
  const filtros = new Map()
  function filtro(w, h, r, p) {
    const desf = Math.round((p.desfoque / 100) * 4 * 10) / 10
    const escala = p.refracao * 2
    const disp = p.dispersao / 100
    const id = `vf-${w}-${h}-${r}-${p.borda}-${escala}-${desf}-${Math.round(disp * 100)}`
    if (filtros.has(id)) return id
    const f = document.createElementNS(SVGNS, 'filter')
    f.setAttribute('id', id)
    f.setAttribute('x', '0')
    f.setAttribute('y', '0')
    f.setAttribute('width', String(w))
    f.setAttribute('height', String(h))
    f.setAttribute('filterUnits', 'userSpaceOnUse')
    f.setAttribute('color-interpolation-filters', 'sRGB')
    const desloca = (s, res) => `<feDisplacementMap in="desf" in2="mapa" scale="${s}" xChannelSelector="R" yChannelSelector="G" result="${res}"/>`
    const canal = (de, linha, res) => {
      const m = ['0 0 0 0 0', '0 0 0 0 0', '0 0 0 0 0', '0 0 0 1 0']
      m[linha] = ['1 0 0 0 0', '0 1 0 0 0', '0 0 1 0 0'][linha]
      return `<feColorMatrix in="${de}" type="matrix" values="${m.join(' ')}" result="${res}"/>`
    }
    let corpo =
      `<feGaussianBlur in="SourceGraphic" stdDeviation="${desf}" edgeMode="duplicate" result="desf"/>` +
      `<feImage href="${mapa(w, h, r, p.borda)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="mapa"/>`
    if (disp > 0 && escala > 0) {
      corpo +=
        desloca(escala * (1 + disp * 4), 'dR') + canal('dR', 0, 'cR') +
        desloca(escala, 'dG') + canal('dG', 1, 'cG') +
        desloca(escala * Math.max(0, 1 - disp * 4), 'dB') + canal('dB', 2, 'cB') +
        '<feComposite in="cR" in2="cG" operator="arithmetic" k2="1" k3="1" result="rg"/>' +
        '<feComposite in="rg" in2="cB" operator="arithmetic" k2="1" k3="1" result="ref"/>'
    } else corpo += desloca(escala, 'ref')
    corpo += '<feColorMatrix in="ref" type="saturate" values="1.3"/>'
    f.innerHTML = corpo
    garantirDefs().appendChild(f)
    filtros.set(id, f)
    if (filtros.size > 24) {
      const [velho, el] = filtros.entries().next().value
      if (!document.querySelector(`[style*="${velho}"]`)) {
        el.remove()
        filtros.delete(velho)
      }
    }
    return id
  }

  let fundo = null // { url }

  function definirFundo(url) {
    fundo = url ? { url } : null
    document.body.style.setProperty('--fundo', url ? `url("${url}")` : 'none')
  }

  const ativo = () => !!fundo

  /** Ajusta a camada de vidro (.vf) de cada cápsula: o pedaço certo do fundo e o filtro do seu tamanho. */
  function sincronizar(cfg, escuro) {
    if (!fundo) return
    const p = parametros(cfg)
    const b = document.body.style
    b.setProperty('--lg-brilho', String(p.brilho / 100))
    b.setProperty('--lg-sombra', String(p.sombra / 100))
    b.setProperty('--lg-tinta', escuro ? `rgba(245, 245, 250, ${(1 - p.transparencia / 100) * 0.9})` : `rgba(248, 248, 252, ${(1 - p.transparencia / 100) * 2.2})`)
    const W = innerWidth
    const H = innerHeight
    for (const vf of document.querySelectorAll('.vf')) {
      const caps = vf.parentElement
      if (!caps || caps.hidden) continue
      const r = caps.getBoundingClientRect()
      const w = Math.max(2, Math.round(r.width))
      const h = Math.max(2, Math.round(r.height))
      const raio = Math.min(Math.round(h / 2), Math.round(w / 2))
      vf.style.backgroundSize = `${W}px ${H}px`
      vf.style.backgroundPosition = `${-r.left}px ${-r.top}px`
      const id = filtro(w, h, raio, p)
      if (vf._filtro !== id) {
        vf._filtro = id
        vf.style.filter = `url(#${id})`
      }
    }
  }

  /** Durante uma animação de tamanho (a ilha a crescer), segue a cápsula a cada fotograma. */
  let seguirAte = 0
  let aSeguir = false
  function seguir(ms, cfg, escuro) {
    seguirAte = Math.max(seguirAte, performance.now() + ms)
    if (aSeguir) return
    aSeguir = true
    const passo = () => {
      sincronizar(cfg(), escuro())
      if (performance.now() < seguirAte) requestAnimationFrame(passo)
      else aSeguir = false
    }
    requestAnimationFrame(passo)
  }

  /** Fundo de demonstração (pré-visualização no browser, sem anfitrião): ondas verdes como o do Atrium. */
  function fundoDemo(w, h) {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const g = c.getContext('2d')
    const grad = g.createLinearGradient(0, 0, w, h)
    grad.addColorStop(0, '#2f5a3a')
    grad.addColorStop(1, '#5c8a5e')
    g.fillStyle = grad
    g.fillRect(0, 0, w, h)
    for (let i = -4; i < 14; i++) {
      const x = i * 170
      const gg = g.createLinearGradient(x, 0, x + 120, 0)
      gg.addColorStop(0, 'rgba(10, 30, 14, 0.55)')
      gg.addColorStop(0.5, 'rgba(160, 200, 150, 0.35)')
      gg.addColorStop(1, 'rgba(10, 30, 14, 0)')
      g.fillStyle = gg
      g.beginPath()
      g.moveTo(x, 0)
      g.bezierCurveTo(x + 60, h * 0.4, x - 40, h * 0.7, x + 30, h)
      g.lineTo(x + 150, h)
      g.bezierCurveTo(x + 80, h * 0.7, x + 180, h * 0.4, x + 120, 0)
      g.fill()
    }
    return c.toDataURL('image/jpeg', 0.92)
  }

  window.VozVidro = { PREDEF, CHAVES, CFG, OMISSAO, parametros, definirFundo, ativo, sincronizar, seguir, fundoDemo }
})()
