# Historia of Dominicana — Studio

Editorial and production workspace for a documentary series on the history of the
Dominican Republic, produced in **Spanish and English**. Scripts, sources,
licences, scene plans and assets live here; rendering and publishing are layered
on top in later milestones.

**Format targets:** 4–6 minutes for the YouTube cut, 50–90 seconds for social
bites. Both are configured per series and shown against the scene plan during
review.

**One rule the whole system is built around: nothing is scheduled, published, or
uploaded anywhere without an explicit human approval, recorded against the exact
script version approved.**

Milestone 1 (the editorial foundation) is implemented. Milestone 2 (rendering) is
partly implemented: scenes render to a real MP4 locally. Milestones 3–5 are not.

---

## Cost model

The app runs end to end with **no paid API and no cloud account**:

| Capability | Free default | Paid option (opt-in) |
|---|---|---|
| Database | Local Postgres (Docker) | Supabase |
| Storage | Local filesystem | Cloudflare R2 / Amazon S3 |
| Auth | Local email + password | Supabase Auth |
| Narration | Upload your own file, or Piper (local) | ElevenLabs / OpenAI |
| Subtitles | Upload SRT/VTT, or faster-whisper (local) | Hosted ASR |
| Scene plan | Written by you | OpenAI / Anthropic |
| Rendering | FFmpeg + Remotion, on your machine | — |
| Publishing | Manual upload | Platform APIs |

Every capability sits behind a provider interface, and **each episode picks its own
mode** — narration, subtitles, scene plan and publishing are independent choices on
the episode's Details tab. The target first workflow is:

> approved script → uploaded narration → uploaded licensed visuals → local render →
> human review → manual upload

---

## Requirements

- **Node.js 20.11+** and npm
- **Docker** (for local Postgres) — or any Postgres 14+ you already have
- **FFmpeg** (with `ffprobe`) — required to render. Debian/Ubuntu:
  `apt-get install ffmpeg`; macOS: `brew install ffmpeg`. Set `FFMPEG_PATH` /
  `FFPROBE_PATH` if they are not on `PATH`.
- A font for on-screen text — any DejaVu, Liberation or FreeFont package.
  Debian/Ubuntu: `apt-get install fonts-dejavu-core`.
