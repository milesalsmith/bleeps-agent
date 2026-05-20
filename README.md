# milesGPT — Nimbus on Project Think

A rebuild of the original milesGPT Worker on top of [Cloudflare Project
Think](https://blog.cloudflare.com/project-think/) — the next generation of
the Cloudflare Agents SDK.

The old milesGPT was a stateless Hono Worker that did one-shot RAG over a D1
notes table. The new one is a persistent, durable agent called **Nimbus**
that streams responses, remembers things across sessions, and owns its own
filesystem of notes.

---

## What changed (one-screen summary)

| Concern        | Before                                       | After                                                                            |
| -------------- | -------------------------------------------- | -------------------------------------------------------------------------------- |
| Runtime        | Hono fetch handler                           | `MilesGPT extends Think<Env>` Durable Object                                     |
| State          | Stateless per request                        | Per-DO SQLite + Workspace + Session message tree                                 |
| Memory         | None                                         | `soul` (Nimbus personality) + `memory` block the model writes to via `set_context` |
| Notes storage  | D1 `notes` table + Vectorize embeddings      | Workspace files at `/notes/<id>.md`; Nimbus uses built-in `read`/`grep`/`find` tools |
| UI             | Server-rendered HTML form, one-shot Q&A      | React + `useAgentChat`, streaming over WebSocket                                 |
| Crash safety   | None                                         | `chatRecovery = true` wraps every turn in a recoverable fiber                    |
| Model          | `@cf/meta/llama-3-8b-instruct`               | `@cf/moonshotai/kimi-k2.6`                                                       |
| Language       | JavaScript                                   | TypeScript                                                                       |

This is "Stage 1" of a larger plan. See [Roadmap](#roadmap) at the bottom for
what comes next.

---

## Project layout

```
miles-gpt/
├── package.json            # type: module; vite + think deps
├── tsconfig.json           # extends agents/tsconfig
├── vite.config.ts          # @cloudflare/vite-plugin + agents/vite + react
├── wrangler.jsonc          # DO binding, SQLite migration, assets config
├── env.d.ts                # typed Cloudflare.Env bindings
├── index.html              # entry HTML for the React app
└── src/
    ├── server.ts           # MilesGPT extends Think + /admin/migrate-notes
    └── client/
        ├── main.tsx        # React root
        ├── App.tsx         # useAgent + useAgentChat, Nimbus avatar + bubble
        └── styles.css      # ported Nimbus orange look
```

---

## Local development

### 1. Install

```bash
npm install
```

### 2. Run the dev server

```bash
npm run dev
```

Vite + the `@cloudflare/vite-plugin` boots a local Worker, mounts the
`MilesGPT` Durable Object on local SQLite, and serves the React client with
HMR. By default it listens on **http://localhost:5173**.

Open that URL and you'll see Nimbus. Type a question, hit **Ask**, watch the
response stream in token-by-token.

### 3. Typecheck / build

```bash
npx tsc --noEmit    # typecheck only
npm run build       # build worker + client into dist/
```

---

## Deploy

### First-time setup

You need a Cloudflare account and `wrangler` logged in:

```bash
npx wrangler login
```

### Deploy

```bash
npm run deploy
```

This runs `vite build` and then `wrangler deploy`. The first deploy will
create the `MilesGPT` Durable Object class and run the SQLite migration
(`v1` in `wrangler.jsonc`). You'll get a URL like
`https://miles-gpt.<your-subdomain>.workers.dev`.

### Custom domain (optional)

Add a `routes` block to `wrangler.jsonc`:

```jsonc
"routes": [
  { "pattern": "nimbus.example.com/*", "zone_name": "example.com" }
]
```

---

## How Nimbus actually works

There is **one global Durable Object instance** named `"miles"`. Every
browser session talks to the same DO, so Nimbus's memory and notes are
shared across devices (and across people who can reach the URL — there's
no auth yet, see [Roadmap](#roadmap)).

### The agent class

`src/server.ts` declares:

```ts
export class MilesGPT extends Think<Env> {
  chatRecovery = true;

  getModel() {
    return createWorkersAI({ binding: this.env.AI })(
      "@cf/moonshotai/kimi-k2.6"
    );
  }

  configureSession(session: Session) {
    return session
      .withContext("soul",   { provider: { get: async () => NIMBUS_SOUL } })
      .withContext("memory", { description: "...", maxTokens: 2000 })
      .withCachedPrompt();
  }
}
```

That is the entire agent. Think's base class wires up:

- The agentic loop (model call → tool calls → results → loop until done)
- Streaming over WebSocket
- Per-message persistence in SQLite
- Resume-on-reconnect if you refresh the page mid-stream
- A built-in Workspace filesystem (SQLite-backed) at `this.workspace`
- Workspace tools (`read`, `write`, `edit`, `find`, `grep`, `list`,
  `delete`) automatically exposed to the model
- A `set_context` tool the model uses to update its own `memory` block

### Two context blocks

1. **`soul`** — Nimbus's personality and operating instructions. Static.
   Defined in `NIMBUS_SOUL` at the top of `src/server.ts`. Edit that string
   to change how Nimbus talks.
2. **`memory`** — a 2000-token scratchpad the **model writes to itself**
   using the `set_context` tool. This is how Nimbus remembers your
   preferences, ongoing projects, names of people you mention, etc.
   across sessions. The contents survive hibernation and restarts.

### The Workspace (notes filesystem)

`this.workspace` is a durable filesystem backed by the DO's SQLite. Nimbus
sees it through the built-in workspace tools, so any question that might be
answered by your notes — Nimbus will `grep` or `find` them itself, without
you wiring any RAG plumbing.

Notes live at `/notes/<id>.md` (one file per note). Once migrated from D1,
you can add more by just talking to Nimbus: "Add a note that I'm flying
to Lisbon on the 14th" → it'll write the file itself.

---

## Migrating your old D1 notes

The `wrangler.jsonc` still has `D1` and `Vectorize` bindings, **for migration
only**. There's a one-shot admin endpoint that reads every row out of the
old `notes` table and writes it as a file in Nimbus's Workspace.

### Run the migration

After your first deploy:

```bash
curl -X POST https://miles-gpt.<your-subdomain>.workers.dev/admin/migrate-notes
```

Or locally (`npm run dev` running):

```bash
curl -X POST http://localhost:5173/admin/migrate-notes
```

You'll get back JSON like:

```json
{ "migrated": [1, 2, 3, ...], "count": 47 }
```

It's idempotent — re-running overwrites files with the same path.

### Verify

Open Nimbus and ask: "What notes do you have?" or "Search your notes for X."
Nimbus will use its `find` / `grep` tools to answer.

### Clean up

Once you've confirmed the migration worked, delete:

1. The `vectorize` and `d1_databases` blocks in `wrangler.jsonc`
2. The `DB` and `VECTOR_INDEX` lines in `env.d.ts`
3. The `migrateNotes` function and `/admin/migrate-notes` route in
   `src/server.ts`
4. The `importNote` method on `MilesGPT`

Then `npm run deploy` again to ship the leaner version.

> ⚠️ **Do NOT delete the Vectorize index or D1 database from your
> Cloudflare dashboard** until you're certain the migration is good — there's
> no easy undo.

---

## Using Nimbus day-to-day

Once it's running, you just talk to it. Some examples of things it can do
that the old milesGPT could not:

- **"Remember that I prefer responses under 100 words."** — Nimbus will
  call `set_context` on its memory block. Next session, that preference is
  still there.
- **"Add a note: dentist appointment Tuesday at 10."** — Nimbus writes a
  new file into `/notes/`.
- **"What did I write down about the React migration?"** — Nimbus
  `grep`s the workspace for "React" and summarises the matches.
- **"Edit my Lisbon note and change the date to the 16th."** — Nimbus
  reads the file, edits it, saves it back.
- **Refresh the page mid-response.** — The stream resumes from where it
  was, because `chatRecovery = true`.

---

## Bindings reference

In `wrangler.jsonc`:

| Binding         | Type             | Used for                                           |
| --------------- | ---------------- | -------------------------------------------------- |
| `AI`            | Workers AI       | The kimi-k2.6 model that drives Nimbus             |
| `MilesGPT`      | Durable Object   | The single Nimbus agent instance (SQLite-backed)   |
| `DB`            | D1               | **TEMPORARY** — only for `/admin/migrate-notes`    |
| `VECTOR_INDEX`  | Vectorize        | **TEMPORARY** — kept for parity, not actually read |

---

## Testing

A Stage-1 testing framework runs in three layers, fast to slow:

```bash
npm test           # unit + integration, ~10s, $0
npm run smoke      # HTTP smoke against live deploy, ~1s, $0
npm run smoke -- --ws  # also opens a WS, sends "ping", asserts a reply
```

### Layer 1 — unit tests (`test/unit/`)

Pure-logic tests with no external dependencies. Currently covers the
migration loop's contract (paths, ordering, error handling, unicode
preservation). Run in <100ms.

### Layer 2 — integration tests (`test/integration/`)

Real Worker, real `MilesGPT` Durable Object, real (local) SQLite + D1 via
[`@cloudflare/vitest-pool-workers`](https://developers.cloudflare.com/workers/testing/vitest-integration/).
No real Workers AI — the agent loop is never triggered in tests, so no
model credits are burned.

- `migrate-notes.test.ts` — POSTs to `/admin/migrate-notes` with seeded D1
  rows, reads files back from the agent's Workspace, asserts round-trip
  integrity. **This is the test that protects your data.**
- `agent-boot.test.ts` — Forces `onStart` to run, asserts the DO is
  reachable and storage persists.
- `agent-tools.test.ts` — Round-trips files via the Workspace
  (write/read/overwrite/unicode/nested paths).

Helpers in `test/integration/_helpers.ts` seed D1 and grab the
single-instance DO stub.

### Layer 3 — live smoke (`scripts/smoke.mjs`)

Runs against the actual deployed Worker. The cheap mode (`npm run smoke`)
does HTTP only — fast, free, catches "the deploy is broken". The `--ws`
mode opens a real WebSocket and sends `"ping"`, asserting any chunk
streams back within 30s. That last mode does burn a small amount of
Workers AI credit per run, so don't put it in a tight loop.

Override the target URL via `TEST_URL`:

```bash
TEST_URL=http://localhost:5173 npm run smoke        # against vite dev
TEST_URL=https://staging.example.com npm run smoke  # against a branch deploy
```

### The standard loop

1. Make a change.
2. `npm test` — catches regressions in seconds.
3. `npm run deploy` — pushes to Cloudflare.
4. `npm run smoke -- --ws` — proves the deployed version actually works.
5. `git commit && git push`.

If any step fails, fix before moving on. The whole point is to refuse to
push code that's quietly broken.

---

## Troubleshooting

**`npm install` fails on `@cloudflare/think`**
The package is in preview (`^0.7.x`). Check you're on Node 20+ and run
`npm install` from a clean tree (`rm -rf node_modules package-lock.json &&
npm install`).

**Typecheck error: `Cannot find type definition file for 'node'`**
You're missing `@types/node`. It's already a devDep — run `npm install`.

**`wrangler deploy` rejects the migration**
First deploy ever? Check that `wrangler.jsonc` has the `migrations` block
with `new_sqlite_classes: ["MilesGPT"]`. If you've previously had a
different DO class with the same name, you'll need a rename migration.

**Nimbus doesn't see my migrated notes**
Re-run `/admin/migrate-notes` and check the JSON response. Then in the
chat ask Nimbus to `list /notes/` — it'll show you what's actually in the
workspace.

**"WebSocket failed to connect" in the browser**
Make sure the URL you opened matches where the Worker is actually running.
On the deployed version it should be the `*.workers.dev` URL exactly.
Locally it's `http://localhost:5173`.

---

## Roadmap

This is **Stage 1** of a five-stage plan, deliberately scoped small. Each
stage is additive — you can stop after any one and still have a useful
product.

- **Stage 2 — Smarter workspace.** Add semantic search back as an optional
  tool. Reorganise notes into folders. Wire R2 for large-file spillover.
- **Stage 3 — Codemode.** Add `@cloudflare/codemode` + Dynamic Workers so
  Nimbus writes a single JS program to answer multi-step questions instead
  of chaining 20 tool calls. Big efficiency win.
- **Stage 4 — Execution ladder.** Optional browser (Browser Run) and
  sandbox (Cloudflare Sandbox) tiers, plus sub-agents (e.g. a `Researcher`
  facet) for parallel work.
- **Stage 5 — Self-authored extensions.** Hook up the `ExtensionManager`
  so Nimbus can write its own tools at runtime (e.g. a Google Calendar
  integration on first use) and persist them.

Also worth adding whenever it bites:

- **Auth.** Currently anyone with the URL can talk to Nimbus and see your
  notes. A GitHub OAuth gate (like the upstream Think `assistant` example
  uses) is straightforward. Then the DO name becomes the user login
  instead of the hardcoded `"miles"`.

---

## References

- [Project Think announcement](https://blog.cloudflare.com/project-think/)
- [Think docs](https://github.com/cloudflare/agents/blob/main/docs/think/index.md)
- [Full Think example (`assistant`)](https://github.com/cloudflare/agents/tree/main/examples/assistant)
- [Agents SDK docs](https://developers.cloudflare.com/agents/)
