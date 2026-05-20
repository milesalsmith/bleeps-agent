#!/usr/bin/env node
/**
 * Live smoke test for the deployed Bleeps Worker.
 *
 * Two tiers:
 *
 *   npm run smoke
 *     -- HTTP only: GETs the root URL, asserts it returns the React shell.
 *        Cheap, takes ~2s, costs $0. Catches "the deploy is broken at the
 *        edge" without touching Workers AI.
 *
 *   npm run smoke -- --ws
 *     -- HTTP + WebSocket: also opens the agents WebSocket to the Bleeps
 *        DO, sends a "ping" message, and waits for any streamed response
 *        chunk. Costs a handful of Workers AI tokens per run.
 *
 * Override the target with TEST_URL:
 *
 *   TEST_URL=http://localhost:5173 npm run smoke
 *
 * Exit codes:
 *   0  all checks passed
 *   1  a check failed (see stderr for what)
 *   2  config error (no TEST_URL, etc)
 */

import process from "node:process";

const DEFAULT_URL = "https://bleeps-agent.buildaflare.workers.dev";
const TEST_URL = process.env.TEST_URL || DEFAULT_URL;
const WANT_WS = process.argv.includes("--ws");
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 30_000);

let failures = 0;

/** Run one named check and record pass/fail. */
async function check(name, fn) {
  const start = Date.now();
  try {
    await fn();
    const ms = Date.now() - start;
    console.log(`  ok   ${name}  (${ms}ms)`);
  } catch (err) {
    failures++;
    const ms = Date.now() - start;
    console.error(`  FAIL ${name}  (${ms}ms)`);
    console.error(`       ${err.message || err}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ── HTTP checks ─────────────────────────────────────────────────────

async function checkHttpRoot() {
  const res = await fetch(TEST_URL, { redirect: "follow" });
  assert(res.ok, `expected 2xx, got ${res.status}`);
  const html = await res.text();
  // The React entry script is what Vite emits — proves the static assets
  // pipeline is wired up, not just that *something* responded.
  assert(
    html.includes("<title>Bleeps</title>"),
    "homepage HTML missing <title>Bleeps</title> — wrong app deployed?"
  );
  assert(
    html.includes('id="root"'),
    "homepage HTML missing React #root mount point"
  );
}

async function checkSpaFallback() {
  // Wrangler's `not_found_handling: "single-page-application"` means
  // unknown routes return the React shell (200 OK + index.html) instead
  // of a 404. That's correct SPA behaviour: client-side routing handles
  // /whatever in the browser. Test that the fallback actually serves the
  // SPA shell, not something else (cached error page, generic 200, etc).
  const res = await fetch(`${TEST_URL}/this-route-does-not-exist`);
  assert(
    res.status === 200,
    `SPA fallback should return 200, got ${res.status}`
  );
  const html = await res.text();
  assert(
    html.includes('id="root"'),
    "SPA fallback didn't serve the React shell"
  );
}

// ── WebSocket check (opt-in) ────────────────────────────────────────

async function checkWebsocketChat() {
  // The agents library exposes the DO at /agents/<class-kebab>/<name>.
  // The DO class is `Bleeps` → `bleeps`. (Single-word class names dodge
  // the camelCase-to-kebab pitfall that previously turned `MilesGPT` into
  // `miles-g-p-t`.) See `camelCaseToKebabCase` in node_modules/agents/dist/utils.js.
  const wsUrl = TEST_URL.replace(/^http/, "ws") + "/agents/bleeps/miles";

  const ws = new WebSocket(wsUrl);

  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {}
      reject(new Error(`no response within ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    let gotAnyMessage = false;

    ws.addEventListener("open", () => {
      // Minimal valid cf_agent_chat_messages frame, mirroring what
      // useAgentChat sends on submit. The id is just a client-side
      // dedupe key.
      const msgId = `smoke-${Date.now()}`;
      ws.send(
        JSON.stringify({
          type: "cf_agent_chat_messages",
          messages: [
            {
              id: msgId,
              role: "user",
              parts: [{ type: "text", text: "ping" }]
            }
          ]
        })
      );
    });

    ws.addEventListener("message", () => {
      // Any message back means the agent picked up our submit and started
      // streaming. We don't care about the content — just that the pipe
      // works end-to-end. The first chunk is the proof.
      if (gotAnyMessage) return;
      gotAnyMessage = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {}
      resolve(true);
    });

    ws.addEventListener("error", (evt) => {
      clearTimeout(timer);
      reject(new Error(`WebSocket error: ${evt.message || "unknown"}`));
    });

    ws.addEventListener("close", (evt) => {
      if (!gotAnyMessage) {
        clearTimeout(timer);
        reject(
          new Error(
            `WebSocket closed before any response (code ${evt.code}, reason ${evt.reason || "none"})`
          )
        );
      }
    });
  });

  assert(result === true, "did not receive any streamed message");
}

// ── Main ────────────────────────────────────────────────────────────

console.log(`\nSmoke test against: ${TEST_URL}`);
console.log(`Mode: ${WANT_WS ? "HTTP + WebSocket" : "HTTP only"}`);
console.log("");

await check("GET / returns the React shell", checkHttpRoot);
await check("SPA fallback serves React shell on unknown routes", checkSpaFallback);

if (WANT_WS) {
  await check("WebSocket chat round-trip", checkWebsocketChat);
}

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log("All checks passed.");
process.exit(0);
