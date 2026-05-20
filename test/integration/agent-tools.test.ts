import { describe, it, expect } from "vitest";
import { nimbusStub } from "./_helpers";

/**
 * Integration: the agent's Workspace actually works as a filesystem.
 *
 * Goes one level deeper than agent-boot.test.ts: rather than just proving
 * the DO doesn't crash on startup, we exercise the Workspace primitives
 * that Think will hand to the model as tools. If these break, Nimbus
 * won't be able to read or write files at all — regardless of what the
 * LLM decides to do.
 *
 * Still no AI calls — Workspace is plain SQLite under the hood.
 */
describe("Nimbus Workspace", () => {
  it("round-trips a simple file", async () => {
    const stub = nimbusStub();
    await stub.writeNote("/test/simple.md", "hello");
    expect(await stub.readNote("/test/simple.md")).toBe("hello");
  });

  it("returns null for a missing file (not an error)", async () => {
    const stub = nimbusStub();
    expect(await stub.readNote("/test/never-written.md")).toBeNull();
  });

  it("overwrites on second write to the same path", async () => {
    const stub = nimbusStub();
    await stub.writeNote("/test/overwrite.md", "v1");
    await stub.writeNote("/test/overwrite.md", "v2");
    expect(await stub.readNote("/test/overwrite.md")).toBe("v2");
  });

  it("preserves unicode + multiline content exactly", async () => {
    const stub = nimbusStub();
    const content = "line 1\nline 2\n\n— café 🦊 ✓\n";
    await stub.writeNote("/test/unicode.md", content);
    expect(await stub.readNote("/test/unicode.md")).toBe(content);
  });

  it("treats / nesting as path structure, not flat keys", async () => {
    // Workspace is a real filesystem; /a/b.md and /a/c.md should both be
    // writable without colliding.
    const stub = nimbusStub();
    await stub.writeNote("/nested/a.md", "A");
    await stub.writeNote("/nested/b.md", "B");
    expect(await stub.readNote("/nested/a.md")).toBe("A");
    expect(await stub.readNote("/nested/b.md")).toBe("B");
  });
});
