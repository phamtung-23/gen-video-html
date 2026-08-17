---
name: dark-technical-explainer
canvas: { w: 1080, h: 1920, aspect: "9:16", fps: 30 }
colors:
  bg: "#090b12"
  panel: "#0e1017"
  card: "#191a21"
  card-active: "#1d2027"
  card-dim: "#14151b"
  chip: "#16171e"
  border: "#262932"
  text: "#ffffff"
  text-card: "#e2e5ed"
  text-mute: "#8c909b"
  text-faint: "#878b96"
  accent-run: "#4f8ef7"
  accent-ok: "#3ecf8e"
  accent-warn: "#eda54a"
  accent-fail: "#f0555f"
  subtitle: "#8f9ad8"
typography:
  display: { family: Montserrat, weight: 400 }
  strong: { family: Montserrat, weight: 700 }
  machine: { family: JetBrains Mono, weight: 700 }
spacing:
  margin-x: 54
  content-w: 972
  safe-bottom: 282
components:
  card: { h: 90, radius: 22, border: 1.5, pad-x: 24 }
  badge: { h: 54, radius: 999, pad-x: 24 }
  chip: { h: 70, radius: 24, pad-x: 26 }
  separator: { h: 33 }
  arc-panel: { h: 166, radius: 22 }
---

# The Frame

Vertical 1080×1920 for an in-feed audience. Content lives in one 972px column with a
54px gutter; the bottom **282px stays empty** for the TikTok/Reels UI. Nothing that
carries meaning goes there.

## Layout archetypes — the theme is fixed, the structure rotates

Colour, type, spacing and component chrome are the channel's identity and never change.
**Structure is what keeps the feed from going stale**, so pick the archetype that matches
the shape of the idea — and do not reach for `lanes` by default just because it exists.

| Archetype | Builder | The shape it fits | Reach for it when |
| --- | --- | --- | --- |
| **lanes** | `card` `arc` `chip` | two strategies, same inputs, different outcome | comparing A vs B end to end |
| **swimlane** | `swim` | actors × time, work that overlaps | the point is *when* things happen — races, locks, backoff, pooling |
| **stack** | `stack` | tiers a request passes through | a call descends and returns — caches, middleware, the call stack |

A topic usually admits only one honest archetype. A race condition drawn as two lanes
loses the overlap that *is* the bug; a cache walk drawn as a swimlane hides the tiering.
If two fit, pick the one you used least recently.

Not yet built, in rough priority: **matrix** (options × dimensions — CAP, isolation
levels), **hero-stat** (one number owning half the frame — latency, cost), **queue**
(flow and overflow — rate limiting, backpressure). Code walkthroughs are **not** ours to
build: `hyperframes add code-typing | code-diff | code-highlight | code-scroll` already
covers them.

Working examples of every built archetype: `videos/kit-smoketest`, `videos/kit-layouts`.

## Colour carries state, not decoration

One hue, one meaning — never reuse a hue for a second idea in the same video:

| Hue | Token | Means |
| --- | --- | --- |
| blue | `accent-run` | in flight, working, not yet resolved |
| green | `accent-ok` | done, committed, persisted |
| amber | `accent-warn` | parallel / dispatched / the "other" strategy |
| red | `accent-fail` | failed, aborted, rolled back |

Grey is the resting state. De-emphasis ("this was undone") comes from **darkening the
card fill**, never from dimming the label text — dim labels fail the WCAG AA gate that
`hyperframes check` enforces, and it will block the render.

## Typography

Two voices, deliberately different registers:

- **Montserrat** — human language. Titles, task names, prose captions.
- **JetBrains Mono** — machine output. Status labels, node numbers, elapsed times,
  the `then` separators. Anything the *system* would say rather than a person.

Never pair two sans-serifs. The sans/mono split is the whole hierarchy.

Sizes assume in-feed viewing (the video plays small): title 54–88, card name 32,
status label 18, captions 22. Below ~16px nothing survives the platform re-encode.

## Motion

Every video opens with a **0.6–0.75s staggered entrance**, then holds the layout still
while state changes carry the story. The layout never reflows mid-video: elements that
appear later occupy reserved space from frame 0 (`visibility: hidden`, not `display: none`).

Nothing loops. Every repeat is a finite count.

## The composition is one clip

One `class="clip"` spanning the full duration, one paused GSAP timeline. Everything
inside is a plain element driven by that timeline. Do not give each element its own clip.
