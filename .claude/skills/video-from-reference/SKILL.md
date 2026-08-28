---
name: video-from-reference
description: >
  Recreate a reference video (an MP4 the user drops in) as a HyperFrames composition in
  this repo's house style — or build a new topic in that same style. Use whenever the
  user supplies a reference clip and asks for "a video like this", "tương tự video này",
  or names a topic to render in the established look. Also use it when the user asks for
  a video and supplies NOTHING — no clip, no topic — in which case you propose the topic.
  Covers measuring the reference, scaffolding against the shared kit, authoring,
  verifying, and rendering.
---

# Video from a reference clip

This repo makes short vertical technical explainers in one house style. Each video is
its own HyperFrames project (unavoidable — a project *is* a composition), but the
measurement tooling, the design system, and the component/timeline layer are shared.

**Read `kit/frame.md` before authoring.** It is the normative design spec: colour
meanings, type registers, spacing, the safe-bottom rule.

## Input

The argument is the reference, in any of four forms:

```
/video-from-reference refs/clip.mp4                    a local file
/video-from-reference https://www.tiktok.com/@x/video/123   a URL
/video-from-reference idempotency keys                 just a topic, no clip
/video-from-reference                                  nothing — you pick the topic
```

**A URL** gets fetched first — `yt-dlp` is installed:

```bash
mkdir -p refs && yt-dlp -o "refs/%(id)s.%(ext)s" "<url>"
```

Keep downloads in `refs/` and treat them strictly as measurement input. They are
someone else's video: measure the structure and timing, never ship their footage,
their audio bed, or their handle in the output.

**No argument at all?** Do not ask what to build — **propose it**. See *When there is no
argument* at the end of this file. Only stop to ask if the message reads like a clip
failed to attach.

## The loop

### 1. Measure the reference — never eyeball it

```bash
node tools/measure.mjs <reference.mp4> --out .measure
```

Prints and writes probe, content column, element boxes (top + pitch + reveal time),
text rows with cap heights, palette, and global change beats — all reported at the
1080-wide build canvas. Also drops key frames at each beat plus a contact sheet.

- **Boxes look merged?** The default reference frame is near the end, where a glowing
  final state bleeds across gaps. Re-run with `--ref 0.2` (or any time where the layout
  is complete but still cold).
- Trust **box tops and pitch**; confirm **heights** against a key frame, since a soft
  edge or glow inflates the run.

### 2. Read the key frames

The tool cannot read text or infer meaning. Open `.measure/frames/*.png` and the contact
sheet and work out: what the lanes are, what each state is called, what the captions say,
what the metaphor is.

### 3. Second pass, scoped

Once a frame tells you where the interesting region is, scope the diff to it:

```bash
node tools/measure.mjs <reference.mp4> --band 1190:1215     # y range, build px
```

A caption swap moves too few pixels to clear the whole-frame threshold. Scoped, it is
unmistakable. This is how you get exact text-change times.

### 4. Scaffold

```bash
node tools/new-video.mjs <name> --duration 14.12 --title "…" --sub "…"
```

Creates `videos/<name>/`, copies `kit/kit.css`, `kit/kit.js`, `frame.md` in, and writes a
starter `index.html` already wired to the kit.

Match the reference's exact duration and fps so frame counts line up.

### 5. Pick a layout archetype, write `shot-plan.json`, then author

**Choose the archetype before writing any markup** — see the table in `kit/frame.md`.
`lanes` is not the default; it is one of several, and three videos already use it. Match
the archetype to the shape of the idea (actors over time → `swim`; tiers a request walks
→ `stack`; two strategies compared → lanes), and record which one you picked and why in
the shot plan. If two fit, take the one used least recently — the theme is what carries
the channel's identity, so structure is free to vary and should.

Record measured values and every deliberate deviation in `videos/<name>/shot-plan.json`
before writing markup — it is what makes the build reviewable later.