- **Redis — optional.** Without it renders run inside the app process; with it
  they are queued to a worker that survives a restart. See
  [Render jobs](#render-jobs).

## Quick start

```bash
cp .env.example .env
```

Set `SESSION_SECRET` in `.env` to a random 32+ character string:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Then:

```bash
docker compose up -d db
npm install
npm run env:check
npm run db:migrate
npm run db:seed
npm run dev
```

Open <http://localhost:3000> and sign in:

| Account | Password | Can approve? |
|---|---|---|
| `owner@historia.local` | `historia-dev` | yes |
| `editor@historia.local` | `historia-dev` | no |

The seed creates one demo episode. **Every line of its content is marked
`[PLACEHOLDER]`** — it exists to exercise the workflow, not to supply history.
Delete it before real use.

### Running without Docker

Point `DATABASE_URL` at any Postgres 14+ instance and skip the `docker compose`
step. The only extension required is `pgcrypto`, which the migration creates.

### Running the app itself in a container

```bash
docker compose --profile app up --build
```

### Render jobs

Rendering works out of the box with nothing extra running — the encode happens
inside the app process. That is fine on a laptop; the only cost is that a
restart mid-encode loses the render.

For anything longer-lived, set `REDIS_URL` and run a worker:

```bash
docker compose --profile jobs up -d redis    # or your own Redis
# .env: REDIS_URL=redis://localhost:6379
npm run worker
```

Renders are then queued, survive restarts, and retry three times with backoff.
A job whose process died is failed after 30 minutes with an explanation rather
than sitting at `running` forever. The Settings page shows which mode is live.

In containers, both at once:

```bash
docker compose --profile app --profile jobs up --build
```

---

## What Milestone 1 does

**Pages**

| Route | State |
|---|---|
| `/dashboard` | Built — counts, pending approvals, scheduled, recent audit activity |
| `/episodes` | Built — searchable, filterable list |
| `/episodes/new` | Built |
| `/episodes/[id]` | Built — Script, Sources, Scene plan, Assets, Voice & captions, Details, History |
| `/review` | Built — review queue with per-episode blockers |
| `/assets` | Built — asset library, licence records, uploads |
| `/settings` | Built — environment and provider status, read-only |
| `/renders` | Built — render centre with per-job progress, errors and outputs |
| `/calendar`, `/social` | Placeholder for Milestone 4 |
| `/analytics` | Placeholder for Milestone 5 |

**Workflow**

`Draft → In Review → Approved → Scheduled → Published`, plus `Rejected` and
`Failed`. The rules live in one pure module, [`src/domain/workflow.ts`](src/domain/workflow.ts),
and nothing writes `episodes.status` without going through it.

Approval is **blocked** when:

- there is no script or no scene
- no research source is marked `verified`
- any attached asset has no licence record, or a licence not marked cleared
- any AI-suggested scene has not been cleared by a human

Approval **warns but proceeds** when sources are still unverified or disputed.

Other guarantees:

- Saving a script writes a **new immutable version row**. Existing versions are
  never updated, and each carries a SHA-256 of its body.
- Approving **pins the version approved**, with who and when.
- **Editing an approved script automatically withdraws the approval** and returns
  the episode to draft.
- Approving, rejecting, scheduling and marking published require the `owner` or
  `reviewer` role. An `editor` can prepare an episode but not sign it off.
- `social_posts` carries a database CHECK constraint: a row cannot be `scheduled`,
  `publishing` or `published` unless `approved_by` and `approved_at` are set. That
  is live now, before any publishing code exists.
- Everything an operator does is written to `audit_log`.

**Source and licence tracking**

- Sources record citation, type, author, publisher, year, URL, archive reference,
  the specific claim they support, and a fact-check state that defaults to
  `unverified`. Nothing is ever auto-verified.
- Licences record type, rights holder, attribution text, source/licence URLs,
  territory, validity dates, and a `is_cleared` flag that must be set deliberately.
- Scenes link to both assets and sources, so the review screen can show which
  scenes are source-backed and which are not.

---

## Commands

```bash
npm run dev              # development server
npm run build            # production build
npm run typecheck        # tsc --noEmit
npm run lint             # eslint
npm run env:check        # validate .env without starting the app
npm run db:migrate       # apply drizzle/*.sql
npm run db:seed          # owner/editor accounts + demo episode
npm run db:reset         # DROP the public schema (development only)
npm run test             # vitest — workflow and render-planning rules
npm run test:e2e         # playwright — approval, uploads, rendering
npm run render:sample    # render a demo MP4 with no database involved
npm run worker           # render worker (only when REDIS_URL is set)
./scripts/make-fixtures.sh   # regenerate binary test fixtures
```

`render:sample` is the quickest way to check the local FFmpeg toolchain:

```bash
npm run render:sample -- ./sample.mp4            # 16:9 colour cards
npm run render:sample -- ./tall.mp4 9:16         # vertical
npm run render:sample -- ./still.mp4 16:9 photo.jpg   # over a real still
```

## Testing

**Unit** — [`src/domain/workflow.test.ts`](src/domain/workflow.test.ts) covers the
state machine and every approval gate;
[`src/domain/render.test.ts`](src/domain/render.test.ts) covers scene timing,
caption selection, aspect-ratio dimensions and the render warnings.

```bash
npm run test
```

**End to end** — three Playwright suites drive a real browser, against a migrated
and seeded database:

- [`approval-workflow.spec.ts`](tests/e2e/approval-workflow.spec.ts) — anonymous
  redirect, blocked submission, the full draft → review → approved path, approval
  withdrawal on script edit, and the editor-cannot-approve role gate.
- [`asset-upload.spec.ts`](tests/e2e/asset-upload.spec.ts) — upload, storage,
  read-back through the guarded file route, and its two refusals.
- [`render.spec.ts`](tests/e2e/render.spec.ts) — renders an episode to an actual
  MP4 and checks the served bytes really are one; uploads narration and checks
  the picture is held to cover it. Needs FFmpeg.

```bash
npm run test:e2e:install   # once
npm run db:migrate && npm run db:seed
npm run test:e2e
```

---

## Architecture

```
drizzle/           Plain SQL migrations — the source of truth for the database
scripts/           migrate / seed / reset / env-check runners
src/
  domain/          Pure business rules: types, review workflow (no I/O, unit tested)
  db/              Drizzle table definitions mirroring drizzle/*.sql, pooled client
  lib/
    env.ts         Zod-validated environment, incl. the Settings screen view
    auth/          Auth provider interface (local | supabase) + JWT session cookie
    storage/       Storage provider interface (local | s3) + object-key builder
    audit.ts       Append-only audit trail
    validation.ts  Zod schemas for every form
  server/          Read-side queries, including the single readiness query
  app/             Next.js App Router pages, server actions, API routes
  components/      Shared accessible UI primitives
tests/e2e/         Playwright specs
```

**Domain boundaries.** `src/domain` knows nothing about the database or Next.js,
so the workflow rules can be reused unchanged by the render worker (M2) and the
publisher (M4).

**Mutations** are Next server actions, all returning the same
[`ActionState`](src/lib/action-state.ts) shape so errors, warnings and per-field
validation render identically everywhere.

**Data model.** All seventeen tables from the brief exist now, including the ones
Milestones 2–5 will fill (`renders`, `render_jobs`, `social_accounts`,
`social_posts`, `publishing_attempts`, `analytics_snapshots`). Building them
up-front means no schema churn later. Enum-like columns are `TEXT` + `CHECK`
rather than Postgres `ENUM` (adding a value to a CHECK is a cheap migration);
JSONB is used only for provider- and platform-specific detail.

## Accessibility

Semantic HTML throughout, one `<h1>` per page with a correct heading order,
a skip link, `aria-current` on navigation, labelled form controls with errors tied
to their inputs, table captions and scoped headers, visible focus rings on every
interactive element, and status colour always paired with a text label. All
interactions work from the keyboard; nothing depends on hover or drag.

## Security

- No secret is ever sent to the browser. The Settings page reports only whether a
  secret is *present*.
- Passwords are bcrypt hashed (cost 12); sign-in compares against a dummy hash on
  a missing account so a bad email and a bad password take the same time.
- Sessions are signed HS256 JWTs in an `httpOnly`, `sameSite=lax` cookie.
  Middleware checks only for the cookie's presence — the signature is verified
  server-side on every page and action.
- Upload filenames are sanitised into generated object keys, and the local storage
  driver refuses any key that resolves outside the storage root.
- `/api/files/*` requires a session **and** an existing `media_assets` row for that
  key, so a signed-in user cannot read arbitrary paths under the storage root.
- OAuth token columns are named `*_encrypted` and will hold AES-256-GCM
  ciphertext; `PUBLISHING_MODE=live` refuses to start without
  `TOKEN_ENCRYPTION_KEY`.

---

## Implementation log

### 2026-07-27 — Milestone 1: editorial foundation

Scaffolded the application by hand (Next.js 15 App Router, TypeScript, Tailwind,
Drizzle, Zod) rather than via `create-next-app`, and implemented:

- Full 19-table schema in `drizzle/0000_init.sql` with a custom SQL migration
  runner that checksums applied files.
- Local-first environment validation with paired-requirement checks (e.g.
  `STORAGE_DRIVER=s3` demands bucket and credentials).
- Auth provider interface with a local email/password implementation; role split
  between editing and approving.
- Storage provider interface with local-filesystem and S3-compatible drivers.
- The review workflow as a pure, unit-tested module, wired through a single
  server action.
- Immutable script versioning with content hashing and approval pinning.
- Research-source tracking with explicit fact-check state.
- Licence records and the approval blocker for uncleared assets.
- Scene planner with reordering, per-scene asset and source links.
- Asset library with upload, licence assignment and clearance filtering.
- Dashboard, episode list, episode editor, review queue, asset library, settings;
  labelled placeholders for the render, calendar, social and analytics screens.
- Audit logging on every editorial action.
- Seeded owner/editor accounts and one demo episode of explicitly marked
  placeholder content.
- Docker Compose for Postgres, with optional Redis (M2) and MinIO (S3 testing)
  profiles, plus a production Dockerfile.
- Vitest unit suite for the workflow; Playwright suite for the approval path.

**Decisions worth knowing about**

- *Plain SQL migrations over drizzle-kit's journal.* The `.sql` files are readable
  and reviewable, and the runner refuses to re-run a file whose contents changed.
  `src/db/schema.ts` mirrors them for typed queries; keep both in step.
- *No component library.* Tailwind plus semantic HTML, so there is no third-party
  UI dependency to audit or upgrade for accessibility. Radix primitives can be
  dropped in later if richer widgets are needed.
- *Scene reordering uses a deferrable unique constraint* on `(episode_id, position)`
  so a swap can happen inside one transaction without a temporary position hack.
- *Milestone 2–5 tables exist but are unused.* Their pages say so plainly rather
  than pretending to work.

### 2026-07-27 — Bilingual episodes and duration targets

Owner decisions landed: the series is **Historia of Dominicana**, produced in
**Spanish and English**, targeting **4–6 minutes** on YouTube and **50–90 second**
social bites. Migration `0001` implements them.

- `series` gained four duration-target columns (long-form and short-form windows,
  each with a CHECK that max ≥ min).
- `episodes` gained `translation_of_id` (self-reference), `primary_format`
  (`long_form` | `short_form`), a partial unique index preventing two translations
  into the same language, and a CHECK stopping an episode being its own translation.
- The review panel shows planned runtime against the target window, and the
  workflow emits a **warning — never a block** — when the scene plan drifts
  outside it. An episode that earns its length should not be stopped by a rule.
- "Create Spanish/English version" on the episode page copies the scene skeleton
  and every research source, shares media assets, and leaves the script empty.

**Decision: a translation is its own episode row, not a language column.** Each
language gets its own human approval, because a translation can be wrong where
the original is right. Script versions, narration, captions and renders all hang
off `episode_id` already, so they follow for free. Assets stay shared — the same
archival still is the same file and the same licence obligation in both languages.
The script is deliberately *not* copied, so an untranslated Spanish draft can
never be mistaken for approved English copy. Translation graphs are kept one
level deep so "the original" is never ambiguous.

### 2026-07-28 — First full run of Milestone 1, and what it turned up

Milestone 1 had never actually been run end to end against a live database. Doing
so — migrate, seed, build, boot, drive the browser — found four things.

- **`/assets` rendered two elements with `id="kind"`**, one in the filter bar and
  one in the upload form. Duplicate ids are invalid HTML and the label binds to
  whichever comes first, so clicking "Kind" above the upload form focused the
  *filter*. Anyone using the keyboard or a screen reader would have set the filter
  believing they were setting the asset kind, and uploaded with the default kind
  silently. The filter's ids are now prefixed (`filter-kind`, and its siblings for
  consistency); the `name` attributes are untouched because they drive the query
  string.
