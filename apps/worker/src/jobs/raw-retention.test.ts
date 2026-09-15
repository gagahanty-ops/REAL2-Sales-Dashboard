import { expect, it, vi } from "vitest";

import { runRawRetention } from "./raw-retention";

it("deletes only proven raw payloads older than ninety days", async () => {
  const deleteProvenBefore = vi.fn(async () => ({
    objectsDeleted: 2,
    eventsDeleted: 3,
    quarantineDeleted: 1,
    hashesPreserved: 6,
    normalizedRowsVerified: 6,
  }));
  const now = new Date("2026-09-15T09:00:00.000Z");

  const result = await runRawRetention({ deleteProvenBefore }, now);

  expect(deleteProvenBefore).toHaveBeenCalledWith(
    new Date("2026-06-17T09:00:00.000Z"),
  );
  expect(result).toMatchObject({
    deleted: 6,
    hashesPreserved: 6,
    normalizedRowsVerified: 6,
  });
});

it("fails closed when deletion proof counts do not match", async () => {
  const deleteProvenBefore = vi.fn(async () => ({
    objectsDeleted: 1,
    eventsDeleted: 0,
    quarantineDeleted: 0,
    hashesPreserved: 0,
    normalizedRowsVerified: 1,
  }));

  await expect(
    runRawRetention(
      { deleteProvenBefore },
      new Date("2026-09-15T09:00:00.000Z"),
    ),
  ).rejects.toMatchObject({ code: "E_DATA_QUALITY_BLOCK" });
});
