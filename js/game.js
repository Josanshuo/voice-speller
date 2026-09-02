/* Vox Tower — game engine (plain script; runs from file:// or any static server) */
(function () {
  'use strict';

  const P = window.VoxPitch, LV = window.VoxLevels, I18N = window.VoxI18N;

  const W = 480, H = 270, GROUND_Y = 222;
  const NUM_FLOORS = LV.FLOORS.length;
  const CHARGE_TIME = 0.32;      // seconds of on-pitch singing per cast
  const CAST_COOLDOWN = 0.10;
  const DMG_WEAK = 12, DMG_OTHER = 3;
  const TRACE_SECONDS = 1.6;

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ---------- settings (persisted per browser) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('vox.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('vox.' + k, JSON.stringify(v)); } catch (e) { /* private mode etc. */ } },
  };
  const settings = {
    lang: store.get('lang', 'en'),
    range: store.get('range', 'kid'),
    threshold: store.get('threshold', 0.35),
    sfx: store.get('sfx', true),
  };
  if (!I18N[settings.lang]) settings.lang = 'en';
  if (!LV.RANGES[settings.range]) settings.range = 'kid';

  // ---------- local high scores (this browser only) ----------
  const MAX_SCORES = 5;
  const scores = {
    list: (store.get('scores', []) || []).filter((e) => e && typeof e.score === 'number'),
    lastName: String(store.get('name', '') || ''),
    best() { return this.list.length ? this.list[0].score : 0; },
    /** Record (or update) the run's entry; returns its rank or -1 if it missed the table. */
    record(runId, score, floors) {
      let e = this.list.find((x) => x.id === runId);
      if (e) { e.score = Math.max(e.score, score); e.floors = Math.max(e.floors, floors); e.date = Date.now(); }
      else { e = { id: runId, name: this.lastName, score, floors, date: Date.now() }; this.list.push(e); }
      this.list.sort((a, b) => b.score - a.score || a.date - b.date);
      this.list = this.list.slice(0, MAX_SCORES);
      this.save();
      const rank = this.list.indexOf(e);
      return { rank, entry: rank >= 0 ? e : null };
    },
    setName(runId, name) {
      name = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 8);
      this.lastName = name;
      const e = this.list.find((x) => x.id === runId);
      if (e) e.name = name;
      this.save();
    },
    save() { store.set('scores', this.list); store.set('name', this.lastName); },
  };

  // ---------- i18n ----------
  function t(key, vars) {
    const dict = I18N[settings.lang] || I18N.en;
    let s = dict[key] != null ? dict[key] : I18N.en[key];
    if (s == null) s = key;
    if (typeof s === 'string' && vars) {
      for (const k in vars) s = s.split('{' + k + '}').join(String(vars[k]));
    }
    return s;
  }
  function tf(i, key) {
    const dict = I18N[settings.lang] || I18N.en;
    const f = dict.floors && dict.floors[i];
    return (f && f[key] != null) ? f[key] : (I18N.en.floors[i][key] || '');
  }
  const spellName = (i) => (I18N[settings.lang].spells || I18N.en.spells)[i];
  const spellLabel = (i) => LV.SPELLS[i].icon + ' ' + spellName(i);

  // ---------- pitch ranges / bands ----------
  const range = () => LV.RANGES[settings.range] || LV.RANGES.kid;
  function bandBounds(i) {
    const r = range(); const bw = (r.hi - r.lo) / 5;
    return { lo: r.lo + bw * i, hi: r.lo + bw * (i + 1) };
  }
  const bandRangeLabel = (i) => { const b = bandBounds(i); return P.midiToName(b.lo) + '–' + P.midiToName(b.hi); };
  function bandOf(midi) {
    const r = range();
    if (midi < r.lo) return { band: -1, pos: 'low' };
    if (midi >= r.hi) return { band: -1, pos: 'high' };
    return { band: clamp(Math.floor((midi - r.lo) / ((r.hi - r.lo) / 5)), 0, 4), pos: 'in' };
  }

  // ---------- assets ----------
  const images = {};
  function loadImages() {
    return Promise.all(Object.keys(LV.SHEETS).map((key) => new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => { images[key] = im; resolve(); };
      im.onerror = () => reject(new Error('Could not load ' + LV.SHEETS[key].src));
      im.src = LV.SHEETS[key].src;
    })));
  }
  function drawTile(c, sheetKey, index, x, y, scale) {
    const s = LV.SHEETS[sheetKey], im = images[sheetKey];
    if (!im) return;
    const sx = (index % s.cols) * s.tile, sy = Math.floor(index / s.cols) * s.tile;
    c.drawImage(im, sx, sy, s.tile, s.tile, x, y, s.tile * scale, s.tile * scale);
  }
  function spriteCanvas(sheetKey, index, scale) {
    const s = LV.SHEETS[sheetKey];
    const c = document.createElement('canvas');
    c.width = c.height = s.tile * scale;
    const cx = c.getContext('2d');
    cx.imageSmoothingEnabled = false;
    drawTile(cx, sheetKey, index, 0, 0, scale);
    c.style.width = c.width + 'px';
    c.style.height = c.height + 'px';
    return c;
  }
  const fx = document.createElement('canvas'); fx.width = fx.height = 128;
  const fxc = fx.getContext('2d');
  function drawTileTinted(c, sheetKey, index, x, y, scale, color, alpha) {
    const size = LV.SHEETS[sheetKey].tile * scale;
    fxc.clearRect(0, 0, fx.width, fx.height);
    fxc.imageSmoothingEnabled = false;
    drawTile(fxc, sheetKey, index, 0, 0, scale);
    fxc.globalCompositeOperation = 'source-atop';
    fxc.globalAlpha = alpha; fxc.fillStyle = color; fxc.fillRect(0, 0, size, size);
    fxc.globalCompositeOperation = 'source-over'; fxc.globalAlpha = 1;
    c.drawImage(fx, 0, 0, size, size, x, y, size, size);
  }

  // ---------- sound effects (tiny synth) ----------
  const sfx = {
    ctx: null,
    init() {
      if (this.ctx) return;
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; }
    },
    tone(f0, f1, dur, type, gain, delay) {
      const c = this.ctx, t0 = c.currentTime + (delay || 0);
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.02);
    },
    noise(dur, gain, delay) {
      const c = this.ctx, t0 = c.currentTime + (delay || 0);
      const n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = c.createBufferSource(), g = c.createGain();
      src.buffer = buf; g.gain.value = gain;
      src.connect(g).connect(c.destination); src.start(t0);
    },
    play(name, band) {
      if (!settings.sfx || !this.ctx) return;
      const c = this.ctx; if (c.state === 'suspended') c.resume();
      switch (name) {
        case 'cast': this.tone(420 + band * 90, 1500 + band * 220, 0.09, 'triangle', 0.10); break;
        case 'hit': this.tone(170, 55, 0.12, 'square', 0.08); this.noise(0.06, 0.07); break;
        case 'hitWeak': this.tone(700, 1400, 0.09, 'sine', 0.10); this.noise(0.09, 0.10); break;
        case 'ui': this.tone(900, 900, 0.03, 'square', 0.04); break;
        case 'start': this.tone(330, 660, 0.16, 'triangle', 0.09); this.tone(660, 990, 0.16, 'triangle', 0.07, 0.12); break;
        case 'phase': this.tone(220, 110, 0.35, 'sawtooth', 0.08); break;
        case 'win': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, f, 0.14, 'square', 0.06, i * 0.11)); break;
        case 'lose': [392, 330, 262].forEach((f, i) => this.tone(f, f * 0.9, 0.22, 'triangle', 0.07, i * 0.2)); break;
        case 'final': [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => this.tone(f, f, 0.16, 'square', 0.06, i * 0.1)); break;
        default: break;
      }
    },
  };

  // ---------- scene state ----------
  const stars = [];
  for (let i = 0; i < 120; i++) {
    stars.push({ x: Math.floor(rand(0, W)), y: Math.floor(rand(0, GROUND_Y - 24)), s: Math.random() < 0.14 ? 2 : 1, a: rand(0.35, 1), tw: rand(0.8, 3.2), ph: rand(0, Math.PI * 2) });
  }
  const hero = { x: 72, cast: 0, castBand: -1 };
  const boss = { x: 392, hp: 100, maxHp: 100, flash: 0, hurt: 0, hop: 0, phase: 0, dead: 0, faded: 0 };
  let projectiles = [], particles = [], popups = [];
  let shake = 0, timeNow = 0;

  const G = {
    screen: 'title', floor: 0, timeLeft: 0, score: 0, floorScore: 0, damageScore: 0,
    wrongCasts: 0, combo: 0, bestCombo: 0, charge: [0, 0, 0, 0, 0], cooldown: 0, bossTimer: 6, weak: 2, loots: [],
    lastBand: -1, runId: '', floorsCleared: 0,
  };

  // ---------- input: microphone, keys, slot taps ----------
  let mic = null, micState = 'idle';
  const keyHeld = [false, false, false, false, false];
  const tapHeld = [false, false, false, false, false];
  let voice = { midi: 0, hz: 0, note: '', level: 0, voiced: false, sim: false, simBand: -1 };
  const trace = [];

  function readVoice() {
    let fb = -1;
    for (let i = 0; i < 5; i++) if (keyHeld[i] || tapHeld[i]) { fb = i; break; }
    let r = null;
    if (mic && mic.running) r = mic.update();
    if (fb >= 0) {
      const b = bandBounds(fb); const midi = (b.lo + b.hi) / 2;
      return { midi, hz: P.midiToHz(midi), note: P.midiToName(midi), level: 1, voiced: true, sim: true, simBand: fb };
    }
    if (r) return { midi: r.midi, hz: r.hz, note: r.note, level: r.level, voiced: r.voiced, sim: false, simBand: -1 };
    return { midi: 0, hz: 0, note: '', level: 0, voiced: false, sim: false, simBand: -1 };
  }
  const voiceActive = (v) => v.voiced && (v.sim || v.level >= settings.threshold);

  async function enableMic() {
    if (micState === 'ok' || micState === 'busy') return;
    micState = 'busy'; setMicStatus();
    try {
      mic = new P.PitchTracker({ fftSize: 4096 });
      applyMicRange();
      await mic.start();
      micState = 'ok';
    } catch (e) {
      micState = 'err'; mic = null;
    }
    setMicStatus();
  }
  function applyMicRange() {
    if (!mic) return;
    const r = range();
    mic.minHz = P.midiToHz(r.lo) / 1.25;
    mic.maxHz = P.midiToHz(r.hi) * 1.25;
  }
  function setMicStatus() {
    const el = $('micStatus'), live = $('micLive'), btn = $('btnMic');
    el.className = 'mic-status';
    if (micState === 'ok') { el.textContent = t('micOk'); el.classList.add('ok'); live.hidden = false; btn.hidden = true; }
    else if (micState === 'err') { el.textContent = t('micErr'); el.classList.add('err'); live.hidden = true; btn.hidden = false; }
    else if (micState === 'busy') { el.textContent = t('micBusy'); live.hidden = true; }
    else { el.textContent = t('micIdle'); live.hidden = true; btn.hidden = false; }
  }

  // ---------- DOM refs ----------
  const canvas = $('scene'), ctx = canvas.getContext('2d');
  const wrap = $('sceneWrap'), stage = $('stage');
  const traceCanvas = $('trace'), traceCtx = traceCanvas.getContext('2d');
  let k = 2, dpr = 1;
  const slotEls = [];

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const sw = Math.max(120, stage.clientWidth - 8), sh = Math.max(80, stage.clientHeight - 8);
    // Fill the stage (fractional CSS scale) while rendering at an integer
    // pixel scale close to it, so sprites stay crisp on any screen.
    const fit = Math.min(sw / W, sh / H);
    k = Math.max(1, Math.round(fit * dpr));
    canvas.width = W * k; canvas.height = H * k;
    const cssW = Math.floor(W * fit), cssH = Math.floor(H * fit);
    wrap.style.width = cssW + 'px'; wrap.style.height = cssH + 'px';
    canvas.style.width = '100%'; canvas.style.height = '100%';
    ctx.imageSmoothingEnabled = false;
    // trace canvas
    const tr = traceCanvas.getBoundingClientRect();
    traceCanvas.width = Math.max(1, Math.floor(tr.width * dpr));
    traceCanvas.height = Math.max(1, Math.floor(tr.height * dpr));
  }

  function buildSlots() {
    const host = $('slots');
    for (let i = 0; i < 5; i++) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'slot'; b.dataset.band = String(i);
      b.style.setProperty('--c', LV.SPELLS[i].color);
      b.setAttribute('aria-label', spellName(i));
      const icon = document.createElement('span'); icon.className = 'slot-icon'; icon.textContent = LV.SPELLS[i].icon;
      const name = document.createElement('span'); name.className = 'slot-name';
      const rng = document.createElement('span'); rng.className = 'slot-range num';
      const ch = document.createElement('span'); ch.className = 'slot-charge'; ch.appendChild(document.createElement('i'));
      b.append(icon, name, rng, ch);
      const down = (e) => { e.preventDefault(); tapHeld[i] = true; sfx.init(); try { b.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } };
      const up = () => { tapHeld[i] = false; };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      host.appendChild(b);
      slotEls.push({ el: b, name, rng, fill: ch.firstChild });
    }
  }
  function refreshRanges() {
    const r = range();
    for (let i = 0; i < 5; i++) { slotEls[i].name.textContent = spellName(i); slotEls[i].rng.textContent = bandRangeLabel(i); slotEls[i].el.setAttribute('aria-label', spellName(i)); }
    $('dashRange').textContent = t('dashRange', { lo: P.midiToName(r.lo), hi: P.midiToName(r.hi) });
    $('rangeNote').textContent = P.midiToName(r.lo) + ' – ' + P.midiToName(r.hi);
    document.querySelectorAll('#segRange button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.range === settings.range)));
    applyMicRange();
  }
  function refreshThreshold() {
    $('thresh').value = String(settings.threshold);
    $('volThresh').style.bottom = (settings.threshold * 100) + '%';
    $('micThresh').style.left = (settings.threshold * 100) + '%';
  }
  function applyLang() {
    document.documentElement.lang = settings.lang === 'zh' ? 'zh-CN' : 'en';
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.dataset.i18n;
      if (key === 'chantPower') el.innerHTML = t(key); else el.textContent = t(key);
    });
    document.title = t('title') === 'VOX TOWER' ? 'Vox Tower' : t('title');
    document.querySelectorAll('#segLang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === settings.lang)));
    $('sfxState').textContent = t(settings.sfx ? 'on' : 'off');
    refreshRanges();
    setMicStatus();
    renderHighScores();
    updateHudStatic();
    if (G.screen === 'intro') fillIntro();
    if (G.screen === 'result') fillResult(G.resultKind);
  }

  // ---------- HUD ----------
  function updateHudStatic() {
    const i = G.floor, F = LV.FLOORS[i];
    $('hudFloor').textContent = t('floor', { n: i + 1, total: NUM_FLOORS });
    $('hudFloorName').textContent = tf(i, 'name');
    $('hudBossName').textContent = tf(i, 'boss');
    $('hudWeakSpell').textContent = spellLabel(G.weak);
    $('hudBossHp').textContent = String(Math.max(0, Math.ceil(boss.hp)));
    $('hudTimeVal').textContent = Math.ceil(G.timeLeft) + 's';
    for (let s = 0; s < 5; s++) slotEls[s].el.classList.toggle('weak', s === G.weak && G.screen !== 'title');
    void F;
  }
  function updateHud() {
    const F = LV.FLOORS[G.floor];
    $('hudTimeVal').textContent = Math.ceil(G.timeLeft) + 's';
    $('hudTimeFill').style.transform = 'scaleX(' + clamp(G.timeLeft / F.time, 0, 1) + ')';
    $('hudBossHp').textContent = String(Math.max(0, Math.ceil(boss.hp)));
    $('hudBossFill').style.transform = 'scaleX(' + clamp(boss.hp / boss.maxHp, 0, 1) + ')';
    $('hudScore').textContent = String(G.score + (G.screen === 'battle' ? G.damageScore : 0));

    const active = voiceActive(voice);
    const b = active ? bandOf(voice.midi) : { band: -1, pos: 'in' };
    for (let s = 0; s < 5; s++) {
      slotEls[s].el.classList.toggle('active', b.band === s);
      slotEls[s].fill.style.width = (G.charge[s] * 100) + '%';
    }
    // readout
    const note = $('readNote'), hz = $('readHz'), hint = $('readHint');
    if (voice.voiced) { note.textContent = voice.note; hz.textContent = voice.hz.toFixed(1) + ' Hz'; }
    else { note.textContent = '—'; hz.textContent = '0 Hz'; }
    hint.className = 'read-hint';
    if (voice.sim) { hint.textContent = t('hintSim', { n: voice.simBand + 1, spell: spellName(voice.simBand) }); hint.classList.add('ok'); }
    else if (!voice.voiced) { hint.textContent = t('hintReady'); }
    else if (voice.level < settings.threshold) { hint.textContent = t('hintQuiet'); hint.classList.add('warn'); }
    else if (b.pos === 'low') { hint.textContent = t('hintLow'); hint.classList.add('warn'); }
    else if (b.pos === 'high') { hint.textContent = t('hintHigh'); hint.classList.add('warn'); }
    else { hint.textContent = t('hintCharging', { spell: spellName(b.band) }); hint.classList.add('ok'); }
    // volume
    const vf = $('volFill');
    vf.style.height = (clamp(voice.sim ? 1 : voice.level, 0, 1) * 100) + '%';
    vf.classList.toggle('hot', active);
    if (G.screen === 'title' && micState === 'ok') {
      const mf = $('micFill');
      mf.style.width = (clamp(voice.level, 0, 1) * 100) + '%';
      mf.classList.toggle('hot', voice.level >= settings.threshold);
      $('micNote').textContent = voice.voiced ? voice.note : '—';
    }
    drawTrace(b.band);
  }

  function drawTrace(currentBand) {
    const c = traceCtx, w = traceCanvas.width, h = traceCanvas.height;
    c.clearRect(0, 0, w, h);
    if (!trace.length) return;
    const r = range();
    const px = Math.max(2, Math.round(2 * dpr));
    for (let i = 0; i < trace.length; i++) {
      const p = trace[i];
      const age = timeNow - p.t;
      if (age > TRACE_SECONDS) continue;
      const fx0 = clamp((p.midi - r.lo) / (r.hi - r.lo), -0.02, 1.02);
      const x = fx0 * w;
      const y = h * 0.14 + (age / TRACE_SECONDS) * h * 0.72;
      c.globalAlpha = (1 - age / TRACE_SECONDS) * 0.9;
      c.fillStyle = p.band >= 0 ? LV.SPELLS[p.band].color : '#9aa3d9';
      const s = i === trace.length - 1 ? px * 3 : px * 2;
      c.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s);
    }
    c.globalAlpha = 1;
    void currentBand;
  }

  // ---------- banners & bubbles ----------
  let bannerTimer = 0, bubbleTimer = 0, comboTimer = 0, resultTimer = 0;
  function banner(text, cls, ms) {
    const el = $('banner');
    el.textContent = text; el.className = 'banner' + (cls ? ' ' + cls : ''); el.hidden = false;
    clearTimeout(bannerTimer); bannerTimer = setTimeout(() => { el.hidden = true; }, ms || 1500);
  }
  function bossSay(text, ms) {
    const el = $('bossBubble');
    el.textContent = text; el.hidden = false;
    positionBubble();
    clearTimeout(bubbleTimer); bubbleTimer = setTimeout(() => { el.hidden = true; }, ms || 2600);
  }
  function positionBubble() {
    const F = LV.FLOORS[G.floor];
    const size = 16 * F.boss.scale;
    const top = GROUND_Y - size - (F.boss.fly ? 26 : 0) - 6;
    const el = $('bossBubble');
    el.style.left = ((boss.x - size / 2 + 10) / W * 100) + '%';
    el.style.top = (top / H * 100) + '%';
  }
  function showCombo(n) {
    const el = $('combo');
    el.textContent = t('combo', { n }); el.hidden = false;
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(comboTimer); comboTimer = setTimeout(() => { el.hidden = true; }, 1200);
  }

  // ---------- screens ----------
  function showOverlay(name) {
    $('ovTitle').hidden = name !== 'title';
    $('ovIntro').hidden = name !== 'intro';
    $('ovResult').hidden = name !== 'result';
    $('app').dataset.screen = name || 'battle';
  }

  function startFloor(i) {
    const F = LV.FLOORS[i];
    G.floor = i; G.weak = F.weak[0];
    boss.hp = boss.maxHp = F.hp; boss.phase = 0; boss.dead = 0; boss.faded = 0; boss.flash = 0; boss.hurt = 0; boss.hop = 0;
    G.timeLeft = F.time; G.damageScore = 0; G.wrongCasts = 0; G.combo = 0; G.bestCombo = 0; G.cooldown = 0; G.lastBand = -1;
    G.charge.fill(0);
    projectiles = []; particles = []; popups = [];
    $('bossBubble').hidden = true; $('banner').hidden = true; $('combo').hidden = true;
    clearTimeout(resultTimer);
    G.screen = 'intro';
    fillIntro();
    showOverlay('intro');
    updateHudStatic();
  }

  function fillIntro() {
    const i = G.floor, F = LV.FLOORS[i];
    $('introFloor').textContent = t('floorEyebrow', { n: i + 1, total: NUM_FLOORS });
    $('introName').textContent = tf(i, 'name');
    const art = $('introBoss'); art.innerHTML = ''; art.appendChild(spriteCanvas(F.boss.sheet, F.boss.tile, 5));
    $('introTaunt').textContent = '“' + tf(i, 'taunt') + '”';
    const hints = $('introHints');
    const weakTxt = F.weak.map((w) => spellLabel(w) + ' (' + bandRangeLabel(w) + ')').join(' → ');
    hints.innerHTML = t('hintTimeLimit', { n: F.time }) + '<br>' +
      t('hintWeak', { spell: weakTxt }) + '<br>' +
      t('hintTip', { tip: tf(i, 'tip') });
  }

  function beginBattle() {
    showOverlay(null);
    G.screen = 'battle';
    banner(t('banPurify'), 'gold', 1500);
    bossSay(tf(G.floor, 'taunt'), 3200);
    sfx.play('start');
    G.bossTimer = 7;
    updateHudStatic();
  }

  function cast(band) {
    const F = LV.FLOORS[G.floor];
    const size = 16 * F.boss.scale;
    const targetY = GROUND_Y - size / 2 - (F.boss.fly ? 26 : 0);
    projectiles.push({ x: hero.x + 22, y: GROUND_Y - 22, y0: GROUND_Y - 22, ty: targetY, vx: 250 + band * 25, band, t: 0, x0: hero.x + 22 });
    hero.cast = 1; hero.castBand = band;
    slotEls[band].el.classList.remove('fired'); void slotEls[band].el.offsetWidth; slotEls[band].el.classList.add('fired');
    sfx.play('cast', band);
    if (band !== G.weak) G.wrongCasts++;
    // muzzle sparks
    for (let i = 0; i < 6; i++) particles.push({ x: hero.x + 22, y: GROUND_Y - 22, vx: rand(20, 90), vy: rand(-50, 50), life: rand(0.2, 0.4), t: 0, color: LV.SPELLS[band].color, size: 2 });
  }

  function hitBoss(pr) {
    const weak = pr.band === G.weak;
    const dmg = weak ? DMG_WEAK : DMG_OTHER;
    boss.hp = Math.max(0, boss.hp - dmg);
    boss.flash = 0.14; boss.hurt = 0.28;
    G.damageScore += dmg * 10;
    if (weak) { G.combo++; G.bestCombo = Math.max(G.bestCombo, G.combo); if (G.combo >= 3) showCombo(G.combo); G.damageScore += Math.min(G.combo, 10) * 5; }
    else G.combo = 0;
    if (!reduceMotion) shake = weak ? 0.22 : 0.1;
    popups.push({ x: pr.x, y: pr.y - 10, text: '-' + dmg, color: weak ? LV.SPELLS[pr.band].color : '#c9cbe6', t: 0, life: 0.8, big: weak });
    const col = LV.SPELLS[pr.band].color;
    const n = weak ? 18 : 8;
    for (let i = 0; i < n; i++) particles.push({ x: pr.x, y: pr.y, vx: rand(-120, 120), vy: rand(-140, 60), life: rand(0.3, 0.7), t: 0, color: col, size: weak ? 3 : 2, grav: 220 });
    sfx.play(weak ? 'hitWeak' : 'hit');
    if (weak && Math.random() < 0.3 && $('bossBubble').hidden) bossSay(pick(t('hurt')), 1200);

    const F = LV.FLOORS[G.floor];
    if (F.weak.length > 1 && boss.phase === 0 && boss.hp <= boss.maxHp / 2) {
      boss.phase = 1; G.weak = F.weak[1]; G.combo = 0;
      banner(t('banWeakChange', { spell: spellLabel(G.weak) }), 'red', 2200);
      bossSay(tf(G.floor, 'taunt2') || pick(t('idle')), 3000);
      $('hudWeak').classList.remove('pulse'); void $('hudWeak').offsetWidth; $('hudWeak').classList.add('pulse');
      sfx.play('phase');
      updateHudStatic();
    }
    if (boss.hp <= 0) victory();
  }

  function victory() {
    boss.dead = 1;
    G.screen = 'dying';
    $('bossBubble').hidden = true;
    const F = LV.FLOORS[G.floor];
    const size = 16 * F.boss.scale;
    const cy = GROUND_Y - size / 2 - (F.boss.fly ? 26 : 0);
    for (let i = 0; i < 40; i++) particles.push({ x: boss.x + rand(-size / 2, size / 2), y: cy + rand(-size / 2, size / 2), vx: rand(-90, 90), vy: rand(-160, -20), life: rand(0.5, 1.1), t: 0, color: pick(['#ffffff', F.accent, '#ffcc33']), size: 3, grav: 120 });
    sfx.play('win');
    const timeBonus = Math.round(G.timeLeft) * 8;
    const perfect = G.wrongCasts === 0 ? 500 : 0;
    G.floorScore = G.damageScore + timeBonus + perfect;
    G.result = { timeBonus, perfect, floorScore: G.floorScore };
    G.score += G.floorScore;
    G.loots.push(F.loot);
    G.floorsCleared = Math.max(G.floorsCleared, G.floor + 1);
    if (G.runId) { scores.record(G.runId, G.score, G.floorsCleared); renderHighScores(); } // keep the run's entry current
    resultTimer = setTimeout(() => { G.screen = 'result'; fillResult('win'); showOverlay('result'); }, 1100);
  }

  function defeat() {
    G.screen = 'result';
    banner(t('banTimeUp'), 'red', 1500);
    sfx.play('lose');
    fillResult('lose');
    resultTimer = setTimeout(() => showOverlay('result'), 700);
  }

  function fillResult(kind) {
    G.resultKind = kind;
    const card = $('resultCard'); card.innerHTML = '';
    const F = LV.FLOORS[G.floor];
    const h2 = document.createElement('h2');
    const art = document.createElement('div'); art.className = 'result-art';
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn btn-gold btn-big';

    if (kind === 'win' || kind === 'final') {
      if (kind === 'win') {
        h2.className = 'result-title win'; h2.textContent = t('win');
        art.appendChild(spriteCanvas(F.loot.sheet, F.loot.tile, 4));
        const ln = document.createElement('div'); ln.className = 'loot-name'; ln.textContent = t('loot', { name: tf(G.floor, 'loot') });
        const fl = document.createElement('p'); fl.className = 'loot-flavor'; fl.textContent = tf(G.floor, 'flavor');
        card.append(h2, art, ln, fl);
      } else {
        h2.className = 'result-title win'; h2.textContent = t('finalTitle');
        art.appendChild(spriteCanvas(LV.HERO.sheet, LV.HERO.tile, 4));
        G.loots.forEach((l) => art.appendChild(spriteCanvas(l.sheet, l.tile, 3)));
        const p = document.createElement('p'); p.className = 'result-text'; p.textContent = t('finalText');
        card.append(h2, art, p);
        scoreSection(card);
      }
      const grid = document.createElement('div'); grid.className = 'score-grid';
      const box = (label, val, cls) => { const d = document.createElement('div'); d.className = 'score-box' + (cls ? ' ' + cls : ''); const s = document.createElement('span'); s.textContent = label; const b = document.createElement('b'); b.textContent = val; d.append(s, b); return d; };
      if (kind === 'win') {
        grid.append(box(t('timeBonus'), '+' + G.result.timeBonus), box(t('perfectBonus'), '+' + G.result.perfect), box(t('floorScore'), String(G.result.floorScore)), box(t('total'), String(G.score), 'total'));
        btn.textContent = t('climbOn');
        btn.addEventListener('click', () => { sfx.play('ui'); nextFloor(); });
      } else {
        grid.append(box(t('finalScore'), String(G.score), 'total'));
        btn.textContent = t('playAgain');
        btn.addEventListener('click', () => { sfx.play('ui'); showTitle(); });
      }
      card.append(grid, btn);
    } else {
      h2.className = 'result-title lose'; h2.textContent = t('lose');
      art.appendChild(spriteCanvas(F.boss.sheet, F.boss.tile, 4));
      const p = document.createElement('p'); p.className = 'result-text'; p.textContent = t('loseText', { boss: tf(G.floor, 'boss') });
      btn.textContent = t('tryAgain');
      btn.addEventListener('click', () => { sfx.play('ui'); startFloor(G.floor); });
      card.append(h2, art, p);
      scoreSection(card);
      card.append(btn);
    }
  }

  function nextFloor() {
    if (G.floor + 1 >= NUM_FLOORS) { G.screen = 'result'; fillResult('final'); showOverlay('result'); sfx.play('final'); }
    else startFloor(G.floor + 1);
  }

  // ---------- runs & high scores ----------
  function showTitle() {
    clearTimeout(resultTimer);
    G.screen = 'title';
    $('bossBubble').hidden = true; $('banner').hidden = true; $('combo').hidden = true;
    renderHighScores();
    showOverlay('title');
    updateHudStatic();
  }
  function newRun() {
    G.score = 0; G.loots = []; G.floorsCleared = 0;
    G.runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    startFloor(0);
  }
  function span(cls, text) { const el = document.createElement('span'); el.className = cls; el.textContent = text; return el; }

  function renderHighScores() {
    const host = $('hiscores'); if (!host) return;
    host.innerHTML = '';
    host.appendChild(span('hiscores-title', t('highScores')));
    if (!scores.list.length) {
      const p = document.createElement('p'); p.className = 'hiscores-empty'; p.textContent = t('noScores');
      host.appendChild(p); return;
    }
    const ol = document.createElement('ol'); ol.className = 'hiscores-list';
    scores.list.forEach((e, i) => {
      const li = document.createElement('li');
      li.title = new Date(e.date).toLocaleDateString();
      li.append(span('rank num', String(i + 1)), span('name', e.name || '\u2014'), span('score num', String(e.score)), span('floors num', t('floorsCleared', { n: e.floors })));
      ol.appendChild(li);
    });
    host.appendChild(ol);
  }

  /** Best-score line (+ NEW BEST tag) and, if the run made the table, a name field. */
  function scoreSection(card) {
    const prevBest = scores.list.filter((e) => e.id !== G.runId).reduce((m, e) => Math.max(m, e.score), 0);
    const r = G.score > 0 && G.runId ? scores.record(G.runId, G.score, G.floorsCleared) : { rank: -1, entry: null };
    const wrap = document.createElement('div'); wrap.className = 'run-record';
    const best = document.createElement('div'); best.className = 'best-line';
    best.appendChild(span('', t('best', { n: Math.max(scores.best(), G.score) })));
    if (G.score > 0 && G.score > prevBest) best.appendChild(span('new-best', t('newBest')));
    wrap.appendChild(best);
    if (r.rank >= 0) {
      const row = document.createElement('label'); row.className = 'name-row';
      const input = document.createElement('input');
      input.type = 'text'; input.className = 'name-input'; input.maxLength = 8; input.autocomplete = 'off'; input.spellcheck = false;
      input.value = r.entry.name || ''; input.placeholder = t('namePlaceholder'); input.setAttribute('aria-label', t('nameLabel'));
      input.addEventListener('input', () => { scores.setName(G.runId, input.value); renderHighScores(); });
      row.append(span('', t('rankLabel', { n: r.rank + 1 })), input);
      wrap.appendChild(row);
    }
    card.appendChild(wrap);
    renderHighScores();
  }

  // ---------- update ----------
  function updateBattle(dt) {
    G.timeLeft -= dt;
    if (G.timeLeft <= 0) { G.timeLeft = 0; defeat(); return; }
    const active = voiceActive(voice);
    const b = active ? bandOf(voice.midi) : { band: -1 };
    for (let i = 0; i < 5; i++) {
      if (b.band === i) G.charge[i] = Math.min(1, G.charge[i] + dt / CHARGE_TIME);
      else G.charge[i] = Math.max(0, G.charge[i] - dt / 0.25);
    }
    G.cooldown -= dt;
    if (b.band >= 0 && G.charge[b.band] >= 1 && G.cooldown <= 0) {
      cast(b.band); G.charge[b.band] = 0.25; G.cooldown = CAST_COOLDOWN;
    }
    // boss idle behaviour (cosmetic)
    G.bossTimer -= dt;
    if (G.bossTimer <= 0) {
      G.bossTimer = rand(6, 10);
      if ($('bossBubble').hidden) bossSay(pick(t('idle')), 1800);
      boss.hop = 1;
    }
  }

  function updateCommon(dt) {
    hero.cast = Math.max(0, hero.cast - dt * 4);
    boss.flash = Math.max(0, boss.flash - dt);
    boss.hurt = Math.max(0, boss.hurt - dt);
    boss.hop = Math.max(0, boss.hop - dt * 2.2);
    shake = Math.max(0, shake - dt);
    if (boss.dead) boss.faded = Math.min(1, boss.faded + dt * 1.4);
    const F = LV.FLOORS[G.floor];
    const size = 16 * F.boss.scale;
    for (const pr of projectiles) {
      pr.t += dt; pr.x += pr.vx * dt;
      const prog = clamp((pr.x - pr.x0) / (boss.x - size / 2 - pr.x0), 0, 1);
      let wob = 0;
      if (pr.band === 2) wob = (Math.floor(pr.t * 24) % 2 ? 4 : -4);
      else if (pr.band === 3) wob = Math.sin(pr.t * 18) * 6;
      else if (pr.band === 0) wob = Math.sin(pr.t * 10) * 2 - prog * 6;
      else if (pr.band === 1) wob = -Math.sin(prog * Math.PI) * 10;
      pr.y = lerp(pr.y0, pr.ty, prog) + wob;
      if (Math.random() < 0.7) particles.push({ x: pr.x - 3, y: pr.y, vx: rand(-30, 10), vy: rand(-20, 20), life: rand(0.15, 0.35), t: 0, color: LV.SPELLS[pr.band].color, size: 2 });
      if (pr.x >= boss.x - size / 2 + 6 && !boss.dead && G.screen === 'battle') { pr.hit = true; hitBoss(pr); }
      else if (pr.x > W + 10 || boss.dead) pr.hit = true;
    }
    projectiles = projectiles.filter((p) => !p.hit);
    for (const p of particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.grav) p.vy += p.grav * dt; }
    particles = particles.filter((p) => p.t < p.life);
    for (const p of popups) { p.t += dt; p.y -= 28 * dt; }
    popups = popups.filter((p) => p.t < p.life);
    // pitch trace history
    if (voice.voiced && (voice.sim || voice.level >= settings.threshold)) trace.push({ t: timeNow, midi: voice.midi, band: bandOf(voice.midi).band });
    while (trace.length && timeNow - trace[0].t > TRACE_SECONDS) trace.shift();
    if (trace.length > 400) trace.splice(0, trace.length - 400);
  }

  // ---------- render ----------
  function render() {
    const F = LV.FLOORS[G.floor];
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (shake > 0) { ctx.translate(Math.round(rand(-1, 1) * shake * 12), Math.round(rand(-1, 1) * shake * 8)); }
    // sky
    const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    g.addColorStop(0, F.sky[0]); g.addColorStop(1, F.sky[1]);
    ctx.fillStyle = g; ctx.fillRect(-16, -16, W + 32, H + 32);
    // stars
    for (const s of stars) {
      ctx.globalAlpha = s.a * (0.55 + 0.45 * Math.sin(timeNow * s.tw + s.ph));
      ctx.fillStyle = '#ffffff'; ctx.fillRect(s.x, s.y, s.s, s.s);
    }
    ctx.globalAlpha = 1;
    // moon
    ctx.fillStyle = '#f4f0d8'; ctx.globalAlpha = 0.9;
    ctx.fillRect(404, 26, 14, 14); ctx.fillRect(402, 28, 18, 10); ctx.fillRect(406, 24, 10, 18);
    ctx.fillStyle = F.sky[0]; ctx.fillRect(408, 26, 12, 12); ctx.fillRect(410, 24, 10, 16);
    ctx.globalAlpha = 1;
    // horizon glow
    const hg = ctx.createLinearGradient(0, GROUND_Y - 40, 0, GROUND_Y);
    hg.addColorStop(0, 'rgba(0,0,0,0)'); hg.addColorStop(1, F.accent);
    ctx.globalAlpha = 0.28; ctx.fillStyle = hg; ctx.fillRect(0, GROUND_Y - 40, W, 40); ctx.globalAlpha = 1;
    ctx.fillStyle = F.accent; ctx.globalAlpha = 0.8; ctx.fillRect(0, GROUND_Y - 1, W, 1); ctx.globalAlpha = 1;
    // ground
    const gs = LV.SHEETS[F.ground.sheet], ts = gs.tile * 2;
    const cols = Math.ceil(W / ts) + 1;
    for (let c = 0; c < cols; c++) {
      drawTile(ctx, F.ground.sheet, F.ground.top[c % F.ground.top.length], c * ts, GROUND_Y, 2);
      for (let r = 1; GROUND_Y + r * ts < H + ts; r++) drawTile(ctx, F.ground.sheet, F.ground.body[(c + r) % F.ground.body.length], c * ts, GROUND_Y + r * ts, 2);
    }
    ctx.fillStyle = 'rgba(7,10,36,0.35)'; ctx.fillRect(0, GROUND_Y + ts, W, H - GROUND_Y - ts);

    // hero
    const hb = Math.round(Math.sin(timeNow * 3) * 1.5);
    const hx = hero.x - 16 - Math.round(hero.cast * 3), hy = GROUND_Y - 32 + hb;
    drawTile(ctx, LV.HERO.sheet, LV.HERO.tile, hx, hy, 2);
    // spell focus orb
    let chargeBand = -1, chargeVal = 0;
    for (let i = 0; i < 5; i++) if (G.charge[i] > chargeVal) { chargeVal = G.charge[i]; chargeBand = i; }
    if (hero.cast > 0 && hero.castBand >= 0) { chargeBand = hero.castBand; chargeVal = Math.max(chargeVal, hero.cast); }
    if (chargeBand >= 0 && chargeVal > 0.02) {
      const ox = hero.x + 16, oy = GROUND_Y - 22 + hb;
      const rad = 2 + chargeVal * 5;
      ctx.globalAlpha = 0.35 + chargeVal * 0.4; ctx.fillStyle = LV.SPELLS[chargeBand].color;
      ctx.fillRect(ox - rad, oy - rad, rad * 2, rad * 2);
      ctx.globalAlpha = 0.9; ctx.fillStyle = '#ffffff'; ctx.fillRect(ox - 1, oy - 1, 2, 2); ctx.globalAlpha = 1;
    }

    // boss
    if (boss.faded < 1) {
      const size = 16 * F.boss.scale;
      const bob = Math.round(Math.sin(timeNow * (F.boss.fly ? 4 : 2.2)) * (F.boss.fly ? 4 : 2));
      const hop = Math.round(Math.sin(boss.hop * Math.PI) * 14);
      const bx = boss.x - size / 2, by = GROUND_Y - size - (F.boss.fly ? 26 : 0) + bob - hop;
      ctx.save();
      ctx.globalAlpha = 1 - boss.faded;
      if (boss.hurt > 0) {
        const hq = Math.sin((boss.hurt / 0.28) * Math.PI) * 0.18;
        ctx.translate(boss.x, GROUND_Y - (F.boss.fly ? 26 : 0) + bob - hop);
        ctx.scale(1 + hq, 1 - hq);
        ctx.translate(-boss.x, -(GROUND_Y - (F.boss.fly ? 26 : 0) + bob - hop));
      }
      if (boss.flash > 0) drawTileTinted(ctx, F.boss.sheet, F.boss.tile, bx, by, F.boss.scale, '#ffffff', 0.85);
      else if (boss.phase === 1) drawTileTinted(ctx, F.boss.sheet, F.boss.tile, bx, by, F.boss.scale, '#ff3b3b', 0.38 + 0.1 * Math.sin(timeNow * 8));
      else drawTile(ctx, F.boss.sheet, F.boss.tile, bx, by, F.boss.scale);
      ctx.restore();
      // shadow
      ctx.globalAlpha = 0.35 * (1 - boss.faded); ctx.fillStyle = '#05071a';
      ctx.fillRect(boss.x - size / 3, GROUND_Y - 3, size * 2 / 3, 3); ctx.globalAlpha = 1;
    }

    // projectiles
    for (const pr of projectiles) {
      const col = LV.SPELLS[pr.band].color;
      ctx.fillStyle = col; ctx.globalAlpha = 0.5; ctx.fillRect(Math.round(pr.x) - 6, Math.round(pr.y) - 6, 12, 12);
      ctx.globalAlpha = 1; ctx.fillRect(Math.round(pr.x) - 4, Math.round(pr.y) - 4, 8, 8);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(pr.x) - 2, Math.round(pr.y) - 2, 4, 4);
    }
    // particles
    for (const p of particles) {
      ctx.globalAlpha = 1 - p.t / p.life; ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;
    // popups
    for (const p of popups) {
      ctx.globalAlpha = 1 - Math.pow(p.t / p.life, 2);
      ctx.font = (p.big ? 10 : 8) + 'px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#0b1030'; ctx.fillText(p.text, Math.round(p.x) + 1, Math.round(p.y) + 1);
      ctx.fillStyle = p.color; ctx.fillText(p.text, Math.round(p.x), Math.round(p.y));
    }
    ctx.globalAlpha = 1;
  }

  // ---------- main loop ----------
  let last = performance.now();
  function tick(dt) {
    timeNow += dt;
    voice = readVoice();
    if (G.screen === 'battle') updateBattle(dt);
    updateCommon(dt);
    render();
    updateHud();
    if (!$('bossBubble').hidden) positionBubble();
  }
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    tick(dt);
    requestAnimationFrame(loop);
  }

  // ---------- wiring ----------
  function wire() {
    $('btnMic').addEventListener('click', () => { sfx.init(); enableMic(); });
    $('btnStart').addEventListener('click', () => { sfx.init(); sfx.play('ui'); newRun(); });
    $('btnBegin').addEventListener('click', () => { sfx.init(); beginBattle(); });
    document.querySelectorAll('#segRange button').forEach((b) => b.addEventListener('click', () => { settings.range = b.dataset.range; store.set('range', settings.range); refreshRanges(); if (G.screen === 'intro') fillIntro(); sfx.play('ui'); }));
    document.querySelectorAll('#segLang button').forEach((b) => b.addEventListener('click', () => { settings.lang = b.dataset.lang; store.set('lang', settings.lang); applyLang(); sfx.play('ui'); }));
    $('thresh').addEventListener('input', (e) => { settings.threshold = parseFloat(e.target.value); store.set('threshold', settings.threshold); refreshThreshold(); });
    $('btnSfx').addEventListener('click', () => { settings.sfx = !settings.sfx; store.set('sfx', settings.sfx); $('btnSfx').setAttribute('aria-pressed', String(settings.sfx)); $('sfxState').textContent = t(settings.sfx ? 'on' : 'off'); sfx.init(); sfx.play('ui'); });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return; // typing a name, not casting
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 5) { keyHeld[n - 1] = true; sfx.init(); e.preventDefault(); return; }
      if (e.key === 'Enter' || e.key === ' ') {
        const ov = ['ovTitle', 'ovIntro', 'ovResult'].map($).find((o) => !o.hidden);
        if (ov && document.activeElement && ov.contains(document.activeElement) && document.activeElement.tagName === 'BUTTON') return;
        if (ov) { const primary = ov.querySelector('.btn-gold'); if (primary) { e.preventDefault(); primary.click(); } }
      }
    });
    window.addEventListener('keyup', (e) => { const n = parseInt(e.key, 10); if (n >= 1 && n <= 5) keyHeld[n - 1] = false; });
    window.addEventListener('blur', () => { keyHeld.fill(false); tapHeld.fill(false); });
    window.addEventListener('resize', resize);
    // helper for automated checks / debugging in the console
    window.VoxDebug = { G, boss, settings, startFloor, beginBattle, keyHeld, tick, nextFloor, newRun, scores };
  }

  async function init() {
    buildSlots();
    refreshThreshold();
    $('btnSfx').setAttribute('aria-pressed', String(settings.sfx));
    applyLang();
    wire();
    try { await loadImages(); } catch (e) { console.error(e); }
    $('titleArt').appendChild(spriteCanvas(LV.HERO.sheet, LV.HERO.tile, 5));
    resize();
    // fonts may arrive after first paint; re-measure the trace canvas then
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(resize);
    setTimeout(resize, 400);
    G.floor = 0; G.weak = LV.FLOORS[0].weak[0]; boss.hp = boss.maxHp = LV.FLOORS[0].hp; G.timeLeft = LV.FLOORS[0].time;
    updateHudStatic();
    showOverlay('title');
    requestAnimationFrame(loop);
  }

  init();
})();
