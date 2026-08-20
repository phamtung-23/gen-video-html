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

/* ── pub-sub ──────────────────────────────────────────────────────────────────
   Same discipline as the others: the mix makes the argument, it does not decorate it.

   Act 1 is the publisher working three times — three departure clicks 180ms apart and
   three separate landings, nine hundred milliseconds of effort you can count with your
   eyes shut. Act 2 replaces all of it with ONE click, one swell, one whoosh, and four
   confirmations that arrive together. The publisher's own sound goes from a stutter to
   a single note while the number of answers goes UP; that inversion is the whole idea,
   and it survives with the screen off.

   Two knocks in between are the services nobody told — the only cues in the piece with
   no departure in front of them, because nothing was ever sent.

   Pan follows x across the 972-wide graph; pitch follows y, because five subscribers
   ringing one hub cannot all be told apart by pan alone. EmailService sits highest and
   answers highest, Warehouse sits lowest and answers lowest.

   These MUST mirror T{}, LEG and the entrance stagger in videos/pub-sub/index.html. */
SHEETS["pub-sub"] = { dur: 9.15, cues: () => {
  const T = { send: 1.05, sendGap: 0.18, missed: 2.55, mode2: 3.5, topic: 3.85,
              publish: 4.5, flare: 5.05, fanout: 5.35, join: 7.15, verdict: 8.05, foot: 8.5 };
  const LEG = 0.62;
  const PUB = -0.79; /* x=100 of 972 */
  const TOPIC = -0.16; /* x=410 */
  /* [pan from x, pitch from y] per subscriber, in DOM order s0..s4 */
  const S = [
    { pan: 0.58, hz: 1319 }, /* EmailService   770, 90  — highest on screen, highest note */
    { pan: 0.81, hz: 1175 }, /* InvoiceService 880, 310 */
    { pan: 0.58, hz: 988 },  /* Analytics      770, 530 */
    { pan: -0.15, hz: 880 }, /* Warehouse      415, 592 — lowest on screen, lowest note */
    { pan: -0.76, hz: 1047 },/* FraudCheck     115, 452 */
  ];

  /* entrance: the publisher, then the five services, in DOM order */
  const c = [{ at: 0.4, v: () => tick(1), g: 0.24, pan: PUB }];
  S.forEach((s, i) => c.push({ at: 0.45 + i * 0.05, v: () => tick(2 + i), g: 0.22, pan: s.pan }));

  /* ── act 1: three separate calls. Three departures, three arrivals, and the ear
       counts every one of them. This is the sound act 2 does not make. ── */
  for (let i = 0; i < 3; i++) {
    const fire = T.send + i * T.sendGap;
    c.push({ at: fire, v: () => tick(10 + i), g: 0.3, pan: PUB });
    c.push({ at: fire + LEG, v: () => pip(S[i].hz), g: 0.26, pan: S[i].pan });
  }

  /* the two nobody told. No departure precedes these — that absence IS the cue. */
  c.push({ at: T.missed, v: () => dull(196), g: 0.3, pan: S[3].pan });
  c.push({ at: T.missed + 0.1, v: () => dull(165), g: 0.3, pan: S[4].pan });

  /* ── act 2: the rewire ── */
  c.push({ at: T.mode2, v: () => tick(20), g: 0.24, pan: 0.0 });
  c.push({ at: T.topic, v: () => tick(21), g: 0.26, pan: TOPIC });
  c.push({ at: T.topic + 0.3, v: () => tut(659, 0.09), g: 0.17, pan: TOPIC }); /* it wires up */

  /* ONE departure, where act 1 needed three. Same voice, same gain, same pan as the
     first send at 1.05 — nothing about the click changed, only how many there are. */
  c.push({ at: T.publish, v: () => tick(30), g: 0.3, pan: PUB });
  /* a sine window peaks at 1.0 but spends most of its length below it, so a swell needs
     more gain than a percussive cue to sit at the same apparent loudness */
  c.push({ at: T.flare, v: () => swell(), g: 0.34, pan: TOPIC }); /* the topic takes it */
  c.push({ at: T.fanout, v: () => whoosh(9), g: 0.2, pan: TOPIC }); /* four copies, one sound */

  /* the confirmations. A 60ms ladder only so four notes are distinguishable — they are
     a chord, not a sequence, and the whoosh above already said they left together. */
  const LAND = T.fanout + LEG;
  for (let i = 0; i < 4; i++)
    c.push({ at: LAND + i * 0.06, v: () => pip(S[i].hz), g: 0.24, pan: S[i].pan });

  /* ── act 3: a subscriber joins, and the publisher makes no sound at all ── */
  c.push({ at: T.join, v: () => tut(784, 0.09), g: 0.2, pan: S[4].pan }); /* it subscribes */
  c.push({ at: T.join + 0.2 + LEG, v: () => pip(S[4].hz), g: 0.26, pan: S[4].pan });

  c.push({ at: T.verdict, v: () => duo(587, 880), g: 0.24, pan: 0.0 }); /* DECOUPLED — ascending */
  c.push({ at: T.foot, v: () => tick(40), g: 0.13, pan: 0.0 });
  return c;
} };

