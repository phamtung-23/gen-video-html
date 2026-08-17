#!/usr/bin/env node
/**
 * sfx.mjs — synthesize a video's sound-effect bed from nothing.
 *
 *   node tools/sfx.mjs <video-name>          write videos/<name>/assets/sfx.m4a
 *   node tools/sfx.mjs <video-name> --wav    keep the intermediate .wav too
 *
 * Why synthesized rather than sampled: a downloaded pack means a network fetch, a
 * licence to track, and a binary blob nobody can diff. Every sound here is a few lines
 * of arithmetic, so the whole bed is reviewable, re-tunable, and byte-identical on every
 * machine. Noise uses a seeded LCG — `Math.random` is banned by the determinism rules
 * and would make two renders differ.
 *
 * House sound design, matching the visual language:
 *   tick   a dry click     — something discrete happened (an element lands, a dot leaves)
 *   tut    a soft beep     — a call completed, an event was published
 *   thud   a falling body  — the crash. The only low-frequency event in the piece.
 *   dull   a muted knock   — a service that was never called
 *   pip    a bright ping   — a consumer confirming receipt
 *   swell  a rising tone   — the bus taking the event
 *   whoosh a noise sweep   — the fan-out: one sound for three simultaneous departures
 *   duo    two notes       — a verdict. Descending for failure, ascending for isolation.
 *
 * Cues are panned to match where the thing is on screen: the chain reads left to right,
 * OrderService sits far left in the hub, ShippingService far right. The ear tracks the
 * eye. Keep every gain low — this plays in-feed under someone else's music.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SR = 48000;
const TAU = Math.PI * 2;

const argv = process.argv.slice(2);
const name = argv.find((a) => !a.startsWith("--"));
if (!name) {
  console.error("usage: node tools/sfx.mjs <video-name> [--wav]");
  process.exit(1);
}
const proj = join(ROOT, "videos", name);
if (!existsSync(proj)) {
  console.error(`no such project: videos/${name}`);
  process.exit(1);
}

/* ── deterministic noise ───────────────────────────────────────────────────── */
const lcg = (seed) => {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2147483648) - 1;
};

/* ── envelopes ─────────────────────────────────────────────────────────────── */
/** linear attack then exponential decay — the shape of nearly every percussive sound */
const ad = (t, attack, tau) => (t < attack ? t / attack : Math.exp(-(t - attack) / tau));
/** a sine window — zero at both ends, peak in the middle. For anything that swells
    rather than strikes; starting or ending at non-zero would click. */
const hann = (t, dur) => Math.sin(Math.PI * Math.min(Math.max(t / dur, 0), 1));

/* ── voices. Each returns a mono Float32Array. ─────────────────────────────── */
const buf = (dur) => new Float32Array(Math.ceil(dur * SR));

/** a dry UI click: a noise transient plus a short mid-high body */
function tick(seed = 1) {
  const b = buf(0.05);
  const rnd = lcg(seed * 7919 + 13);
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    b[i] = 0.55 * rnd() * ad(t, 0.0006, 0.0035) + 0.45 * Math.sin(TAU * 1850 * t) * ad(t, 0.0008, 0.011);
  }
  return b;
}

/** a soft beep — the "tút" */
function tut(f = 820, dur = 0.085) {
  const b = buf(dur + 0.02);
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    b[i] = (Math.sin(TAU * f * t) + 0.18 * Math.sin(TAU * 2 * f * t)) * ad(t, 0.004, 0.026);
  }
  return b;
}

/** the crash: pitch falls as the amplitude decays, with a noise transient on the strike */
function thud(seed = 5) {
  const dur = 0.42;
  const b = buf(dur);
  const rnd = lcg(seed * 104729 + 7);
  let ph = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    const f = 195 * Math.exp(-t / 0.13) + 48;
    ph += (TAU * f) / SR;
    b[i] = 0.85 * Math.sin(ph) * ad(t, 0.002, 0.115) + 0.3 * rnd() * ad(t, 0.001, 0.014);
  }
  return b;
}

/** a muted knock — work that never happened */
function dull(f = 196) {
  const dur = 0.16;
  const b = buf(dur);
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    b[i] = (Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * 1.5 * f * t)) * ad(t, 0.003, 0.038);
  }
  return b;
}