Author `index.html` as: a **DATA block** (the content, at the top of the script), then
**DOM** built with `Kit.*` builders, then the **TIMELINE**. Keep the data separate from
the machinery so the next video is an edit, not a rewrite.

### 6. Verify — both gates, every time

```bash
cd videos/<name>
npm run check
npx hyperframes snapshot . --at <beat>,<beat>,…
```

`check` must be 0 errors. Then **look at the snapshots** — the automated gates do not
catch wrong-looking output, only invalid output. Pick times that show the opening state,
each signature move, and the final hold.

### 7. Render only after the user approves

Ask "preview first, or render?" and wait. Then:

```bash
npx hyperframes render . -q high -o ./renders/video.mp4
```

Quality `high`, not the `standard` default: these compositions are dark with gradients
and glows, and a low bitrate bands badly once the platform re-encodes.

## Four traps that cost a debug cycle each

These are why `kit.js` exists. Use the helpers and you cannot hit them.

1. **A delayed `gsap.fromTo()` leaks its `from` value to frame 0.** `immediateRender`
   defaults to true, so a tween scheduled at t=7 applies its start state at build time.
   A delayed *hide* (`fromTo({autoAlpha:1},{autoAlpha:0})`) is worse — it forces the
   element **visible** from the first frame. Use `Kit.reveal()` (sets
   `immediateRender:false` *and* stamps `.hf-pre` so CSS owns the hidden start) and
   `Kit.hide()` (a plain `.to()`). Both halves are required: `immediateRender:false`
   alone means nothing hides the element, and `.hf-pre` alone gets overwritten.

2. **Simultaneous cross-fades paint two strings on top of each other.** Stacked status
   labels and captions must go out *then* in. `Kit.swap()` and `Kit.captions()` sequence
   them. Mark deliberately overlapping text `data-layout-allow-overlap="true"` or the
   layout gate fails — the builders do this already.

3. **A CSS initial transform plus a GSAP tween on the same property fails lint**
   (`gsap_css_transform_conflict`). Never write `transform: scaleX(0)` and then tween
   `scaleX`. Segmented bars tween `backgroundColor` instead; path-following elements put
   the position on a wrapper so nothing fights over one transform.

4. **The contrast gate is stricter than the reference.** Reference clips routinely use
   greys at 3.8–4.3:1 that `hyperframes check` rejects (needs 4.5:1 for body text, 3:1
   for large). Do not fight it — lift the text and express de-emphasis by **darkening
   the card fill**. The result reads better in-feed anyway.

Also: the full-screen fill goes on a **child** (`.hf-bg`), never the composition root —
the producer can drop the root's own background and render pure black while preview and
snapshot look fine.

## Shared kit

`kit/` at the repo root is the source of truth; each project holds a frozen copy.
A path traversing above the project root is rejected by lint and 404s in Studio, so the
copy is mandatory, not a convenience. After editing `kit/`:

```bash
node tools/new-video.mjs --sync     # pull the current kit into every project
```

Freezing is deliberate — editing the kit must never silently change what an
already-rendered project renders. Re-check any project you sync.

`Kit` API: `bg badge chip then vs card arc` (builders) ·
`reveal hide swap captions pulse march travel pin entrance` (timeline) ·
`T` (colour tokens, so tweens and CSS agree) · `ICONS`.

## When the user supplies a topic instead of a clip

Same loop minus steps 1–3. Read `kit/frame.md`, pick the structure that fits the idea
(two lanes for a comparison, one lane plus an arc for a sequence), and author directly.
The house style is the constant; the topic is the variable.

## When there is no argument — propose the topic yourself

A request for "a video" with nothing attached is a request for you to pick. Come back
with candidates, not with a question.

**Scope: working developers, always.** Backend, frontend, databases, Docker and
containers, CI/CD, infrastructure, networking, caching, concurrency, observability.
Not product strategy, not career advice, not framework opinions. The viewer is someone
who already writes code and wants the *mechanism* they have been using without quite
seeing.

