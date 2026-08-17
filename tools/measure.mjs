#!/usr/bin/env node
/**
 * measure.mjs — turn a reference video into a measured spec.
 *
 *   node tools/measure.mjs <video> [--out DIR] [--fps 10] [--width 720] [--target 1080]
 *
 * Reads raw pixels via ffmpeg (never guesses) and writes:
 *   DIR/spec.json     probe, content column, element boxes, text rows, palette, change beats
 *   DIR/frames/*.png  key frames at each detected beat, for eyeballing
 *   DIR/contact.jpg   contact sheet
 *
 * Every measurement is reported twice: `px` at the analysis width, and `at<target>`
 * scaled to the build canvas. Social re-encodes are usually downscales of a 1080-wide
 * original, so the scaled numbers are the ones to author against.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

/* ── args ── */
const argv = process.argv.slice(2);
const VIDEO = argv.find((a) => !a.startsWith("--"));
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
if (!VIDEO) {
  console.error("usage: node tools/measure.mjs <video> [--out DIR] [--fps 10] [--width 720] [--target 1080]");
  process.exit(1);
}
const OUT = flag("out", ".measure");
const FPS = Number(flag("fps", 10));
const W = Number(flag("width", 720));
const TARGET = Number(flag("target", 1080));

const sh = (cmd, args, max = 1 << 28) => execFileSync(cmd, args, { maxBuffer: max });

/* ── probe ── */
const probeRaw = sh("ffprobe", [
  "-v", "error",
  "-show_entries", "format=duration,bit_rate",
  "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate,nb_frames",
  "-of", "json", VIDEO,
]).toString();
const p = JSON.parse(probeRaw);
const v = p.streams.find((s) => s.codec_type === "video");
const a = p.streams.find((s) => s.codec_type === "audio");
const H = Math.round((W * v.height) / v.width);
const probe = {
  width: v.width,
  height: v.height,
  fps: eval(v.r_frame_rate),
  duration: Number(p.format.duration),
  frames: Number(v.nb_frames),
  codec: v.codec_name,
  bitrate: Number(p.format.bit_rate),
  hasAudio: !!a,
  audioCodec: a?.codec_name ?? null,
};
const K = TARGET / W; // analysis px → build px
const up = (n) => Math.round(n * K);

