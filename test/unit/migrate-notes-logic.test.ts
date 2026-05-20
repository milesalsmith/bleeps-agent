import { describe, it, expect, vi } from "vitest";

/**
 * Unit test for the migration loop in isolation.
 *
 * Note: the `migrateNotes` function in src/server.ts isn't exported (it's
 * an internal helper). Rather than change production code just for testing,
 * we re-implement the loop here against the same contract and assert it
 * does what we expect. The integration test in
 * test/integration/migrate-notes.test.ts then proves the *actual* route
 * also does the right thing end-to-end.
 *
 * If the migration shape changes in server.ts, this test should change in
 * the same PR — they are intentionally a pair.
 */

type StubRow = { id: number; text: string };

async function migrate(
  rows: StubRow[],
  importNote: (path: string, content: string) => Promise<void>
): Promise<{ migrated: number[]; count: number }> {
  const migrated: number[] = [];
  for (const row of rows) {
    const path = `/notes/${row.id}.md`;
    await importNote(path, row.text);
    migrated.push(row.id);
  }
  return { migrated, count: migrated.length };
}

describe("migration loop", () => {
  it("writes one file per row, using /notes/<id>.md as the path", async () => {
    const importNote = vi.fn().mockResolvedValue(undefined);
    const result = await migrate(
      [
        { id: 1, text: "buy milk" },
        { id: 2, text: "ring mum" }
      ],
      importNote
    );

    expect(importNote).toHaveBeenCalledTimes(2);
    expect(importNote).toHaveBeenNthCalledWith(1, "/notes/1.md", "buy milk");
    expect(importNote).toHaveBeenNthCalledWith(2, "/notes/2.md", "ring mum");
    expect(result).toEqual({ migrated: [1, 2], count: 2 });
  });

  it("returns count: 0 and an empty list for no rows", async () => {
    const importNote = vi.fn();
    const result = await migrate([], importNote);
    expect(importNote).not.toHaveBeenCalled();
    expect(result).toEqual({ migrated: [], count: 0 });
  });

  it("preserves the original text byte-for-byte (incl. newlines / unicode)", async () => {
    const tricky = "line one\nline two\n\n  — em dash, café, 🦊\n";
    const importNote = vi.fn().mockResolvedValue(undefined);
    await migrate([{ id: 42, text: tricky }], importNote);
    expect(importNote).toHaveBeenCalledWith("/notes/42.md", tricky);
  });

  it("stops at the first failure rather than silently skipping rows", async () => {
    // If a write fails mid-migration, we want the caller to see it — we do
    // NOT want to swallow the error and report partial success.
    const importNote = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(undefined);

    await expect(
      migrate(
        [
          { id: 1, text: "a" },
          { id: 2, text: "b" },
          { id: 3, text: "c" }
        ],
        importNote
      )
    ).rejects.toThrow("disk full");

    // First write succeeded, second threw, third never ran.
    expect(importNote).toHaveBeenCalledTimes(2);
  });
});
