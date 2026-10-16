// OLILAB 3 + ukelele + vídeos: síntesis WebAudio en vivo, sin samples. Textos y datos por idioma en #i18n.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const I = JSON.parse($('i18n').textContent);
  const fill = (tpl, o) => tpl.replace(/\{(\w+)\}/g, (_, k) => o[k]);
  const OLI = (window.OLI = window.OLI || { bpm: 120 });
  const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
  const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const name = (m) => NOTE[m % 12] + (Math.floor(m / 12) - 1);
  const oledA = $('oledA'), oledB = $('oledB'), oledV = $('oledV');
  const oled = (a, b, v) => { oledA.textContent = a; oledB.textContent = b; oledV.style.setProperty('--v', v ?? 0); };

  // ---------- motor de audio (se crea en el primer toque: política de autoplay) ----------
  let ac, master, noise;
  const audio = () => {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      const comp = ac.createDynamicsCompressor(); master = ac.createGain(); master.gain.value = 0.25;
      master.connect(comp).connect(ac.destination);
      noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended') ac.resume();
    return ac.currentTime;
  };
  const env = (g, w, peak, dur) => { g.gain.setValueAtTime(0.0001, w); g.gain.linearRampToValueAtTime(peak, w + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, w + dur); };
  const osc = (type, f, w, dur, peak, dest = master) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f, w); env(g, w, peak, dur); o.connect(g).connect(dest); o.start(w); o.stop(w + dur + 0.05); return o; };
  const burst = (w, dur, peak, type, freq, q = 1) => { const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = noise; f.type = type; f.frequency.value = freq; f.Q.value = q; env(g, w, peak, dur); s.connect(f).connect(g).connect(master); s.start(w); s.stop(w + dur + 0.05); };
  const SFX = {
    kick: (w) => { const o = osc('sine', 150, w, 0.28, 1); o.frequency.exponentialRampToValueAtTime(42, w + 0.12); },
    snare: (w) => { burst(w, 0.16, 0.55, 'bandpass', 1900, 0.8); osc('triangle', 190, w, 0.09, 0.35); },
    hat: (w) => burst(w, 0.045, 0.28, 'highpass', 7500),
    clap: (w) => { for (let i = 0; i < 3; i++) burst(w + i * 0.011, 0.03, 0.5, 'bandpass', 1300, 1.4); burst(w + 0.033, 0.18, 0.4, 'bandpass', 1300, 1.4); },
    laser: (w) => { const o = osc('square', 1500, w, 0.3, 0.3); o.frequency.exponentialRampToValueAtTime(110, w + 0.28); },   // el disparo de la nave
    bass: (w, m, len = 0.2) => osc('square', mtof(m), w, len, 0.32),
    lead: (w, m) => osc('square', mtof(m), w, 0.11, 0.12),
  };

  // ---------- knobs = skills con el nivel del CV ----------
  const SKILLS = I.knobs, LEAD = I.faders;
  const angle = (v) => `${-135 + v * 2.7}deg`;
  const knobs = $('knobs');
  SKILLS.forEach(([label, v], i) => {
    const b = document.createElement('button'); b.className = 'knob'; b.type = 'button';
    b.setAttribute('aria-label', fill(I.aria.knob, { label, v }));
    b.innerHTML = `<i style="--a:-135deg"></i><span>${label}</span>`;
    b.addEventListener('click', () => {
      const w = audio(); SFX.lead(w, [60, 62, 64, 67, 69, 72, 74, 76][i]);
      knobs.querySelectorAll('.on').forEach((k) => k.classList.remove('on')); b.classList.add('on');
      const dial = b.firstChild; dial.style.setProperty('--a', '-135deg');                 // gira desde cero hasta su valor
      requestAnimationFrame(() => requestAnimationFrame(() => dial.style.setProperty('--a', angle(v))));
      oled(label.toUpperCase(), `${I.oled.level} ${v}/100`, v / 100);
    });
    knobs.appendChild(b);
  });
  const faders = $('faders');
  LEAD.forEach(([label, v]) => { faders.insertAdjacentHTML('beforeend', `<div class="fader" role="img" aria-label="${fill(I.aria.fader, { label, v })}"><div class="tr"><span class="cap" data-v="${v / 100}"></span></div><span>${label}</span></div>`); });
  // al entrar en pantalla, knobs y faders suben a su valor con stagger de 60 ms
  new IntersectionObserver(([e], io) => {
    if (!e.isIntersecting) return; io.disconnect();
    knobs.querySelectorAll('.knob i').forEach((k, i) => { k.style.transitionDelay = `${i * 60}ms`; k.style.setProperty('--a', angle(SKILLS[i][1])); setTimeout(() => (k.style.transitionDelay = ''), 1200); });
    faders.querySelectorAll('.cap').forEach((c, i) => { c.style.transitionDelay = `${240 + i * 60}ms`; c.style.setProperty('--v', c.dataset.v); });
  }, { threshold: 0.35 }).observe($('lab'));

  // ---------- pads ----------
  const PADS = I.pads;
  const pads = $('pads'), padEl = {};
  const flash = (id, w) => { const el = padEl[id]; if (!el) return; setTimeout(() => { el.classList.add('hit'); setTimeout(() => el.classList.remove('hit'), 90); }, Math.max(0, (w - ac.currentTime) * 1000)); };
  let taps = [];
  PADS.forEach(([label, c, id]) => {
    const b = document.createElement('button'); b.className = 'pad'; b.type = 'button'; b.style.setProperty('--c', c); b.textContent = label;
    b.addEventListener('pointerdown', () => {
      const w = audio();
      if (SFX[id]) { SFX[id](w); flash(id, w); oled(label, I.oled.pad, 0); }
      else if (id === 'play') seqStart();
      else if (id === 'stop') seqStop();
      else if (id === 'tap') {
        const now = performance.now(); taps = taps.filter((x) => now - x < 2500).concat(now); flash('tap', w);
        if (taps.length > 1) { const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1); OLI.bpm = Math.round(Math.min(180, Math.max(70, 60000 / avg))); }
        oled(`${OLI.bpm} BPM`, I.oled.tap_tempo, (OLI.bpm - 70) / 110);
      }
    });
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); b.dispatchEvent(new PointerEvent('pointerdown')); } });
    padEl[id] = b; pads.appendChild(b);
  });

  // ---------- secuenciador chiptune con scheduling look-ahead (reloj de audio, no de setTimeout) ----------
  const KICK = '1000100010011000', SNARE = '0000100000001000', HAT = '0010001000100010';
  const BASS = [45, 0, 0, 45, 0, 0, 48, 0, 41, 0, 0, 41, 0, 0, 43, 0];
  const CHORDS = [[69, 72, 76], [65, 69, 72], [60, 64, 67], [67, 71, 74]];
  let seqT = 0, nextAt = 0, step = 0;
  function tick() {
    while (nextAt < ac.currentTime + 0.12) {
      const s = step % 16, bar = Math.floor(step / 16) % 4, w = nextAt;
      if (KICK[s] === '1') { SFX.kick(w); flash('kick', w); }
      if (SNARE[s] === '1') { SFX.snare(w); flash('snare', w); }
      if (HAT[s] === '1') { SFX.hat(w); flash('hat', w); }
      if (BASS[s]) SFX.bass(w, BASS[s] + [0, -4, 3, -2][bar], 0.18);
      SFX.lead(w, CHORDS[bar][step % 3] + 12);
      if (s % 4 === 0) flash('play', w);
      nextAt += 60 / OLI.bpm / 4; step++;
    }
  }
  function seqStart() { if (seqT) return; nextAt = audio() + 0.05; step = 0; seqT = setInterval(tick, 25); tick(); oled(I.oled.now_playing, fill(I.oled.loop, { bpm: OLI.bpm }), 1); }
  function seqStop() { clearInterval(seqT); seqT = 0; oled(I.oled.stop, I.oled.stopped, 0); }
  new IntersectionObserver(([e]) => { if (!e.isIntersecting && seqT) seqStop(); }).observe($('lab'));   // no suena si no lo ves

  // ---------- teclado: 1 octava en móvil, 2 en escritorio; glissando con el dedo ----------
  const keysEl = $('keys'), voices = new Map();
  const noteOn = (m, el) => {
    if (voices.has(m)) return;
    const w = audio(), o = ac.createOscillator(), o2 = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
    o.type = 'sawtooth'; o2.type = 'square'; o.frequency.value = mtof(m); o2.frequency.value = mtof(m) * 1.004;
    f.type = 'lowpass'; f.Q.value = 6; f.frequency.setValueAtTime(400, w); f.frequency.exponentialRampToValueAtTime(3200, w + 0.08); f.frequency.exponentialRampToValueAtTime(1100, w + 0.5);
    g.gain.setValueAtTime(0.0001, w); g.gain.linearRampToValueAtTime(0.22, w + 0.01);
    o.connect(f); o2.connect(f); f.connect(g).connect(master); o.start(w); o2.start(w);
    voices.set(m, { o, o2, g, el }); el.classList.add('down'); oled(name(m), I.oled.synth, (m - 48) / 36);
  };
  const noteOff = (m) => {
    const v = voices.get(m); if (!v) return; voices.delete(m);
    const w = ac.currentTime; v.g.gain.cancelScheduledValues(w); v.g.gain.setValueAtTime(v.g.gain.value, w); v.g.gain.exponentialRampToValueAtTime(0.0001, w + 0.25);
    v.o.stop(w + 0.3); v.o2.stop(w + 0.3); v.el.classList.remove('down');
  };
  const KEYMAP = 'awsedftgyhujk';                                   // fila de teclas tipo DAW
  function buildKeys() {
    const octaves = innerWidth >= 960 ? 2 : 1, base = 60, n = octaves * 12 + 1;
    keysEl.innerHTML = ''; const whites = [];
    for (let i = 0; i < n; i++) if (![1, 3, 6, 8, 10].includes(i % 12)) whites.push(base + i);
    const ww = 100 / whites.length;
    for (let i = 0; i < n; i++) {
      const m = base + i, black = [1, 3, 6, 8, 10].includes(i % 12);
      const b = document.createElement('button'); b.type = 'button'; b.className = 'key' + (black ? ' b' : ''); b.dataset.m = m; b.setAttribute('aria-label', name(m));
      if (black) { b.style.left = `${whites.indexOf(m + 1) * ww}%`; b.style.width = `${ww * 0.62}%`; }
      keysEl.appendChild(b);
    }
  }
  buildKeys(); addEventListener('resize', () => { if ((innerWidth >= 960) !== (keysEl.children.length > 13)) buildKeys(); });
  const keyAt = (x, y) => document.elementFromPoint(x, y)?.closest('.key');
  const held = new Map();                                            // pointerId → nota
  keysEl.addEventListener('pointerdown', (e) => { const k = e.target.closest('.key'); if (!k) return; held.set(e.pointerId, +k.dataset.m); noteOn(+k.dataset.m, k); });
  keysEl.addEventListener('pointermove', (e) => {
    if (!held.has(e.pointerId)) return; const k = keyAt(e.clientX, e.clientY); if (!k) return;
    const m = +k.dataset.m; if (m !== held.get(e.pointerId)) { noteOff(held.get(e.pointerId)); held.set(e.pointerId, m); noteOn(m, k); }
  });
  const up = (e) => { if (held.has(e.pointerId)) { noteOff(held.get(e.pointerId)); held.delete(e.pointerId); } };
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => keysEl.addEventListener(ev, up));
  keysEl.addEventListener('keydown', (e) => {
    const k = e.target.closest('.key'); if (!k || (e.key !== 'Enter' && e.key !== ' ') || e.repeat) return;
    e.preventDefault(); const m = +k.dataset.m; noteOn(m, k); setTimeout(() => noteOff(m), 300);
  });
  let labVisible = false;
  new IntersectionObserver(([e]) => (labVisible = e.isIntersecting), { threshold: 0.3 }).observe($('lab'));
  addEventListener('keydown', (e) => {
    if (!labVisible || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const i = KEYMAP.indexOf(e.key.toLowerCase()); if (i < 0) return;
    const k = keysEl.querySelector(`[data-m="${60 + i}"]`); if (k) noteOn(60 + i, k);
  });
  addEventListener('keyup', (e) => { const i = KEYMAP.indexOf(e.key.toLowerCase()); if (i >= 0) noteOff(60 + i); });

  // ---------- ukelele: Karplus-Strong (cuerda pulsada física, 1983) ----------
  const OPEN = [67, 60, 64, 69];                                     // afinación re-entrante G C E A
  const FRETS = { C: [0, 0, 0, 3], Am: [2, 0, 0, 0], F: [2, 0, 1, 0], G: [0, 2, 3, 2] };
  let chord = 'C';
  const ks = new Map();
  const pluck = (s) => {
    const w = audio(), f = mtof(OPEN[s] + FRETS[chord][s]), key = f.toFixed(1);
    let buf = ks.get(key);
    if (!buf) {
      const sr = ac.sampleRate, len = Math.floor(sr * 1.8), N = Math.round(sr / f);
      buf = ac.createBuffer(1, len, sr); const d = buf.getChannelData(0);
      for (let i = 0; i < N; i++) d[i] = Math.random() * 2 - 1;
      for (let i = 1; i < N; i++) d[i] = 0.5 * (d[i] + d[i - 1]);  // ataque más suave: cuerda de nylon
      for (let i = N; i < len; i++) d[i] = 0.4985 * (d[i - N] + d[i - N + 1]);
      ks.set(key, buf);
    }
    const src = ac.createBufferSource(), g = ac.createGain(); src.buffer = buf; g.gain.value = 0.55; src.connect(g).connect(master); src.start(w);
    const el = strings.children[s]; el.classList.remove('pl'); void el.offsetWidth; el.classList.add('pl');
  };
  const strings = $('strings');
  document.querySelectorAll('.chord').forEach((b) => b.addEventListener('click', () => {
    chord = b.dataset.ch; document.querySelectorAll('.chord').forEach((x) => x.setAttribute('aria-pressed', x === b));
    [0, 1, 2, 3].forEach((s, i) => setTimeout(() => pluck(s), i * 28));   // rasgueo hacia abajo
  }));
  let lastS = -1, strumming = false;
  const strAt = (x, y) => document.elementFromPoint(x, y)?.closest('.str');
  strings.addEventListener('pointerdown', (e) => { const s = e.target.closest('.str'); if (!s) return; strumming = true; lastS = +s.dataset.s; pluck(lastS); });
  strings.addEventListener('pointermove', (e) => { if (!strumming) return; const s = strAt(e.clientX, e.clientY); if (s && +s.dataset.s !== lastS) { lastS = +s.dataset.s; pluck(lastS); } });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => strings.addEventListener(ev, () => { strumming = false; lastS = -1; }));
  strings.addEventListener('keydown', (e) => { const s = e.target.closest('.str'); if (s && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pluck(+s.dataset.s); } });

  // ---------- ukelele en pixel art (dibujado a mano en código, paleta de 12 bits) ----------
  (function drawUke() {
    const cv = $('ukeArt'), c = cv.getContext('2d'), W = 128, H = 40;
    const inBody = (x, y) => ((x - 22) / 20) ** 2 + ((y - 20) / 17) ** 2 <= 1 || ((x - 49) / 15) ** 2 + ((y - 20) / 13) ** 2 <= 1;
    const B = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!inBody(x, y)) continue;
      const edge = !inBody(x - 1, y) || !inBody(x + 1, y) || !inBody(x, y - 1) || !inBody(x, y + 1);
      const grain = Math.sin(y * 1.7 + Math.sin(x * 0.15) * 2) * 0.5 + 0.5 + B[(y & 3) * 4 + (x & 3)] / 32;
      c.fillStyle = edge ? '#eee' : grain > 1.05 ? '#6ac' : grain > 0.55 ? '#48a' : '#368'; c.fillRect(x, y, 1, 1);
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const d = Math.hypot(x - 43.5, y - 19.5); if (d <= 7.2) { c.fillStyle = d > 6.2 ? '#ccc' : '#000'; c.fillRect(x, y, 1, 1); } }
    c.fillStyle = '#421'; c.fillRect(13, 13, 4, 14);                              // puente
    c.fillStyle = '#321'; c.fillRect(57, 16, 56, 8);                              // diapasón
    c.fillStyle = '#aaa'; let fx = 60; for (let i = 0; i < 14; i++) { c.fillRect(Math.round(fx), 16, 1, 8); fx += 4.6 - i * 0.1; }
    c.fillStyle = '#eee'; [[67, 20], [76, 20], [84, 20], [91, 19], [91, 21], [103, 20]].forEach(([x, y]) => c.fillRect(x, y, 1, 1));   // fases lunares
    c.fillStyle = '#48a'; c.beginPath(); c.moveTo(113, 15); c.lineTo(126, 12); c.lineTo(127, 26); c.lineTo(113, 25); c.fill();     // pala
    c.fillStyle = '#ddd'; [115, 118, 121, 124].forEach((x) => { c.fillRect(x, 10, 2, 2); c.fillRect(x, 12, 1, 3); });                // clavijas
    c.fillStyle = 'rgba(238,238,238,.85)'; [17, 19, 21, 23].forEach((y, i) => c.fillRect(15, y - (i < 2 ? 0 : 0) - 1 + (i * 0), 101, 1));
    const fit = () => { const k = Math.max(2, Math.floor((cv.parentElement.clientWidth - 32) / W)); cv.style.width = W * k + 'px'; cv.style.height = H * k + 'px'; };
    fit(); addEventListener('resize', fit);
  })();

  // ---------- vídeos propios con dirección de arte: reel vertical en móvil, horizontal en escritorio ----------
  // solo se descarga el que se ve; en móvil arranca un loop mudo de 1,3 MB y el reel completo (6 MB) solo al pedir sonido
  const mq = matchMedia('(max-width:639px) and (orientation:portrait)'), vidH = $('vidH'), vidV = $('vidV'), snd = $('snd'), cap = $('cap');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const active = () => (mq.matches ? vidV : vidH);
  let inView = false;
  const sync = () => {
    const v = active();
    [vidH, vidV].forEach((x) => { if (x !== v || !inView) x.pause(); });
    cap.textContent = v === vidV ? I.captions.v : I.captions.h;
    snd.setAttribute('aria-pressed', !v.muted); snd.textContent = v.muted ? I.sound.on : I.sound.playing;
    if (!inView) return;
    if (v.preload !== 'auto') { v.preload = 'auto'; v.load(); }
    if (!still || !v.muted) v.play().catch(() => {});
  };
  new IntersectionObserver(([e]) => { inView = e.isIntersecting; sync(); }, { rootMargin: '200px 0px' }).observe($('stage'));
  mq.addEventListener('change', sync);
  snd.addEventListener('click', () => {
    const v = active();
    if (v.muted) {
      if (!v.currentSrc.endsWith(v.dataset.full)) v.src = v.dataset.full;     // loop mudo → versión completa con audio
      v.muted = false; v.currentTime = 0; v.play().catch(() => {});
    } else v.muted = true;
    sync();
  });
})();
