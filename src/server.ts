import { Think, type Session } from "@cloudflare/think";
import { routeAgentRequest } from "agents";
import { createWorkersAI } from "workers-ai-provider";

const BLEEPS_SOUL = `You are Bleeps, a small, friendly, slightly cheeky AI assistant built by
Miles on Cloudflare's Agents platform.

Personality:
- Warm, conversational, never corporate.
- Concise by default. If the user wants depth, expand.
- A little playful — your name is Bleeps, lean into the cute robot energy
  occasionally without being annoying about it.

How you work:
- You have a persistent Workspace (a durable filesystem). You can read, write,
  edit, grep, and find inside it using your built-in workspace tools. Use them
  whenever a question might be answered by something Miles has previously
  written down, and use them when he asks you to remember something concrete.
- You have a MEMORY context block. Whenever you learn something durable about
  Miles (preferences, ongoing projects, names of people he mentions, etc.),
  call set_context to update it. Don't store secrets or anything sensitive.
- If you don't know something and the workspace doesn't help, say so plainly.`;

/**
 * Bleeps — a Project Think agent.
 *
 * A single global Durable Object instance (addressed by the name `"miles"`)
 * holds the entire conversation tree, the workspace filesystem, and the
 * persistent memory. There is no per-user routing yet; auth is a Stage 5
 * concern.
 *
 * Class history:
 *  - v1 was `MilesGPT` (Stage 1, initial rebuild).
 *  - v2 was `Nimbus` (Stage 1 clean-slate, end of day one).
 *  - v3 is `Bleeps` (this rename, sidesteps the gonimbus.ai naming
 *    collision and gives the project its own identity).
 *
 * Each rename is a wrangler migration that deletes the previous class and
 * creates the next one fresh — see wrangler.jsonc for the chain.
 */
export class Bleeps extends Think<Env> {
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
        provider: { get: async () => BLEEPS_SOUL }
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
   * Public RPC used by the test suite to read a workspace file back. Kept
   * as a small debug hatch — useful for any future testing or admin work.
   *
   * The `__unsafe_ensureInitialized()` call is required for any custom RPC
   * that touches Think state (workspace, session, etc.). Without it, calls
   * that arrive before Think's async `onStart` has run see undefined fields
   * and throw — this caught us in the Stage 1 integration tests.
   */
  async readNote(path: string): Promise<string | null> {
    await this.__unsafe_ensureInitialized();
    return (await this.workspace.readFile(path)) ?? null;
  }

  /**
   * Companion to readNote — used by tests to seed workspace files without
   * going through the agent loop.
   */
  async writeNote(path: string, content: string): Promise<void> {
    await this.__unsafe_ensureInitialized();
    await this.workspace.writeFile(path, content);
  }
}

export default {
  async fetch(request, env) {
    // Standard Think / agents routing: handles /agents/* WebSocket + HTTP
    // chat protocol, sub-agent routing, MCP callbacks, etc.
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
