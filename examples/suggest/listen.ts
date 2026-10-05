import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

export interface Span {
  from: number;
  to: number;
}

export type ListenState = "idle" | "loading" | "playing" | "paused";

interface Timed extends Span {
  startMs: number;
  endMs: number;
}

const SAMPLE_RATE = 24000;
const MAX_CHARS = 4000;

export const setSpoken = StateEffect.define<Span | null>();

/** Marks the word being read aloud and keeps it in view. */
export function spokenHighlight(): Extension {
  return [
    StateField.define<DecorationSet>({
      create: () => Decoration.none,
      update(deco, tr) {
        deco = deco.map(tr.changes);
        for (const e of tr.effects) {
          if (!e.is(setSpoken)) continue;
          const s = e.value;
          deco =
            s && s.to <= tr.state.doc.length && s.from < s.to
              ? Decoration.set([
                  Decoration.mark({ class: "sg-spoken" }).range(s.from, s.to),
                ])
              : Decoration.none;
        }
        return deco;
      },
      provide: (f) => EditorView.decorations.from(f),
    }),
    EditorView.updateListener.of((u) => {
      for (const t of u.transactions)
        for (const e of t.effects)
          if (e.is(setSpoken) && e.value && e.value.to <= u.state.doc.length)
            requestAnimationFrame(() =>
              u.view.dispatch({
                effects: EditorView.scrollIntoView(e.value!.from, {
                  y: "nearest",
                  yMargin: 96,
                }),
              }),
            );
    }),
  ];
}

function tokens(text: string): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(/\S+/g)) {
    if (/^[#>*+-]+$/.test(m[0])) continue;
    out.push({ from: m.index!, to: m.index! + m[0].length });
  }
  return out;
}

function weight(word: string): number {
  return (
    4 +
    Math.max(1, word.length) +
    (/[.!?]$/.test(word) ? 5 : /[,;:]$/.test(word) ? 3 : 0)
  );
}

/**
 * Word timings from the audio itself: the loudness envelope (10 ms frames)
 * says where speech starts, stops and pauses, and words share the voiced time
 * in proportion to their length and trailing punctuation.
 */
export function wordTimings(pcm: Uint8Array, text: string): Timed[] {
  const words = tokens(text);
  if (words.length === 0) return [];
  let total = 0;
  const cum = words.map((w) => {
    const start = total;
    total += weight(text.slice(w.from, w.to));
    return { start, end: total };
  });
  const FRAME = 480;
  const n = Math.max(1, Math.floor(pcm.byteLength / FRAME));
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const rms = new Float32Array(n);
  let peak = 0;
  for (let f = 0; f < n; f++) {
    const count = Math.min(240, Math.floor((pcm.byteLength - f * FRAME) / 2));
    let sum = 0;
    for (let s = 0; s < count; s++) {
      const v = view.getInt16(f * FRAME + s * 2, true);
      sum += v * v;
    }
    rms[f] = count > 0 ? Math.sqrt(sum / count) : 0;
    if (rms[f] > peak) peak = rms[f];
  }
  const smooth = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let sum = 0;
    let c = 0;
    for (let d = -2; d <= 2; d++)
      if (f + d >= 0 && f + d < n) {
        sum += rms[f + d];
        c++;
      }
    smooth[f] = sum / c;
  }
  const floor = Math.max(80, peak * 0.06);
  let on = 0;
  while (on < n && rms[on] < floor) on++;
  let off = n - 1;
  while (off > on && rms[off] < floor) off--;
  if (on >= off)
    return words.map((w, i) => ({
      ...w,
      startMs: Math.round((cum[i].start / total) * n * 10),
      endMs: Math.round((cum[i].end / total) * n * 10),
    }));
  const act = new Float32Array(n);
  let acc = 0;
  for (let f = on; f <= off; f++) {
    acc += smooth[f] >= floor ? 1 : 0.25;
    act[f] = acc;
  }
  const out: Timed[] = [];
  let prevEnd = on;
  words.forEach((w, i) => {
    const t0 = (cum[i].start / total) * acc;
    const t1 = (cum[i].end / total) * acc;
    let a = prevEnd;
    if (i === 0) a = on;
    else {
      while (a < off && act[a] < t0) a++;
      while (a < off && smooth[a] < floor && act[a] < t0 + 1) a++;
    }
    let b = a;
    while (b < off && act[b] < t1) b++;
    b = Math.min(off + 1, Math.max(a + 10, b));
    prevEnd = b;
    out.push({ ...w, startMs: a * 10, endMs: b * 10 });
  });
  return out;
}

function activeAt(words: Timed[], ms: number): Span | null {
  let lo = 0;
  let hi = words.length - 1;
  let hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].startMs <= ms) {
      hit = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return hit === -1 ? null : words[hit];
}

