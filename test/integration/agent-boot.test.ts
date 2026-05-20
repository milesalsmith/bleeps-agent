import { describe, it, expect } from "vitest";
import { bleepsStub } from "./_helpers";

/**
 * Smoke test: the Bleeps DO can boot.
 *
 * Think's `onStart` does a *lot* — initialises the Workspace, builds the
 * Session, runs `configureSession`, registers session change observers,
 * sets up resumable streams, etc. If any of that throws, this test fails
 * before the user ever loads the chat UI.
 *
 * We don't trigger a chat turn here (that would call Workers AI). We just
 * confirm the DO is reachable via RPC, which forces `onStart` to run.
 */
describe("Bleeps DO boot", () => {
  it("instantiates without throwing and answers RPC calls", async () => {
    const stub = bleepsStub();

    // Calling any RPC method forces the DO to wake up and run onStart.
    // readNote on a missing path is the cheapest no-op RPC we have.
    const result = await stub.readNote("/does-not-exist.md");
    expect(result).toBeNull();
  });

  it("writes are durable across two RPC calls (state survives)", async () => {
    const stub = bleepsStub();

    // Within a single test run the DO instance is the same, but this
    // confirms that the Workspace actually persists writes through Think's
    // initialization rather than being re-created on each call.
    await stub.writeNote("/test/boot-marker.txt", "hello from boot test");
    const read = await stub.readNote("/test/boot-marker.txt");
    expect(read).toBe("hello from boot test");
  });
});
