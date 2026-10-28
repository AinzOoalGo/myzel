import type { Season } from '../core/config';

/**
 * Sound und Naturgeräusche – komplett im Browser erzeugt (Web Audio), ohne Audiodateien.
 * Dadurch gibt es keine Lizenzfragen und die Spieldatei bleibt klein.
 *
 * Effekte sind als „Rezepte“ (sfx) geschrieben, die einen beliebigen AudioContext bekommen.
 * So lassen sie sich im Test auch offline rendern und auf Übersteuerung prüfen.
 */

type Ctx = BaseAudioContext;
type Out = AudioNode;

/** Moll-Pentatonik – klingt in jeder Kombination ruhig */
const PENTA = [0, 3, 5, 7, 10];

export const midi = (m: number): number => 440 * 2 ** ((m - 69) / 12);
const pentaNote = (root: number, step: number): number => root + PENTA[((step % 5) + 5) % 5]! + 12 * Math.floor(step / 5);

function env(ctx: Ctx, out: Out, t: number, attack: number, decay: number, peak: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(out);
  return g;
}

function tone(ctx: Ctx, out: Out, t: number, freq: number, type: OscillatorType, attack: number, decay: number, peak: number): void {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.connect(env(ctx, out, t, attack, decay, peak));
  o.start(t);
  o.stop(t + attack + decay + 0.05);
}

const noiseCache: WeakMap<Ctx, AudioBuffer> = new WeakMap();
function noiseBuffer(ctx: Ctx): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = b.getChannelData(0);
    let seed = 1;
    for (let i = 0; i < d.length; i++) {
      seed = (seed * 16807) % 2147483647;
      d[i] = (seed / 2147483647) * 2 - 1;
    }
    noiseCache.set(ctx, b);
  }
  return b;
}

function noise(ctx: Ctx, out: Out, t: number, dur: number, filter: BiquadFilterType, freq: number, peak: number, q = 1): BiquadFilterNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(freq, t);
  f.Q.value = q;
  src.connect(f);
  f.connect(env(ctx, out, t, 0.005, dur, peak));
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
  return f;
}

/** Alle Effekte. `v` = Variation (0..1), z. B. für wechselnde Tonhöhen. */
export const sfx = {
  tap(ctx: Ctx, out: Out, t: number, v = Math.random()) {
    const f = midi(pentaNote(69, Math.floor(v * 7)));
    tone(ctx, out, t, f, 'triangle', 0.004, 0.14, 0.18);
    noise(ctx, out, t, 0.04, 'highpass', 3500, 0.05);
  },
  grow(ctx: Ctx, out: Out, t: number) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(midi(57), t);
    o.frequency.exponentialRampToValueAtTime(midi(69), t + 0.35);
    o.connect(env(ctx, out, t, 0.02, 0.4, 0.14));
    o.start(t);
    o.stop(t + 0.5);
  },
  connect(ctx: Ctx, out: Out, t: number, v = Math.random()) {
    const f = midi(pentaNote(72, Math.floor(v * 5)));
    tone(ctx, out, t, f, 'sine', 0.005, 1.2, 0.2);
    tone(ctx, out, t, f * 2.01, 'sine', 0.005, 0.7, 0.07);
    tone(ctx, out, t + 0.07, f * 1.5, 'sine', 0.005, 0.9, 0.08);
  },
  buy(ctx: Ctx, out: Out, t: number) {
    tone(ctx, out, t, midi(76), 'triangle', 0.003, 0.08, 0.14);
    tone(ctx, out, t + 0.05, midi(81), 'triangle', 0.003, 0.12, 0.12);
  },
  gold(ctx: Ctx, out: Out, t: number) {
    [0, 2, 4, 5, 7].forEach((s, i) => tone(ctx, out, t + i * 0.06, midi(pentaNote(76, s)), 'sine', 0.004, 0.5, 0.13));
    noise(ctx, out, t, 0.6, 'highpass', 6000, 0.04);
  },
  achievement(ctx: Ctx, out: Out, t: number) {
    tone(ctx, out, t, midi(72), 'sine', 0.01, 0.6, 0.16);
    tone(ctx, out, t + 0.14, midi(79), 'sine', 0.01, 0.9, 0.16);
  },
  fanfare(ctx: Ctx, out: Out, t: number) {
    [60, 64, 67, 72].forEach((m, i) => tone(ctx, out, t + i * 0.12, midi(m), 'triangle', 0.02, 1.6, 0.11));
    tone(ctx, out, t + 0.5, midi(48), 'sine', 0.1, 2.2, 0.16);
  },
  prestige(ctx: Ctx, out: Out, t: number) {
    const f = noise(ctx, out, t, 1.6, 'bandpass', 300, 0.25, 4);
    f.frequency.exponentialRampToValueAtTime(5000, t + 1.4);
    [57, 64, 69, 72, 76].forEach((m, i) => tone(ctx, out, t + 0.6 + i * 0.05, midi(m), 'sine', 0.05, 2, 0.08));
  },
  rival(ctx: Ctx, out: Out, t: number) {
    tone(ctx, out, t, midi(41), 'sine', 0.05, 0.6, 0.12);
    tone(ctx, out, t, midi(42), 'sine', 0.05, 0.6, 0.06);
  },
};
export type SfxName = keyof typeof sfx;

