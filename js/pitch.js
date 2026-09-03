/* Vox Tower — microphone pitch tracker
 * Plain script (no modules) so the game also runs from file://.
 * Exposes window.VoxPitch.
 *
 * Algorithm: McLeod Pitch Method (normalized square difference function)
 * over a time-domain buffer from an AnalyserNode, with parabolic peak
 * interpolation and a short median filter to steady the reading.
 */
(function () {
  'use strict';

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  function hzToMidi(hz) {
    return 69 + 12 * Math.log2(hz / 440);
  }
  function midiToHz(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }
  function midiToName(midi) {
    const m = Math.round(midi);
    return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  }
  function noteNameToMidi(name) {
    const m = /^([A-G])(#?)(-?\d+)$/.exec(name);
    if (!m) return NaN;
    const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
    return (parseInt(m[3], 10) + 1) * 12 + base + (m[2] ? 1 : 0);
  }

  class PitchTracker {
    constructor(opts) {
      opts = opts || {};
      this.fftSize = opts.fftSize || 4096;
      this.minHz = opts.minHz || 55;     // lowest pitch we bother to look for
      this.maxHz = opts.maxHz || 2200;   // highest
      this.clarityMin = opts.clarityMin || 0.86;
      this.medianLen = opts.medianLen || 5;
      this.ctx = null;
      this.analyser = null;
      this.stream = null;
      this.buf = null;
      this.history = [];
      this.running = false;
      this.lastResult = { hz: 0, midi: 0, note: '', rms: 0, level: 0, clarity: 0, voiced: false };
    }

    async start() {
      if (this.running) return true;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('no-getusermedia');
      }
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = this.fftSize;
      this.analyser.smoothingTimeConstant = 0;
      src.connect(this.analyser);
      this.buf = new Float32Array(this.analyser.fftSize);
      this.running = true;
      return true;
    }

    stop() {
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      if (this.ctx) this.ctx.close();
      this.stream = null; this.ctx = null; this.analyser = null;
      this.running = false;
    }

    /** Pull one reading. Call from the animation loop. */
    update() {
      if (!this.running) return this.lastResult;
      const buf = this.buf;
      this.analyser.getFloatTimeDomainData(buf);
      const sr = this.ctx.sampleRate;

      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      // Perceptual-ish level: -60 dBFS -> 0, -10 dBFS -> 1
      const db = 20 * Math.log10(rms + 1e-9);
      const level = Math.max(0, Math.min(1, (db + 60) / 50));

      let hz = 0, clarity = 0;
      if (rms > 0.003) {
        const r = this._mpm(buf, sr);
        hz = r.hz; clarity = r.clarity;
      }

      let voiced = hz > 0 && clarity >= this.clarityMin && hz >= this.minHz && hz <= this.maxHz;
      if (voiced) {
        this.history.push(hz);
        if (this.history.length > this.medianLen) this.history.shift();
      } else {
        this.history.length = 0;
      }
      let smooth = 0;
      if (this.history.length >= 2) {
        const s = this.history.slice().sort((a, b) => a - b);
        smooth = s[Math.floor(s.length / 2)];
      } else {
        voiced = false;
      }
      const midi = smooth > 0 ? hzToMidi(smooth) : 0;
      this.lastResult = {
        hz: smooth,
        midi,
        note: smooth > 0 ? midiToName(midi) : '',
        rms, level, clarity, voiced,
      };
      return this.lastResult;
    }

    /** McLeod pitch method over lags [minLag, maxLag]. */
    _mpm(buf, sr) {
      const maxLag = Math.min(Math.floor(sr / this.minHz), buf.length >> 1);
      const minLag = Math.max(2, Math.floor(sr / this.maxHz));
      const W = buf.length - maxLag; // window we correlate over
      const nsdf = this._nsdf || (this._nsdf = new Float32Array(buf.length));

      // running sums of squares for normalisation
      let e0 = 0;
      for (let j = 0; j < W; j++) e0 += buf[j] * buf[j];

      for (let tau = minLag; tau <= maxLag; tau++) {
        let acf = 0, e1 = 0;
        for (let j = 0; j < W; j++) {
          const b = buf[j + tau];
          acf += buf[j] * b;
          e1 += b * b;
        }
        const m = e0 + e1;
        nsdf[tau] = m > 0 ? (2 * acf) / m : 0;
      }

      // key-maxima picking
      let maxVal = 0;
      const peaks = [];
      let tau = minLag;
      // skip until first negative-going zero crossing
      while (tau <= maxLag && nsdf[tau] > 0) tau++;
      while (tau <= maxLag) {
        // wait for positive-going crossing
        while (tau <= maxLag && nsdf[tau] <= 0) tau++;
        let best = -1, bestTau = -1;
        while (tau <= maxLag && nsdf[tau] > 0) {
          if (nsdf[tau] > best) { best = nsdf[tau]; bestTau = tau; }
          tau++;
        }
        if (bestTau > 0) {
          peaks.push([bestTau, best]);
          if (best > maxVal) maxVal = best;
        }
      }
      if (!peaks.length || maxVal <= 0) return { hz: 0, clarity: 0 };

      const thresh = 0.9 * maxVal;
      let pick = null;
      for (const p of peaks) { if (p[1] >= thresh) { pick = p; break; } }
      let t = pick[0];
      // parabolic interpolation
      if (t > minLag && t < maxLag) {
        const a = nsdf[t - 1], b = nsdf[t], c = nsdf[t + 1];
        const denom = a - 2 * b + c;
        if (denom !== 0) t = t + 0.5 * (a - c) / denom;
      }
      return { hz: sr / t, clarity: pick[1] };
    }
  }

  window.VoxPitch = { PitchTracker, hzToMidi, midiToHz, midiToName, noteNameToMidi, NOTE_NAMES };
})();