**Keep the demo small.** Four rows, three services, two lanes — it has to sit on one
1080×1920 frame and stay readable at thumbnail size in a feed. If the honest picture
needs eight boxes, the topic is too big: split it and take the half that carries the
misconception. `videos/inner-join` shows the shape — four users, five orders, one
clause.

### Four filters, applied in order

1. **Is there a wrong mental model to correct?** Every video in this repo pays off at
   the moment an assumption breaks — the retry that charges twice, the row that is kept
   anyway, the order nobody can claim. A topic with no misconception is a definition,
   and a definition does not need ten seconds of motion. Drop it.
2. **Can one picture show it changing?** The idea has to live in something that moves:
   rows appearing, a token descending, bars overlapping, a counter climbing. If the only
   honest rendering is prose or a wall of code, it is a blog post — and code
   walkthroughs already belong to `hyperframes add code-typing | code-diff`.
3. **Is it already built?** `ls videos/` first. Do not re-cut a shipped topic. A
   deliberate *sibling* is allowed and can be excellent (`inner-join` after `left-join`)
   — but only when the shared frame makes the difference legible, and say so in the shot
   plan.
4. **Which archetype does it want, and when was that used last?** Read the table in
   `kit/frame.md`. A topic usually admits one honest structure; when two fit, take the
   least recently used. Rotation is what keeps the feed from going stale, so weight
   candidates that exercise an under-used shape — `swim` has still never shipped.

### How to propose

Use `AskUserQuestion` with **three or four** candidates. Each option names the topic,
the archetype it would use, and the **signature move** — the single shot the video is
built around. A candidate with no signature move is not ready to propose; keep looking
rather than padding the list. The user should be choosing between shots, not titles.

State briefly which one you would take and why, then let them pick. If they answer with
something of their own, that wins.

### Candidate bank

A starting point, not a menu — anything you find that clears the four filters better
beats what is listed here. Cross off whatever `videos/` already covers.

| Domain | Candidates (archetype it wants) |
| --- | --- |
| **Database** | N+1 queries: 1 call becomes 101 (`swim`) · index vs full scan (`grid`) · transaction isolation levels (`matrix`) · deadlock from lock ordering (`swim`) · connection pooling under load (`swim`) |
| **Backend** | retry with exponential backoff + jitter (`swim`) · circuit breaker closed/open/half-open (`stack`) · optimistic vs pessimistic locking (`swim`) · JWT vs session — where the state lives (`stack`) · webhook vs polling (`swim`) |
| **Frontend** | debounce vs throttle on the same keystrokes (`swim`) · event bubbling vs capturing (`stack`) · CSR vs SSR vs SSG — when the HTML gets its content (`lanes`) · the CORS preflight nobody asked for (`swim`) |
| **Docker** | image layers and cache invalidation — one changed line rebuilds four layers (`stack`) · container vs VM: what is shared (`stack`) · bind mount vs volume (`lanes`) · why `localhost` is not localhost (`topology`) |
| **CI/CD** | blue-green vs rolling deploy (`swim`) · pipeline cache hit vs miss (`hero-stat`) · canary release 5% → 50% → 100% (`queue`) · trunk-based vs long-lived branch (`swim`) |
| **Infrastructure** | DNS resolution walk: root → TLD → authoritative (`stack`) · TLS handshake round trips (`swim`) · CDN cache hit/miss at the edge (`stack`) · reverse vs forward proxy (`topology`) · horizontal vs vertical scaling (`queue`) |

`matrix` and `hero-stat` are named in `kit/frame.md` and still unbuilt; `queue`,
`topology` and `grid` are built project-local (`videos/load-balancing`,
`videos/event-driven-architecture`, `videos/left-join`) and can be copied forward. Building a genuinely new archetype is fine and expected — say why in
the shot plan, and leave it project-local until it has earned a second outing.