- **The Playwright suite could not pass.** `getByRole("alert")` also matched the
  empty route announcer Next injects at body level, and `getByText("Draft")` had
  become ambiguous once the translation panel added prose containing the word. The
  app was right in every one of those cases — only the selectors were wrong.
- **`npm ci` in the Dockerfile had no lockfile to install from**, so the image
  still could not build even after the lazy-connection fix. `package-lock.json` is
  now committed, which also makes builds reproducible.
- **Two upload forms passed `encType` alongside a function `action`**, which React
  overrides with a warning.

Uploads now have their own e2e coverage (`tests/e2e/asset-upload.spec.ts`), which
is what should have caught the id collision: it asserts the upload form's label
resolves to the upload form's control, that every id on the page is unique, that a
file reaches storage and reads back byte-for-byte through `/api/files/*`, and that
the route refuses both an unknown key and a signed-out caller.

Verified green: typecheck, lint, 20 unit tests, production build, 10 e2e tests.

### 2026-07-28 — Milestone 2, first slice: episodes render to real video

An episode's scene plan now becomes a watchable MP4, entirely on the local
machine. Scene → segment → concatenated film, in 16:9 or 9:16, with per-job
progress, and the output served back through the same guarded route as uploads.

**Decision: FFmpeg first, Remotion behind the same seam.** The milestone plan
named Remotion, and it is still the right tool for motion and richer templates.
It is also a large dependency that drives a headless browser, and its licence is
not free for larger companies. Getting *watchable output* mattered more than
getting the final renderer, so this slice encodes with FFmpeg alone, behind a
`RenderProvider` interface that mirrors the existing auth and storage seams.
`renders.template` already carries a per-render template id for the day Remotion
lands beside it.

