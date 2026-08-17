#!/usr/bin/env node
/**
 * new-video.mjs — scaffold a video project wired to the shared kit.
 *
 *   node tools/new-video.mjs <name> [--duration 12] [--title "…"] [--sub "…"]
 *   node tools/new-video.mjs --sync            re-copy kit/ into every existing project
 *
 * Each project carries its own copy of kit/. That is not duplication for its own sake:
 * `hyperframes lint` rejects any asset path that traverses above the project root, so a
 * shared ../../kit/ reference fails outright. The copy also freezes the kit per video,
 * so editing the kit can never silently change what an already-rendered project renders.
 * Re-run with --sync to pull the current kit into projects deliberately.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KIT = join(ROOT, "kit");
const VIDEOS = join(ROOT, "videos");
const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};

const copyKit = (proj) => {
  mkdirSync(join(proj, "kit"), { recursive: true });
  for (const f of ["kit.css", "kit.js"]) cpSync(join(KIT, f), join(proj, "kit", f));
  cpSync(join(KIT, "frame.md"), join(proj, "frame.md"));
};

/* ── --sync ── */
if (argv.includes("--sync")) {
  /* Only projects that actually reference the kit. Hand-authored compositions that
     inline their own CSS/JS are left alone — dropping an unused kit/ into them would
     just be litter that later reads as a dependency. */
  const all = readdirSync(VIDEOS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(VIDEOS, d.name, "hyperframes.json")))
    .map((d) => join(VIDEOS, d.name));
  const uses = all.filter((p) => {
    const idx = join(p, "index.html");
    return existsSync(idx) && readFileSync(idx, "utf8").includes("kit/kit.js");
  });
  uses.forEach((p) => {
    copyKit(p);
    console.log(`synced kit → ${p.replace(ROOT + "/", "")}`);
  });
  const skipped = all.length - uses.length;
  console.log(`\n${uses.length} synced, ${skipped} skipped (not kit-based). Re-run \`npm run check\` in any you touched.`);
  process.exit(0);
}

const name = argv.find((a) => !a.startsWith("--"));
if (!name) {
  console.error('usage: node tools/new-video.mjs <name> [--duration 12] [--title "…"] [--sub "…"]');
  console.error("       node tools/new-video.mjs --sync");
  process.exit(1);
}
const proj = join(VIDEOS, name);
const duration = flag("duration", "12");
const title = flag("title", name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
const sub = flag("sub", "one line of context under the title");

if (existsSync(proj)) {
  console.error(`${proj} already exists — pick another name or delete it first.`);
  process.exit(1);
}

execFileSync("npx", ["hyperframes", "init", `videos/${name}`, "--example", "blank"], { cwd: ROOT, stdio: "inherit" });
copyKit(proj);

writeFileSync(
  join(proj, "index.html"),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <title>${title}</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <link rel="stylesheet" href="kit/kit.css" />
    <script src="kit/kit.js"></script>
    <style>
      /* project-specific overrides only — shared rules belong in kit/kit.css */
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${duration}"
      data-width="1080"
      data-height="1920"
    >
      <section id="scene" class="clip" data-start="0" data-duration="${duration}" data-track-index="1">
        <div class="hf-content" id="content">
          <h1 id="title" class="hf-title">${title}</h1>
          <div id="sub" class="hf-sub">${sub}</div>
        </div>
      </section>
    </div>

    <script>
      /* ══ DATA — everything specific to this video lives here ══ */
      const DUR = ${duration};

      /* ══ DOM ══ */
      const content = document.getElementById("content");
      document.getElementById("scene").prepend(
        Kit.bg([
          "660px 660px at 100% 1%, rgba(79,142,247,0.16), transparent 62%",
          "560px 560px at 4% 99%, rgba(62,207,142,0.06), transparent 60%",
        ]),
      );

      /* build the body of the composition here, e.g.
         content.appendChild(Kit.badge({ id: "badge-a", tone: "run", icon: "link", label: "STEP ONE", note: "— context" }));
         content.appendChild(Kit.card({ id: "k0", name: "Do the thing", icon: "doc" }));
      */

      /* ══ TIMELINE ══ */
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });

      Kit.entrance(tl, [
        ["#title", 0, { y: 20, duration: 0.4 }],
        ["#sub", 0.1, { y: 10 }],
      ]);

      /* Every element that appears after t=0 goes through Kit.reveal — it stamps
         .hf-pre and disables immediateRender, which is the only combination that
         does not leak the element into frame 0. */

      tl.seek(0);
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`,
);

console.log(`
scaffolded videos/${name}  (${duration}s, 1080x1920)
  kit/kit.css, kit/kit.js, frame.md copied in

next:
  node tools/measure.mjs <reference.mp4> --out videos/${name}/.measure
  cd videos/${name} && npm run check && npm run dev
`);
