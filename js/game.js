/* Vox Tower — game engine (plain script; runs from file:// or any static server) */
(function () {
  'use strict';

  const P = window.VoxPitch, LV = window.VoxLevels, I18N = window.VoxI18N;

  const W = 480, H = 270, GROUND_Y = 222;
  const FLOORS = LV.FLOORS, NUM_FLOORS = FLOORS.length;
  const MAIN_FLOORS = FLOORS.filter((f) => !f.bonus).length;
  const BASE_CHARGE = 0.32;      // seconds of on-pitch singing per cast
  const CAST_COOLDOWN = 0.10;
  const DMG_WEAK = 12, DMG_OTHER = 3, RUNE_DMG = 30;
  const MAX_HEARTS = 3;
  const TRACE_SECONDS = 1.6;
  const TUNE_HOLD = 1.2, TUNE_MIN_WIDTH = 10;

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const median = (arr) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ---------- settings (persisted per browser) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('vox.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('vox.' + k, JSON.stringify(v)); } catch (e) { /* private mode etc. */ } },
  };
  const settings = {
    lang: store.get('lang', 'en'),
    range: store.get('range', 'kid'),
    customRange: store.get('customRange', null),
    threshold: store.get('threshold', 0.35),
    sfx: store.get('sfx', true),
  };
  if (!I18N[settings.lang]) settings.lang = 'en';
  const validCustom = () => !!(settings.customRange && typeof settings.customRange.lo === 'number' && settings.customRange.hi - settings.customRange.lo >= TUNE_MIN_WIDTH);
  if (settings.range === 'custom' ? !validCustom() : !LV.RANGES[settings.range]) settings.range = 'kid';
  const bestStars = store.get('stars', {}) || {};

  // ---------- local high scores (this browser only) ----------
  const MAX_SCORES = 5;
  const scores = {
    list: (store.get('scores', []) || []).filter((e) => e && typeof e.score === 'number'),
    lastName: String(store.get('name', '') || ''),
    best() { return this.list.length ? this.list[0].score : 0; },
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
  const effectText = (id) => (t('effects') || {})[id] || I18N.en.effects[id] || '';
  const floorLabel = (i) => FLOORS[i].bonus ? t('floorBonus') : t('floor', { n: i + 1, total: MAIN_FLOORS });
  const floorsText = (n) => n > MAIN_FLOORS ? t('floorsAll') : t('floorsCleared', { n });

  // ---------- pitch ranges / bands ----------
  const range = () => (settings.range === 'custom' && validCustom()) ? settings.customRange : (LV.RANGES[settings.range] || LV.RANGES.kid);
  function bandBounds(i) {
    const r = range(); const bw = (r.hi - r.lo) / 5;
    return { lo: r.lo + bw * i, hi: r.lo + bw * (i + 1) };
  }
  const bandRangeLabel = (i) => { const b = bandBounds(i); return P.midiToName(b.lo) + '–' + P.midiToName(b.hi); };
  /** Band for a pitch, with hysteresis so a wobbly note near an edge keeps its band. */
  function bandOf(midi, prev) {
    const r = range(); const bw = (r.hi - r.lo) / 5;
    const margin = Math.min(0.7, bw * 0.15);
    if (midi < r.lo - (prev === 0 ? margin : 0)) return { band: -1, pos: 'low' };
    if (midi >= r.hi + (prev === 4 ? margin : 0)) return { band: -1, pos: 'high' };
    let b = clamp(Math.floor((midi - r.lo) / bw), 0, 4);
    if (prev >= 0 && b !== prev) {
      const lo = r.lo + bw * prev, hi = lo + bw;
      if (midi >= lo - margin && midi < hi + margin) b = prev;
    }
    return { band: b, pos: 'in' };
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
  function spriteCanvas(sheetKey, index, scale, tint, tintAlpha, cssSize) {
    const s = LV.SHEETS[sheetKey] || { tile: 16 };
    const c = document.createElement('canvas');
    c.width = c.height = s.tile * scale;
    const cx = c.getContext('2d');
    cx.imageSmoothingEnabled = false;
    if (tint) drawTileTinted(cx, sheetKey, index, 0, 0, scale, tint, tintAlpha == null ? 1 : tintAlpha);
    else drawTile(cx, sheetKey, index, 0, 0, scale);
    c.style.width = (cssSize || c.width) + 'px';
    c.style.height = (cssSize || c.height) + 'px';
    return c;
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
        case 'warn': this.tone(180, 180, 0.07, 'square', 0.07); this.tone(180, 180, 0.07, 'square', 0.07, 0.12); break;
        case 'shoot': this.tone(300, 120, 0.18, 'sawtooth', 0.07); break;
        case 'block': this.tone(1200, 2400, 0.12, 'sine', 0.10); this.noise(0.05, 0.05); break;
        case 'hurt': this.tone(140, 40, 0.25, 'square', 0.10); this.noise(0.12, 0.10); break;
        case 'runeOpen': [660, 880].forEach((f, i) => this.tone(f, f, 0.08, 'triangle', 0.06, i * 0.09)); break;
        case 'runeStep': this.tone(880 + (band || 0) * 120, 880 + (band || 0) * 120, 0.06, 'square', 0.05); break;
        case 'rune': [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, f * 1.01, 0.18, 'square', 0.07, i * 0.05)); this.noise(0.25, 0.10, 0.2); break;
        case 'tuneOk': this.tone(880, 1320, 0.12, 'sine', 0.08); break;
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
  const hero = { x: 72, cast: 0, castBand: -1, hurt: 0, shield: 0 };
  const boss = { x: 392, hp: 100, maxHp: 100, flash: 0, hurt: 0, hop: 0, phase: 0, dead: 0, faded: 0, tint: null, action: null, next: 6, lastAttack: -1 };
  let projectiles = [], enemyShots = [], particles = [], popups = [];
  let shake = 0, timeNow = 0;

  const G = {
    screen: 'title', floor: 0, timeLeft: 0, floorTime: 45, score: 0, floorScore: 0, damageScore: 0,
    wrongCasts: 0, combo: 0, bestCombo: 0, charge: [0, 0, 0, 0, 0], cooldown: 0, weak: 2, loots: [],
    lastBand: -1, runId: '', floorsCleared: 0, hearts: MAX_HEARTS, heartsLostFloor: 0, stars: {},
    actionsDone: 0, resultKind: '', result: null, loseReason: 'time', mapTarget: 0, mapFrom: -1,
    graceBand: -1, graceUntil: 0, // a note held briefly after a block or rune step is not a wrong spell
  };
  const hasLoot = (id) => G.loots.some((l) => l.id === id);
  const chargeTime = () => BASE_CHARGE * (hasLoot('wand') ? 0.8 : 1);
  const blockWindow = (F) => F.block + (hasLoot('needle') ? 0.6 : 0);
  const floorTime = (F) => F.time + (hasLoot('ring') ? 8 : 0);

  // ---------- input: microphone, keys, slot taps, simulated voice ----------
  let mic = null, micState = 'idle';
  const keyHeld = [false, false, false, false, false];
  const tapHeld = [false, false, false, false, false];
  let simVoice = null; // { midi, level } — debugging / automated checks
  let voice = { midi: 0, hz: 0, note: '', level: 0, voiced: false, sim: false, simBand: -1 };
  let vb = { band: -1, pos: 'in', active: false };
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
    if (simVoice) return { midi: simVoice.midi, hz: P.midiToHz(simVoice.midi), note: P.midiToName(simVoice.midi), level: simVoice.level == null ? 1 : simVoice.level, voiced: true, sim: false, simBand: -1 };
    if (r) return { midi: r.midi, hz: r.hz, note: r.note, level: r.level, voiced: r.voiced, sim: false, simBand: -1 };
    return { midi: 0, hz: 0, note: '', level: 0, voiced: false, sim: false, simBand: -1 };
  }
  const voiceActive = (v) => v.voiced && (v.sim || v.level >= settings.threshold);
  function computeBand() {
    if (!voiceActive(voice)) { vb = { band: -1, pos: 'in', active: false }; return; }
    const b = bandOf(voice.midi, G.lastBand);
    vb = { band: b.band, pos: b.pos, active: true };
    if (b.band >= 0) G.lastBand = b.band;
  }

  async function enableMic() {
    if (micState === 'ok' || micState === 'busy') return micState === 'ok';
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
    return micState === 'ok';
  }
  function applyMicRange() {
    if (!mic) return;
    // wide enough for tuning as well as play
    mic.minHz = P.midiToHz(30) / 1.1;
    mic.maxHz = P.midiToHz(100) * 1.1;
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
    const fit = Math.min(sw / W, sh / H);
    k = Math.max(1, Math.round(fit * dpr));
    canvas.width = W * k; canvas.height = H * k;
    const cssW = Math.floor(W * fit), cssH = Math.floor(H * fit);
    wrap.style.width = cssW + 'px'; wrap.style.height = cssH + 'px';
    canvas.style.width = '100%'; canvas.style.height = '100%';
    ctx.imageSmoothingEnabled = false;
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
    $('rangeCustom').hidden = !validCustom();
    document.querySelectorAll('#segRange button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.range === settings.range)));
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
    renderHearts();
    updateHudStatic();
    if (G.screen === 'intro') fillIntro();
    if (G.screen === 'result') fillResult(G.resultKind);
    if (G.screen === 'map') renderMap();
    if (G.screen === 'tune') renderTune();
    if (boss.action) showAction();
  }

  // ---------- HUD ----------
  function renderHearts() {
    const host = $('hearts'); host.innerHTML = '';
    host.setAttribute('aria-label', t('hearts') + ' ' + G.hearts + '/' + MAX_HEARTS);
    for (let i = 0; i < MAX_HEARTS; i++) {
      host.appendChild(spriteCanvas(LV.HEART.sheet, i < G.hearts ? LV.HEART.full : LV.HEART.empty, 3, null, 0, 27));
    }
  }
  function updateHudStatic() {
    const i = G.floor;
    $('hudFloor').textContent = floorLabel(i);
    $('hudFloorName').textContent = tf(i, 'name');
    $('hudBossName').textContent = tf(i, 'boss');
    $('hudWeakSpell').textContent = spellLabel(G.weak);
    $('hudBossHp').textContent = String(Math.max(0, Math.ceil(boss.hp)));
    $('hudTimeVal').textContent = Math.ceil(G.timeLeft) + 's';
    for (let s = 0; s < 5; s++) slotEls[s].el.classList.toggle('weak', s === G.weak && G.screen !== 'title');
  }
  function updateHud() {
    $('hudTimeVal').textContent = Math.ceil(G.timeLeft) + 's';
    $('hudTimeFill').style.transform = 'scaleX(' + clamp(G.timeLeft / G.floorTime, 0, 1) + ')';
    $('hudBossHp').textContent = String(Math.max(0, Math.ceil(boss.hp)));
    $('hudBossFill').style.transform = 'scaleX(' + clamp(boss.hp / boss.maxHp, 0, 1) + ')';
    $('hudScore').textContent = String(G.score + (G.screen === 'battle' ? G.damageScore : 0));

    const a = boss.action;
    const target = a ? (a.type === 'attack' ? a.band : a.seq[a.idx]) : -1;
    for (let s = 0; s < 5; s++) {
      slotEls[s].el.classList.toggle('active', vb.band === s);
      slotEls[s].el.classList.toggle('target', !!a && a.type === 'attack' && s === target);
      slotEls[s].fill.style.width = (G.charge[s] * 100) + '%';
    }
    // readout
    const note = $('readNote'), hz = $('readHz'), hint = $('readHint');
    if (voice.voiced) { note.textContent = voice.note; hz.textContent = voice.hz.toFixed(1) + ' Hz'; }
    else { note.textContent = '—'; hz.textContent = '0 Hz'; }
    hint.className = 'read-hint';
    if (a && a.type === 'attack' && G.screen === 'battle') { hint.textContent = t('block') + ' ' + spellLabel(a.band); hint.classList.add('danger'); }
    else if (voice.sim) { hint.textContent = t('hintSim', { n: voice.simBand + 1, spell: spellName(voice.simBand) }); hint.classList.add('ok'); }
    else if (!voice.voiced) { hint.textContent = t('hintReady'); }
    else if (voice.level < settings.threshold) { hint.textContent = t('hintQuiet'); hint.classList.add('warn'); }
    else if (vb.pos === 'low') { hint.textContent = t('hintLow'); hint.classList.add('warn'); }
    else if (vb.pos === 'high') { hint.textContent = t('hintHigh'); hint.classList.add('warn'); }
    else { hint.textContent = t('hintCharging', { spell: spellName(vb.band) }); hint.classList.add('ok'); }
    // volume
    const vf = $('volFill');
    vf.style.height = (clamp(voice.sim ? 1 : voice.level, 0, 1) * 100) + '%';
    vf.classList.toggle('hot', vb.active);
    if (G.screen === 'title' && micState === 'ok') {
      const mf = $('micFill');
      mf.style.width = (clamp(voice.level, 0, 1) * 100) + '%';
      mf.classList.toggle('hot', voice.level >= settings.threshold);
      $('micNote').textContent = voice.voiced ? voice.note : '—';
    }
    drawTrace();
  }

  function drawTrace() {
    const c = traceCtx, w = traceCanvas.width, h = traceCanvas.height;
    c.clearRect(0, 0, w, h);
    if (!trace.length) return;
    const r = range();
    const px = Math.max(2, Math.round(2 * dpr));
    for (let i = 0; i < trace.length; i++) {
      const p = trace[i];
      const age = timeNow - p.t;
      if (age > TRACE_SECONDS) continue;
      const x = clamp((p.midi - r.lo) / (r.hi - r.lo), -0.02, 1.02) * w;
      const y = h * 0.14 + (age / TRACE_SECONDS) * h * 0.72;
      c.globalAlpha = (1 - age / TRACE_SECONDS) * 0.9;
      c.fillStyle = p.band >= 0 ? LV.SPELLS[p.band].color : '#9aa3d9';
      const s = i === trace.length - 1 ? px * 3 : px * 2;
      c.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s);
    }
    c.globalAlpha = 1;
  }

  // ---------- banners & bubbles ----------
  let bannerTimer = 0, bubbleTimer = 0, comboTimer = 0, resultTimer = 0;
  function banner(text, cls, ms) {
    const el = $('banner');
    el.textContent = text; el.className = 'banner' + (cls ? ' ' + cls : ''); el.hidden = false;
    clearTimeout(bannerTimer); bannerTimer = setTimeout(() => { el.hidden = true; }, ms || 1500);
  }
  function bossSay(text, ms) {
    if (boss.action) return; // the action bubble owns that spot
    const el = $('bossBubble');
    el.textContent = text; el.hidden = false;
    positionAboveBoss(el);
    clearTimeout(bubbleTimer); bubbleTimer = setTimeout(() => { el.hidden = true; }, ms || 2600);
  }
  function positionAboveBoss(el) {
    const F = FLOORS[G.floor];
    const size = 16 * F.boss.scale;
    const top = GROUND_Y - size - (F.boss.fly ? 26 : 0) - 6;
    el.style.left = ((boss.x - size / 2 + 10) / W * 100) + '%';
    el.style.top = (top / H * 100) + '%';
  }
  function showCombo(n) {
    const el = $('combo');
    el.textContent = t('combo', { n }); el.hidden = false;
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(comboTimer); comboTimer = setTimeout(() => { el.hidden = true; }, 1200);
  }
  function hitFlash() {
    if (reduceMotion) return;
    const el = $('hitFlash'); el.hidden = false;
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    setTimeout(() => { el.hidden = true; }, 500);
  }

  // boss action bubble (attack to block / rune pattern)
  function showAction() {
    const a = boss.action, el = $('bossAction');
    if (!a) { el.hidden = true; return; }
    el.innerHTML = '';
    el.className = 'action ' + (a.type === 'attack' ? 'attack' : 'rune');
    const label = document.createElement('span'); label.className = 'act-label';
    label.textContent = a.type === 'attack' ? t('block') : t('runeSing');
    const icons = document.createElement('div'); icons.className = 'act-icons';
    const seq = a.type === 'attack' ? [a.band] : a.seq;
    seq.forEach((b, i) => { const s = document.createElement('span'); s.className = 'act-icon'; s.textContent = LV.SPELLS[b].icon; s.dataset.i = String(i); icons.appendChild(s); });
    const timer = document.createElement('div'); timer.className = 'act-timer'; timer.appendChild(document.createElement('i'));
    el.append(label, icons, timer);
    el.hidden = false;
    $('bossBubble').hidden = true;
    positionAboveBoss(el);
    updateActionUI();
  }
  function updateActionUI(shakeIt) {
    const a = boss.action, el = $('bossAction');
    if (!a || el.hidden) return;
    const bar = el.querySelector('.act-timer i');
    if (bar) bar.style.transform = 'scaleX(' + clamp(1 - a.t / a.dur, 0, 1) + ')';
    if (a.type === 'pattern') {
      el.querySelectorAll('.act-icon').forEach((s, i) => { s.classList.toggle('done', i < a.idx); s.classList.toggle('next', i === a.idx); });
    }
    if (shakeIt) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
  }
  function hideAction() { $('bossAction').hidden = true; }

  // ---------- screens ----------
  function showOverlay(name) {
    ['title', 'tune', 'map', 'intro', 'result'].forEach((n) => { $('ov' + n[0].toUpperCase() + n.slice(1)).hidden = name !== n; });
    $('app').dataset.screen = name || 'battle';
  }
  function showTitle() {
    clearTimeout(resultTimer);
    G.screen = 'title';
    $('bossBubble').hidden = true; $('banner').hidden = true; $('combo').hidden = true; hideAction();
    renderHighScores();
    showOverlay('title');
    updateHudStatic();
  }
  function newRun() {
    G.score = 0; G.loots = []; G.floorsCleared = 0; G.stars = {}; G.hearts = MAX_HEARTS;
    G.runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    renderHearts();
    showMap(0, -1);
  }

  function startFloor(i, opts) {
    opts = opts || {};
    const F = FLOORS[i];
    clearTimeout(resultTimer);
    G.floor = i; G.weak = F.weak[0];
    boss.hp = boss.maxHp = F.hp; boss.phase = 0; boss.dead = 0; boss.faded = 0; boss.flash = 0; boss.hurt = 0; boss.hop = 0;
    boss.tint = null; boss.action = null; boss.next = F.attackEvery * 0.6; boss.lastAttack = -1;
    G.floorTime = floorTime(F); G.timeLeft = G.floorTime;
    G.damageScore = 0; G.wrongCasts = 0; G.combo = 0; G.bestCombo = 0; G.cooldown = 0; G.lastBand = -1;
    G.heartsLostFloor = 0; G.actionsDone = 0; G.graceBand = -1; G.graceUntil = 0;
    if (opts.retry) G.hearts = MAX_HEARTS;
    else if (hasLoot('tonic')) G.hearts = Math.min(MAX_HEARTS, G.hearts + 1);
    G.charge.fill(0);
    projectiles = []; enemyShots = []; particles = []; popups = [];
    hero.hurt = 0; hero.shield = 0;
    $('bossBubble').hidden = true; $('banner').hidden = true; $('combo').hidden = true; hideAction();
    renderHearts();
    G.screen = 'intro';
    fillIntro();
    showOverlay('intro');
    updateHudStatic();
  }

  function fillIntro() {
    const i = G.floor, F = FLOORS[i];
    $('introFloor').textContent = F.bonus ? t('floorEyebrowBonus') : t('floorEyebrow', { n: i + 1, total: MAIN_FLOORS });
    $('introName').textContent = tf(i, 'name');
    const art = $('introBoss'); art.innerHTML = ''; art.appendChild(spriteCanvas(F.boss.sheet, F.boss.tile, 5));
    $('introTaunt').textContent = '“' + tf(i, 'taunt') + '”';
    const w0 = F.weak[0];
    $('introHints').innerHTML = [
      t('hintTimeLimit', { n: G.floorTime, h: G.hearts }),
      t('hintWeak', { spell: spellLabel(w0) + ' (' + bandRangeLabel(w0) + ')' }),
      t('hintTip', { tip: tf(i, 'tip') }),
      t('hintBlock'),
      t('hintRune'),
    ].join('<br>');
  }

  function beginBattle() {
    showOverlay(null);
    G.screen = 'battle';
    banner(t('banPurify'), 'gold', 1500);
    bossSay(tf(G.floor, 'taunt'), 3200);
    sfx.play('start');
    updateHudStatic();
  }

  // ---------- battle ----------
  function cast(band) {
    const F = FLOORS[G.floor];
    const size = 16 * F.boss.scale;
    const targetY = GROUND_Y - size / 2 - (F.boss.fly ? 26 : 0);
    projectiles.push({ x: hero.x + 22, y: GROUND_Y - 22, y0: GROUND_Y - 22, ty: targetY, vx: 250 + band * 25, band, t: 0, x0: hero.x + 22 });
    hero.cast = 1; hero.castBand = band;
    slotEls[band].el.classList.remove('fired'); void slotEls[band].el.offsetWidth; slotEls[band].el.classList.add('fired');
    sfx.play('cast', band);
    for (let i = 0; i < 6; i++) particles.push({ x: hero.x + 22, y: GROUND_Y - 22, vx: rand(20, 90), vy: rand(-50, 50), life: rand(0.2, 0.4), t: 0, color: LV.SPELLS[band].color, size: 2 });

    let special = band === G.graceBand && timeNow < G.graceUntil;
    const grace = () => { G.graceBand = band; G.graceUntil = timeNow + 0.8; special = true; };
    const a = boss.action;
    if (a && a.type === 'attack' && !a.blocked && band === a.band) {
      a.blocked = true; grace();
      blockEffect();
      endBossAction();
    } else if (a && a.type === 'pattern') {
      if (band === a.seq[a.idx]) {
        a.idx++; grace(); sfx.play('runeStep', band); updateActionUI();
        if (a.idx >= a.seq.length) runeBreak();
      } else if (a.idx > 0 && band === a.seq[a.idx - 1]) {
        special = true; // still holding the note that completed the previous step
      } else if (a.idx > 0 && !special) {
        a.idx = 0; updateActionUI(true);
      }
    }
    // late block: a shot already in flight can still be shattered
    for (const s of enemyShots) if (!s.hit && s.band === band) { s.hit = true; grace(); blockEffect(s.x, s.y); }
    if (band !== G.weak && !special) G.wrongCasts++;
  }

  function blockEffect(x, y) {
    hero.shield = 0.5;
    G.damageScore += 150;
    popups.push({ x: x == null ? hero.x + 30 : x, y: (y == null ? GROUND_Y - 44 : y - 10), text: t('blocked'), color: '#5ee0ff', t: 0, life: 0.9, big: true });
    for (let i = 0; i < 14; i++) particles.push({ x: x == null ? hero.x + 18 : x, y: y == null ? GROUND_Y - 24 : y, vx: rand(-80, 120), vy: rand(-120, 40), life: rand(0.3, 0.6), t: 0, color: '#bff4ff', size: 2, grav: 200 });
    sfx.play('block');
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
    afterDamage();
  }

  function afterDamage() {
    const F = FLOORS[G.floor];
    const n = F.weak.length, nextPhase = boss.phase + 1;
    if (nextPhase < n && boss.hp > 0 && boss.hp <= boss.maxHp * (1 - nextPhase / n)) {
      boss.phase = nextPhase; G.weak = F.weak[nextPhase]; G.combo = 0;
      boss.tint = LV.SPELLS[G.weak].color;
      banner(t('banWeakChange', { spell: spellLabel(G.weak) }), 'red', 2200);
      const say = tf(G.floor, 'taunt2') || pick(t('idle'));
      if (boss.action) endBossAction();
      bossSay(say, 3000);
      $('hudWeak').classList.remove('pulse'); void $('hudWeak').offsetWidth; $('hudWeak').classList.add('pulse');
      sfx.play('phase');
      updateHudStatic();
    }
    if (boss.hp <= 0) victory();
  }

  function runeBreak() {
    const F = FLOORS[G.floor];
    const size = 16 * F.boss.scale;
    const cy = GROUND_Y - size / 2 - (F.boss.fly ? 26 : 0);
    boss.hp = Math.max(0, boss.hp - RUNE_DMG);
    boss.flash = 0.3; boss.hurt = 0.45;
    if (!reduceMotion) shake = 0.4;
    G.damageScore += RUNE_DMG * 10 + 300;
    popups.push({ x: boss.x, y: cy - 20, text: '-' + RUNE_DMG, color: '#ffcc33', t: 0, life: 1.1, big: true });
    for (let i = 0; i < 36; i++) particles.push({ x: boss.x + rand(-size / 2, size / 2), y: cy + rand(-size / 2, size / 2), vx: rand(-160, 160), vy: rand(-200, 40), life: rand(0.4, 0.9), t: 0, color: pick(['#ffcc33', '#fff0a8', '#ffffff']), size: 3, grav: 200 });
    banner(t('runeBreak'), 'gold', 1400);
    sfx.play('rune');
    endBossAction();
    afterDamage();
  }

  function startBossAction() {
    const F = FLOORS[G.floor];
    const wantPattern = G.actionsDone > 0 && Math.random() < 0.4;
    if (wantPattern) {
      const seq = []; let prev = -1;
      for (let i = 0; i < F.patternLen; i++) { let b; do { b = Math.floor(Math.random() * 5); } while (b === prev); seq.push(b); prev = b; }
      boss.action = { type: 'pattern', seq, idx: 0, t: 0, dur: F.patternLen * 2.5 + 1 };
      sfx.play('runeOpen');
    } else {
      let b, guard = 0;
      do { b = Math.floor(Math.random() * 5); guard++; } while ((b === G.weak || b === boss.lastAttack) && guard < 20);
      boss.lastAttack = b;
      boss.action = { type: 'attack', band: b, t: 0, dur: blockWindow(F), blocked: false };
      boss.hop = 1;
      sfx.play('warn');
    }
    G.actionsDone++;
    showAction();
  }
  function forceAction(type, arg) {
    if (type === 'attack') boss.action = { type: 'attack', band: arg, t: 0, dur: blockWindow(FLOORS[G.floor]), blocked: false };
    else boss.action = { type: 'pattern', seq: arg, idx: 0, t: 0, dur: arg.length * 2.5 + 1 };
    G.actionsDone++;
    showAction();
  }
  function updateBossAction(dt) {
    const a = boss.action; if (!a) return;
    a.t += dt;
    updateActionUI();
    if (a.t >= a.dur) {
      if (a.type === 'attack' && !a.blocked) bossFire(a.band);
      endBossAction();
    }
  }
  function endBossAction() {
    boss.action = null; hideAction();
    boss.next = FLOORS[G.floor].attackEvery + rand(-1, 1);
  }
  function bossFire(band) {
    const F = FLOORS[G.floor]; const size = 16 * F.boss.scale;
    const y0 = GROUND_Y - size / 2 - (F.boss.fly ? 26 : 0);
    enemyShots.push({ x: boss.x - size / 2, x0: boss.x - size / 2, y: y0, y0, vx: -230, band, t: 0, hit: false });
    boss.hop = 1;
    sfx.play('shoot');
  }
  function hurtHero() {
    G.hearts = Math.max(0, G.hearts - 1); G.heartsLostFloor++; G.combo = 0;
    hero.hurt = 0.6; if (!reduceMotion) shake = 0.3;
    hitFlash();
    popups.push({ x: hero.x, y: GROUND_Y - 42, text: '-1', color: '#ff5c8a', t: 0, life: 0.9, big: true });
    renderHearts();
    const lost = $('hearts').children[G.hearts]; if (lost) lost.classList.add('lost');
    sfx.play('hurt');
    if (G.hearts <= 0) defeat('hearts');
  }

  function victory() {
    boss.dead = 1;
    G.screen = 'dying';
    $('bossBubble').hidden = true; hideAction(); boss.action = null;
    enemyShots = [];
    const F = FLOORS[G.floor];
    const size = 16 * F.boss.scale;
    const cy = GROUND_Y - size / 2 - (F.boss.fly ? 26 : 0);
    for (let i = 0; i < 40; i++) particles.push({ x: boss.x + rand(-size / 2, size / 2), y: cy + rand(-size / 2, size / 2), vx: rand(-90, 90), vy: rand(-160, -20), life: rand(0.5, 1.1), t: 0, color: pick(['#ffffff', F.accent, '#ffcc33']), size: 3, grav: 120 });
    sfx.play('win');
    const timeBonus = Math.round(G.timeLeft) * 8;
    const perfect = G.wrongCasts === 0 ? 500 : 0;
    const stars = 1 + (G.timeLeft / G.floorTime >= 0.4 ? 1 : 0) + ((G.wrongCasts === 0 && G.heartsLostFloor === 0) ? 1 : 0);
    G.floorScore = G.damageScore + timeBonus + perfect;
    G.result = { timeBonus, perfect, floorScore: G.floorScore, stars };
    G.score += G.floorScore;
    G.stars[G.floor] = Math.max(G.stars[G.floor] || 0, stars);
    bestStars[F.id] = Math.max(bestStars[F.id] || 0, stars); store.set('stars', bestStars);
    if (!G.loots.some((l) => l.id === F.loot.id)) G.loots.push(F.loot);
    G.floorsCleared = Math.max(G.floorsCleared, G.floor + 1);
    if (G.runId) { scores.record(G.runId, G.score, G.floorsCleared); renderHighScores(); }
    resultTimer = setTimeout(() => { G.screen = 'result'; fillResult('win'); showOverlay('result'); }, 1100);
  }

  function defeat(reason) {
    G.screen = 'result';
    G.loseReason = reason || 'time';
    boss.action = null; hideAction(); $('bossBubble').hidden = true;
    banner(t(reason === 'hearts' ? 'banHearts' : 'banTimeUp'), 'red', 1500);
    sfx.play('lose');
    fillResult('lose');
    resultTimer = setTimeout(() => showOverlay('result'), 700);
  }

  function starsEl(n, small) {
    const el = document.createElement('span'); el.className = 'stars' + (small ? ' small' : '');
    for (let i = 0; i < 3; i++) { const s = document.createElement('span'); s.className = i < n ? 'on' : 'off'; s.textContent = '★'; el.appendChild(s); }
    el.setAttribute('aria-label', t('stars') + ' ' + n + '/3');
    return el;
  }

  function fillResult(kind) {
    G.resultKind = kind;
    const card = $('resultCard'); card.innerHTML = '';
    const F = FLOORS[G.floor];
    const h2 = document.createElement('h2');
    const art = document.createElement('div'); art.className = 'result-art';
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn btn-gold btn-big';
    const box = (label, val, cls) => { const d = document.createElement('div'); d.className = 'score-box' + (cls ? ' ' + cls : ''); const s = document.createElement('span'); s.textContent = label; const b = document.createElement('b'); b.textContent = val; d.append(s, b); return d; };

    if (kind === 'win') {
      h2.className = 'result-title win'; h2.textContent = t('win');
      const srow = document.createElement('div'); srow.className = 'stars-row';
      srow.append(span('', t('stars')), starsEl(G.result.stars));
      art.appendChild(spriteCanvas(F.loot.sheet, F.loot.tile, 4));
      const ln = document.createElement('div'); ln.className = 'loot-name'; ln.textContent = t('loot', { name: tf(G.floor, 'loot') });
      const fl = document.createElement('p'); fl.className = 'loot-flavor'; fl.textContent = tf(G.floor, 'flavor');
      const ef = document.createElement('p'); ef.className = 'loot-effect'; ef.textContent = t('effect', { text: effectText(F.loot.id) });
      const grid = document.createElement('div'); grid.className = 'score-grid';
      grid.append(box(t('timeBonus'), '+' + G.result.timeBonus), box(t('perfectBonus'), '+' + G.result.perfect), box(t('floorScore'), String(G.result.floorScore)), box(t('total'), String(G.score), 'total'));
      btn.textContent = t('climbOn');
      btn.addEventListener('click', () => { sfx.play('ui'); nextFloor(); });
      card.append(h2, srow, art, ln, fl, ef, grid, btn);
    } else if (kind === 'final') {
      h2.className = 'result-title win'; h2.textContent = t('finalTitle');
      art.appendChild(spriteCanvas(LV.HERO.sheet, LV.HERO.tile, 4));
      G.loots.forEach((l) => art.appendChild(spriteCanvas(l.sheet, l.tile, 3)));
      const p = document.createElement('p'); p.className = 'result-text'; p.textContent = t('finalText');
      const totalStars = Object.values(G.stars).reduce((a, b) => a + b, 0);
      const srow = document.createElement('div'); srow.className = 'stars-row';
      srow.append(span('', t('stars')), span('num', totalStars + ' / ' + (Object.keys(G.stars).length * 3)));
      card.append(h2, art, p, srow);
      scoreSection(card);
      const grid = document.createElement('div'); grid.className = 'score-grid';
      grid.append(box(t('finalScore'), String(G.score), 'total'));
      btn.textContent = t('playAgain');
      btn.addEventListener('click', () => { sfx.play('ui'); showTitle(); });
      card.append(grid, btn);
    } else {
      const hearts = G.loseReason === 'hearts';
      h2.className = 'result-title lose'; h2.textContent = t(hearts ? 'loseHearts' : 'lose');
      art.appendChild(spriteCanvas(F.boss.sheet, F.boss.tile, 4));
      const p = document.createElement('p'); p.className = 'result-text'; p.textContent = t(hearts ? 'loseHeartsText' : 'loseText', { boss: tf(G.floor, 'boss') });
      btn.textContent = t('tryAgain');
      btn.addEventListener('click', () => { sfx.play('ui'); startFloor(G.floor, { retry: true }); });
      card.append(h2, art, p);
      scoreSection(card);
      card.append(btn);
    }
  }

  function nextFloor() {
    const next = G.floor + 1;
    if (next >= NUM_FLOORS) showFinal();
    else showMap(next, G.floor);
  }
  function showFinal() {
    clearTimeout(resultTimer);
    G.screen = 'result'; fillResult('final'); showOverlay('result'); sfx.play('final');
  }

  // ---------- tower map ----------
  function showMap(target, from) {
    G.mapTarget = target; G.mapFrom = from;
    G.screen = 'map';
    renderMap();
    showOverlay('map');
  }
  function renderMap() {
    const host = $('mapRows'); host.innerHTML = '';
    const target = G.mapTarget, from = G.mapFrom == null ? -1 : G.mapFrom;
    const bonusOpen = hasLoot('crest') || target >= MAIN_FLOORS;
    const rowH = 58; // 52px row + 6px gap
    for (let idx = NUM_FLOORS - 1; idx >= 0; idx--) {
      const F = FLOORS[idx];
      const locked = F.bonus && !bonusOpen;
      const reached = idx <= target && !locked;
      const row = document.createElement('div');
      row.className = 'map-row' + (idx === target ? ' current' : '') + (locked ? ' locked' : '');
      const no = document.createElement('span'); no.className = 'map-no'; no.textContent = F.bonus ? '★' : String(idx + 1);
      const art = reached ? spriteCanvas(F.boss.sheet, F.boss.tile, 2, null, 0, 40) : spriteCanvas(F.boss.sheet, F.boss.tile, 2, '#0b1030', 1, 40);
      const name = document.createElement('span'); name.className = 'map-name';
      name.textContent = reached ? tf(idx, 'name') : t('unknown');
      if (locked) { const sm = document.createElement('small'); sm.textContent = t('locked'); name.appendChild(sm); }
      const best = Math.max(G.stars[idx] || 0, bestStars[F.id] || 0);
      row.append(no, art, name, starsEl(best, true));
      host.appendChild(row);
    }
    const wiz = document.createElement('div'); wiz.className = 'map-wizard';
    wiz.appendChild(spriteCanvas(LV.HERO.sheet, LV.HERO.tile, 3, null, 0, 48));
    const rowTop = (idx) => (NUM_FLOORS - 1 - idx) * rowH + 2;
    wiz.style.top = (from < 0 ? rowTop(0) + rowH : rowTop(from)) + 'px';
    host.appendChild(wiz);
    setTimeout(() => { wiz.style.top = rowTop(target) + 'px'; }, 60);

    const btns = $('mapButtons'); btns.innerHTML = '';
    const enter = document.createElement('button'); enter.type = 'button'; enter.className = 'btn btn-gold btn-big';
    enter.textContent = FLOORS[target].bonus ? t('enterBonus') : t('enterFloor', { n: target + 1 });
    enter.addEventListener('click', () => { sfx.init(); sfx.play('ui'); startFloor(target); });
    btns.appendChild(enter);
    if (FLOORS[target].bonus) {
      const fin = document.createElement('button'); fin.type = 'button'; fin.className = 'btn btn-line';
      fin.textContent = t('finishHere');
      fin.addEventListener('click', () => { sfx.play('ui'); showFinal(); });
      btns.appendChild(fin);
    }
  }

  // ---------- wand tuning ----------
  const tune = { step: 0, hold: 0, samples: [], lo: 0, hi: 0, msg: '', msgCls: '' };
  async function openTune() {
    sfx.init();
    if (micState !== 'ok') {
      const ok = await enableMic();
      if (!ok) { $('micStatus').textContent = t('tuneNoMic'); $('micStatus').className = 'mic-status err'; return; }
    }
    tune.step = 1; tune.hold = 0; tune.samples = []; tune.msg = ''; tune.msgCls = '';
    G.screen = 'tune';
    renderTune();
    showOverlay('tune');
  }
  function updateTune(dt) {
    if (tune.step < 1 || tune.step > 2) return;
    if (voice.voiced && voice.level >= settings.threshold) {
      tune.samples.push(voice.midi); if (tune.samples.length > 90) tune.samples.shift();
      tune.hold += dt;
    } else {
      tune.hold = Math.max(0, tune.hold - dt * 2);
      if (tune.hold === 0) tune.samples.length = 0;
    }
    if (tune.hold >= TUNE_HOLD && tune.samples.length) {
      const m = median(tune.samples);
      tune.hold = 0; tune.samples.length = 0;
      if (tune.step === 1) { tune.lo = m; tune.step = 2; tune.msg = ''; sfx.play('tuneOk'); }
      else { tune.hi = m; finishTune(); }
    }
    renderTune();
  }
  function finishTune() {
    const lo = Math.round(tune.lo) + 1, hi = Math.round(tune.hi) - 1;
    if (hi - lo < TUNE_MIN_WIDTH) { tune.step = 1; tune.msg = t('tuneNarrow'); tune.msgCls = 'warn'; sfx.play('lose'); return; }
    settings.customRange = { lo, hi }; settings.range = 'custom';
    store.set('customRange', settings.customRange); store.set('range', settings.range);
    tune.step = 3; tune.msg = t('tuneDone', { lo: P.midiToName(lo), hi: P.midiToName(hi) }); tune.msgCls = 'ok';
    refreshRanges();
    sfx.play('win');
  }
  function renderTune() {
    $('tuneStep').textContent = (tune.step === 3 ? 2 : tune.step) + ' / 2';
    $('tuneText').textContent = tune.step === 1 ? t('tuneLow') : tune.step === 2 ? t('tuneHigh') : '';
    $('tuneNote').textContent = voice.voiced ? voice.note : '—';
    $('tuneFill').style.width = (clamp(tune.hold / TUNE_HOLD, 0, 1) * 100) + '%';
    const msg = $('tuneMsg'); msg.textContent = tune.msg || (tune.hold > 0.2 ? t('tuneHold') : ''); msg.className = 'tune-msg ' + tune.msgCls;
    $('btnTuneDone').hidden = tune.step !== 3;
    $('btnTuneCancel').hidden = tune.step === 3;
  }

  // ---------- runs & high scores ----------
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
      li.append(span('rank num', String(i + 1)), span('name', e.name || '—'), span('score num', String(e.score)), span('floors num', floorsText(e.floors)));
      ol.appendChild(li);
    });
    host.appendChild(ol);
  }

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
    if (G.timeLeft <= 0) { G.timeLeft = 0; defeat('time'); return; }
    const b = vb.band;
    const ct = chargeTime();
    for (let i = 0; i < 5; i++) {
      if (b === i) G.charge[i] = Math.min(1, G.charge[i] + dt / ct);
      else G.charge[i] = Math.max(0, G.charge[i] - dt / 0.25);
    }
    G.cooldown -= dt;
    if (b >= 0 && G.charge[b] >= 1 && G.cooldown <= 0) {
      cast(b); G.charge[b] = 0.25; G.cooldown = CAST_COOLDOWN;
    }
    if (G.screen !== 'battle') return; // a cast may have ended the floor
    if (boss.action) updateBossAction(dt);
    else { boss.next -= dt; if (boss.next <= 0) startBossAction(); }
  }

  function updateCommon(dt) {
    hero.cast = Math.max(0, hero.cast - dt * 4);
    hero.hurt = Math.max(0, hero.hurt - dt);
    hero.shield = Math.max(0, hero.shield - dt);
    boss.flash = Math.max(0, boss.flash - dt);
    boss.hurt = Math.max(0, boss.hurt - dt);
    boss.hop = Math.max(0, boss.hop - dt * 2.2);
    shake = Math.max(0, shake - dt);
    if (boss.dead) boss.faded = Math.min(1, boss.faded + dt * 1.4);
    const F = FLOORS[G.floor];
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
    for (const s of enemyShots) {
      if (s.hit) continue;
      s.t += dt; s.x += s.vx * dt;
      const prog = clamp((s.x0 - s.x) / (s.x0 - (hero.x + 8)), 0, 1);
      s.y = lerp(s.y0, GROUND_Y - 20, prog) + Math.sin(s.t * 14) * 3;
      if (Math.random() < 0.8) particles.push({ x: s.x + 3, y: s.y, vx: rand(-10, 30), vy: rand(-20, 20), life: rand(0.15, 0.3), t: 0, color: '#ff5c5c', size: 2 });
      if (s.x <= hero.x + 8) { s.hit = true; if (G.screen === 'battle') hurtHero(); }
    }
    enemyShots = enemyShots.filter((s) => !s.hit);
    for (const p of particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.grav) p.vy += p.grav * dt; }
    particles = particles.filter((p) => p.t < p.life);
    for (const p of popups) { p.t += dt; p.y -= 28 * dt; }
    popups = popups.filter((p) => p.t < p.life);
    if (vb.active) trace.push({ t: timeNow, midi: voice.midi, band: vb.band });
    while (trace.length && timeNow - trace[0].t > TRACE_SECONDS) trace.shift();
    if (trace.length > 400) trace.splice(0, trace.length - 400);
  }

  // ---------- render ----------
  function drawLadder() {
    const r = range();
    const top = 46, bottom = GROUND_Y - 14, h = bottom - top, x = 18, w = 8;
    const a = boss.action;
    const target = a ? (a.type === 'attack' ? a.band : a.seq[a.idx]) : G.weak;
    const pulse = 0.5 + 0.5 * Math.sin(timeNow * 6);
    ctx.fillStyle = 'rgba(7,10,36,0.55)'; ctx.fillRect(x - 4, top - 4, w + 8, h + 8);
    for (let i = 0; i < 5; i++) {
      const y1 = bottom - ((i + 1) / 5) * h, y0 = bottom - (i / 5) * h;
      ctx.globalAlpha = i === target ? 0.55 + 0.3 * pulse : 0.22;
      ctx.fillStyle = LV.SPELLS[i].color;
      ctx.fillRect(x, Math.round(y1) + 1, w, Math.round(y0 - y1) - 2);
    }
    ctx.globalAlpha = 1;
    const ty1 = bottom - ((target + 1) / 5) * h, ty0 = bottom - (target / 5) * h;
    ctx.fillStyle = a && a.type === 'attack' ? '#ff5c5c' : '#ffcc33';
    ctx.fillRect(x - 3, Math.round(ty1), w + 6, 1); ctx.fillRect(x - 3, Math.round(ty0) - 1, w + 6, 1);
    ctx.fillRect(x - 3, Math.round(ty1), 1, Math.round(ty0 - ty1)); ctx.fillRect(x + w + 2, Math.round(ty1), 1, Math.round(ty0 - ty1));
    if (voice.voiced && (voice.sim || voice.level >= settings.threshold)) {
      const f = clamp((voice.midi - r.lo) / (r.hi - r.lo), -0.03, 1.03);
      const y = Math.round(bottom - f * h);
      const col = vb.band >= 0 ? LV.SPELLS[vb.band].color : '#9aa3d9';
      ctx.fillStyle = col; ctx.fillRect(x - 5, y - 3, w + 10, 6);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 1, y - 1, w + 2, 2);
      if (vb.band !== target) {
        const dir = (vb.band < target || vb.pos === 'low') ? -1 : 1; // -1: go up
        const ay = y + dir * (10 + Math.round(pulse * 3));
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.moveTo(x + w / 2, ay + dir * 5); ctx.lineTo(x + w / 2 - 5, ay - dir * 2); ctx.lineTo(x + w / 2 + 5, ay - dir * 2); ctx.closePath(); ctx.fill();
      }
    } else {
      ctx.font = '8px "Press Start 2P", monospace'; ctx.textAlign = 'center';
      ctx.fillStyle = '#9aa3d9'; ctx.globalAlpha = 0.5 + 0.5 * pulse;
      ctx.fillText('♪', x + w / 2, bottom + 12); ctx.globalAlpha = 1;
    }
  }

  function render() {
    const F = FLOORS[G.floor];
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (shake > 0) { ctx.translate(Math.round(rand(-1, 1) * shake * 12), Math.round(rand(-1, 1) * shake * 8)); }
    const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    g.addColorStop(0, F.sky[0]); g.addColorStop(1, F.sky[1]);
    ctx.fillStyle = g; ctx.fillRect(-16, -16, W + 32, H + 32);
    for (const s of stars) {
      ctx.globalAlpha = s.a * (0.55 + 0.45 * Math.sin(timeNow * s.tw + s.ph));
      ctx.fillStyle = '#ffffff'; ctx.fillRect(s.x, s.y, s.s, s.s);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#f4f0d8'; ctx.globalAlpha = 0.9;
    ctx.fillRect(404, 26, 14, 14); ctx.fillRect(402, 28, 18, 10); ctx.fillRect(406, 24, 10, 18);
    ctx.fillStyle = F.sky[0]; ctx.fillRect(408, 26, 12, 12); ctx.fillRect(410, 24, 10, 16);
    ctx.globalAlpha = 1;
    const hg = ctx.createLinearGradient(0, GROUND_Y - 40, 0, GROUND_Y);
    hg.addColorStop(0, 'rgba(0,0,0,0)'); hg.addColorStop(1, F.accent);
    ctx.globalAlpha = 0.28; ctx.fillStyle = hg; ctx.fillRect(0, GROUND_Y - 40, W, 40); ctx.globalAlpha = 1;
    ctx.fillStyle = F.accent; ctx.globalAlpha = 0.8; ctx.fillRect(0, GROUND_Y - 1, W, 1); ctx.globalAlpha = 1;
    const gs = LV.SHEETS[F.ground.sheet], ts = gs.tile * 2;
    const cols = Math.ceil(W / ts) + 1;
    for (let c = 0; c < cols; c++) {
      drawTile(ctx, F.ground.sheet, F.ground.top[c % F.ground.top.length], c * ts, GROUND_Y, 2);
      for (let r = 1; GROUND_Y + r * ts < H + ts; r++) drawTile(ctx, F.ground.sheet, F.ground.body[(c + r) % F.ground.body.length], c * ts, GROUND_Y + r * ts, 2);
    }
    ctx.fillStyle = 'rgba(7,10,36,0.35)'; ctx.fillRect(0, GROUND_Y + ts, W, H - GROUND_Y - ts);

    if (G.screen === 'battle') drawLadder();

    // hero
    const hb = Math.round(Math.sin(timeNow * 3) * 1.5);
    const hx = hero.x - 16 - Math.round(hero.cast * 3) + (hero.hurt > 0 ? Math.round(Math.sin(hero.hurt * 40) * 2) : 0), hy = GROUND_Y - 32 + hb;
    if (hero.hurt > 0 && Math.floor(hero.hurt * 12) % 2 === 0) drawTileTinted(ctx, LV.HERO.sheet, LV.HERO.tile, hx, hy, 2, '#ff5c5c', 0.6);
    else drawTile(ctx, LV.HERO.sheet, LV.HERO.tile, hx, hy, 2);
    if (hero.shield > 0) {
      const rr = 22 + (0.5 - hero.shield) * 20;
      ctx.strokeStyle = '#bff4ff'; ctx.globalAlpha = Math.min(1, hero.shield * 1.6); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(hero.x, GROUND_Y - 16 + hb, rr, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    }
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
      const windup = boss.action && boss.action.type === 'attack' ? Math.round(Math.sin(timeNow * 30) * 2) : 0;
      const bx = boss.x - size / 2 + windup, by = GROUND_Y - size - (F.boss.fly ? 26 : 0) + bob - hop;
      ctx.save();
      ctx.globalAlpha = 1 - boss.faded;
      if (boss.hurt > 0) {
        const hq = Math.sin((boss.hurt / 0.28) * Math.PI) * 0.18;
        const py = GROUND_Y - (F.boss.fly ? 26 : 0) + bob - hop;
        ctx.translate(boss.x, py); ctx.scale(1 + hq, 1 - hq); ctx.translate(-boss.x, -py);
      }
      if (boss.flash > 0) drawTileTinted(ctx, F.boss.sheet, F.boss.tile, bx, by, F.boss.scale, '#ffffff', 0.85);
      else if (boss.tint) drawTileTinted(ctx, F.boss.sheet, F.boss.tile, bx, by, F.boss.scale, boss.tint, 0.38 + 0.1 * Math.sin(timeNow * 8));
      else drawTile(ctx, F.boss.sheet, F.boss.tile, bx, by, F.boss.scale);
      ctx.restore();
      ctx.globalAlpha = 0.35 * (1 - boss.faded); ctx.fillStyle = '#05071a';
      ctx.fillRect(boss.x - size / 3, GROUND_Y - 3, size * 2 / 3, 3); ctx.globalAlpha = 1;
    }

    for (const pr of projectiles) {
      const col = LV.SPELLS[pr.band].color;
      ctx.fillStyle = col; ctx.globalAlpha = 0.5; ctx.fillRect(Math.round(pr.x) - 6, Math.round(pr.y) - 6, 12, 12);
      ctx.globalAlpha = 1; ctx.fillRect(Math.round(pr.x) - 4, Math.round(pr.y) - 4, 8, 8);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(pr.x) - 2, Math.round(pr.y) - 2, 4, 4);
    }
    for (const s of enemyShots) {
      ctx.fillStyle = '#ff5c5c'; ctx.globalAlpha = 0.5; ctx.fillRect(Math.round(s.x) - 7, Math.round(s.y) - 7, 14, 14);
      ctx.globalAlpha = 1; ctx.fillRect(Math.round(s.x) - 5, Math.round(s.y) - 5, 10, 10);
      ctx.fillStyle = LV.SPELLS[s.band].color; ctx.fillRect(Math.round(s.x) - 2, Math.round(s.y) - 2, 4, 4);
    }
    for (const p of particles) {
      ctx.globalAlpha = 1 - p.t / p.life; ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;
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
    computeBand();
    if (G.screen === 'battle') updateBattle(dt);
    if (G.screen === 'tune') updateTune(dt);
    updateCommon(dt);
    render();
    updateHud();
    if (!$('bossBubble').hidden) positionAboveBoss($('bossBubble'));
    if (!$('bossAction').hidden) positionAboveBoss($('bossAction'));
  }
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    tick(dt);
    requestAnimationFrame(loop);
  }

  // ---------- wiring ----------
  function wire() {
    $('btnMic').addEventListener('click', () => { sfx.init(); enableMic(); });
    $('btnTune').addEventListener('click', () => openTune());
    $('btnTuneCancel').addEventListener('click', () => { sfx.play('ui'); showTitle(); });
    $('btnTuneDone').addEventListener('click', () => { sfx.play('ui'); showTitle(); });
    $('btnStart').addEventListener('click', () => { sfx.init(); sfx.play('ui'); newRun(); });
    $('btnBegin').addEventListener('click', () => { sfx.init(); beginBattle(); });
    document.querySelectorAll('#segRange button').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.range === 'custom' && !validCustom()) return;
      settings.range = b.dataset.range; store.set('range', settings.range); refreshRanges();
      if (G.screen === 'intro') fillIntro();
      sfx.play('ui');
    }));
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
        const ov = ['ovTitle', 'ovTune', 'ovMap', 'ovIntro', 'ovResult'].map($).find((o) => !o.hidden);
        if (ov && document.activeElement && ov.contains(document.activeElement) && document.activeElement.tagName === 'BUTTON') return;
        if (ov) { const primary = ov.querySelector('.btn-gold:not([hidden])'); if (primary) { e.preventDefault(); primary.click(); } }
      }
    });
    window.addEventListener('keyup', (e) => { const n = parseInt(e.key, 10); if (n >= 1 && n <= 5) keyHeld[n - 1] = false; });
    window.addEventListener('blur', () => { keyHeld.fill(false); tapHeld.fill(false); });
    window.addEventListener('resize', resize);
    // helper for automated checks / debugging in the console
    window.VoxDebug = {
      G, boss, hero, settings, startFloor, beginBattle, keyHeld, tick, nextFloor, newRun, scores, showMap, showTitle, openTune,
      forceAction, setSimVoice(v) { simVoice = v; }, get enemyShots() { return enemyShots; }, tune, bestStars,
      openTuneNoMic() { tune.step = 1; tune.hold = 0; tune.samples = []; tune.msg = ''; tune.msgCls = ''; G.screen = 'tune'; renderTune(); showOverlay('tune'); },
    };
  }

  async function init() {
    buildSlots();
    refreshThreshold();
    $('btnSfx').setAttribute('aria-pressed', String(settings.sfx));
    applyLang();
    wire();
    try { await loadImages(); } catch (e) { console.error(e); }
    $('titleArt').appendChild(spriteCanvas(LV.HERO.sheet, LV.HERO.tile, 5));
    renderHearts();
    resize();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(resize);
    setTimeout(resize, 400);
    G.floor = 0; G.weak = FLOORS[0].weak[0]; boss.hp = boss.maxHp = FLOORS[0].hp; G.floorTime = FLOORS[0].time; G.timeLeft = G.floorTime;
    updateHudStatic();
    showOverlay('title');
    requestAnimationFrame(loop);
  }

  init();
})();
