import { env } from "cloudflare:test";

/**
 * Shared helpers for integration tests.
 *
 * These run inside the Workers test pool, so `env` is the live `Env` from
 * wrangler.jsonc — with local DO storage that resets per test file.
 */

/**
 * Get an RPC stub for the single `"miles"` Bleeps DO instance — the same
 * instance the deployed app talks to. Storage is local to the test pool
 * (your live deployment is unaffected).
 */
export function bleepsStub() {
  return env.Bleeps.get(env.Bleeps.idFromName("miles"));
}