**Decision: one segment per scene, not one filter graph.** Encoding each scene
separately and concatenating with `-c copy` is what makes progress reporting and
useful errors possible — a 40-scene episode reports 40 steps, and a failure names
the scene that caused it rather than dumping an unreadable graph. Peak memory
stays flat regardless of episode length.

**Decision: rendering is not gated on approval.** Approval governs *publishing*;
you cannot sensibly approve a cut you have never watched. What a render does
record is the script version it was built from, so an approved episode can never
be confused with a render of a later draft. The only thing that blocks a render
is having no scenes. Runtime drift against the series target warns, exactly as it
does in review.

Text is passed to `drawtext` via `textfile=` rather than inline. Headings
legitimately contain colons, apostrophes and commas — all filter-graph
metacharacters — and escaping them by hand is the kind of thing that works until
someone writes a real title.

Rendering surfaced one integration gap: `/api/files/*` only served keys backed by
a `media_assets` row, so a finished render 404ed. That guard was right to refuse
— it now resolves renders too, and nothing else.

Verified from a clean database: typecheck, lint, 41 unit tests, production build,
13 e2e tests including one that renders an actual MP4 and asserts the served
bytes carry an `ftyp` box.

### 2026-07-28 — Milestone 2, second slice: durable render jobs

Renders can now go through BullMQ + Redis and survive a restart.

