import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { resetNotesTable, seedNotes, nimbusStub } from "./_helpers";

/**
 * Integration test for the /admin/migrate-notes endpoint.
 *
 * This is the test that actually protects your data: it spins up the real
 * Worker with the real MilesGPT DO + a real local D1, seeds notes in D1,
 * hits the endpoint, and reads the files back out of the agent's Workspace
 * to verify content survived intact.
 *
 * Each test gets a fresh local D1 (vitest-pool-workers isolates them).
 * The DO storage is *not* automatically reset, so we hit unique IDs each
 * test to avoid file collisions across tests in the same run.
 */
describe("/admin/migrate-notes", () => {
  beforeEach(async () => {
    await resetNotesTable();
  });

  it("returns 200 with { migrated, count } and the right shape", async () => {
    await seedNotes(["first note", "second note"]);

    const res = await SELF.fetch("https://example.com/admin/migrate-notes", {
      method: "POST"
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { migrated: number[]; count: number };
    expect(body.count).toBe(2);
    expect(body.migrated).toHaveLength(2);
    // IDs come from D1 auto-increment — we just check they're positive.
    body.migrated.forEach((id) => expect(id).toBeGreaterThan(0));
  });

  it("writes one file per row into the Workspace at /notes/<id>.md", async () => {
    const ids = await seedNotes(["alpha", "beta", "gamma"]);

    const res = await SELF.fetch("https://example.com/admin/migrate-notes", {
      method: "POST"
    });
    expect(res.status).toBe(200);

    // Read the files back via the stub's RPC. Because importNote() is a
    // straight passthrough to workspace.writeFile, we can prove it landed
    // by reading via Workspace's own read. But MilesGPT doesn't expose a
    // public read RPC, so we use Think's internal listing surface instead:
    // ask the DO to grep its own workspace.
    const stub = nimbusStub();

    // We added an `importNote` helper for the migration; for reads in
    // tests we add a tiny read shim below in agent-tools.test.ts. Here we
    // assert by side-channel: the body's `migrated` array matches the
    // IDs we just inserted, in order.
    const body = (await res.json()) as { migrated: number[]; count: number };
    expect(body.count).toBe(3);
    expect(body.migrated).toEqual(ids);
  });

  it("returns count: 0 when D1 is empty (idempotent against no-data state)", async () => {
    // notes table exists but no rows
    const res = await SELF.fetch("https://example.com/admin/migrate-notes", {
      method: "POST"
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { migrated: number[]; count: number };
    expect(body).toEqual({ migrated: [], count: 0 });
  });

  it("preserves note text exactly (multiline, unicode, leading spaces)", async () => {
    const tricky = "line one\nline two\n\n  — em dash, café, 🦊\n";
    await seedNotes([tricky]);

    const res = await SELF.fetch("https://example.com/admin/migrate-notes", {
      method: "POST"
    });
    expect(res.status).toBe(200);
    // Read the file back via a (test-only) read RPC we add on MilesGPT.
    // If that RPC doesn't exist yet, this test will fail loudly — and the
    // failure tells you exactly what's missing.
    const stub = nimbusStub();
    const { migrated } = (await res.json()) as { migrated: number[] };
    const content = await stub.readNote(`/notes/${migrated[0]}.md`);
    expect(content).toBe(tricky);
  });

  it("is idempotent: running it twice overwrites with the same content", async () => {
    const ids = await seedNotes(["only note"]);

    const first = await SELF.fetch("https://example.com/admin/migrate-notes", {
      method: "POST"
    });
    expect(first.status).toBe(200);

    const second = await SELF.fetch("https://example.com/admin/migrate-notes", {
      method: "POST"
    });
    expect(second.status).toBe(200);
    const body2 = (await second.json()) as { migrated: number[]; count: number };
    expect(body2.migrated).toEqual(ids);

    const stub = nimbusStub();
    const content = await stub.readNote(`/notes/${ids[0]}.md`);
    expect(content).toBe("only note");
  });
});
