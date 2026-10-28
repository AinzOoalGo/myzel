import type { Season } from '../core/config';

/**
 * Sound und Musik – komplett im Browser erzeugt (Web Audio), ohne Audiodateien.
 * Dadurch gibt es keine Lizenzfragen und die Spieldatei bleibt klein.
 *
 * Effekte sind als „Rezepte“ (sfx) geschrieben, die einen beliebigen AudioContext bekommen.
 * So lassen sie sich im Test auch offline rendern und auf Übersteuerung prüfen.
 */

type Ctx = BaseAudioContext;
type Out = AudioNode;

/** Moll-Pentatonik – klingt in jeder Kombination ruhig */
const PENTA = [0, 3, 5, 7, 10];
const ROOT_BY_SEASON: Record<Season | 'none', number> = { none: 57, fruehling: 62, sommer: 60, herbst: 57, winter: 55 }; // MIDI

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

/** Steuert Effekte, Regen-Rauschen und die generative Musik. */
export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private delay!: DelayNode;
  private rainGain: GainNode | null = null;
  private drone: { gain: GainNode; oscs: OscillatorNode[]; filter: BiquadFilterNode } | null = null;
  private nextNote = 0;
  private step = 0;
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
    this.startMusic();
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sfxBus.gain.setTargetAtTime(this.sfxVolume, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.musicVolume * 0.6, t, 0.3);
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

  /** Musik wird mit wachsendem Netz voller. */
  setIntensity(connected: number): void {
    this.intensity = Math.max(0, Math.min(1, connected / 40));
    if (this.drone && this.ctx) this.drone.filter.frequency.setTargetAtTime(350 + this.intensity * 900, this.ctx.currentTime, 2);
  }

  setSeason(s: Season | null): void {
    if (s === this.season) return;
    this.season = s;
    this.retuneDrone();
  }

  private root(): number {
    return ROOT_BY_SEASON[this.season ?? 'none'];
  }

  private retuneDrone(): void {
    if (!this.drone || !this.ctx) return;
    const t = this.ctx.currentTime;
    const r = this.root() - 24;
    this.drone.oscs.forEach((o, i) => o.frequency.setTargetAtTime(midi(r + (i === 2 ? 7 : 0)) * (i === 1 ? 1.004 : 1), t, 3));
  }

  private startMusic(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    // Klangteppich: drei leise, leicht verstimmte Oszillatoren durch einen Tiefpass
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 350;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.gain.setTargetAtTime(0.05, ctx.currentTime, 4);
    filter.connect(gain);
    gain.connect(this.musicBus);
    const oscs = [0, 1, 2].map((i) => {
      const o = ctx.createOscillator();
      o.type = i === 2 ? 'triangle' : 'sawtooth';
      o.connect(filter);
      o.start();
      return o;
    });
    this.drone = { gain, oscs, filter };
    this.retuneDrone();
    this.nextNote = ctx.currentTime + 1;
    window.setInterval(() => this.schedule(), 250);
  }

  /** Vorausplanung der nächsten Töne (stabiler als setTimeout pro Ton). */
  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.musicVolume <= 0) return;
    while (this.nextNote < ctx.currentTime + 0.6) {
      const t = this.nextNote;
      const r = this.root();
      // Schicht 1: langsame Töne – immer
      this.step += Math.random() < 0.5 ? 1 : -1;
      this.step = Math.max(-3, Math.min(8, this.step));
      const n = midi(pentaNote(r, this.step));
      tone(ctx, this.musicBus, t, n, 'sine', 0.03, 2.4, 0.07);
      tone(ctx, this.delay, t, n, 'sine', 0.03, 1.2, 0.04);
      // Schicht 2: hohe Funkel-Töne ab mittlerem Netz
      if (this.intensity > 0.3 && Math.random() < this.intensity * 0.6) {
        const h = midi(pentaNote(r + 12, Math.floor(Math.random() * 8)));
        tone(ctx, this.delay, t + 0.4 + Math.random() * 0.6, h, 'sine', 0.01, 0.8, 0.035);
      }
      // Schicht 3: tiefer Puls bei großem Netz
      if (this.intensity > 0.65 && Math.random() < 0.5) tone(ctx, this.musicBus, t, midi(r - 12), 'triangle', 0.08, 1.4, 0.06);
      this.nextNote += 2 + Math.random() * 2.5 - this.intensity;
    }
  }
}