/** a bright confirmation ping */
function pip(f = 988) {
  const dur = 0.2;
  const b = buf(dur);
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    b[i] = (Math.sin(TAU * f * t) + 0.22 * Math.sin(TAU * 2 * f * t) + 0.08 * Math.sin(TAU * 3 * f * t)) * ad(t, 0.003, 0.045);
  }
  return b;
}

/** the bus accepting the event: a tone that rises into place */
function swell() {
  const dur = 0.5;
  const b = buf(dur);
  let ph = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    const f = 260 + 470 * Math.min(t / 0.26, 1);
    ph += (TAU * f) / SR;
    b[i] = Math.sin(ph) * hann(t, dur) * 0.8;
  }
  return b;
}

/** the fan-out: one noise sweep standing in for three departures at once. A one-pole
    lowpass whose cutoff opens as the sweep rises — three separate ticks here would just
    sum into a click, and the point is that they leave together. */
function whoosh(seed = 9) {
  const dur = 0.44;
  const b = buf(dur);
  const rnd = lcg(seed * 15485863 + 3);
  let lp = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    const a = 0.02 + 0.3 * Math.min(t / 0.3, 1); /* cutoff opens over the sweep */
    lp += a * (rnd() - lp);
    b[i] = lp * hann(t, dur) * 2.6;
  }
  return b;
}

/** a verdict: two notes, one after the other */
function duo(f1, f2, gap = 0.115) {
  const a = tut(f1, 0.1);
  const c = tut(f2, 0.16);
  const off = Math.round(gap * SR);
  const b = buf((off + c.length) / SR);
  for (let i = 0; i < a.length; i++) b[i] += a[i] * 0.85;
  for (let i = 0; i < c.length; i++) b[off + i] += c[i];
  return b;
}

/* ── the cue sheet ─────────────────────────────────────────────────────────────
   `at` MUST mirror the T{} constants and the entrance stagger in the project's
   index.html. They are deliberately duplicated rather than shared: the composition may
   not read a local file at render time, and a build-time import would put audio code in
   the visual bundle. Two short lists side by side is the honest cost — if a beat moves in
   index.html, move it here and re-run. `--verify` prints them for eyeballing.        */
const SHEETS = {};

SHEETS["event-driven-architecture"] = { dur: 9.17, cues: () => [
  /* entrance: the four chain discs land left to right, and the pan follows them */
  { at: 0.34, v: () => tick(1), g: 0.3, pan: -0.62 },
  { at: 0.39, v: () => tick(2), g: 0.3, pan: -0.22 },
  { at: 0.44, v: () => tick(3), g: 0.3, pan: 0.22 },
  { at: 0.49, v: () => tick(4), g: 0.3, pan: 0.62 },

  /* act 1 — the call, the crash, the cascade */
  { at: 0.9, v: () => tick(5), g: 0.34, pan: -0.55 }, /* the call dot leaves OrderService */
  { at: 1.38, v: () => tut(700, 0.09), g: 0.2, pan: -0.15 }, /* it lands; the link goes solid blue */
  { at: 1.5, v: () => thud(6), g: 0.5, pan: 0.0 }, /* PaymentService dies */
  { at: 1.95, v: () => dull(196), g: 0.26, pan: 0.12 }, /* EmailService never called */
  { at: 2.35, v: () => dull(175), g: 0.26, pan: 0.5 }, /* ShippingService never called */
  { at: 2.85, v: () => duo(330, 247), g: 0.24, pan: 0.0 }, /* CASCADE FAILURE — descending */

  /* act 2 — the hub */
  { at: 3.55, v: () => tick(7), g: 0.28, pan: 0.0 }, /* the hub appears */
  { at: 4.2, v: () => tick(8), g: 0.34, pan: -0.75 }, /* OrderService publishes, far left */
  /* a sine window peaks at 1.0 but spends most of its length well below that, so this
     needs more gain than a percussive cue to sit at the same apparent loudness */
  { at: 4.95, v: () => swell(), g: 0.34, pan: 0.0 }, /* the bus takes it */
  { at: 5.3, v: () => whoosh(9), g: 0.2, pan: 0.0 }, /* three dots leave together */

  /* the confirmations rise B5 → C#6 → E6, panned to where each consumer sits */
  { at: 6.1, v: () => pip(988), g: 0.26, pan: 0.0 }, /* EmailService, top centre */
  { at: 6.18, v: () => pip(1109), g: 0.26, pan: 0.7 }, /* ShippingService, right */
  { at: 6.26, v: () => pip(1319), g: 0.26, pan: 0.0 }, /* AuditLog, bottom centre */

  { at: 6.95, v: () => duo(587, 880), g: 0.24, pan: 0.0 }, /* ISOLATED — ascending */
] };

