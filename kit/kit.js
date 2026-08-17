/* kit.js — builders and seek-safe timeline helpers for dark technical explainers.
 *
 * Loaded from <head> via a script tag pointing at kit/kit.js, so it only defines things;
 * it never touches the DOM at load. The project's own script (end of <body>) calls it.
 *
 * Never write the literal closing-script sequence anywhere in this file, not even inside
 * a comment or a string: the compiler inlines this file into a script tag, and the HTML
 * parser closes that tag at the first such sequence, dumping the rest of the kit onto the
 * page as visible text. Write it split, like "<\/script>", if it is ever needed.
 *
 * The helpers exist mainly to make four bugs structurally impossible. Each one cost a
 * full debug cycle when hit by hand:
 *
 *   1. A delayed gsap.fromTo() applies its `from` value at BUILD time (immediateRender
 *      defaults true), so an element meant to appear at t=7 is visible from frame 0 —
 *      or worse, a delayed "hide" tween forces an element visible. Kit.reveal() sets
 *      immediateRender:false AND stamps .hf-pre on the target so CSS owns the hidden
 *      start state. Those two always go together; neither works alone.
 *   2. Cross-fading two stacked labels simultaneously renders both texts on top of each
 *      other mid-swap. Kit.swap() sequences them: out first, then in.
 *   3. A CSS initial transform plus a GSAP tween on the same property trips lint
 *      (gsap_css_transform_conflict). Nothing here sets a CSS transform on an animated
 *      element; positions are carried by a wrapper.
 *   4. repeat:-1 is banned (non-deterministic). Kit.pulse() computes a finite count.
 */