/* ── left-join ────────────────────────────────────────────────────────────────
   The mix makes the argument. Three lookups establish a three-part rhythm — click
   (the probe leaves), ping (it found the row), knock (the result row lands) — repeated
   three times at exactly the same spacing so the ear learns it. The fourth probe opens
   with the SAME click, at the same gain and the same pan as the other three, and then
   the ping never comes. Four dull knocks descend the orders table instead, and the
   piece is silent where the confirmation should have been. That hole is the cue.

   What Dana finally gets is a `tut`, not a `pip`: warm and mid, where every match rang
   bright. Timbre carries amber-vs-green the way the fill does on screen — the row
   arrived, it just did not match, and those are not the same event.

   Pan follows x across the 972-wide stage: the users table sits left of centre
   (pan -0.55), orders right (+0.55), the full-width result table dead centre. Pitch
   follows y, because four rows one above the other cannot be told apart by pan alone.

   These MUST mirror T{}, HOP and SCAN in videos/left-join/index.html. */
SHEETS["left-join"] = { dur: 11.0, cues: () => {
  const T = { p: [1.45, 2.63, 3.81], miss: 5.05, orphan: 7.35, inner: 8.7, chips: 9.5 };
  const HOP = 0.46;  /* out of the left row, along the gutter, into the right row */
  const SCAN = 0.19; /* per row, while Dana's probe walks the orders table */
  const LEFT = -0.55, RIGHT = 0.55;
  const MATCH = [1, 3, 0];             /* users row i answered by orders row MATCH[i] */
  const OHZ = [1319, 1175, 988, 880];  /* orders rows, top to bottom */
  const RHZ = [1047, 988, 880];        /* the three result rows that carry a total */

  /* entrance: the query strip, then the three tables left, right, centre */
  const c = [
    { at: 0.14, v: () => tick(1), g: 0.2, pan: 0.0 },
    { at: 0.22, v: () => tick(2), g: 0.24, pan: LEFT },
    { at: 0.3, v: () => tick(3), g: 0.24, pan: RIGHT },
    { at: 0.42, v: () => tick(4), g: 0.22, pan: 0.0 },
  ];

  /* ── the three that match. click · ping · knock, three times, identically spaced.
       This is the pattern the fourth probe exists to break. ── */
  T.p.forEach((at, i) => {
    c.push({ at, v: () => tick(10 + i), g: 0.3, pan: LEFT });                        /* leaves */
    c.push({ at: at + HOP, v: () => pip(OHZ[MATCH[i]]), g: 0.26, pan: RIGHT });      /* found  */
    c.push({ at: at + HOP + 0.16, v: () => tut(RHZ[i], 0.075), g: 0.16, pan: 0.0 }); /* lands  */
  });

  /* ── Dana. Same click, same gain, same pan as the other three — nothing about the
       departure changed, which is what makes the missing ping audible. ── */
  c.push({ at: T.miss, v: () => tick(13), g: 0.3, pan: LEFT });
  const reach = T.miss + HOP;
  /* four knocks down the table where one ping should have been */
  for (let j = 0; j < 4; j++)
    c.push({ at: reach + SCAN * j, v: () => dull(392 - j * 34), g: 0.24, pan: RIGHT });
  /* came back empty: two notes, descending */
  c.push({ at: reach + SCAN * 3 + 0.14, v: () => duo(392, 294, 0.1), g: 0.22, pan: 0.0 });
  /* kept anyway. A tut, never a pip — the row arrived, it did not match. */
  c.push({ at: reach + SCAN * 3 + 0.37, v: () => tut(587, 0.13), g: 0.24, pan: 0.0 });

  /* the order nobody could claim. No departure precedes it — nothing ever asked. */
  c.push({ at: T.orphan, v: () => dull(165), g: 0.3, pan: RIGHT });
  c.push({ at: T.orphan + 0.1, v: () => whoosh(3), g: 0.13, pan: RIGHT }); /* the strike drawing */

  /* what INNER JOIN would have done — descending, because it is a loss */
  c.push({ at: T.inner, v: () => duo(523, 392), g: 0.24, pan: 0.0 });

  /* the two counts: one bright, one muted, the same split as green and red */
  c.push({ at: T.chips, v: () => tut(659, 0.11), g: 0.24, pan: -0.35 });
  c.push({ at: T.chips + 0.12, v: () => dull(196), g: 0.24, pan: 0.35 });
  return c;
} };