/* ── load-balancing ───────────────────────────────────────────────────────────
   The sound design carries the argument rather than decorating it. Panel A is a
   clatter of identical ticks and six identical dull thuds — nine requests hitting one
   box sounds monotonous because it IS monotonous. Panel B drops the departure ticks
   entirely and keeps one clean note per turn, pitched by which box took it: web-1 high,
   web-2 middle, web-3 low. Round robin cycles 1→2→3, so those pitches form a repeating
   arpeggio at a steady 0.4s pulse. Overload sounds like noise; balance sounds like
   rhythm. Close your eyes and the two halves are still distinguishable.            */
SHEETS["load-balancing"] = { dur: 9.15, cues: () => {
  const A0 = 0.6, AGAP = 0.3, FLIGHT = 0.48, CAP = 3, N = 9;
  const B_SERVE0 = 3.8, BGAP = 0.4;
  const c = [
    { at: 0.22, v: () => tick(1), g: 0.22, pan: -0.3 },
    { at: 0.4, v: () => tick(2), g: 0.22, pan: 0.3 },
  ];

  for (let i = 0; i < N; i++) {
    const dep = A0 + i * AGAP;
    const land = dep + FLIGHT;
    /* every request departs the same source with the same click — quiet, so nine of them
       read as a stream rather than nine separate events */
    c.push({ at: dep, v: () => tick(10 + i), g: 0.16, pan: -0.62 });
    if (i < CAP) c.push({ at: land, v: () => pip(1109), g: 0.2, pan: 0.35 }); /* got in */
    else c.push({ at: land, v: () => dull(165), g: 0.3, pan: 0.35 }); /* 503 — low and dead */
  }
  /* the ceiling, 0.1s after the third slot fills so the two do not muddy each other */
  c.push({ at: A0 + (CAP - 1) * AGAP + FLIGHT + 0.1, v: () => duo(392, 294, 0.1), g: 0.2, pan: 0.2 });

  /* one note per turn. E6 / C#6 / B5 maps pitch to the box's height on screen — the top
     card is the top note — which panning cannot express, since all three share an x. */
  const TURN = [1319, 1109, 988];
  for (let i = 0; i < N; i++)
    c.push({ at: B_SERVE0 + i * BGAP, v: () => pip(TURN[i % 3]), g: 0.24, pan: 0.1 });

  c.push({ at: 7.25, v: () => duo(587, 880), g: 0.24, pan: 0.0 }); /* 6 DROPPED → 0 */
  return c;
} };

/* ── redis-caching ────────────────────────────────────────────────────────────
   Same trick as load-balancing: the mix argues rather than decorates. Read #1 is a
   muted knock (nothing in the cache), then a seven-click ratchet under the marching
   bar — 480ms you can HEAR pass — then a mid tone when the disk finally answers.
   Read #2 is one bright pip and it is over. The ear should be able to tell the two
   halves apart with the screen off, and the grind is the reason it can.

   Pitch, not pan, carries position here: all three tiers share one column, so panning
   them would be a lie. Depth maps to pitch instead — the cache answers high, the disk
   answers low, and the one sound Postgres makes on read #2 is the lowest note in the
   piece, played quietly, because it is the sound of work that did not happen.      */