(function (global) {
  "use strict";

  const T = {
    bg: "#090b12", panel: "#0e1017", card: "#191a21", cardHi: "#1d2027", cardDim: "#14151b",
    chip: "#16171e", bd: "#262932", tx: "#ffffff", cardTx: "#e2e5ed", mute: "#8c909b",
    dimTx: "#6e727b", track: "#33363d", curve: "#565a7a",
    run: "#4f8ef7", ok: "#3ecf8e", warn: "#eda54a", fail: "#f0555f",
    bdRun: "#31486f", bdOk: "#22503c", bdWarn: "#5b4529", bdFail: "#5b2730", bdDim: "#1e2028",
    curveOk: "#2f8f68", curveFail: "#8f3f48",
    glow: { run: "rgba(79,142,247,0.40)", warn: "rgba(237,165,74,0.40)", ok: "rgba(62,207,142,0.26)", off: "rgba(0,0,0,0)" },
  };

  const ICONS = {
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.4" fill="rgba(62,207,142,0.16)"/><path d="m8 12.3 2.7 2.7L16.2 9.5"/></svg>',
    fail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.4" fill="rgba(240,85,95,0.17)"/><path d="m9 9 6 6M15 9l-6 6"/></svg>',
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M4.4 6.6v4.8h4.8"/><path d="M4.9 11.1a7.6 7.6 0 1 1 2.2 6.6"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.6v11.2M7.6 11.6 12 16l4.4-4.4M5 19.4h14"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19.4V8.2M7.6 12.6 12 8.2l4.4 4.4M5 4.6h14"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3.5h7L18 8v12H6.5z"/><path d="M13.2 3.7v4.6h4.6M9.2 13h5.6M9.2 16.4h5.6"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8.2" r="3.4"/><path d="M5.5 19.2c1.1-3.2 3.6-4.8 6.5-4.8s5.4 1.6 6.5 4.8"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 6.2a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v7.6a2 2 0 0 1-2 2h-6.4l-4.2 3.4a.5.5 0 0 1-.8-.4v-3z"/><path d="M9 9.4h6M9 12.4h4"/></svg>',
    db: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><ellipse cx="12" cy="6.4" rx="7" ry="2.9"/><path d="M5 6.4v11.2c0 1.6 3.1 2.9 7 2.9s7-1.3 7-2.9V6.4M5 12c0 1.6 3.1 2.9 7 2.9s7-1.3 7-2.9"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M13.4 2.4 5.6 13.1h4.6l-1 8.5 7.8-10.7h-4.6z"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9.5 14.5 14.5 9.5"/><path d="M7.8 11.1 6.2 12.7a3.4 3.4 0 0 0 4.8 4.8l1.6-1.6"/><path d="M16.2 12.9l1.6-1.6a3.4 3.4 0 0 0-4.8-4.8l-1.6 1.6"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 3.2 20.8 12 12 20.8 3.2 12z"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.2 19 5.6v6.1c0 4.3-2.9 7.5-7 9.1-4.1-1.6-7-4.8-7-9.1V5.6z"/><path d="m8.7 12.1 2.4 2.4 4.2-4.6"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="13.4" r="7.6"/><path d="M12 13.4V9.8M9.6 3.4h4.8M12 3.4v2.4"/></svg>',
    target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="3.6"/></svg>',
    money: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.6" y="6" width="18.8" height="12" rx="2.2"/><circle cx="12" cy="12" r="2.7"/><path d="M6 9.4v5.2M18 9.4v5.2"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/></svg>',
    arrow: '<svg viewBox="0 0 11 9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M5.5 0v7M2.6 4.6l2.9 2.9 2.9-2.9"/></svg>',
  };

  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const all = (sel) => Array.from(document.querySelectorAll(sel));

  /* ══════════ builders ══════════ */

  /** Background layer with accent-tinted glows. Always a child, never the root. */
  function bg(glows) {
    const g = (glows || []).map((s) => `radial-gradient(${s})`).join(",");
    const n = el("div", "hf-bg");
    if (g) n.style.background = `${g},var(--bg)`;
    return n;
  }

  function badge(o) {
    const n = el("div", `hf-badge b-${o.tone}`, `${ICONS[o.icon] || ""}<b class="t-${o.tone}">${o.label}</b><em>${o.note || ""}</em>`);
    if (o.id) n.id = o.id;
    return n;
  }

  function chip(o) {
    const n = el("div", `hf-chip b-${o.tone}`, `<span class="t-${o.tone}">${ICONS[o.icon] || ""}</span><b class="t-${o.tone}">${o.label}</b><em>${o.note || ""}</em>`);
    if (o.id) n.id = o.id;
    return n;
  }

  function then(id) {
    const n = el("div", "hf-then", `${ICONS.arrow}<span>then</span>`);
    if (id) n.id = id;
    return n;
  }

  function vs(id) {
    const n = el("div", "hf-vs", "vs");
    if (id) n.id = id;
    return n;
  }

  /**
   * Operation card. `states` is an ordered list of label strings; each becomes a
   * stacked span addressed as `#<id>-st-<key>`. Keys are lowercased labels with
   * non-alphanumerics stripped, so "ROLLED BACK" → `rolledback`.
   * Indicators are addressed as `#<id>-ind-<name>`.
   */
  function card(o) {
    const n = el("div", `hf-card${o.tall ? " hf-card--tall" : ""}`);
    n.id = o.id;
    const key = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const states = o.states || ["QUEUED", "PROCESSING", "COMPLETE"];
    const tones = o.tones || { queued: "mute", processing: "run", complete: "ok", failed: "fail", rolledback: "mute" };
    const sts = states
      .map((s, i) => `<span class="hf-st t-${tones[key(s)] || "mute"}${i ? " hf-pre" : ""}" id="${o.id}-st-${key(s)}" data-layout-allow-overlap="true">${s}</span>`)
      .join("");
    const inds = (o.indicators || ["dot", "ok", "fail"])
      .map((k) => {
        const body = k === "dot" ? "<i></i>" : ICONS[k === "rb" ? "undo" : k] || "";
        const tone = k === "dot" ? "run" : k === "ok" ? "ok" : k === "fail" ? "fail" : "mute";
        return `<span class="hf-pre t-${tone}" id="${o.id}-ind-${k}">${body}</span>`;
      })
      .join("");
    const head =
      `<div class="hf-ico" id="${o.id}-ico">${ICONS[o.icon] || ""}</div>` +
      `<div><div class="hf-name" id="${o.id}-name">${o.name}</div><div class="hf-stat">${sts}</div></div>` +
      `<div class="hf-ind">${inds}</div>`;
    if (o.tall) {
      n.appendChild(el("div", "hf-row", head));
      n.appendChild(el("div", "hf-glow")).id = `${o.id}-glow`;
      const bar = el("div", "hf-bar");
      bar.id = `${o.id}-bar`;
      for (let i = 0; i < (o.segments || 25); i++) bar.appendChild(el("i", "hf-seg"));
      n.appendChild(bar);
    } else {
      n.innerHTML = head;
    }
    return n;
  }

  /**
   * Arc panel: `nodes` numbered circles on a dashed curve that sags between them.
   * Geometry is returned so the timeline can address exact path points.
   */
  function arc(o) {
    const w = o.width || 972, h = o.height || 166, y = o.nodeY || 55, sag = o.sag || 31;
    const inset = o.inset || 129;
    const n = o.nodes.length;
    const xs = Array.from({ length: n }, (_, i) => inset + ((w - 2 * inset) * i) / (n - 1));
    let d = `M${xs[0]} ${y}`;
    for (let i = 1; i < n; i++) d += ` Q${(xs[i - 1] + xs[i]) / 2} ${y + 2 * sag} ${xs[i]} ${y}`;

    const box = el("div", "hf-arc");
    box.id = o.id;
    box.innerHTML =
      `<svg class="hf-curve" id="${o.id}-curve" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<path d="${d}" fill="none" stroke="currentColor" stroke-width="7" opacity="0.16" stroke-linecap="round"/>` +
      `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="5 8" stroke-linecap="round"/></svg>`;
    xs.forEach((x, i) => {
      const ring = el("div", "hf-ring hf-pre t-ok");
      ring.id = `${o.id}-ring-${i}`;
      ring.style.cssText = `left:${x}px;top:${y}px`;
      const node = el("div", "hf-node", String(i + 1));
      node.id = `${o.id}-node-${i}`;
      node.style.cssText = `left:${x}px;top:${y}px`;
      const lbl = el("div", "hf-node-lbl", o.nodes[i]);
      lbl.style.cssText = `left:${x}px;top:${y + 24}px`;
      box.append(ring, node, lbl);
    });
    const dot = el("div", "hf-dot");
    dot.id = `${o.id}-dot`;
    (o.pips || ["run"]).forEach((tone) => {
      const pip = el("i", "hf-pip hf-pre");
      pip.id = `${o.id}-pip-${tone}`;
      pip.style.background = tone === "fail" ? "#ff8b92" : "#7fb0ff";
      pip.style.boxShadow = `0 0 10px 3px ${tone === "fail" ? "rgba(240,85,95,.85)" : "rgba(79,142,247,.85)"},0 0 26px 10px ${tone === "fail" ? "rgba(240,85,95,.35)" : "rgba(79,142,247,.35)"}`;
      dot.appendChild(pip);
    });
    box.appendChild(dot);
    const mark = el("div", "hf-mark hf-pre t-fail", ICONS.x);
    mark.id = `${o.id}-mark`;
    box.appendChild(mark);

    const caps = el("div", "hf-caps");
    caps.style.top = `${o.capTop || 136}px`;
    (o.captions || []).forEach((t, i) => {
      const c = el("div", `hf-cap${i ? " hf-pre" : ""}`, t);
      c.id = `${o.id}-cap-${i}`;
      c.setAttribute("data-layout-allow-overlap", "true");
      caps.appendChild(c);
    });
    box.appendChild(caps);

    /* span index → the two node x's it joins; u is 0..1 along that span */
    const geom = {
      xs, y, sag,
      spans: xs.slice(0, -1).map((x, i) => [x, xs[i + 1]]),
      at(span, u) {
        const [a, b] = this.spans[span];
        return { x: a + (b - a) * u, y: this.y + 4 * this.sag * u * (1 - u) };
      },
    };
    return { node: box, geom };
  }

  /**
   * ARCHETYPE: swimlane. Actors are rows, story time runs left→right, work is bars that
   * may overlap. `span` is the story duration the track covers (seconds); every bar's
   * from/to is in those same story seconds, so the geometry and the narrative agree.
   *
   *   Kit.swim({ id, span: 4, labelW: 168, rows: [
   *     { label: "Client", bars: [{ id: "c1", from: 0, to: 1.2, tone: "run", text: "read" }] },
   *   ]})
   */
  function swim(o) {
    const span = o.span, labelW = o.labelW || 168, W = o.width || 972;
    const trackW = W - labelW;
    const pct = (t) => (t / span) * 100;
    const px = (t) => labelW + (t / span) * trackW;
    const box = el("div", "hf-swim");
    box.id = o.id;

    const axis = el("div", "hf-swim-axis");
    axis.style.marginLeft = `${labelW}px`;
    const ticks = o.ticks || Math.min(6, Math.round(span) + 1);
    for (let i = 0; i < ticks; i++) {
      const t = (span * i) / (ticks - 1);
      const s = el("span", "hf-tick", `${Number(t.toFixed(1))}s`);
      s.style.left = `${pct(t)}%`;
      axis.appendChild(s);
    }
    box.appendChild(axis);

    const rows = el("div", "hf-swim-rows");
    for (let i = 1; i < ticks - 1; i++) {
      const g = el("i", "hf-grid");
      g.style.left = `${px((span * i) / (ticks - 1))}px`;
      rows.appendChild(g);
    }
    o.rows.forEach((r) => {
      const row = el("div", "hf-swim-row");
      const lbl = el("div", "hf-swim-label", r.label);
      lbl.style.width = `${labelW}px`;
      row.appendChild(lbl);
      const track = el("div", "hf-swim-track");
      (r.bars || []).forEach((b) => {
        const bar = el("div", "hf-swim-bar", b.text ? `<b>${b.text}</b>` : "");
        bar.id = `${o.id}-bar-${b.id}`;
        bar.style.left = `${pct(b.from)}%`;
        bar.style.width = `${pct(b.to - b.from)}%`;
        bar.style.background = T[b.tone] || T.run;
        track.appendChild(bar);
      });
      row.appendChild(track);
      rows.appendChild(row);
    });
    const head = el("div", "hf-head hf-pre");
    head.id = `${o.id}-head`;
    head.style.left = `${labelW}px`;
    rows.appendChild(head);
    box.appendChild(rows);

    /* trackW is what the playhead travels — the track, not the whole row */
    return { node: box, geom: { span, labelW, trackW, pct, px } };
  }

  /**
   * ARCHETYPE: stack. Layers top to bottom with a token that descends and returns.
   * `verdicts` is the set of outcome words any layer may show; each is a stacked span
   * addressed `#<id>-v-<layerIndex>-<key>`.
   */
  function stack(o) {
    const H = 84, GAP = 8;
    const verdicts = o.verdicts || ["MISS", "HIT"];
    const key = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const box = el("div", "hf-stack");
    box.id = o.id;
    box.appendChild(el("div", "hf-rail"));
    o.layers.forEach((L, i) => {
      const row = el("div", "hf-layer");
      row.id = `${o.id}-layer-${i}`;
      row.innerHTML =
        `<span class="hf-layer-name" id="${o.id}-name-${i}">${L.name}</span>` +
        `<span class="hf-layer-note">${L.note || ""}</span>` +
        `<span class="hf-verdict">` +
        verdicts
          .map(
            (v) =>
              `<span class="hf-pre t-${v === verdicts[verdicts.length - 1] ? "ok" : "warn"}" id="${o.id}-v-${i}-${key(v)}" data-layout-allow-overlap="true">${v}</span>`,
          )
          .join("") +
        `</span>`;
      box.appendChild(row);
    });
    const tok = el("div", "hf-token hf-pre", "<i></i>");
    tok.id = `${o.id}-token`;
    box.appendChild(tok);
    return {
      node: box,
      geom: { at: (i) => ({ y: i * (H + GAP) + H / 2 }), count: o.layers.length, H, GAP },
    };
  }

  /* ══════════ timeline helpers ══════════ */

  /**
   * Reveal something at time `at`. Stamps .hf-pre on the target so CSS holds it hidden
   * before the tween, and disables immediateRender so the tween does not leak its
   * `from` value to frame 0. Use this for EVERY element that appears after t=0.
   */
  function reveal(tl, sel, at, vars) {
    const v = vars || {};
    if (at > 0) all(sel).forEach((n) => n.classList.add("hf-pre"));
    const from = { autoAlpha: 0 };
    const to = { autoAlpha: 1, duration: v.duration || 0.28, ease: v.ease || "power2.out", immediateRender: at > 0 };
    for (const k of ["y", "x", "scale"]) if (v[k] != null) { from[k] = v[k]; to[k] = 0 + (k === "scale" ? 1 : 0); }
    if (v.stagger) to.stagger = v.stagger;
    to.immediateRender = false;
    return tl.fromTo(sel, from, to, at);
  }

  /** Hide something at time `at`. A plain .to() — never a fromTo, which would leak. */
  function hide(tl, sel, at, duration) {
    return tl.to(sel, { autoAlpha: 0, duration: duration || 0.1, ease: "none" }, at);
  }

  /**
   * Swap one stacked label for another. Sequenced, not cross-faded: fading both at once
   * paints two strings on top of each other for the duration of the overlap.
   */
  function swap(tl, outSel, inSel, at, gap) {
    const g = gap == null ? 0.09 : gap;
    if (outSel) tl.to(outSel, { autoAlpha: 0, duration: g, ease: "none" }, at);
    if (inSel) {
      all(inSel).forEach((n) => n.classList.add("hf-pre"));
      tl.fromTo(inSel, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.13, ease: "none", immediateRender: false }, at + g);
    }
    return tl;
  }

  /** Chain a caption stack: `times[i]` is when caption i takes over. times[0] is t=0. */
  function captions(tl, arcId, times) {
    times.forEach((t, i) => {
      if (i === 0) return;
      swap(tl, `#${arcId}-cap-${i - 1}`, `#${arcId}-cap-${i}`, t, 0.1);
    });
    return tl;
  }

  /** Finite attention pulse. repeat:-1 is banned; the count is derived from `dur`. */
  function pulse(tl, sel, at, dur, cycle) {
    const c = cycle || 0.42;
    return tl.to(sel, { opacity: 0.28, duration: c, repeat: Math.max(0, Math.floor(dur / c) - 1), yoyo: true, ease: "sine.inOut" }, at);
  }

  /**
   * March a segmented bar: N segments light one after another across exactly `dur`.
   * One tween per bar, not one per segment — and backgroundColor, so no transform
   * conflict with the CSS.
   */
  function march(tl, cardId, at, dur, color, segments) {
    const n = segments || 25;
    const step = dur / n;
    return tl.to(`#${cardId}-bar .hf-seg`, { backgroundColor: color, duration: step, stagger: step, ease: "none" }, at);
  }

  /**
   * Move the arc dot along span `span` from u0 to u1. x is exactly linear (the control
   * point sits at the span midpoint); y is the parabola, sampled as keyframes. The first
   * keyframe has duration 0 so the start point is pinned on any seek.
   */
  function travel(tl, arcId, geom, span, u0, u1, at, dur, steps) {
    const N = steps || 14, kf = [];
    for (let i = 0; i <= N; i++) {
      const p = geom.at(span, u0 + (u1 - u0) * (i / N));
      kf.push({ x: p.x, y: p.y, duration: i === 0 ? 0 : dur / N, ease: "none" });
    }
    return tl.to(`#${arcId}-dot`, { keyframes: kf }, at);
  }

  /** Pin the dot at a path point without moving it (use before its first travel). */
  function pin(tl, arcId, geom, span, u, at) {
    return tl.set(`#${arcId}-dot`, geom.at(span, u), at);
  }

  /**
   * Staggered opening. `steps` is [selector, at, fromVars] triples. Everything here
   * starts at or near t=0, so these are the one place a plain fromTo is safe.
   */
  function entrance(tl, steps) {
    steps.forEach(([sel, at, from]) => {
      const f = Object.assign({ autoAlpha: 0 }, from || {});
      const to = { autoAlpha: 1, duration: 0.28, ease: "power2.out" };
      for (const k of ["x", "y"]) if (f[k] != null) to[k] = 0;
      if (f.scale != null) to.scale = 1;
      if (f.stagger) { to.stagger = f.stagger; delete f.stagger; }
      if (f.duration) { to.duration = f.duration; delete f.duration; }
      tl.fromTo(sel, f, to, at);
    });
    return tl;
  }

  /**
   * Grow a swimlane bar. scaleX is safe here because the CSS never declares `transform`
   * — only `transform-origin`. The collapsed start is set on the timeline at t=0 so any
   * seek before `at` renders it empty, without a CSS transform to conflict with.
   */
  function grow(tl, sel, at, dur, ease) {
    tl.set(sel, { scaleX: 0 }, 0);
    return tl.to(sel, { scaleX: 1, duration: dur, ease: ease || "none" }, at);
  }

  /** Sweep the swimlane playhead across the track over `dur`, covering `span` story seconds. */
  function playhead(tl, swimId, geom, at, dur) {
    tl.set(`#${swimId}-head`, { x: 0 }, 0);
    reveal(tl, `#${swimId}-head`, at, { duration: 0.2 });
    return tl.to(`#${swimId}-head`, { x: geom.trackW, duration: dur, ease: "none" }, at);
  }

  /** Move the stack token from layer index `a` to layer index `b`. */
  function descend(tl, stackId, geom, a, b, at, dur) {
    tl.set(`#${stackId}-token`, { y: geom.at(a).y }, at);
    return tl.to(`#${stackId}-token`, { y: geom.at(b).y, duration: dur, ease: "power1.inOut" }, at);
  }

  /** Flip one stack layer to a verdict, tinting the row to match. */
  function verdict(tl, stackId, i, word, tone, at) {
    const k = word.toLowerCase().replace(/[^a-z0-9]/g, "");
    reveal(tl, `#${stackId}-v-${i}-${k}`, at, { duration: 0.14 });
    const c = tone === "ok" ? T.ok : tone === "fail" ? T.fail : tone === "warn" ? T.warn : T.run;
    const b = tone === "ok" ? T.bdOk : tone === "fail" ? T.bdFail : tone === "warn" ? T.bdWarn : T.bdRun;
    tl.to(`#${stackId}-name-${i}`, { color: c, duration: 0.24, ease: "none" }, at);
    return tl.to(`#${stackId}-layer-${i}`, { borderColor: b, duration: 0.24, ease: "none" }, at);
  }

  global.Kit = {
    T, ICONS, el,
    bg, badge, chip, then, vs, card, arc, swim, stack,
    reveal, hide, swap, captions, pulse, march, travel, pin, entrance, grow, playhead, descend, verdict,
  };
})(window);