/* ── monolith-vs-microservices ─────────────────────────────────────────────────
   ARCHETYPE: queue, run twice at once. Both architectures are on screen for the whole
   video, so both are in the mix for the whole video — and the mix separates them by
   REGISTER, not by pan. The monolith answers in a low octave (G4), microservices in the
   octave above (G5). Pan follows the slot a request actually lands in, because that part
   is true; the panels share an x, so panning them apart would not be.

   One arrival, two answers, and you can hear them come apart:

     the two honest requests   both octaves say yes — the architectures agree
     the spike, ten requests   the LOW octave says yes ten times while the HIGH octave
                               stops at four and knocks six times. The monolith sounds
                               like it is coping. It is: it is handing the spike everything.
     the four retries          the registers swap. The low octave knocks four times and
                               the high octave answers four times. That flip is the whole
                               video, and it survives with the screen off.

   These MUST mirror ARR, FLIGHT, the resolver rules and T{} in
   videos/monolith-vs-microservices/index.html. */
SHEETS["monolith-vs-microservices"] = { dur: 9.15, cues: () => {
  const FLIGHT = 0.36;
  const T = { verdict: 6.0, verdictB: 6.25, foot: 6.9 };

  /* geometry, mirrored so a landing sounds where it lands */
  const W = 972, BOX_X = 350, PAD = 18, SW = 89.33, GAP = 10;
  const A_COLS = 6, B_COLS = 4;
  const A_X = (i) => BOX_X + PAD + (i % A_COLS) * (SW + GAP) + SW / 2;
  const B_SLOT_X = BOX_X + (W - BOX_X) - PAD - (B_COLS * SW + (B_COLS - 1) * GAP);
  const B_X = (i) => B_SLOT_X + i * (SW + GAP) + SW / 2;
  const pan = (x) => (x / W) * 2 - 1;
  const MOUTH = pan(BOX_X + 22); /* where a refused request bounces */

  const LOW = 392;  /* the monolith's voice */
  const HIGH = 784; /* microservices, an octave up */

  /* the one arrival list, and the two resolvers */
  const ARR = [
    { src: 0, at: 1.05 },
    { src: 2, at: 1.2 },
    ...Array.from({ length: 10 }, (_, i) => ({ src: 1, at: 1.45 + i * 0.22 })),
    { src: 0, at: 4.15 },
    { src: 2, at: 4.4 },
    { src: 0, at: 4.95 },
    { src: 2, at: 5.2 },
  ];
  let nextA = 0;
  const nextB = [0, 0, 0];
  const RA = ARR.map((a) => (nextA < A_COLS * 2 ? { ...a, slot: nextA++ } : { ...a, slot: null }));
  const RB = ARR.map((a) => (nextB[a.src] < B_COLS ? { ...a, slot: nextB[a.src]++ } : { ...a, slot: null }));

  const c = [
    /* entrance: the rails, then both capacities landing together */
    { at: 0.3, v: () => tick(1), g: 0.16, pan: -0.4 },
    { at: 0.5, v: () => tut(523, 0.09), g: 0.14, pan: -0.2 },
    { at: 0.56, v: () => tick(2), g: 0.18, pan: 0.4 },
  ];

  /* the monolith's answers, low. Gain climbs across the spike: the last thread is loudest
     because it is the last one. */
  const nA = RA.filter((x) => x.slot !== null).length;
  let kA = 0;
  RA.forEach((a, i) => {
    if (a.slot !== null) {
      c.push({ at: a.at + FLIGHT, v: () => pip(LOW), g: 0.15 + (0.09 * kA++) / (nA - 1), pan: pan(A_X(a.slot)) });
    } else {
      /* a request the monolith refused — and every one of these is from a feature that
         never spiked. The lowest, deadest sound in the piece. */
      c.push({ at: a.at + 0.24, v: () => dull(98), g: 0.3, pan: MOUTH });
    }
  });
  /* the shared pool closing */
  const lastA = RA.filter((x) => x.slot !== null).pop();
  c.push({ at: lastA.at + FLIGHT + 0.02, v: () => thud(5), g: 0.3, pan: 0.5 });

  /* microservices' answers, an octave up */
  RB.forEach((a) => {
    if (a.slot !== null) c.push({ at: a.at + FLIGHT, v: () => pip(HIGH), g: 0.19, pan: pan(B_X(a.slot)) });
    else c.push({ at: a.at + 0.24, v: () => dull(196), g: 0.24, pan: MOUTH });
  });
  /* payments' own queue closing — higher and lighter than the monolith's thud, because
     what closed was one queue and not the whole application */
  const lastPay = RB.filter((x) => x.slot !== null && x.src === 1).pop();
  c.push({ at: lastPay.at + FLIGHT + 0.02, v: () => duo(523, 415, 0.09), g: 0.2, pan: 0.55 });

  /* the score */
  c.push({ at: T.verdict, v: () => duo(392, 294, 0.1), g: 0.26, pan: -0.35 }); /* descending */
  c.push({ at: T.verdictB, v: () => duo(587, 880, 0.115), g: 0.26, pan: 0.35 }); /* ascending */
  c.push({ at: T.foot, v: () => tick(60), g: 0.15, pan: -0.3 });
  return c;
} };


