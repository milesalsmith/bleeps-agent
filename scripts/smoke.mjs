#!/usr/bin/env node
/**
 * Live smoke test for the deployed milesGPT Worker.
 *
 * Two tiers:
 *
 *   npm run smoke
 *     -- HTTP only: GETs the root URL, asserts it returns the React shell.
 *        Cheap, takes ~2s, costs $0. Catches "the deploy is broken at the
 *        edge" without touching Workers AI.
 *
 *   npm run smoke -- --ws
 *     -- HTTP + WebSocket: also opens the agents WebSocket to the MilesGPT
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

const DEFAULT_URL = "https://miles-gpt.buildaflare.workers.dev";
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
    html.includes("<title>MilesGPT</title>"),
    "homepage HTML missing <title>MilesGPT</title> — wrong app deployed?"
  );
  assert(
    html.includes('id="root"'),
    "homepage HTML missing React #root mount point"
  );
}

async function checkAdminRouteSafe() {
  // GET /admin/migrate-notes should NOT trigger the migration (we only
  // accept POST). This is a guardrail: if a future change accidentally
  // allowed GET, we'd quietly re-migrate notes on every cache probe.
  const res = await fetch(`${TEST_URL}/admin/migrate-notes`);
  assert(
    res.status === 404,
    `GET /admin/migrate-notes should 404, got ${res.status} — migration may be triggerable by accident`
  );
}

// ── WebSocket check (opt-in) ────────────────────────────────────────

async function checkWebsocketChat() {
  // The agents library exposes the DO at /agents/<class-kebab>/<name>.
  // It kebab-cases the class name character-by-character, so `MilesGPT`
  // becomes `miles-g-p-t` (one dash per capital, not the more obvious
  // `miles-gpt`). See `camelCaseToKebabCase` in node_modules/agents/dist/utils.js.
  const wsUrl = TEST_URL.replace(/^http/, "ws") + "/agents/miles-g-p-t/miles";

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
await check("GET /admin/migrate-notes is safely 404", checkAdminRouteSafe);

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
