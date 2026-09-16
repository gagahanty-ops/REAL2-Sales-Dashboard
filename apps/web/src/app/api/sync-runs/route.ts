import {
  enqueueSyncWork,
  getCurrentSafeAmoConnectionStatus,
  getLatestSyncRun,
  isSyncAdvisoryLockBusy,
  listSyncRuns,
} from "@real2/db";
import { AppError, success } from "@real2/domain";
import { z } from "zod";

import { requireRole } from "../../../lib/auth/authorization";
import { requireUser } from "../../../lib/auth/require-user";
import { requireSameOrigin } from "../../../lib/http-security";
import { readJson, withRoute } from "../../../lib/http/route";
import { getDatabase } from "../../../lib/server/runtime";

const manualSyncSchema = z.strictObject({
  confirmRecent: z.boolean().optional().default(false),
});

export const GET = withRoute(async (request) => {
  requireRole(await requireUser(), ["admin", "head"]);
  const pageValue = new URL(request.url).searchParams.get("page") ?? "1";
  const page = Number(pageValue);
  return listSyncRuns(getDatabase(), { page, pageSize: 25 });
});

export const POST = withRoute(async (request, context) => {
  requireSameOrigin(request);
  const user = requireRole(await requireUser(), ["admin"]);
  const input = manualSyncSchema.parse(await readJson(request));
  const db = getDatabase();
  const latest = await getLatestSyncRun(db);
  if (
    latest &&
    Date.now() - latest.startedAt.getTime() < 60_000 &&
    !input.confirmRecent
  ) {
    throw new AppError(
      "E_CONFLICT",
      409,
      "Последняя синхронизация началась менее минуты назад",
    );
  }

  const connection = await getCurrentSafeAmoConnectionStatus(db);
  if (
    connection?.status === "active" &&
    (await isSyncAdvisoryLockBusy(db, connection.id))
  ) {
    throw new AppError("E_SYNC_LOCKED", 409);
  }

  const queued = await enqueueSyncWork(db, {
    traceId: context.traceId,
    kind: "manual",
    requestedBy: user.id,
  });
  return Response.json(
    success(
      {
        requestId: queued.id,
        traceId: queued.traceId,
        status: "queued",
      },
      { trace_id: context.traceId },
    ),
    { status: 202 },
  );
});