interface TtsModel {
  generateContent(request: Record<string, unknown>): Promise<unknown>;
}

async function synthesize(model: TtsModel, text: string): Promise<Uint8Array> {
  const res = (await model.generateContent({
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
      },
    },
  })) as {
    response: {
      candidates?: {
        content?: { parts?: { inlineData?: { data?: string } }[] };
      }[];
    };
  };
  const b64 = res.response.candidates?.[0]?.content?.parts?.find(
    (p) => p.inlineData?.data,
  )?.inlineData?.data;
  if (!b64) throw new Error("no audio");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Trim to whole sentences so the voice never stops mid-thought. */
export function speakable(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  const cut = text.slice(0, MAX_CHARS);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("\n"));
  return end > MAX_CHARS / 2 ? cut.slice(0, end + 1) : cut;
}

export interface NarratorEvents {
  onState(state: ListenState): void;
  onWord(span: Span | null): void;
  onError(message: string): void;
}

/**
 * Reads text aloud and reports the word being spoken. Gemini speech is used
 * when a model is given (word times come from its audio); otherwise, or if
 * that fails, the browser's own voice reports each word as it goes.
 */
export class Narrator {
  private run = 0;
  private state: ListenState = "idle";
  private ctx: AudioContext | null = null;
  private frame = 0;
  private cache = new Map<string, Uint8Array>();

  constructor(private events: NarratorEvents) {}

  private set(state: ListenState): void {
    this.state = state;
    this.events.onState(state);
  }

  async speak(rawText: string, model: TtsModel | null): Promise<void> {
    this.stop();
    const text = speakable(rawText);
    if (!text.trim()) return this.events.onError("There's nothing to read.");
    const run = ++this.run;
    this.set("loading");
    let pcm: Uint8Array | null = this.cache.get(text) ?? null;
    if (!pcm && model) {
      try {
        pcm = await synthesize(model, text);
        this.cache.set(text, pcm);
      } catch {
        pcm = null;
      }
    }
    if (run !== this.run) return;
    if (pcm) await this.playPcm(pcm, text, run);
    else this.playBrowser(text, run);
  }

  private async playPcm(pcm: Uint8Array, text: string, run: number) {
    const words = wordTimings(pcm, text);
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    const samples = new Float32Array(Math.floor(pcm.byteLength / 2));
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    for (let i = 0; i < samples.length; i++)
      samples[i] = view.getInt16(i * 2, true) / 32768;
    const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    this.ctx = ctx;
    source.onended = () => run === this.run && this.finish();
    const t0 = ctx.currentTime;
    source.start();
    this.set("playing");
    const tick = () => {
      if (run !== this.run) return;
      this.events.onWord(activeAt(words, (ctx.currentTime - t0) * 1000));
      this.frame = requestAnimationFrame(tick);
    };
    tick();
  }

  private playBrowser(text: string, run: number) {
    const synth = window.speechSynthesis;
    if (!synth) return this.fail("This browser can't read aloud.");
    const u = new SpeechSynthesisUtterance(text);
    u.onstart = () => run === this.run && this.set("playing");
    u.onboundary = (e) => {
      if (run !== this.run || e.name === "sentence") return;
      const word = /\S+/y;
      word.lastIndex = e.charIndex;
      const m = word.exec(text);
      if (m)
        this.events.onWord({
          from: e.charIndex,
          to: e.charIndex + m[0].length,
        });
    };
    u.onend = () => run === this.run && this.finish();
    u.onerror = (e) => {
      if (
        run === this.run &&
        e.error !== "canceled" &&
        e.error !== "interrupted"
      )
        this.fail("Couldn't read that aloud.");
    };
    synth.speak(u);
  }

  toggle(): void {
    if (this.state === "playing") {
      void this.ctx?.suspend();
      if (!this.ctx) window.speechSynthesis.pause();
      this.set("paused");
    } else if (this.state === "paused") {
      void this.ctx?.resume();
      if (!this.ctx) window.speechSynthesis.resume();
      this.set("playing");
    }
  }

  stop(): void {
    this.run++;
    cancelAnimationFrame(this.frame);
    void this.ctx?.close();
    this.ctx = null;
    window.speechSynthesis?.cancel();
    if (this.state !== "idle") {
      this.events.onWord(null);
      this.set("idle");
    }
  }

  private finish(): void {
    this.stop();
  }

  private fail(message: string): void {
    this.stop();
    this.events.onError(message);
  }
}

/** Two or three sentences for the offline mock (no model to summarize). */
export function roughSummary(text: string): string {
  const sentences = text
    .replace(/\s+/g, " ")
    .trim()
    .match(/[^.!?]+[.!?]+/g);
  return (
    sentences ? sentences.slice(0, 3).join(" ") : text.slice(0, 300)
  ).trim();
}
