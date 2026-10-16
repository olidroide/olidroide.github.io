
// Portada Amiga/Turrican: canvas en tiempo real, HUD y retrato en mosaico. Sin dependencias.
(() => {
  'use strict';
  document.documentElement.classList.add('js');   // el avatar solo se oculta si este script corre de verdad
  const TAU = Math.PI * 2;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const qt = new URLSearchParams(location.search).get('t') ?? new URLSearchParams(location.hash.slice(1)).get('t');   // ?t=2.5 o #t=2.5
  const frozen = qt !== null && qt !== '' && !isNaN(+qt);              // ?t=2.5 → frame exacto para QA
  const $ = (id) => document.getElementById(id);
  const hero = $('hero'), hud = $('hud'), copyEl = $('copy');
  const sky = $('sky'), sctx = sky.getContext('2d');
  const pix = $('pix'), pctx = pix.getContext('2d');
  const bugsEl = $('bugs');
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // muelle amortiguado (ζ≈0.75): ~3% de sobreoscilación y asentado en ~0.65 s
  const spring = (x) => { if (x <= 0) return 0; const w = 14, z = 0.75, wd = w * Math.sqrt(1 - z * z); return 1 - Math.exp(-z * w * x) * (Math.cos(wd * x) + ((z * w) / wd) * Math.sin(wd * x)); };

  // RNG con semilla → cada frame es reproducible
  let seed = 0x0c64;
  const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let r = Math.imul(seed ^ (seed >>> 15), 1 | seed); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };

  // ---------- paleta Amiga OCS: 12 bits, 4096 colores ----------
  const rgb = (h) => h.length === 4 ? [1, 2, 3].map((i) => parseInt(h[i], 16) * 17) : [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const q12 = ([r, g, b]) => [r, g, b].map((v) => Math.round(v / 17) * 17);
  const css = ([r, g, b]) => `rgb(${r},${g},${b})`;
  const pack = ([r, g, b]) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  const LAVA = ['#100', '#300', '#610', '#a30', '#d50', '#f70', '#fb4', '#fea'].map((h) => pack(rgb(h)));
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const RAINBOW = ['#f00', '#f40', '#f80', '#fb0', '#ff0', '#bf0', '#8f0', '#4f0', '#0f4', '#0f8', '#0fb', '#0ff', '#0bf', '#08f', '#04f', '#40f', '#80f', '#b0f', '#f0f', '#f0b', '#f08', '#f04'];
  const ramp = (base) => {                                    // barra copper: 11 scanlines, cada una un color de 12 bits
    const c = rgb(base), out = [];
    for (let j = 0; j < 11; j++) {
      const k = 1 - Math.abs(j - 5) / 5, w = Math.max(0, k - 0.75) * 4;
      out.push(css(q12(c.map((v) => v * k + (255 - v) * w * k))));
    }
    return out;
  };
  const COPPER = [ramp('#f48'), ramp('#2df'), ramp('#fb0')];
  const OLI = (window.OLI = window.OLI || { bpm: 120 });   // tempo compartido: el TAP del MiniLab lo cambia

  // ---------- sprites (pixel art propio) ----------
  const sprite = (rows, pal) => {
    const c = document.createElement('canvas'); c.width = rows[0].length; c.height = rows.length;
    const x = c.getContext('2d');
    rows.forEach((r, j) => [...r].forEach((ch, i) => { if (pal[ch]) { x.fillStyle = pal[ch]; x.fillRect(i, j, 1, 1); } }));
    return c;
  };
  const SHIP = sprite([
    '....aa..........', '....abaa........', 'aa..abbbaa......', 'abaaabbbbbaaa...', 'abbbbbccddbbbaa.',
    'abbbbbbbbbbbbbbe', 'abaaabbbbbbbaa..', 'aa..abbbaa......', '....aa..........',
  ], { a: '#225', b: '#cdf', c: '#2df', d: '#eff', e: '#fff' });
  const BUG = [
    ['.a.....a.', '..a...a..', '.bbbbbbb.', 'bcbbbbbcb', 'bbbbbbbbb', '.b.b.b.b.', 'b...b...b'],
    ['.a.....a.', '..a...a..', '.bbbbbbb.', 'bcbbbbbcb', 'bbbbbbbbb', '.b.b.b.b.', '..b...b..'],
  ].map((r) => sprite(r, { a: '#9f6', b: '#4c4', c: '#f25' }));
  const SHOT = sprite(['aa...', '.abb.', '..abb', '..acb', '..acb', '..acb', '..abb', '.abb.', 'aa...'], { a: '#a30', b: '#f80', c: '#fe4' });

  const SCROLL = JSON.parse(document.getElementById('i18n').textContent).scroller;   // texto por idioma desde _data/<lang>.yml

  // ---------- estado ----------
  let cssW, cssH, dpr, S, W, H, lavaTop, scrollerY, bandTop, bandBot, lavaImg, lavaBuf, colTop, colA, stars = [], skyBg;
  let planet = { x: 0, y: 0, r: 0, cell: 8 };
  const logo = { F: 16, lines: [], top: 0, bottom: 0, gap: 0, pad: 1, glyphs: {}, landed: 1 };
  const st = { shots: [], bugs: [], parts: [], texts: [], fireT: 0.4, spawnT: 0.8, shipY: 0, pointerY: null, pointerT: -9, fixed: 0 };
  let t = 0, ready = false;

  function buildLogo() {
    const maxF = Math.max(16, Math.floor((H * 0.12) / 8) * 8);
    const fit = (n) => Math.max(8, Math.min(48, maxF, Math.floor((W - 12) / n / 8) * 8));
    const f1 = fit(9), f2 = fit(6), two = f2 >= f1 * 1.5, F = two ? f2 : f1;
    Object.assign(logo, { F, lines: two ? ['OLI', 'DROIDE'] : ['OLIDROIDE'], top: Math.round(H * 0.13), gap: Math.round(F * 0.25), pad: Math.max(1, F >> 4) + 1, glyphs: {} });
    logo.bottom = logo.top + logo.lines.length * F + (logo.lines.length - 1) * logo.gap;
    logo.landed = 0.15 + (logo.lines.join('').length - 1) * 0.033 + 0.65;     // cuándo termina de caer la última letra
    const p = logo.pad;
    // cromado por bandas duras (como un logo de Amiga hecho con copper), sin degradado continuo
    const BANDS = [[0, '#fff'], [0.18, '#cdf'], [0.34, '#9ae'], [0.46, '#57b'], [0.52, '#224'], [0.58, '#eef'], [0.7, '#aae'], [0.84, '#66a']];
    for (const ch of new Set(logo.lines.join('').replace(/ /g, ''))) {
      const c = document.createElement('canvas'); c.width = F + p * 3; c.height = F + p * 3;
      const x = c.getContext('2d'); x.font = `${F}px "Press Start 2P", monospace`; x.textBaseline = 'top';
      x.fillStyle = '#a30'; x.fillText(ch, p * 2, p * 2);
      x.fillStyle = '#102'; for (const [ax, ay] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) x.fillText(ch, p + ax, p + ay);
      const g = x.createLinearGradient(0, p, 0, p + F);
      BANDS.forEach(([o, col], i) => { g.addColorStop(o, col); g.addColorStop(i + 1 < BANDS.length ? BANDS[i + 1][0] - 0.0001 : 1, col); });
      x.fillStyle = g; x.fillText(ch, p, p);
      logo.glyphs[ch] = c;
    }
  }

  function buildSky() {                       // cielo copper: bandas horizontales de 12 bits, pre-renderizado una vez
    skyBg = document.createElement('canvas'); skyBg.width = sky.width; skyBg.height = sky.height;
    const c = skyBg.getContext('2d'), band = 4 * S * dpr, n = Math.ceil(sky.height / band);
    const top = [0, 17, 51], mid = [0, 0, 17], low = [34, 0, 0];
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1), a = f < 0.6 ? top : mid, b = f < 0.6 ? mid : low, k = f < 0.6 ? f / 0.6 : (f - 0.6) / 0.4;
      c.fillStyle = css(q12(a.map((v, j) => v + (b[j] - v) * k))); c.fillRect(0, Math.floor(i * band), sky.width, Math.ceil(band));
    }
  }

  function layout() {
    const r = hero.getBoundingClientRect();
    cssW = Math.round(r.width); cssH = Math.round(r.height);
    dpr = Math.min(devicePixelRatio || 1, 2);
    S = clamp(Math.floor(Math.min(cssW / 300, cssH / 200)), 2, 5);
    W = Math.ceil(cssW / S); H = Math.ceil(cssH / S);
    pix.width = W; pix.height = H; pix.style.width = W * S + 'px'; pix.style.height = H * S + 'px';
    sky.width = Math.round(cssW * dpr); sky.height = Math.round(cssH * dpr); sky.style.width = cssW + 'px'; sky.style.height = cssH + 'px';
    pctx.imageSmoothingEnabled = false;
    hero.style.setProperty('--S', S + 'px');

    const hudH = hud.offsetHeight / S;
    lavaTop = Math.round(H - hudH - Math.max(18, Math.round(H * 0.14)));
    scrollerY = lavaTop - 13;
    buildLogo();
    hero.style.setProperty('--copy-top', logo.bottom * S + 12 + 'px');
    const copyBottom = (copyEl.offsetTop + copyEl.offsetHeight) / S;
    bandBot = scrollerY - 12;
    bandTop = Math.min(Math.round(copyBottom + 6), bandBot - 24);

    lavaImg = pctx.createImageData(W, H - lavaTop); lavaBuf = new Uint32Array(lavaImg.data.buffer);
    colTop = new Float32Array(W); colA = new Float32Array(W);
    seed = 0x0c64;
    stars = Array.from({ length: Math.round((W * lavaTop) / 70) }, (_, i) => ({ x: rnd() * W, y: rnd() * lavaTop, l: i % 3 }));
    const mobile = cssW < 700;
    planet = { x: cssW * (mobile ? 0.86 : 0.82), y: cssH * 0.6, r: Math.min(cssW, cssH) * (mobile ? 0.4 : 0.36), cell: mobile ? 7 : 9 };
    buildSky();
    st.shipY = (bandTop + bandBot) / 2; st.bugs.length = 0; st.shots.length = 0;
  }

  // ---------- simulación ----------
  const SHIP_X = () => Math.round(W * 0.08);
  function fire(burst) {
    const sp = W * 0.85;
    for (const a of burst ? [-0.32, -0.16, 0, 0.16, 0.32] : [0]) st.shots.push({ x: SHIP_X() + 14, y: st.shipY - 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp });
  }
  function update(dt) {
    const mid = (bandTop + bandBot) / 2, span = bandBot - bandTop;
    const target = t - st.pointerT < 2.5 && st.pointerY != null ? clamp(st.pointerY, bandTop + 4, bandBot - 4) : mid + Math.sin(t * 1.3) * span * 0.3;
    st.shipY += (target - st.shipY) * Math.min(1, dt * 6);
    if (t > logo.landed && (st.fireT -= dt) <= 0) { fire(false); st.fireT = 60 / OLI.bpm; }     // un disparo por beat
    if (t > logo.landed && (st.spawnT -= dt) <= 0) {
      st.bugs.push({ x: W + 10, by: bandTop + 4 + rnd() * Math.max(4, span - 12), ph: rnd() * TAU, vx: -(W * 0.15 + rnd() * W * 0.08), y: 0 });
      st.spawnT = 0.8 + rnd() * 0.9;
    }
    for (const s of st.shots) { s.x += s.vx * dt; s.y += s.vy * dt; }
    for (const b of st.bugs) { b.x += b.vx * dt; b.y = b.by + Math.sin(t * 3 + b.ph) * 4; }
    for (const s of st.shots) for (const b of st.bugs) {
      if (!s.dead && !b.dead && s.x + 5 > b.x && s.x < b.x + 9 && s.y + 9 > b.y && s.y < b.y + 7) {
        s.dead = b.dead = true;
        for (let i = 0; i < 12; i++) { const a = rnd() * TAU, v = 15 + rnd() * 45; st.parts.push({ x: b.x + 4, y: b.y + 3, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.4 + rnd() * 0.4, max: 0.8 }); }
        st.texts.push({ x: b.x - 6, y: b.y - 4, life: 0.9 });
        bugsEl.textContent = String(++st.fixed).padStart(4, '0');
      }
    }
    st.shots = st.shots.filter((s) => !s.dead && s.x < W + 8 && s.y > -10 && s.y < H);
    st.bugs = st.bugs.filter((b) => !b.dead && b.x > -12);
    for (const p of st.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 40 * dt; p.life -= dt; }
    st.parts = st.parts.filter((p) => p.life > 0);
    for (const tx of st.texts) { tx.y -= 22 * dt; tx.life -= dt; }
    st.texts = st.texts.filter((tx) => tx.life > 0);
  }

  // ---------- render: cielo + planeta en semitono (resolución real) ----------
  function drawSky() {
    const c = sctx, k = dpr, unit = S * k;
    c.drawImage(skyBg, 0, 0);
    const speeds = [3, 8, 18], cols = ['#446', '#99c', '#fff'];
    for (let l = 0; l < 3; l++) {
      c.fillStyle = cols[l];
      for (const s of stars) if (s.l === l) c.fillRect(Math.round((((s.x - t * speeds[l]) % W) + W) % W) * unit, Math.round(s.y) * unit, unit, unit);
    }
    const { x: px0, y: py0, r: R, cell } = planet;
    c.fillStyle = '#102'; c.beginPath(); c.arc(px0 * k, py0 * k, R * k, 0, TAU); c.fill();
    const la = t * 0.12, Lx = Math.cos(la) * 0.75, Ly = -0.45, Lz = 0.5 + Math.sin(la) * 0.3;
    const Ln = Math.hypot(Lx, Ly, Lz), lx = Lx / Ln, ly = Ly / Ln, lz = Lz / Ln, rot = t * 0.18, n = Math.ceil(R / cell);
    c.beginPath();
    for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
      const nx = (i * cell) / R, ny = (j * cell) / R, d2 = nx * nx + ny * ny;
      if (d2 >= 1) continue;
      const nz = Math.sqrt(1 - d2), lam = nx * lx + ny * ly + nz * lz;
      if (lam <= 0) continue;
      const band = 0.5 + 0.5 * Math.sin(ny * 10 + Math.sin((Math.atan2(nx, nz) + rot) * 3) * 0.9);
      const rr = cell * 0.56 * Math.sqrt(lam * (0.42 + 0.58 * band)) * k;
      if (rr < 0.4) continue;
      const x = (px0 + i * cell) * k, y = (py0 + j * cell) * k;
      c.moveTo(x + rr, y); c.arc(x, y, rr, 0, TAU);
    }
    c.fillStyle = '#2df'; c.fill();
    c.beginPath();                                           // segunda trama desplazada = contraluz rosa de cómic
    for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
      const ox = i * cell + cell / 2, oy = j * cell + cell / 2, nx = ox / R, ny = oy / R, d2 = nx * nx + ny * ny;
      if (d2 >= 1) continue;
      const nz = Math.sqrt(1 - d2), side = clamp(0.5 - (nx * lx + ny * ly) * 0.9, 0, 1), rr = cell * 0.5 * (1 - nz) ** 2.4 * side * k;
      if (rr < 0.4) continue;
      const x = (px0 + ox) * k, y = (py0 + oy) * k;
      c.moveTo(x + rr, y); c.arc(x, y, rr, 0, TAU);
    }
    c.fillStyle = '#f48'; c.fill();
  }

  // ---------- render: capa pixel ----------
  function drawLava() {
    const LH = H - lavaTop, sx = t * 10;
    for (let x = 0; x < W; x++) { const X = x + sx; colTop[x] = 2 + 1.5 * Math.sin(X * 0.21) + 1.2 * Math.sin(X * 0.07 + 2); colA[x] = Math.sin(X * 0.09 + t * 0.8); }
    let k = 0;
    for (let y = 0; y < LH; y++) {
      const sy = Math.sin(y * 0.23 - t * 1.1), depth = (y / LH) * 2.2;
      for (let x = 0; x < W; x++, k++) {
        const top = colTop[x];
        if (y < top) { lavaBuf[k] = 0; continue; }
        if (y < top + 1) { lavaBuf[k] = LAVA[7]; continue; }
        const v = colA[x] + sy + Math.sin((x + sx + y * 2) * 0.06 + t * 0.6);
        lavaBuf[k] = LAVA[clamp(Math.floor(((v + 3) / 6) * 6.2 + BAYER[((y & 3) << 2) | (x & 3)] / 16 - depth + 1), 0, 6)];
      }
    }
    pctx.putImageData(lavaImg, 0, lavaTop);
  }

  function drawPix() {
    pctx.clearRect(0, 0, W, H);
    drawLava();

    // copper: secundario, entra 150 ms después de que aterriza el logo, late a 120 BPM y se desplaza a un compás (4 beats)
    const barsIn = clamp((t - logo.landed - 0.15) / 0.45, 0, 1);
    if (barsIn > 0) {
      const beat = (t * OLI.bpm) / 60, pulse = Math.exp(-(beat % 1) * 5);
      const mid = (logo.top + logo.bottom) / 2, amp = (logo.bottom - logo.top) / 2;
      pctx.globalAlpha = (0.22 + 0.2 * pulse) * barsIn;
      COPPER.forEach((rows, b) => {
        const cy = Math.round(mid + Math.sin((beat / 4) * TAU + b * 2.1) * amp) - 5;
        rows.forEach((col, j) => { pctx.fillStyle = col; pctx.fillRect(0, cy + j, W, 1); });
      });
      pctx.globalAlpha = 1;
    }

    // protagonista: logo cromado que cae con muelle, stagger de 2 frames por letra, luego ondula 1 px
    const F = logo.F, p = logo.pad;
    logo.lines.forEach((line, li) => {
      let x = Math.round((W - line.length * F) / 2);
      const y0 = logo.top + li * (F + logo.gap);
      [...line].forEach((ch, i) => {
        if (ch !== ' ') {
          const idx = li * 10 + i, lt = t - 0.15 - idx * 0.033;
          const e = spring(lt), settled = lt > 0.8;
          const wob = settled ? Math.round(Math.sin(t * Math.PI + idx * 0.55) * Math.max(1, F / 16)) : 0;
          pctx.drawImage(logo.glyphs[ch], x - p, Math.round(y0 - (1 - e) * (y0 + F + 8) + wob) - p);
        }
        x += F;
      });
    });

    // sine scroller (decorativo: el mismo texto está quieto y accesible en la página)
    pctx.font = '8px "Press Start 2P", monospace'; pctx.textBaseline = 'top';
    const L = SCROLL.length * 8, off = t * 34;
    for (let i = 0; i < SCROLL.length; i++) {
      const x = Math.round((((i * 8 - off) % L) + L) % L);
      if (x > W) continue;
      pctx.fillStyle = RAINBOW[(((x >> 3) + ((t * 6) | 0)) % RAINBOW.length + RAINBOW.length) % RAINBOW.length];
      pctx.fillText(SCROLL[i], x, scrollerY + Math.round(Math.sin(t * 4 + x * 0.07) * 3));
    }

    for (const s of st.shots) pctx.drawImage(SHOT, Math.round(s.x), Math.round(s.y));
    for (const b of st.bugs) pctx.drawImage(BUG[((t * 7 + b.ph) | 0) & 1], Math.round(b.x), Math.round(b.y));
    const sx = SHIP_X(), sy = Math.round(st.shipY - 4), fl = ((t * 30) | 0) & 1;
    pctx.fillStyle = fl ? '#fe4' : '#f70'; pctx.fillRect(sx - 2 - fl, sy + 4, 2 + fl, 2);
    pctx.fillStyle = '#f30'; pctx.fillRect(sx - 4 - fl * 2, sy + 4, 2, 2);
    pctx.drawImage(SHIP, sx, sy);
    for (const q of st.parts) {
      const f = q.life / q.max;
      pctx.fillStyle = f > 0.75 ? '#ffb' : f > 0.5 ? '#fb0' : f > 0.25 ? '#f50' : '#710';
      pctx.fillRect(Math.round(q.x), Math.round(q.y), 1, 1);
    }
    pctx.fillStyle = '#fd0';
    for (const tx of st.texts) if (tx.life > 0.3 || ((t * 5) | 0) & 1) pctx.fillText('FIX!', Math.round(tx.x), Math.round(tx.y));   // ≤ 3 destellos/s (WCAG 2.3.1)
  }

  // ---------- bucle ----------
  let last = 0, raf = 0, running = false;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    update(dt); drawSky(); drawPix();
    raf = requestAnimationFrame(frame);
  }
  function start() { if (running || reduce || frozen || !ready) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
  function stop() { running = false; cancelAnimationFrame(raf); }
  function still(at) {                       // simula de forma determinista hasta `at` y pinta ese frame
    t = 0; seed = 0x0c64; st.shots = []; st.bugs = []; st.parts = []; st.texts = []; st.fireT = 0.4; st.spawnT = 0.8; st.fixed = 0;
    while (t < at) { t += 1 / 60; update(1 / 60); }
    drawSky(); drawPix();
  }

  const pointer = (e) => { const r = hero.getBoundingClientRect(); st.pointerY = (e.clientY - r.top) / S; st.pointerT = t; };
  hero.addEventListener('pointermove', pointer, { passive: true });
  hero.addEventListener('pointerdown', (e) => { if (e.target.closest('a,button')) return; pointer(e); fire(true); }, { passive: true });

  // ---------- HUD ----------
  const bar = $('bar'), worldEl = $('world');
  let ticking = false;
  addEventListener('scroll', () => {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => { const max = document.documentElement.scrollHeight - innerHeight; bar.style.transform = `scaleX(${max > 0 ? scrollY / max : 0})`; ticking = false; });
  }, { passive: true });
  const worldIO = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) worldEl.textContent = e.target.dataset.world; }), { rootMargin: '-45% 0px -45% 0px' });
  document.querySelectorAll('[data-world]').forEach((el) => worldIO.observe(el));
  new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting && scrollY < innerHeight * 0.5) worldEl.textContent = 'START'; }), { threshold: 0.6 }).observe(hero);
  const stampIO = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); stampIO.unobserve(e.target); } }), { threshold: 0.5 });
  document.querySelectorAll('.world').forEach((el) => stampIO.observe(el));

  const yearsEl = $('years');
  if (reduce || frozen) yearsEl.textContent = '16';
  else { let y = 0; setTimeout(() => { const iv = setInterval(() => { yearsEl.textContent = String(++y).padStart(2, '0'); if (y >= 16) clearInterval(iv); }, 60); }, 1700); }

  // ---------- retrato: mosaico Amiga que se resuelve en ~0.6 s + cara pixelada en el HUD ----------
  const img = $('avatarImg'), fx = $('avatarFx'), fctx = fx.getContext('2d'), tmp = document.createElement('canvas'), tc = tmp.getContext('2d');
  const mosaic = (n) => { tmp.width = tmp.height = n; tc.drawImage(img, 0, 0, n, n); fctx.imageSmoothingEnabled = false; fctx.clearRect(0, 0, 240, 240); fctx.drawImage(tmp, 0, 0, 240, 240); };
  const showPhoto = () => { img.style.visibility = 'visible'; fx.style.opacity = 0; };
  img.decode().then(() => {
    const face = $('face').getContext('2d');
    face.imageSmoothingEnabled = true; face.drawImage(img, 190, 70, 500, 500, 0, 0, 16, 16);
    if (reduce || frozen) return showPhoto();
    mosaic(6);
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return; io.disconnect();
      const steps = [6, 10, 16, 26, 42, 70, 120]; let i = 0;
      const tick = () => { mosaic(steps[i]); if (++i < steps.length) setTimeout(tick, 85); else showPhoto(); };
      tick();
    }, { threshold: 0.45 });
    io.observe($('avatar'));
  }).catch(showPhoto);

  // ---------- arranque ----------
  const fontReady = Promise.race([document.fonts.load('16px "Press Start 2P"'), new Promise((r) => setTimeout(r, 1500))]);
  fontReady.then(() => {
    layout(); ready = true;
    if (reduce) still(3); else if (frozen) still(+qt); else start();
    new ResizeObserver(() => { layout(); if (reduce) still(3); else if (frozen) still(+qt); }).observe(hero);
    new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop())).observe(hero);
  });
})();