**Decision: Redis stays optional.** Making it required would have broken the
promise this project is built on — that the whole thing runs with no extra
services. So `REDIS_URL` selects the behaviour and nothing else in the codebase
changes shape:

| `REDIS_URL` | Where a render runs | Cost |
|---|---|---|
| unset | in the app process | nothing to run; a restart mid-encode loses it |
| set | BullMQ worker (`npm run worker`) | survives restarts, retries 3× with backoff |

The Settings page states which mode is live in those words, rather than making
an operator infer it from "(set)".

**Stale-render reclaim.** A job left `running` by a process that died is failed
after 30 minutes with an explanation, on worker start. Only `running` is
reclaimed, never `queued` — with a worker configured a job legitimately waits in
`queued`, and failing those would break the durability this exists to add.
Progress updates keep `updated_at` moving, so a live render is never mistaken
for a dead one; verified against a live database with one dead and one healthy
render, which reclaimed exactly one.

The worker imports the same `server-only`-guarded modules the app uses, via
Node's `react-server` resolve condition (`tsx --conditions=react-server`). No
parallel copy of the orchestration, and the guard still protects the client
bundle.

Two things this slice found:

- **The Docker image had ffmpeg but no fonts.** `drawtext` needs a real font
  file, and the slim base ships none, so every containerised render would have
  failed at the moment it drew a heading. `fonts-dejavu-core` is now installed
  beside ffmpeg.
- **BullMQ pulls an optional Valkey client** that is not installed, which put
  `Can't resolve @valkey/valkey-glide` warnings on every build. `bullmq` and
  `ioredis` are now server-external — that noise is where a real module error
  goes to hide.

### 2026-07-28 — Milestone 2, third slice: narration

Upload a recording on the Production tab and the next render lays it under the
picture, normalised in one pass over the whole programme.

**Decision: −14 LUFS, not −16 or −23.** YouTube normalises uploads to roughly
−14 LUFS. Delivering at that target means the platform leaves the mix alone
instead of pulling it down and flattening whatever dynamics were chosen. True
peak is capped at −1.5 dBTP so lossy transcodes do not clip.

