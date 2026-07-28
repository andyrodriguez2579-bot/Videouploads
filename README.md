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

Milestone 1 (the editorial foundation) is implemented. Milestones 2–5 are not.

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
- FFmpeg (only needed from Milestone 2)

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
| `/renders` | Placeholder for Milestone 2 |
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
npm run test             # vitest — workflow rules
npm run test:e2e         # playwright — approval workflow
```

## Testing

**Unit** — [`src/domain/workflow.test.ts`](src/domain/workflow.test.ts) covers the
state machine and every approval gate.

```bash
npm run test
```

**End to end** — [`tests/e2e/approval-workflow.spec.ts`](tests/e2e/approval-workflow.spec.ts)
drives a real browser through: anonymous redirect, blocked submission, the full
draft → review → approved path, approval withdrawal on script edit, and the
editor-cannot-approve role gate. Needs a migrated and seeded database.

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

### Next — Milestone 2: rendering pipeline

Remotion templates, FFmpeg encoding and loudness normalisation, BullMQ + Redis
jobs with progress and retry, local sample render with no paid API, subtitle
import and faster-whisper generation.

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
