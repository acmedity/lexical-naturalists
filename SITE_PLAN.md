# SITE PLAN
### Build scope for the Society's web archive

A static site built from `entries/`, `plates/`, `editions/`, and `SOCIETY_LOG.md`.
Updates automatically when a new contribution is pushed. Hosted on GitHub Pages
at `<username>.github.io/lexical-naturalists`.

---

## Stack

- **Eleventy (11ty)** — static site generator, Node-based
- **Nunjucks** — templating
- **markdown-it** — Eleventy's default markdown engine; entries already parse cleanly with it
- **No client-side framework.** A small vanilla JS file handles the marginalia floats, the plate lightbox, and the TOC collapse. Total JS budget: under 5 KB.
- **GitHub Actions** for build + deploy to `gh-pages` branch
- **Self-hosted fonts**: `PPMondwest-Regular.woff2`, `PxPlus_IBM_VGA8.woff2`, converted one-time from the `.otf` / `.ttf` in `lexical_backrooms/fonts/` via `brew install woff2 && woff2_compress <file>`

---

## Repository layout

The site build lives under `site/`. The Society's source files (`entries/`,
`plates/`, etc.) are untouched — the site reads them as data.

```
lexical-naturalists/
├── entries/                       (unchanged — source of truth)
├── plates/                        (unchanged)
├── editions/                      (unchanged)
├── SOCIETY_LOG.md                 (unchanged)
├── ...
└── site/                          (NEW)
    ├── package.json
    ├── .eleventy.js               (config: paths, collections, filters)
    ├── src/
    │   ├── _data/
    │   │   ├── site.js            (title, motto, repo URL)
    │   │   ├── entries.js         (loads & parses ../entries/*.md)
    │   │   └── plates.js          (manifests ../plates/*.svg)
    │   ├── _includes/
    │   │   ├── layouts/
    │   │   │   ├── base.njk       (HTML skeleton + TOC sidebar)
    │   │   │   ├── entry.njk      (extends base; adds right rail)
    │   │   │   └── page.njk       (extends base; single column)
    │   │   └── partials/
    │   │       ├── toc.njk
    │   │       ├── field-card.njk
    │   │       ├── status-pill.njk
    │   │       └── plate.njk
    │   ├── assets/
    │   │   ├── css/site.css
    │   │   ├── fonts/*.woff2
    │   │   └── js/site.js         (marginalia + lightbox + TOC)
    │   ├── index.njk              (home)
    │   ├── entries/
    │   │   ├── index.njk          (A–Z list, sortable)
    │   │   └── entry.njk          (per-entry, paginated over entries collection)
    │   ├── taxonomy/
    │   │   ├── index.njk
    │   │   └── genus.njk          (paginated over genera)
    │   ├── status/
    │   │   ├── index.njk
    │   │   └── status.njk         (paginated)
    │   ├── marginalia/index.njk   (collected feed of every dissent)
    │   ├── sightings/index.njk    (pre-empt; "None on record" until populated)
    │   ├── editions/index.njk
    │   ├── about/
    │   │   ├── index.njk          (charter)
    │   │   ├── bylaws.njk
    │   │   └── protocol.njk
    │   └── 404.njk
    └── _site/                     (build output; gitignored)
```

---

## Routes

| Path | Source | Notes |
|---|---|---|
| `/` | `README.md` + 3 latest entries | Cover. Title, brief description, the three most recent entry previews, motto |
| `/entries/` | `entries/*.md` | A–Z list. Client-side sort toggle: name / genus / status / date |
| `/entries/{name}/` | individual `*.md` | The heart of the site. URL slug from frontmatter `name` |
| `/taxonomy/` | groups by frontmatter `genus` | Index of the 7 genera + counts |
| `/taxonomy/{genus}/` | filtered list | e.g. `/taxonomy/vocabulum/` |
| `/status/` | groups by frontmatter `status` | Index of the 8 statuses + counts |
| `/status/{status}/` | filtered list | e.g. `/status/naturalized/` |
| `/marginalia/` | extracted from all entries | Reverse-chronological feed of dissents |
| `/sightings/` | filtered (entries with disputed sightings) | Currently empty; renders placeholder |
| `/editions/` | `editions/*.md` | Currently empty; renders placeholder |
| `/about/`, `/about/bylaws/`, `/about/protocol/` | `README.md`, `STYLE_BIBLE.md`, `PROTOCOL.md` | Stitched, rendered, navigable |
| `/404.html` | hand-written | In the Society's voice |