**Decision: the picture stretches, the narration never gets cut.** If a
recording outlasts the scene plan the final scene is held until it finishes. A
picture that lingers is a stylistic wrinkle; a word clipped off mid-sentence is
a defect. `-shortest` is deliberately absent from the mix command for the same
reason. The plan warns in both directions — narration running well past the
scene plan, or a plan long enough that the film ends in silence.

Loudness is normalised once over the finished programme rather than per segment,
because integrated loudness only means anything at programme level. The measured
result is stored on both the render and the voiceover, so the delivered figure is
visible without re-probing the file.

Duration is read with `ffprobe` at *upload* time, not render time: the scene plan
is fitted to it, and an editor needs that number while they are still editing.

Verified end to end: a 2-second scene plan with 12 seconds of narration produced
a 12.05s film with an AAC stereo track measuring exactly −14.0 LUFS, from a
source deliberately 24 dB down.

One thing this slice re-taught: the narration panel's own copy contains the word
"render", which broke the e2e selector that located the render panel by prose.
Panels are now located by heading. That is the same ambiguity that bit
`getByText("Draft")` two slices ago — body copy is not an identifier.

### 2026-07-28 — What a real human voice changed

The narration path had only ever been tested with a generated tone. A 33-second
Spanish take from an actual narrator, recorded on a phone, exposed two things a
constant tone cannot.

**Loudness normalisation needed two passes.** Single-pass `loudnorm` works
forward through the file and can only estimate; on a steady tone that estimate
is perfect, on speech it landed 1.8 LU under target. Measuring first
(`print_format=json`) and feeding the numbers back halved the error. The
remainder is the true-peak ceiling doing its job — the output measures −14.8
LUFS with peaks at −3.5 dBFS, inside the ±1 LU that EBU R128 and YouTube both
work to, with her dynamics intact (LRA 4.3 LU).

**A dead Redis hung the request instead of failing it.** BullMQ needs
`maxRetriesPerRequest: null` so a *worker* never abandons its blocking wait —
but the same setting on the *producer* means `queue.add()` retries forever
rather than rejecting, so clicking "Start render" hung the web request. Producer
and consumer now get opposite connections: bounded retries and
`enableOfflineQueue: false` for the producer, unbounded for the worker, plus an
8-second ceiling on the handoff and a cache reset so one outage at startup
cannot poison every later render. Verified with Redis stopped: fails in 621 ms
with a readable message.

Both were found by testing with real material rather than a fixture. Neither was
reachable from the test suite as written.

### Next — the rest of Milestone 2

- **Subtitles** — SRT/VTT import, then faster-whisper timing locally.
- **Per-scene narration.** The `voiceovers.scene_id` column already exists; only
  full-episode narration is mixed today, because mixing both would overlap.
- **Local narration generation** with Piper, as an alternative to uploading.
- **Richer templates** — Ken Burns motion on stills, and per-template layouts
  rather than one shared lower-third.

---

## Accounts needed later (none required now)

Documented so they can be provisioned when the relevant milestone arrives:

| Service | Needed for | Milestone |
|---|---|---|
| Supabase | Hosted Postgres + Auth (optional) | any |
| Cloudflare R2 / Amazon S3 | Cloud object storage (optional) | any |
| OpenAI or Anthropic | Scene-plan and copy drafting (optional) | 3 |
| ElevenLabs or similar | Hosted narration (optional — Piper is free) | 3 |
| YouTube Data API + OAuth | Publishing | 4 |
| TikTok Content Posting API | Publishing | 4 |
| Meta developer app | Instagram / Facebook publishing | 4 |
| LinkedIn developer app | Publishing | 4 |
| X developer platform | Publishing | 4 |
| Licensed music / archival media source | Rights-cleared media | ongoing |

None of these block local development. Provider adapters are mocked and the
configuration screens work without any of them.

## Editorial standards

- Do not publish copyrighted music, imagery, footage or archival material without
  documented rights. The licence record is the documentation.
- AI output, when providers are enabled in Milestone 3, is always labelled a draft
  until a human approves it, and is visually distinguished from source-backed
  content throughout the interface.
- Do not fabricate historical facts, citations, licences or quotations. The tool
  will not verify a source for you — `unverified` is the default and stays that way
  until a person changes it.