/** Bausteine der Waldatmosphäre (ebenfalls offline testbar). */
export const ambience = {
  /** Ein Vogelruf: schnelle Tonhöhen-Sprünge, je nach Art anders. */
  bird(ctx: Ctx, out: Out, t: number, kind = Math.floor(Math.random() * 3), pitch = 1) {
    const chirp = (at: number, f0: number, f1: number, dur: number, peak: number) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f0 * pitch, at);
      o.frequency.exponentialRampToValueAtTime(f1 * pitch, at + dur);
      o.connect(env(ctx, out, at, 0.008, dur, peak));
      o.start(at);
      o.stop(at + dur + 0.05);
    };
    if (kind === 0) {
      // Meise: „zi-zi-bä“
      for (let i = 0; i < 3; i++) chirp(t + i * 0.16, 4200, 3600, 0.07, 0.05);
      chirp(t + 0.5, 3000, 2600, 0.12, 0.045);
    } else if (kind === 1) {
      // Triller
      const n = 6 + Math.floor(Math.random() * 6);
      for (let i = 0; i < n; i++) chirp(t + i * 0.055, 3300, 4400, 0.035, 0.035);
    } else {
      // Amsel-artig: zwei weiche, tiefere Pfiffe
      chirp(t, 1700, 2300, 0.22, 0.05);
      chirp(t + 0.3, 2100, 1600, 0.28, 0.045);
    }
  },
  /** Blätterrascheln: kurzes, gefiltertes Knistern */
  rustle(ctx: Ctx, out: Out, t: number, strength = 1) {
    const n = 3 + Math.floor(Math.random() * 5);
    for (let i = 0; i < n; i++) noise(ctx, out, t + Math.random() * 0.6, 0.05 + Math.random() * 0.12, 'bandpass', 2500 + Math.random() * 3000, 0.035 * strength, 1.5);
  },
  /** Grille (Sommer) */
  cricket(ctx: Ctx, out: Out, t: number) {
    for (let i = 0; i < 4; i++) tone(ctx, out, t + i * 0.09, 4700, 'sine', 0.004, 0.04, 0.018);
  },
  /** Wassertropfen (wenn eine Feuchtstelle verbunden ist) */
  drip(ctx: Ctx, out: Out, t: number) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(1400 + Math.random() * 500, t);
    o.frequency.exponentialRampToValueAtTime(500, t + 0.09);
    o.connect(env(ctx, out, t, 0.003, 0.12, 0.05));
    o.start(t);
    o.stop(t + 0.2);
  },
};

/** Was gerade im Wald zu hören ist – Jahreszeit und Netzgröße bestimmen die Mischung. */
const MIX: Record<Season | 'none', { birds: number; rustle: number; crickets: number; wind: number }> = {
  none: { birds: 0.6, rustle: 0.5, crickets: 0, wind: 0.6 },
  fruehling: { birds: 1, rustle: 0.4, crickets: 0, wind: 0.5 },
  sommer: { birds: 0.6, rustle: 0.3, crickets: 1, wind: 0.4 },
  herbst: { birds: 0.3, rustle: 1, crickets: 0, wind: 0.8 },
  winter: { birds: 0, rustle: 0.15, crickets: 0, wind: 1 },
};