SHEETS["redis-caching"] = { dur: 9.15, cues: () => {
  const c = [
    /* entrance: three tiers land top to bottom, then the elapsed panel */
    { at: 0.34, v: () => tick(1), g: 0.24, pan: -0.12 },
    { at: 0.41, v: () => tick(2), g: 0.24, pan: 0.0 },
    { at: 0.48, v: () => tick(3), g: 0.24, pan: 0.12 },
    { at: 0.56, v: () => tick(4), g: 0.15, pan: 0.0 },

    /* ── read #1: the long way round ── */
    { at: 0.86, v: () => tick(5), g: 0.3, pan: 0.0 }, /* the request leaves the client */
    { at: 1.3, v: () => dull(196), g: 0.3, pan: 0.0 }, /* MISS — the cache has nothing */
    { at: 1.44, v: () => tick(6), g: 0.2, pan: 0.0 }, /* it falls through */
    { at: 1.9, v: () => tut(392, 0.11), g: 0.2, pan: 0.0 }, /* Postgres starts scanning */
  ];

  /* the ratchet. Seven clicks across the bar's 1.05s march, alternating a hair off
     centre so the wait has width. Quiet on purpose — it should register as duration,
     not as an event. This is the sound read #2 does not make. */
  for (let i = 0; i < 7; i++)
    c.push({ at: 1.98 + i * 0.15, v: () => tick(20 + i), g: 0.1, pan: i % 2 ? 0.12 : -0.12 });

  c.push(
    { at: 3.02, v: () => tut(659, 0.13), g: 0.26, pan: 0.0 }, /* the disk answers, 480ms */
    { at: 3.48, v: () => pip(880), g: 0.19, pan: 0.0 }, /* CACHED — the write on the way back */
    { at: 3.8, v: () => tut(523, 0.1), g: 0.24, pan: 0.0 }, /* it reaches the client */
    { at: 3.95, v: () => tick(8), g: 0.16, pan: 0.0 }, /* result row 1 lands */

    { at: 4.2, v: () => tick(9), g: 0.26, pan: 0.0 }, /* the flip — same request, warm cache */

    /* ── read #2: one note ── */
    { at: 4.46, v: () => tick(10), g: 0.3, pan: 0.0 }, /* the request leaves again */
    { at: 4.96, v: () => pip(1319), g: 0.33, pan: 0.0 }, /* HIT — the brightest note here */
    { at: 5.2, v: () => dull(147), g: 0.17, pan: 0.0 }, /* Postgres never reached */
    { at: 6.08, v: () => tut(880, 0.1), g: 0.24, pan: 0.0 }, /* already home, <1ms */
    { at: 6.45, v: () => tick(11), g: 0.16, pan: 0.0 }, /* result row 2 lands */
    { at: 7.1, v: () => duo(587, 880), g: 0.24, pan: 0.0 }, /* the takeaway — ascending */
  );
  return c;
} };

/* ── rate-limiting ────────────────────────────────────────────────────────────
   Both halves refuse roughly the same number of requests. The mix is what tells you
   one of those is a failure and the other is a feature.

   Section A: eight departure clicks, then five falling thuds as the API hands back
   503s — low, untuned, arriving 55ms apart, which is close enough to smear into one
   collapsing noise. There is no pulse to it because there is no mechanism behind it.

   Section B: the same eight departures, but every request lands on a crisp check
   click, and the answer alternates pip / tut / pip / tut at a dead-steady 85ms — a
   rejection is the same loudness and the same length as an acceptance, because the
   limiter did its job either way. Overload sounds like a pile-up; a limiter sounds
   like a metronome. With the screen off the two halves are still tellable apart.

   Panning follows the wire: requests leave hard left, the gate is centre, the API is
   right. The 503s pan from right back to left as they travel home.               */
SHEETS["rate-limiting"] = { dur: 9.15, cues: () => {
  /* these MUST mirror T{}, A{} and B{} in videos/rate-limiting/index.html */
  const A = { fire: 0.5, stagger: 0.055, land: 0.26 + 0.07 + 0.36, ok: 3 };
  const B = { fire: 3.74, stagger: 0.085, gate: 0.26, hold: 0.05, land: 0.26 + 0.05 + 0.09 + 0.44 };
  const PASS = [0, 2, 4, 6];
  const N = 8;
  const c = [
    /* entrance: the graph assembles left to right */
    { at: 0.26, v: () => tick(1), g: 0.22, pan: -0.6 },
    { at: 0.305, v: () => tick(2), g: 0.22, pan: -0.1 },
    { at: 0.35, v: () => tick(3), g: 0.22, pan: 0.45 },
    { at: 0.4, v: () => tick(4), g: 0.14, pan: 0.0 },
  ];

  /* ── A: no gate ── */
  for (let i = 0; i < N; i++) {
    c.push({ at: A.fire + i * A.stagger, v: () => tick(10 + i), g: 0.15, pan: -0.66 });
    const land = A.fire + i * A.stagger + A.land;
    if (i < A.ok) c.push({ at: land, v: () => pip(1109), g: 0.2, pan: 0.5 });
    /* the 503 strikes at the API and the thud follows it home, so it starts right and
       the next one is already further left — the collapse moves toward the caller */
    else c.push({ at: land, v: () => thud(30 + i), g: 0.34, pan: 0.5 - (i - A.ok) * 0.22 });
  }
  c.push({ at: 1.9, v: () => duo(330, 247), g: 0.24, pan: 0.0 }); /* overwhelmed — descending */

  /* ── B: the same burst, gated ── */
  c.push({ at: 3.36, v: () => tick(5), g: 0.22, pan: 0.0 }); /* the limiter drops in */
  c.push({ at: 3.66, v: () => tut(659, 0.09), g: 0.18, pan: 0.2 }); /* it wires up */

  for (let i = 0; i < N; i++) {
    c.push({ at: B.fire + i * B.stagger, v: () => tick(50 + i), g: 0.15, pan: -0.66 });
    const gate = B.fire + i * B.stagger + B.gate;
    /* the check itself — quiet, but every single request gets one. This is the sound
       section A does not make. */
    c.push({ at: gate, v: () => tick(70 + i), g: 0.1, pan: 0.0 });
    if (PASS.indexOf(i) !== -1)
      c.push({ at: B.fire + i * B.stagger + B.land, v: () => pip(1109), g: 0.24, pan: 0.5 });
    /* the 429: mid, short, clean. Deliberately the SAME weight as the pip above — a
       refusal here is not a failure, and making it thud would argue the opposite. */
    else c.push({ at: gate + B.hold, v: () => tut(523, 0.075), g: 0.24, pan: -0.3 });
  }
  c.push({ at: 5.05, v: () => duo(587, 880), g: 0.24, pan: 0.0 }); /* delivered — ascending */
  c.push({ at: 6.8, v: () => pip(1319), g: 0.22, pan: 0.0 }); /* BURST DEFLECTED */
  return c;
} };

