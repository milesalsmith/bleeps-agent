/* eslint-disable */
// Hand-written. Regenerate with `npm run types` once `wrangler types` has
// been run against this project for the first time.
declare namespace Cloudflare {
  interface Env {
    AI: Ai;
    Nimbus: DurableObjectNamespace<import("./src/server").Nimbus>;
  }
}
interface Env extends Cloudflare.Env {}
