import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * Vitest config for the Stage 1 testing framework.
 *
 * - Unit tests live in `test/unit/**` and run in plain Node — they're for
 *   pure-logic helpers and shouldn't pay the workerd startup cost.
 * - Integration tests live in `test/integration/**` and run inside a real
 *   `workerd` via @cloudflare/vitest-pool-workers, with our DO + SQLite +
 *   D1 + AI bindings from wrangler.jsonc.
 *
 * Workers AI is faked by default. To opt into the real binding, set
 * USE_REAL_AI=1 and run `npm run test:live`.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // Stub the AI binding so the agent loop never burns model credits
        // during tests. The fake mirrors the shape of the workers-ai
        // provider's response well enough for the unit/integration tests
        // we care about; tests that need real AI run via `test:live`.
        bindings: {},
        compatibilityFlags: ["nodejs_compat"]
      }
    })
  ],
  test: {
    include: ["test/**/*.test.ts"],
    // Keep unit + integration separate so it's obvious where a failure is.
    // Both still run under the Workers pool — that's fine for unit tests
    // too, and avoids the maintenance overhead of two configs.
    testTimeout: 30_000,
    // The workerd-backed pool can hold open connections (MCP-related)
    // after the tests complete. Force-exit avoids the 10s hang at the
    // end of every run.
    teardownTimeout: 2_000
  }
});
