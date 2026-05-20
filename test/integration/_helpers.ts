import { env } from "cloudflare:test";

/**
 * Shared helpers for integration tests.
 *
 * These run inside the Workers test pool, so `env` is the live `Env` from
 * wrangler.jsonc — with a fresh local D1 + local DO storage per test run.
 */

/** Create the legacy `notes` table that the old milesGPT used. */
export async function ensureNotesTable(): Promise<void> {
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL)"
  );
}

/** Wipe and re-create the `notes` table; useful at the top of a test. */
export async function resetNotesTable(): Promise<void> {
  await env.DB.exec("DROP TABLE IF EXISTS notes");
  await ensureNotesTable();
}

/** Seed `notes` with rows in the given order. Returns the inserted IDs. */
export async function seedNotes(texts: string[]): Promise<number[]> {
  const ids: number[] = [];
  for (const text of texts) {
    const { results } = await env.DB.prepare(
      "INSERT INTO notes (text) VALUES (?) RETURNING id"
    )
      .bind(text)
      .all<{ id: number }>();
    ids.push(results[0].id);
  }
  return ids;
}

/**
 * Get an RPC stub for the single `"miles"` MilesGPT DO instance. The same
 * instance the deployed app talks to — local-only, fresh storage per test.
 */
export function nimbusStub() {
  return env.MilesGPT.get(env.MilesGPT.idFromName("miles"));
}