const sheet = SHEETS[name];
if (!sheet) {
  console.error(`no cue sheet for "${name}". Sheets: ${Object.keys(SHEETS).join(", ")}`);
  process.exit(1);
}
const CUES = sheet.cues();
const DUR = Number(process.env.SFX_DUR || sheet.dur);

/* ── mix ───────────────────────────────────────────────────────────────────── */
const n = Math.ceil(DUR * SR);
const L = new Float32Array(n);
const R = new Float32Array(n);
for (const c of CUES) {
  const s = c.v();
  const off = Math.round(c.at * SR);
  /* constant-power pan, so a hard-panned cue is not quieter than a centred one */
  const th = ((c.pan + 1) * Math.PI) / 4;
  const gl = Math.cos(th) * Math.SQRT2 * c.g;
  const gr = Math.sin(th) * Math.SQRT2 * c.g;
  for (let i = 0; i < s.length; i++) {
    const j = off + i;
    if (j >= n) break;
    L[j] += s[i] * gl;
    R[j] += s[i] * gr;
  }
}

/* peak-normalise to -1.6 dBFS only if we are over it; never pump quiet mixes up */
let peak = 0;
for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const ceil = Math.pow(10, -1.6 / 20);
const k = peak > ceil ? ceil / peak : 1;

/* ── write a 16-bit stereo WAV ─────────────────────────────────────────────── */
const bytes = n * 4;
const wav = Buffer.alloc(44 + bytes);
wav.write("RIFF", 0);
wav.writeUInt32LE(36 + bytes, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); /* PCM */
wav.writeUInt16LE(2, 22); /* stereo */
wav.writeUInt32LE(SR, 24);
wav.writeUInt32LE(SR * 4, 28);
wav.writeUInt16LE(4, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(bytes, 40);
const q = (x) => Math.max(-32768, Math.min(32767, Math.round(x * k * 32767)));
for (let i = 0; i < n; i++) {
  wav.writeInt16LE(q(L[i]), 44 + i * 4);
  wav.writeInt16LE(q(R[i]), 46 + i * 4);
}

const assets = join(proj, "assets");
mkdirSync(assets, { recursive: true });
const wavPath = join(assets, "sfx.wav");
const outPath = join(assets, "sfx.m4a");
writeFileSync(wavPath, wav);

/* AAC, because the documented <audio> pattern uses a compressed container and it muxes
   without a re-encode surprise at render time */
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", wavPath, "-c:a", "aac", "-b:a", "160k", "-ar", String(SR), outPath]);
if (!argv.includes("--wav")) unlinkSync(wavPath);

console.log(`sfx → videos/${name}/assets/sfx.m4a`);
console.log(`  ${CUES.length} cues · ${DUR}s · ${SR}Hz stereo · peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS${k < 1 ? ` → trimmed ${(20 * Math.log10(k)).toFixed(1)} dB` : " (no trim needed)"}`);
console.log(`  cue times: ${CUES.map((c) => c.at).join(", ")}`);