`SOCIETY_LOG.md` is intentionally **not** rendered (user pref: private for now).

---

## Layout (the visual structure)

Three columns on desktop, collapsing toward single column on narrow widths.

```
┌──────────────┬─────────────────────────────────┬──────────────┐
│ LEFT SIDEBAR │ MAIN CONTENT                    │ RIGHT RAIL   │
│              │                                 │              │
│ TOC          │ (entry / index / about / etc.)  │ Field card   │
│ (collapsible)│                                 │ (entry pages)│
│              │                                 │              │
│              │                                 │ Marginalia   │
│              │                                 │ (anchored    │
│              │                                 │  floats)     │
└──────────────┴─────────────────────────────────┴──────────────┘
```

- **Left sidebar** — TOC, present on every page, collapsible. Width ~220px.
- **Main content** — centered, max 720px.
- **Right rail** — present on entry pages only. Width ~260px. Holds the field
  card at the top, marginalia floats below, vertically aligned to the section
  each one targets via its `Re:` line.

Below ~960px the right rail collapses (marginalia become inline `[†]` markers
that tap-expand). Below ~720px the left sidebar collapses to a hamburger.

---

## The entry page (the page that matters most)

Render order, top to bottom:

1. **Title** — the headword in PP Mondwest, large
2. **Binomial** — the fabricated Latin, italic, smaller, under the headword
3. **First-described date + observer** — small, muted, sitting between the binomial and the plates
4. **Plates** — full-width, after the header block. Each rendered inline as
   `<img>` (SVG), `loading="lazy"`, tappable to open in a lightbox
5. **Sections** — Description, Status, Range, Call, Sign, Easily Confused
   With (and optionals if present). Each section gets an `id` derived from its
   heading so marginalia can anchor to it
6. (The Marginalia section is **lifted out** of the main flow and rendered as
   right-rail floats; it does not appear inline)

Right rail on entry pages:

- **Field card** — fieldset with floating label, mimicking the `.control-group`
  pattern from `newUI.html`. Contains: Genus, Status (as a pill with status-color
  dot), First described, Observer, Plates (roman numerals linking to the
  rendered SVG).
- **Marginalia floats** — each block in a `<pre>` of PxPlus IBM VGA8, smaller
  than body, vertically aligned to the section named in its `Re:` line. If
  multiple target the same section, they stack downward from the anchor.

---

## Marginalia anchoring (the implementation)

1. **Build time**: For each entry, parse the Marginalia section. Split into
   blocks by ASCII frame (`+---...---+ ... +---...---+`). For each block,
   extract the `Re: ...` line. From that, derive a section ID (e.g.
   `Re: Call section, soft-ch dialect ruling` → `call`).
2. **Render**: emit each marginalia block as an `<aside data-anchor="call">`
   element at the bottom of the main content, hidden by default.
3. **Page load (JS)**: on desktop, JS reads each `<aside>`, looks up the
   target section by ID, computes its `offsetTop` in the main column, and
   positions the aside absolutely in the right rail at that `top`. Stacks
   collisions.
4. **Below 960px**: JS skips the float positioning. Instead, each section
   that has marginalia gets a `[†]` indicator inserted after its heading,
   and the asides display inline, expanded on tap.

The ASCII frame is preserved literally. Bylaw III: the scrawl must never look
like the plate. PxPlus IBM VGA8 in a `<pre>` next to Mondwest body satisfies
this exactly.

---

## Visual language (palette + type)

Pulled from `styles.py` / `newUI.html`:

| Token | Value | Use |
|---|---|---|
| `--paper` | `#e0ddd3` | page background |
| `--panel` | `#d1cdc2` | sidebar background |
| `--card` | `#e8e6df` | content card background |
| `--ink` | `#111` | body text |
| `--border` | `#333` | borders (2px solid, **0 radius**) |
| `--muted` | `#444` | secondary text |
| `--muted-light` | `#666` | metadata |
| `--status-green` | `#00a000` | OK / connected accents |
| `--accent-red` | `#a93434` | dissent / disputed / error |
| `--accent-yellow` | `#6f6400` | warning / caution |
| `--separator` | dashed `#999`, 1px | between sections |

Typography:

| Font | Family | Use |
|---|---|---|
| Body | `"PP Mondwest", Georgia, serif` | All prose. The dominant voice. |
| Subheaders & chrome | `"PxPlus IBM VGA8", "Courier New", monospace` | Section headings (`DESCRIPTION`, `STATUS`), labels, tags, nav items, marginalia content |

No rounded corners anywhere. 2px borders. Black tags for genus / status pills.
Dashed separators between sections.

### Conservation status pills

Always black-on-white pill, uppercase VGA, with a small leading colored dot:

| Status | Dot color |
|---|---|
| Abundant | `--status-green` |
| Irruptive | `--accent-yellow` |
| Naturalized | `--status-green` (muted) |
| Vulnerable | `--accent-yellow` |
| Critically Endangered | `--accent-red` |
| Extinct in the Wild | `--muted` |
| Extinct | `--muted-light` |
| Data Deficient | `--muted-light` |

---

## Auto-update flow

`.github/workflows/deploy.yml`:

```
on push to main:
  1. Checkout
  2. Set up Node
  3. cd site && npm ci
  4. cd site && npx @11ty/eleventy
  5. Deploy site/_site/ to gh-pages branch (or via official Pages action)
```

Build is ~1s for the current entry count. Free. No external services.

**Build-time validation** (fail the build on bad data):

- frontmatter `genus` must be one of the 7 (Bylaw V)
- frontmatter `status` must be one of the 8 (Bylaw VI)
- frontmatter `name`, `binomial`, `first_described`, `observer` must be present
- mandatory sections must exist: Description, Status, Range, Call, Sign,
  Easily Confused With (Bylaw IV)
- any plate listed in frontmatter must exist in `plates/`

A failed build will not deploy, so a malformed entry is caught before publishing.

---

## Build phases

Suggest tackling in this order so we can iterate on look-and-feel against real
content before fanning out.

### Phase 0 — Bootstrap
- `site/` directory, `package.json`, `.eleventy.js`
- Convert and self-host the two fonts
- Base CSS: palette tokens, typography, reset

### Phase 1 — One entry page (the visual anchor)
- `base.njk`, `entry.njk`
- Field card partial
- Render `petrichor` end-to-end with all sections
- **Get the visual polish right before building the rest.** This is the page
  that defines the project's web feel; everything else is supporting structure.

### Phase 2 — Marginalia floats
- `Re:` parser
- Desktop float positioning JS
- Mobile `[†]` collapse
- Render petrichor's existing marginal dissent correctly

### Phase 3 — Multi-page IA
- TOC sidebar partial
- `/entries/` index
- `/taxonomy/` + per-genus
- `/status/` + per-status
- `/about/` (charter + bylaws + protocol)
- `/marginalia/`, `/sightings/`, `/editions/` (with appropriate placeholders)
- Home page

### Phase 4 — Polish
- Custom 404 in the Society's voice
- Plate lightbox JS
- Frontmatter / structure validation
- Status pill system

### Phase 5 — Deploy
- GH Actions workflow
- Pages settings
- First live deploy

---

## Deferred (out of scope for v1)

- **RSS / Atom feed** — deferred pending partner's API
- **Disputed sightings rendering** — page structure built pre-emptively; styling
  refined when the first sighting lands
- **Edition diff views** — wait until Acmedity cuts the First Edition
- **Search bar** — index suffices below ~300 entries
- **Analytics, cookies, tracking** — none, ever

---

## Open / TBD

- Exact wording of the 404 — drafted in the Society's voice during Phase 4,
  brought to the Publisher for approval before deploy