/* ── inner-join ───────────────────────────────────────────────────────────────
   The mix carries the two moves the picture carries, and both survive with the
   screen off.

   THE FAN-OUT. Every lookup is click (it leaves, panned left where the users table
   is) · ping (it found the row, panned right, pitched by how far down the orders
   table that row sits) · tut (the result row lands, dead centre). Four times. The
   third and fourth results ring the SAME note — 880 — because they came from the
   same left row, and two rows that sound identical is exactly what a fan-out is.
   The x2 mark is that note struck twice in a row, nothing else.

   THE DOUBLE CULL. Two knocks at the same instant, the same voice, the same
   frequency, one hard left and one hard right. left-join's two drops were seconds
   apart and pitched differently because LEFT JOIN really is asymmetric; here they
   are one event, so they are one sound, mirrored across the stereo field. Nothing
   in the piece is simultaneous until this.

   Pan follows x across the 972-wide stage: users left (-0.55), orders right
   (+0.55), the full-width result table dead centre. Pitch follows y, because rows
   stacked one above the other cannot be told apart by pan alone.

   These MUST mirror T{}, HOPS, HOP and STUB in videos/inner-join/index.html. */
SHEETS["inner-join"] = { dur: 10.2, cues: () => {
  const T = { mark: 5.72, cull: 6.55, chips: 8.3 };
  const HOP = 0.46;  /* out of the left row, along the gutter, into the right row */
  const STUB = 0.16; /* a cull probe reaching into the gutter and stopping */
  const LEFT = -0.55, RIGHT = 0.55;
  const HOPS = [
    { u: 0, o: 1, at: 1.4 },
    { u: 1, o: 3, at: 2.58 },
    { u: 2, o: 0, at: 3.76 },
    { u: 2, o: 4, at: 4.94 }, /* the same users row, reaching a second time */
  ];
  const OHZ = [1319, 1175, 988, 880, 784]; /* orders rows, top to bottom */
  /* result rows 2 and 3 are both Cy, so they ring the same note. That repeat is the
     fan-out; giving the fourth row its own pitch would have hidden it. */
  const RHZ = [1047, 988, 880, 880];

  /* entrance: the query strip, then the three tables left, right, centre */
  const c = [
    { at: 0.14, v: () => tick(1), g: 0.2, pan: 0.0 },
    { at: 0.22, v: () => tick(2), g: 0.24, pan: LEFT },
    { at: 0.3, v: () => tick(3), g: 0.24, pan: RIGHT },
    { at: 0.42, v: () => tick(4), g: 0.22, pan: 0.0 },
  ];

  /* ── the four matches. click · ping · tut, identically spaced, four times. ── */
  HOPS.forEach((h, i) => {
    c.push({ at: h.at, v: () => tick(10 + i), g: 0.3, pan: LEFT });                 /* leaves */
    c.push({ at: h.at + HOP, v: () => pip(OHZ[h.o]), g: 0.26, pan: RIGHT });        /* found  */
    c.push({ at: h.at + HOP + 0.16, v: () => tut(RHZ[i], 0.075), g: 0.17, pan: 0 });/* lands  */
  });

  /* the x2 mark: one note struck twice. The only doubled cue in the piece. */
  c.push({ at: T.mark, v: () => tut(880, 0.07), g: 0.15, pan: LEFT });
  c.push({ at: T.mark + 0.12, v: () => tut(880, 0.07), g: 0.15, pan: LEFT });

  /* ── THE DOUBLE CULL. Same voice, same gain, same frequency, same frame — the only
       difference between the two is which ear it arrives in. ── */
  c.push({ at: T.cull, v: () => tick(20), g: 0.28, pan: LEFT });
  c.push({ at: T.cull, v: () => tick(21), g: 0.28, pan: RIGHT });
  const dead = T.cull + STUB + 0.1;
  c.push({ at: dead, v: () => dull(196), g: 0.3, pan: LEFT });
  c.push({ at: dead, v: () => dull(196), g: 0.3, pan: RIGHT });
  /* the verdict, descending, dead centre — it belongs to neither side */
  c.push({ at: dead + 0.14, v: () => duo(392, 294, 0.1), g: 0.22, pan: 0.0 });

  /* the two chips: one bright, one muted, the same split as green and red */
  c.push({ at: T.chips, v: () => tut(659, 0.11), g: 0.24, pan: -0.35 });
  c.push({ at: T.chips + 0.12, v: () => dull(196), g: 0.24, pan: 0.35 });
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
