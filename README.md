# Bleeps — a personal AI agent on Cloudflare Project Think

A small, friendly AI assistant called **Bleeps**, built on top of
[Cloudflare Project Think](https://blog.cloudflare.com/project-think/) —
the next generation of the Cloudflare Agents SDK.

Bleeps streams responses, remembers things across sessions, and owns its
own durable filesystem of notes. It runs as a single Durable Object that
hibernates when idle (zero cost) and wakes on message.

**Live:** https://bleeps-agent.buildaflare.workers.dev

> **Project history.** This project started as "milesGPT" — a stateless
> Hono Worker doing one-shot RAG over D1. The Project Think rebuild was
> originally called "Nimbus" until I noticed the [gonimbus.ai](https://gonimbus.ai/)
> collision; the agent is now called **Bleeps**. The git history, the v1/v2
> migration tags in `wrangler.jsonc`, and the journal entry under
> [`docs/journal/`](./docs/journal/) all carry the older names — that's
> intentional, history shouldn't lie.

---

## What's under the hood

| Concern        | Implementation                                                                |
| -------------- | ----------------------------------------------------------------------------- |
| Runtime        | `Bleeps extends Think<Env>` Durable Object                                    |
| State          | Per-DO SQLite + Workspace + Session message tree                              |
| Memory         | `soul` (personality) + `memory` block the model writes to via `set_context`   |
| Note storage   | Workspace files; Bleeps uses built-in `read`/`grep`/`find` tools              |
| UI             | React + `useAgentChat`, streaming over WebSocket                              |
| Crash safety   | `chatRecovery = true` wraps every turn in a recoverable fiber                 |
| Model          | `@cf/moonshotai/kimi-k2.6`                                                    |
| Language       | TypeScript                                                                    |

This is "Stage 1" of a larger plan. See [Roadmap](#roadmap) at the bottom.

---

## Project layout

```
bleeps-agent/
├── package.json            # type: module; vite + think deps
├── tsconfig.json           # extends agents/tsconfig
├── vite.config.ts          # @cloudflare/vite-plugin + agents/vite + react
├── wrangler.jsonc          # DO binding + SQLite migration chain + assets
├── env.d.ts                # typed Cloudflare.Env bindings
├── index.html              # entry HTML for the React app
├── docs/journal/           # build history
├── scripts/
│   └── smoke.mjs           # live HTTP + optional WebSocket smoke test
├── test/                   # vitest + @cloudflare/vitest-pool-workers
└── src/
    ├── server.ts           # Bleeps extends Think + routeAgentRequest
    └── client/
        ├── main.tsx        # React root
        ├── App.tsx         # useAgent + useAgentChat
        └── styles.css      # Cloudflare orange terminal look
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
`Bleeps` Durable Object on local SQLite, and serves the React client with
HMR. By default it listens on **http://localhost:5173**.

Open that URL and you'll see Bleeps. Type a question, hit **Ask**, watch
the response stream in token-by-token.

### 3. Typecheck / build

```bash
npm run typecheck     # tsc --noEmit
npm run build         # bundle worker + client into dist/
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
create the `Bleeps` Durable Object class and run the SQLite migrations
(`v1`, `v2`, `v3` in `wrangler.jsonc`). You'll get a URL like
`https://bleeps-agent.<your-subdomain>.workers.dev`.

### Custom domain (optional)

Add a `routes` block to `wrangler.jsonc`:

```jsonc
"routes": [
  { "pattern": "bleeps.example.com/*", "zone_name": "example.com" }
]
```

---

## How Bleeps actually works

There is **one global Durable Object instance** named `"miles"`. Every
browser session talks to the same DO, so Bleeps's memory and notes are
shared across devices (and across people who can reach the URL — there's
no auth yet, see [Roadmap](#roadmap)).

### The agent class

`src/server.ts` declares:

```ts
export class Bleeps extends Think<Env> {
  chatRecovery = true;

  getModel() {
    return createWorkersAI({ binding: this.env.AI })(
      "@cf/moonshotai/kimi-k2.6"
    );
  }

  configureSession(session: Session) {
    return session
      .withContext("soul",   { provider: { get: async () => BLEEPS_SOUL } })
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

1. **`soul`** — Bleeps's personality and operating instructions. Static.
   Defined in `BLEEPS_SOUL` at the top of `src/server.ts`. Edit that
   string to change how Bleeps talks.
2. **`memory`** — a 2000-token scratchpad the **model writes to itself**
   using the `set_context` tool. This is how Bleeps remembers your
   preferences, ongoing projects, names of people you mention, etc.
   across sessions. The contents survive hibernation and restarts.

### The Workspace

`this.workspace` is a durable filesystem backed by the DO's SQLite. Bleeps
sees it through the built-in workspace tools, so any question that might
be answered by something previously written down — Bleeps will `grep` or
`find` it itself, without you wiring any RAG plumbing.

You add files by just talking to Bleeps: "Add a note that I'm flying to
Lisbon on the 14th" → it'll write a file under `/notes/` itself. The
naming/structure is the model's to organise; the only convention is that
paths are absolute (start with `/`).

---

## Using Bleeps day-to-day

Once it's running, you just talk to it. Some examples:

- **"Remember that I prefer responses under 100 words."** — Bleeps will
  call `set_context` on its memory block. Next session, that preference
  is still there.
- **"Add a note: dentist appointment Tuesday at 10."** — Bleeps writes a
  new file into `/notes/`.
- **"What did I write down about the React migration?"** — Bleeps `grep`s
  the workspace for "React" and summarises the matches.
- **"Edit my Lisbon note and change the date to the 16th."** — Bleeps
  reads the file, edits it, saves it back.
- **Refresh the page mid-response.** — The stream resumes from where it
  was, because `chatRecovery = true`.

---

## Bindings reference

In `wrangler.jsonc`:

| Binding   | Type           | Used for                                         |
| --------- | -------------- | ------------------------------------------------ |
| `AI`      | Workers AI     | The kimi-k2.6 model that drives Bleeps           |
| `Bleeps`  | Durable Object | The single Bleeps agent instance (SQLite-backed) |

### Migration chain

`wrangler.jsonc` keeps the full history of DO class migrations — Cloudflare
requires every prior tag to be present to deploy.

- **v1** — created the original `MilesGPT` class (Stage 1).
- **v2** — clean-slate rename: deleted `MilesGPT`, created `Nimbus`. Used
  to drop test pollution from the live agent.
- **v3** — renamed `Nimbus` → `Bleeps` after the gonimbus.ai naming
  collision. Storage wiped again; fresh start.

---

## Testing

A three-layer testing framework, fast to slow:

```bash
npm test               # unit + integration, ~10s, $0
npm run smoke          # HTTP smoke against live deploy, ~1s, $0
npm run smoke -- --ws  # also opens a WS, sends "ping", asserts a reply
```

### Layer 1 — unit tests (`test/unit/`)

Pure-logic tests with no external dependencies. Empty right now — the
Stage 1 migration tests that lived here were retired with the clean-slate.
Kept as a placeholder for future pure-logic helpers (Stage 2 onwards).

### Layer 2 — integration tests (`test/integration/`)

Real Worker, real `Bleeps` Durable Object, real (local) SQLite via
[`@cloudflare/vitest-pool-workers`](https://developers.cloudflare.com/workers/testing/vitest-integration/).
No real Workers AI — the agent loop is never triggered in tests, so no
model credits are burned.

- `agent-boot.test.ts` — Forces `onStart` to run, asserts the DO is
  reachable and storage persists across RPCs.
- `agent-tools.test.ts` — Round-trips files via the Workspace
  (write/read/overwrite/unicode/nested paths).

Helpers in `test/integration/_helpers.ts` grab the single-instance DO stub.

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
First deploy ever? Check that `wrangler.jsonc` has the full `migrations`
chain — Cloudflare requires every prior tag to be present, even ones
whose classes have since been deleted.

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
  Bleeps writes a single JS program to answer multi-step questions instead
  of chaining 20 tool calls. Big efficiency win.
- **Stage 4 — Execution ladder.** Optional browser (Browser Run) and
  sandbox (Cloudflare Sandbox) tiers, plus sub-agents (e.g. a `Researcher`
  facet) for parallel work.
- **Stage 5 — Self-authored extensions.** Hook up the `ExtensionManager`
  so Bleeps can write its own tools at runtime (e.g. a Google Calendar
  integration on first use) and persist them.

Also worth adding whenever it bites:

- **Auth.** Currently anyone with the URL can talk to Bleeps and see your
  notes. A GitHub OAuth gate (like the upstream Think `assistant` example
  uses) is straightforward. Then the DO name becomes the user login
  instead of the hardcoded `"miles"`.

---

## References

- [Project Think announcement](https://blog.cloudflare.com/project-think/)
- [Think docs](https://github.com/cloudflare/agents/blob/main/docs/think/index.md)
- [Full Think example (`assistant`)](https://github.com/cloudflare/agents/tree/main/examples/assistant)
- [Agents SDK docs](https://developers.cloudflare.com/agents/)