/** Steuert Effekte, Regen-Rauschen und die generative Musik. */
export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private delay!: DelayNode;
  private rainGain: GainNode | null = null;
  private wind: { gain: GainNode; lowF: BiquadFilterNode; highF: BiquadFilterNode; highGain: GainNode } | null = null;
  private nextEvent = 0;
  private water = false;
  private lastTap = 0;
  private intensity = 0; // 0..1, wächst mit dem Netz
  private season: Season | null = null;
  musicVolume = 0.5;
  sfxVolume = 0.7;

  /** Muss aus einer Nutzeraktion heraus aufgerufen werden (Browser-Regel für Autoplay). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
      return;
    }
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
    } catch {
      return; // kein Audio verfügbar – Spiel läuft stumm weiter
    }
    const ctx = this.ctx;
    // sanfter Begrenzer gegen Übersteuerung
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 6;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(comp);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.master);
    // Echo für Raum in der Musik
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.35;
    const wet = ctx.createGain();
    wet.gain.value = 0.4;
    this.delay.connect(fb);
    fb.connect(this.delay);
    this.delay.connect(wet);
    wet.connect(this.musicBus);
    this.applyVolumes();
    this.startAmbience();
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sfxBus.gain.setTargetAtTime(this.sfxVolume, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.musicVolume * 1.5, t, 0.3);
  }

  suspend(): void {
    void this.ctx?.suspend().catch(() => undefined);
  }
  resume(): void {
    if (this.ctx?.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  play(name: SfxName, v?: number): void {
    const ctx = this.ctx;
    if (!ctx || this.sfxVolume <= 0 || ctx.state !== 'running') return;
    // sehr schnelles Tippen nicht zur Klangwand werden lassen
    if (name === 'tap') {
      if (ctx.currentTime - this.lastTap < 0.045) return;
      this.lastTap = ctx.currentTime;
    }
    try {
      sfx[name](ctx, this.sfxBus, ctx.currentTime + 0.005, v);
    } catch {
      /* Audio-Fehler dürfen das Spiel nie stören */
    }
  }

  setRain(on: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (on && !this.rainGain) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx);
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1400;
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      g.gain.setTargetAtTime(0.06, ctx.currentTime, 1.5);
      src.connect(f);
      f.connect(g);
      g.connect(this.sfxBus);
      src.start();
      this.rainGain = g;
      (g as GainNode & { src?: AudioBufferSourceNode }).src = src;
    } else if (!on && this.rainGain) {
      const g = this.rainGain as GainNode & { src?: AudioBufferSourceNode };
      g.gain.setTargetAtTime(0.0001, ctx.currentTime, 1);
      g.src?.stop(ctx.currentTime + 4);
      this.rainGain = null;
    }
  }

  /** Der Wald wird mit wachsendem Netz lebendiger. */
  setIntensity(connected: number, hasWater = false): void {
    this.intensity = Math.max(0, Math.min(1, connected / 40));
    this.water = hasWater;
  }

  setSeason(s: Season | null): void {
    if (s === this.season) return;
    this.season = s;
    this.applyWind();
  }

  private mix() {
    return MIX[this.season ?? 'none'];
  }

  private applyWind(): void {
    if (!this.wind || !this.ctx) return;
    const t = this.ctx.currentTime;
    const w = this.mix().wind;
    this.wind.gain.gain.setTargetAtTime(0.11 * w, t, 3);
    this.wind.highGain.gain.setTargetAtTime(0.05 * w, t, 3);
  }

  /** Wind: zwei Rauschschichten, deren Filter langsam „atmen“ – das klingt nach Böen. */
  private startAmbience(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    src.loop = true;
    const lowF = ctx.createBiquadFilter();
    lowF.type = 'lowpass';
    lowF.frequency.value = 380;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    src.connect(lowF);
    lowF.connect(gain);
    gain.connect(this.musicBus);
    const highF = ctx.createBiquadFilter();
    highF.type = 'bandpass';
    highF.frequency.value = 1100;
    highF.Q.value = 0.7;
    const highGain = ctx.createGain();
    highGain.gain.value = 0.0001;
    src.connect(highF);
    highF.connect(highGain);
    highGain.connect(this.musicBus);
    // langsame Modulation (LFOs) für Böen
    const lfo = (freq: number, depth: number, target: AudioParam) => {
      const o = ctx.createOscillator();
      o.frequency.value = freq;
      const d = ctx.createGain();
      d.gain.value = depth;
      o.connect(d);
      d.connect(target);
      o.start();
    };
    lfo(0.07, 160, lowF.frequency);
    lfo(0.045, 450, highF.frequency);
    src.start();
    this.wind = { gain, lowF, highF, highGain };
    this.applyWind();
    this.nextEvent = ctx.currentTime + 2;
    window.setInterval(() => this.schedule(), 250);
  }

  /** Vögel, Rascheln, Grillen, Tropfen – zufällig verteilt, nie aufdringlich. */
  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.musicVolume <= 0) return;
    while (this.nextEvent < ctx.currentTime + 0.6) {
      const t = this.nextEvent;
      const m = this.mix();
      const life = 0.4 + this.intensity * 0.6;
      const r = Math.random();
      if (r < 0.45 * m.birds * life) {
        // Vögel klingen leicht entfernt: etwas Echo dazu
        const kind = Math.floor(Math.random() * 3);
        const pitch = 0.9 + Math.random() * 0.25;
        ambience.bird(ctx, this.musicBus, t, kind, pitch);
        ambience.bird(ctx, this.delay, t, kind, pitch);
      } else if (r < 0.45 * m.birds * life + 0.35 * m.rustle) {
        ambience.rustle(ctx, this.musicBus, t, 0.6 + Math.random() * 0.6);
      } else if (m.crickets && r < 0.9) {
        for (let i = 0; i < 3; i++) ambience.cricket(ctx, this.musicBus, t + i * 0.6);
      } else if (this.water && r > 0.9) {
        ambience.drip(ctx, this.delay, t);
        ambience.drip(ctx, this.musicBus, t);
      }
      this.nextEvent += 2.5 + Math.random() * (7 - this.intensity * 3);
    }
  }
}
