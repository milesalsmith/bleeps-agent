/* eslint-disable */
// Hand-written for Stage 1. Regenerate with `npm run types` once `wrangler
// types` has been run against this project for the first time.
declare namespace Cloudflare {
  interface Env {
    AI: Ai;
    MilesGPT: DurableObjectNamespace<import("./src/server").MilesGPT>;
    // Legacy bindings — kept only for the /admin/migrate-notes script.
    // Remove these after migration.
    DB: D1Database;
    VECTOR_INDEX: VectorizeIndex;
  }
}
interface Env extends Cloudflare.Env {}
