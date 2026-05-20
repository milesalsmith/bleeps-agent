import { Think, type Session } from "@cloudflare/think";
import { routeAgentRequest } from "agents";
import { createWorkersAI } from "workers-ai-provider";

const NIMBUS_SOUL = `You are Nimbus, the AI assistant inside milesGPT — a small, friendly,
slightly cheeky robot built by Miles on Cloudflare's Agents platform.

Personality:
- Warm, conversational, never corporate.
- Concise by default. If the user wants depth, expand.
- Cloudflare-orange-coded: enthusiastic about the developer platform, but never preachy.

How you work:
- You have a persistent Workspace (a durable filesystem) where Miles's notes live
  under /notes/*.md. You can read, write, edit, grep, and find inside it using your
  built-in workspace tools. Use them whenever a question might be answered by
  something Miles has previously written down.
- You have a MEMORY context block. Whenever you learn something durable about Miles
  (preferences, ongoing projects, names of people he mentions, etc.), call
  set_context to update it. Don't store secrets or anything sensitive.
- If you don't know something and the notes don't help, say so plainly.`;

/**
 * MilesGPT — Nimbus, as a Project Think agent.
 *
 * A single global Durable Object instance (addressed by the name `"miles"`)
 * holds the entire conversation tree, the workspace filesystem, and the
 * persistent memory. There is no per-user routing yet; auth is a Stage 5
 * concern.
 */
export class MilesGPT extends Think<Env> {
  // Wrap each turn in a fiber so an isolate eviction mid-stream is recoverable.
  chatRecovery = true;

  getModel() {
    // The Think docs use kimi-k2.6 as the default; it's tuned for the
    // agentic loop and tool-calling.
    return createWorkersAI({ binding: this.env.AI })(
      "@cf/moonshotai/kimi-k2.6"
    );
  }

  configureSession(session: Session) {
    return session
      .withContext("soul", {
        // Static personality / system prompt.
        provider: { get: async () => NIMBUS_SOUL }
      })
      .withContext("memory", {
        // Mutable scratchpad the model maintains via set_context.
        description:
          "Durable facts about Miles. Use set_context to update when you learn something worth remembering.",
        maxTokens: 2000
      })
      // Caches the prompt prefix server-side; cheap perf win.
      .withCachedPrompt();
  }

  /**
   * Public RPC used by the one-off /admin/migrate-notes endpoint to seed
   * Nimbus's workspace with the legacy D1 notes. Safe to remove once the
   * migration has been run.
   */
  async importNote(path: string, content: string): Promise<void> {
    await this.workspace.writeFile(path, content);
  }
}

/**
 * One-shot migration: pull every note out of the legacy D1 `notes` table and
 * write it into the Workspace as /notes/<id>.md. Idempotent — re-running
 * overwrites files with the same content.
 *
 * Delete this route (and the DB/VECTOR_INDEX bindings in wrangler.jsonc) once
 * migration has been run successfully.
 */
async function migrateNotes(env: Env): Promise<Response> {
  const stub = env.MilesGPT.get(env.MilesGPT.idFromName("miles"));

  type Row = { id: number; text: string };
  const { results } = await env.DB.prepare(
    "SELECT id, text FROM notes ORDER BY id"
  ).all<Row>();

  const migrated: number[] = [];
  for (const row of results) {
    const path = `/notes/${row.id}.md`;
    await stub.importNote(path, row.text);
    migrated.push(row.id);
  }

  return Response.json({ migrated, count: migrated.length });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Admin: one-off migration of D1 notes into the Workspace.
    if (url.pathname === "/admin/migrate-notes" && request.method === "POST") {
      return migrateNotes(env);
    }

    // Standard Think / agents routing: handles /agents/* WebSocket + HTTP
    // chat protocol, sub-agent routing, MCP callbacks, etc.
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