/* ── decode every sampled frame once, at analysis size ── */
const FRAME = W * H * 3;
const buf = sh(
  "ffmpeg",
  ["-v", "error", "-i", VIDEO, "-vf", `fps=${FPS},scale=${W}:${H}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
  1_500_000_000,
);
const N = Math.floor(buf.length / FRAME);
const px = (f, x, y) => {
  const i = f * FRAME + (y * W + x) * 3;
  return [buf[i], buf[i + 1], buf[i + 2]];
};
const lum = (f, x, y) => {
  const i = f * FRAME + (y * W + x) * 3;
  return 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2];
};
const hex = ([r, g, b]) => "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");

/* Reference frame for all geometry. Defaults to near the end, where the layout is
   most complete — but on a glow-heavy final state the bloom bridges the gaps between
   cards and the box detector merges them. When boxes look merged, pass `--ref` a time
   where the layout is fully laid out but still cold (often just after the entrance). */
const REF = flag("ref", null) !== null
  ? Math.max(0, Math.min(N - 1, Math.round(Number(flag("ref", 0)) * FPS)))
  : Math.min(N - 1, Math.round(N * 0.94));

/* ── page background: the most common colour in the outer margins ── */
function background() {
  const tally = new Map();
  for (let y = 4; y < H; y += 3)
    for (const x of [2, 5, W - 6, W - 3]) {
      const k = hex(px(REF, x, y));
      tally.set(k, (tally.get(k) || 0) + 1);
    }
  return [...tally.entries()].sort((m, n) => n[1] - m[1])[0][0];
}
const bgHex = background();
const bgLum = (() => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(bgHex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b;
})();

/* ── content column ──
   Measured across the widest element box, NOT the whole frame: background glows
   differ from the flat page colour at every x, so a full-frame scan just returns
   0..W. Compared against the local row edges instead of the global background. */
function contentColumn(boxes) {
  if (!boxes.length) return null;
  const tallest = boxes.reduce((m, b) => (b.px[2] > m.px[2] ? b : m));
  const y = Math.round(tallest.px[0] + tallest.px[2] / 2);
  const edge = (lum(REF, 1, y) + lum(REF, W - 2, y)) / 2;
  let x0 = null, x1 = null;
  for (let x = 0; x < W; x++) if (Math.abs(lum(REF, x, y) - edge) > 2.5) { if (x0 === null) x0 = x; x1 = x; }
  if (x0 === null) return null;
  return { px: [x0, x1, x1 - x0 + 1], [`at${TARGET}`]: [up(x0), up(x1), up(x1 - x0 + 1)], scannedAtY: up(y) };
}

/* ── element boxes: runs of rows whose fill differs from the page background ──
   Panels and cards are usually LIGHTER, but inset panels can be darker, so the
   test is on |Δ| rather than a one-sided threshold. */
function elementBoxes() {
  const cx = Math.round(W * 0.66); // right of most text, inside cards
  const out = [];
  let run = null;
  for (let y = 0; y < H; y++) {
    const on = Math.abs(lum(REF, cx, y) - bgLum) > 4;
    if (on && run === null) run = y;
    if (!on && run !== null) {
      if (y - run >= 8)
        out.push({
          px: [run, y - 1, y - run],
          [`at${TARGET}`]: [up(run), up(y - 1), up(y - run)],
          fill: hex(px(REF, cx, Math.round(run + (y - run) / 2))),
        });
      run = null;
    }
  }
  return out;
}

/* ── text rows: runs of rows containing bright pixels ── */
function textRows() {
  const out = [];
  let run = null;
  for (let y = 0; y < H; y++) {
    let c = 0, x0 = W, x1 = 0;
    for (let x = 2; x < W - 2; x++)
      if (lum(REF, x, y) > 120) { c++; if (x < x0) x0 = x; if (x > x1) x1 = x; }
    const on = c >= 3;
    if (on && run === null) run = { y0: y, x0, x1 };
    if (on && run) { run.x0 = Math.min(run.x0, x0); run.x1 = Math.max(run.x1, x1); }
    if (!on && run !== null) {
      if (y - run.y0 >= 4)
        out.push({
          px: [run.y0, y - 1, y - run.y0],
          [`at${TARGET}`]: [up(run.y0), up(y - 1), up(y - run.y0)],
          x: { px: [run.x0, run.x1], [`at${TARGET}`]: [up(run.x0), up(run.x1)] },
          capHeightHint: up(y - run.y0),
        });
      run = null;
    }
  }
  return out;
}

/* ── palette: brightest (text/accent) and median (fill) per element box ── */
function palette(boxes) {
  const accents = new Map();
  for (let y = 0; y < H; y += 2)
    for (let x = 2; x < W - 2; x += 2) {
      const c = px(REF, x, y), mx = Math.max(...c), mn = Math.min(...c);
      if (mx - mn > 45 && mx > 90) {
        const k = hex(c.map((n) => Math.round(n / 24) * 24));
        accents.set(k, (accents.get(k) || 0) + 1);
      }
    }
  return {
    background: bgHex,
    fills: [...new Set(boxes.map((b) => b.fill))],
    accents: [...accents.entries()].sort((m, n) => n[1] - m[1]).slice(0, 8).map(([k, n]) => ({ hex: k, weight: n })),
  };
}

/* ── change beats: mean |Δ| between consecutive sampled frames ──
   Peaks are where the composition actually does something: a state flip, a text
   swap, an element revealing. These are the timeline beats worth authoring to. */
function beats() {
  const series = [];
  for (let f = 1; f < N; f++) {
    let s = 0, c = 0;
    for (let y = 0; y < H; y += 3) for (let x = 2; x < W - 2; x += 3) { s += Math.abs(lum(f, x, y) - lum(f - 1, x, y)); c++; }
    series.push({ t: +(f / FPS).toFixed(2), d: +(s / c).toFixed(3) });
  }
  const vals = series.map((s) => s.d).sort((m, n) => m - n);
  const median = vals[vals.length >> 1] || 0;
  const thr = Math.max(median * 2.2, 0.35);
  const peaks = series.filter((s, i) => s.d > thr && (i === 0 || s.d >= series[i - 1].d) && (i === series.length - 1 || s.d >= series[i + 1].d));
  return { threshold: +thr.toFixed(3), median: +median.toFixed(3), peaks, series };
}

/* ── per-box reveal: when the box stops looking like empty background ──
   Deliberately does NOT report per-box change peaks: inside a busy box the peak
   detector fires on animation as well as on state flips, and the noise drowns the
   signal. For a specific region use `--band y0:y1` (target coords) instead — that
   is the targeted second pass, once a frame has told you where to look. */
function boxReveals(boxes) {
  return boxes.map((b, i) => {
    const [y0, y1] = b.px;
    const mean = [];
    for (let f = 0; f < N; f++) {
      let s = 0, c = 0;
      for (let y = y0; y <= y1; y += 2) for (let x = 2; x < W - 2; x += 3) { s += lum(f, x, y); c++; }
      mean.push(s / c);
    }
    let revealAt = null;
    for (let f = 1; f < N; f++) if (revealAt === null && mean[f] - mean[0] > 2.5) revealAt = +(f / FPS).toFixed(2);
    return { box: i, y: b[`at${TARGET}`].slice(0, 2), revealAt };
  });
}

/* ── targeted band scan (--band y0:y1, in target coords) ──
   The follow-up pass. A caption swap moves too few pixels to clear the whole-frame
   threshold, so scope the diff to the band and it stands out cleanly. */
function bandScan(spec0, spec1) {
  const y0 = Math.round(spec0 / K), y1 = Math.round(spec1 / K);
  const d = [];
  for (let f = 1; f < N; f++) {
    let s = 0, c = 0;
    for (let y = y0; y <= y1; y++) for (let x = 2; x < W - 2; x++) { s += Math.abs(lum(f, x, y) - lum(f - 1, x, y)); c++; }
    d.push({ t: +(f / FPS).toFixed(2), d: +(s / c).toFixed(2) });
  }
  const sorted = d.map((x) => x.d).sort((m, n) => m - n);
  const med = sorted[sorted.length >> 1] || 0;
  const thr = Math.max(med * 4, 1.5);
  const peaks = d.filter((x, j) => x.d > thr && (j === 0 || x.d >= d[j - 1].d) && (j === d.length - 1 || x.d >= d[j + 1].d));
  return { band: [spec0, spec1], threshold: +thr.toFixed(2), peaks, series: d };
}

/* ── run ── */
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "frames"), { recursive: true });

const boxes = elementBoxes();

/* --band y0:y1 is a standalone targeted pass — print and exit, write nothing */
const BAND = flag("band", null);
if (BAND) {
  const [a0, a1] = BAND.split(":").map(Number);
  const r = bandScan(a0, a1);
  console.log(`band ${a0}..${a1} (target px)  threshold ${r.threshold}`);
  console.log("peaks: " + r.peaks.map((k) => `${k.t}(${k.d})`).join("  "));
  process.exit(0);
}

const b = beats();
const timing = boxReveals(boxes);
const spec = {
  source: VIDEO,
  probe,
  analysis: { width: W, height: H, fps: FPS, sampledFrames: N, scaleToTarget: K, target: TARGET, refFrame: +(REF / FPS).toFixed(2) },
  contentColumn: contentColumn(boxes),
  elementBoxes: boxes,
  textRows: textRows(),
  palette: palette(boxes),
  timing,
  beats: { threshold: b.threshold, median: b.median, peaks: b.peaks },
  diffSeries: b.series,
};
writeFileSync(join(OUT, "spec.json"), JSON.stringify(spec, null, 2));

/* key frames at each beat (plus first/last) so the text can actually be read */
const stamps = [...new Set([0.05, ...b.peaks.map((k) => k.t), probe.duration - 0.15].map((t) => +t.toFixed(2)))]
  .filter((t) => t >= 0 && t < probe.duration)
  .sort((m, n) => m - n)
  .slice(0, 28);
for (const t of stamps)
  sh("ffmpeg", ["-v", "error", "-ss", String(t), "-i", VIDEO, "-frames:v", "1",
    "-vf", `scale=${v.width}:${v.height}`, join(OUT, "frames", `t${String(t).padStart(6, "0")}.png`), "-y"]);
sh("ffmpeg", ["-v", "error", "-pattern_type", "glob", "-i", join(OUT, "frames", "*.png"),
  "-vf", `scale=300:-1,tile=6x${Math.ceil(stamps.length / 6)}`, join(OUT, "contact.jpg"), "-y"]);

/* ── report ── */
const R = [];
R.push(`${probe.width}x${probe.height}  ${probe.fps}fps  ${probe.duration.toFixed(2)}s  ${probe.frames} frames  ${(probe.bitrate / 1000) | 0}kbps  audio=${probe.hasAudio ? probe.audioCodec : "none"}`);
R.push(`analysed at ${W}x${H}, reported at ${TARGET} (x${K.toFixed(3)})`);
const cc = spec.contentColumn;
R.push(cc ? `content column  x ${cc[`at${TARGET}`][0]}..${cc[`at${TARGET}`][1]}  (w ${cc[`at${TARGET}`][2]}, scanned at y=${cc.scannedAtY})` : "content column  n/a");
R.push(`background ${spec.palette.background}   accents ${spec.palette.accents.slice(0, 6).map((x) => x.hex).join(" ")}`);
R.push(`\nelement boxes (y at ${TARGET}) — tops and pitch are reliable; heights inflate where`);
R.push(`an element has a soft edge or glow, so confirm a height against a key frame:`);
boxes.forEach((x, i) => {
  const [y0, y1, h] = x[`at${TARGET}`];
  const prev = i ? boxes[i - 1][`at${TARGET}`][0] : null;
  const pitch = prev === null ? "" : `  pitch=${y0 - prev}`;
  R.push(
    `  [${String(i).padStart(2)}] top=${String(y0).padStart(4)}  ..${String(y1).padStart(4)}  h=${String(h).padStart(3)}  ${x.fill}  reveal=${String(timing[i].revealAt ?? "t0").padStart(5)}${pitch}`,
  );
});
R.push(`\ntext rows (y at ${TARGET}, h, x-extent):`);
spec.textRows.forEach((x) => {
  const [y0, , h] = x[`at${TARGET}`];
  R.push(`  ${String(y0).padStart(4)}  h=${String(h).padStart(3)}  x ${x.x[`at${TARGET}`][0]}..${x.x[`at${TARGET}`][1]}`);
});
R.push(`\nchange beats (t, magnitude) — threshold ${b.threshold}:`);
R.push("  " + b.peaks.map((k) => `${k.t}(${k.d})`).join("  "));
R.push(`\nwrote ${OUT}/spec.json, ${stamps.length} key frames, ${OUT}/contact.jpg`);
R.push(`next: read the key frames, then re-run scoped to a region you care about, e.g.`);
R.push(`  node tools/measure.mjs ${VIDEO} --band 1190:1215   # caption row, target px`);
const report = R.join("\n");
writeFileSync(join(OUT, "report.txt"), report);
console.log(report);
