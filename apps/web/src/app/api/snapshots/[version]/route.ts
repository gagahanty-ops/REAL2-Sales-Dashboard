import {
  getCurrentSnapshot,
  getSnapshotByVersion,
  listSnapshotCells,
  validateSnapshot,
} from "@real2/db";
import { AppError } from "@real2/domain";
import { z } from "zod";

import { requireRole } from "../../../../lib/auth/authorization";
import { requireUser } from "../../../../lib/auth/require-user";
import { withRoute } from "../../../../lib/http/route";
import { getDatabase } from "../../../../lib/server/runtime";

type SnapshotRouteContext = { params: Promise<{ version: string }> };

const versionSchema = z.union([
  z.literal("current"),
  z.string().regex(/^[1-9]\d{0,14}$/),
]);

export const GET = withRoute<unknown, SnapshotRouteContext>(async (
  _request,
  context,
) => {
  requireRole(await requireUser(), ["admin", "head"]);
  if (!context.routeContext) throw new AppError("E_NOT_FOUND", 404);
  const { version } = await context.routeContext.params;
  const requested = versionSchema.parse(version);
  const db = getDatabase();
  const snapshot = requested === "current"
    ? await getCurrentSnapshot(db)
    : await getSnapshotByVersion(db, Number(requested));
  if (!snapshot) throw new AppError("E_NOT_FOUND", 404);
  const [cells, validation] = await Promise.all([
    listSnapshotCells(db, snapshot.id),
    validateSnapshot(db, snapshot.id),
  ]);
  return { snapshot, totals: cells, validation };
});
