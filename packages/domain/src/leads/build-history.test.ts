import {
  SYNTHETIC_APPLICATION_STATUS_ID,
  SYNTHETIC_LEAD_ACCOUNT_ID,
  SYNTHETIC_OPEN_STATUS_ID,
  SYNTHETIC_WON_STATUS_ID,
} from "@real2/testkit";
import { describe, expect, it } from "vitest";

import { AppError } from "../errors.js";
import {
  HISTORY_ISSUE_SEVERITY,
  buildLeadHistory,
  extractHistoryEvent,
  type BuildLeadHistoryInput,
  type LeadHistoryEvent,
} from "./build-history.js";

const ACCOUNT_ID = SYNTHETIC_LEAD_ACCOUNT_ID;
const LEAD_ID = 4242;
const LATER_STATUS_ID = 779;

const STATUS_ORDER = [
  { statusId: SYNTHETIC_OPEN_STATUS_ID, sortOrder: 10 },
  { statusId: SYNTHETIC_APPLICATION_STATUS_ID, sortOrder: 20 },
  { statusId: LATER_STATUS_ID, sortOrder: 30 },
  { statusId: SYNTHETIC_WON_STATUS_ID, sortOrder: 40 },
] as const;

function stageEvent(
  amoEventId: string,
  occurredAt: string,
  toStatusId: number,
  fromStatusId: number | null = null,
): LeadHistoryEvent {
  return { kind: "stage", amoEventId, occurredAt, fromStatusId, toStatusId };
}

function responsibleEvent(
  amoEventId: string,
  occurredAt: string,
  toUserId: number | null,
  fromUserId: number | null = null,
): LeadHistoryEvent {
  return { kind: "responsible", amoEventId, occurredAt, fromUserId, toUserId };
}

function buildInput(
  overrides: Partial<BuildLeadHistoryInput> = {},
): BuildLeadHistoryInput {
  return {
    accountId: ACCOUNT_ID,
    amoLeadId: LEAD_ID,
    events: [],
    applicationStatusId: SYNTHETIC_APPLICATION_STATUS_ID,
    wonStatusId: SYNTHETIC_WON_STATUS_ID,
    currentStatusId: SYNTHETIC_OPEN_STATUS_ID,
    currentResponsibleUserId: 501,
    pipelineStatuses: STATUS_ORDER,
    snapshotAt: "2026-09-12T00:00:00.000Z",
    ...overrides,
  };
}

function codes(
  result: ReturnType<typeof buildLeadHistory>,
): readonly string[] {
  return result.issues.map((issue) => issue.code);
}

describe("buildLeadHistory ordering", () => {
  it("uses event ID as a stable tie-breaker and keeps first application/won times", () => {
    const result = buildLeadHistory(
      buildInput({
        currentStatusId: SYNTHETIC_WON_STATUS_ID,
        events: [
          stageEvent("evt-20", "2026-09-07T09:00:00Z", SYNTHETIC_APPLICATION_STATUS_ID),
          stageEvent("evt-10", "2026-09-07T09:00:00Z", SYNTHETIC_OPEN_STATUS_ID),
          stageEvent("evt-30", "2026-09-10T10:00:00Z", SYNTHETIC_WON_STATUS_ID),
          stageEvent("evt-40", "2026-09-11T10:00:00Z", SYNTHETIC_WON_STATUS_ID),
        ],
      }),
    );

    expect(result.milestones.applicationAt).toBe("2026-09-07T09:00:00.000Z");
    expect(result.milestones.wonAt).toBe("2026-09-10T10:00:00.000Z");
    expect(result.orderedEventIds).toEqual(["evt-10", "evt-20", "evt-30", "evt-40"]);
  });

  it("orders by the canonical instant, not by the spelling of the offset", () => {
    const result = buildLeadHistory(
      buildInput({
        events: [
          stageEvent("evt-b", "2026-09-07T09:00:00Z", SYNTHETIC_APPLICATION_STATUS_ID),
          stageEvent("evt-a", "2026-09-07T12:00:00+04:00", SYNTHETIC_OPEN_STATUS_ID),
        ],
      }),
    );

    expect(result.orderedEventIds).toEqual(["evt-a", "evt-b"]);
    expect(result.stageEvents[0]?.occurredAt).toBe("2026-09-07T08:00:00.000Z");
  });

  it("keeps the first copy of a repeated event ID and reports it once", () => {
    const result = buildLeadHistory(
      buildInput({
        events: [
          stageEvent("evt-1", "2026-09-07T09:00:00Z", SYNTHETIC_APPLICATION_STATUS_ID),
          stageEvent("evt-1", "2026-09-08T09:00:00Z", LATER_STATUS_ID),
          stageEvent("evt-1", "2026-09-09T09:00:00Z", LATER_STATUS_ID),
        ],
      }),
    );

    expect(result.orderedEventIds).toEqual(["evt-1"]);
    expect(result.stageEvents).toHaveLength(1);
    expect(result.stageEvents[0]?.toStatusId).toBe(SYNTHETIC_APPLICATION_STATUS_ID);
    expect(codes(result).filter((code) => code === "duplicate_event")).toHaveLength(1);
  });

  it("separates stage and responsible timelines while ordering them together", () => {
    const result = buildLeadHistory(
      buildInput({
        events: [
          responsibleEvent("evt-r1", "2026-09-06T09:00:00Z", 601, 600),
          stageEvent("evt-s1", "2026-09-07T09:00:00Z", SYNTHETIC_APPLICATION_STATUS_ID),
        ],
      }),
    );

    expect(result.orderedEventIds).toEqual(["evt-r1", "evt-s1"]);
    expect(result.stageEvents.map((event) => event.amoEventId)).toEqual(["evt-s1"]);
    expect(result.responsibleEvents.map((event) => event.amoEventId)).toEqual(["evt-r1"]);
  });
});

describe("buildLeadHistory milestones", () => {
  it("does not invent a milestone that no event proves", () => {
    const result = buildLeadHistory(buildInput());

    expect(result.milestones).toEqual({
      applicationAt: null,
      applicationResponsibleUserId: null,
      wonAt: null,
      wonResponsibleUserId: null,
      currentlyWon: false,
    });
    expect(codes(result)).toEqual([]);
  });

  it("marks a returned lead as not currently won but keeps the won time", () => {
    const result = buildLeadHistory(
      buildInput({
        currentStatusId: SYNTHETIC_OPEN_STATUS_ID,
        events: [
          stageEvent("evt-1", "2026-09-07T09:00:00Z", SYNTHETIC_APPLICATION_STATUS_ID),
          stageEvent("evt-2", "2026-09-08T09:00:00Z", SYNTHETIC_WON_STATUS_ID),
          stageEvent(
            "evt-3",
            "2026-09-09T09:00:00Z",
            SYNTHETIC_OPEN_STATUS_ID,
            SYNTHETIC_WON_STATUS_ID,
          ),
        ],
      }),
    );

    expect(result.milestones.wonAt).toBe("2026-09-08T09:00:00.000Z");
    expect(result.milestones.currentlyWon).toBe(false);
  });

  it("re-entering won keeps the first won time", () => {
    const result = buildLeadHistory(
      buildInput({
        currentStatusId: SYNTHETIC_WON_STATUS_ID,
        events: [
          stageEvent("evt-1", "2026-09-07T09:00:00Z", SYNTHETIC_APPLICATION_STATUS_ID),
          stageEvent("evt-2", "2026-09-08T09:00:00Z", SYNTHETIC_WON_STATUS_ID),
          stageEvent(
            "evt-3",
            "2026-09-09T09:00:00Z",
            SYNTHETIC_OPEN_STATUS_ID,
            SYNTHETIC_WON_STATUS_ID,
          ),
          stageEvent(
            "evt-4",
            "2026-09-10T09:00:00Z",
            SYNTHETIC_WON_STATUS_ID,
            SYNTHETIC_OPEN_STATUS_ID,
          ),
        ],
      }),
    );

    expect(result.milestones.wonAt).toBe("2026-09-08T09:00:00.000Z");
    expect(result.milestones.currentlyWon).toBe(true);
  });

  it("opens missing_stage_history when the lead is won without a won event", () => {
    const result = buildLeadHistory(
      buildInput({
        currentStatusId: SYNTHETIC_WON_STATUS_ID,
        events: [
          stageEvent("evt-1", "2026-09-07T09:00:00Z", SYNTHETIC_APPLICATION_STATUS_ID),
        ],
      }),
    );

    expect(result.milestones.wonAt).toBeNull();
    expect(result.milestones.currentlyWon).toBe(true);
    expect(codes(result)).toContain("missing_stage_history");
    expect(
      result.issues.find((issue) => issue.code === "missing_stage_history")?.severity,
    ).toBe("blocking");
  });

  it("opens missing_stage_history when the current status is past the application status", () => {
    const result = buildLeadHistory(
      buildInput({ currentStatusId: LATER_STATUS_ID }),
    );

    expect(result.milestones.applicationAt).toBeNull();
    expect(codes(result)).toContain("missing_stage_history");
  });

  it("stays silent when the lead simply has not reached the application status", () => {
    const result = buildLeadHistory(
      buildInput({ currentStatusId: SYNTHETIC_OPEN_STATUS_ID }),
    );

    expect(codes(result)).not.toContain("missing_stage_history");
  });

  it("treats an unknown current status as not implying any milestone", () => {
    const result = buildLeadHistory(buildInput({ currentStatusId: 999_001 }));

    expect(codes(result)).not.toContain("missing_stage_history");
  });
});

describe("buildLeadHistory responsibility", () => {
  it("reads the responsible at creation from the earliest handover", () => {
    const result = buildLeadHistory(
      buildInput({
        currentResponsibleUserId: 603,
        events: [
          responsibleEvent("evt-r1", "2026-09-06T09:00:00Z", 602, 601),
          responsibleEvent("evt-r2", "2026-09-09T09:00:00Z", 603, 602),
        ],
      }),
    );

    expect(result.responsibility.atCreation).toBe(601);
    expect(result.responsibility.current).toBe(603);
  });

  it("falls back to the current responsible when no handover exists", () => {
    const result = buildLeadHistory(buildInput({ currentResponsibleUserId: 777 }));

    expect(result.responsibility).toEqual({
      atCreation: 777,
      atApplication: null,
      atWon: null,
      current: 777,
    });
  });

  it("captures the responsible in effect at each milestone", () => {
    const result = buildLeadHistory(
      buildInput({
        currentStatusId: SYNTHETIC_WON_STATUS_ID,
        currentResponsibleUserId: 603,
        events: [
          responsibleEvent("evt-r1", "2026-09-06T09:00:00Z", 602, 601),
          stageEvent("evt-s1", "2026-09-07T09:00:00Z", SYNTHETIC_APPLICATION_STATUS_ID),
          responsibleEvent("evt-r2", "2026-09-08T09:00:00Z", 603, 602),
          stageEvent("evt-s2", "2026-09-09T09:00:00Z", SYNTHETIC_WON_STATUS_ID),
        ],
      }),
    );

    expect(result.milestones.applicationResponsibleUserId).toBe(602);
    expect(result.milestones.wonResponsibleUserId).toBe(603);
    expect(result.responsibility.atApplication).toBe(602);
    expect(result.responsibility.atWon).toBe(603);
  });

  it("stamps every stage event with the responsible in effect at that instant", () => {
    const result = buildLeadHistory(
      buildInput({
        currentResponsibleUserId: 603,
        events: [
          stageEvent("evt-s1", "2026-09-06T09:00:00Z", SYNTHETIC_OPEN_STATUS_ID),
          responsibleEvent("evt-r1", "2026-09-07T09:00:00Z", 602, 601),
          stageEvent("evt-s2", "2026-09-08T09:00:00Z", SYNTHETIC_APPLICATION_STATUS_ID),
        ],
      }),
    );

    expect(result.stageEvents.map((event) => event.responsibleUserId)).toEqual([601, 602]);
  });

  it("uses the handover that happened at the same instant as the stage change", () => {
    const result = buildLeadHistory(
      buildInput({
        events: [
          responsibleEvent("evt-a", "2026-09-07T09:00:00Z", 602, 601),
          stageEvent("evt-b", "2026-09-07T09:00:00Z", SYNTHETIC_APPLICATION_STATUS_ID),
        ],
      }),
    );

    expect(result.milestones.applicationResponsibleUserId).toBe(602);
  });

  it("keeps an unassigned lead instead of inventing a responsible", () => {
    const result = buildLeadHistory(
      buildInput({
        currentResponsibleUserId: null,
        events: [responsibleEvent("evt-r1", "2026-09-06T09:00:00Z", null, null)],
      }),
    );

    expect(result.responsibility.atCreation).toBeNull();
    expect(result.responsibility.current).toBeNull();
  });
});

describe("buildLeadHistory stage stays", () => {
  it("measures closed stays between events and the open stay against the snapshot", () => {
    const result = buildLeadHistory(
      buildInput({
        currentStatusId: SYNTHETIC_APPLICATION_STATUS_ID,
        snapshotAt: "2026-09-09T09:00:00Z",
        events: [
          stageEvent("evt-1", "2026-09-07T09:00:00Z", SYNTHETIC_OPEN_STATUS_ID),
          stageEvent(
            "evt-2",
            "2026-09-08T09:00:00Z",
            SYNTHETIC_APPLICATION_STATUS_ID,
            SYNTHETIC_OPEN_STATUS_ID,
          ),
        ],
      }),
    );

    expect(result.stageStays).toEqual([
      {
        statusId: SYNTHETIC_OPEN_STATUS_ID,
        enteredAt: "2026-09-07T09:00:00.000Z",
        exitedAt: "2026-09-08T09:00:00.000Z",
        durationSeconds: 86_400,
        ageSeconds: null,
      },
      {
        statusId: SYNTHETIC_APPLICATION_STATUS_ID,
        enteredAt: "2026-09-08T09:00:00.000Z",
        exitedAt: null,
        durationSeconds: null,
        ageSeconds: 86_400,
      },
    ]);
  });

  it("does not invent a current stage age without any stage event", () => {
    const result = buildLeadHistory(buildInput());

    expect(result.stageStays).toEqual([]);
  });

  it("never reports a negative age when the snapshot precedes the last event", () => {
    const result = buildLeadHistory(
      buildInput({
        snapshotAt: "2026-09-07T00:00:00Z",
        events: [stageEvent("evt-1", "2026-09-07T09:00:00Z", SYNTHETIC_OPEN_STATUS_ID)],
      }),
    );

    expect(result.stageStays[0]?.ageSeconds).toBe(0);
  });
});

describe("buildLeadHistory conflicts and invalid input", () => {
  it("reports a broken chain as stage_history_conflict but keeps the order", () => {
    const result = buildLeadHistory(
      buildInput({
        events: [
          stageEvent("evt-1", "2026-09-07T09:00:00Z", SYNTHETIC_OPEN_STATUS_ID),
          stageEvent(
            "evt-2",
            "2026-09-08T09:00:00Z",
            SYNTHETIC_APPLICATION_STATUS_ID,
            LATER_STATUS_ID,
          ),
        ],
      }),
    );

    expect(result.orderedEventIds).toEqual(["evt-1", "evt-2"]);
    expect(codes(result)).toContain("stage_history_conflict");
    expect(
      result.issues.find((issue) => issue.code === "stage_history_conflict")?.severity,
    ).toBe("warning");
  });

  it("reports two different moves at one instant as a conflict", () => {
    const result = buildLeadHistory(
      buildInput({
        events: [
          stageEvent("evt-1", "2026-09-07T09:00:00Z", SYNTHETIC_APPLICATION_STATUS_ID),
          stageEvent("evt-2", "2026-09-07T09:00:00Z", LATER_STATUS_ID),
        ],
      }),
    );

    expect(codes(result).filter((code) => code === "stage_history_conflict")).toHaveLength(1);
  });

  it("drops an event whose instant cannot be parsed and opens a blocking issue", () => {
    const result = buildLeadHistory(
      buildInput({
        events: [
          stageEvent("evt-bad", "not-an-instant", SYNTHETIC_APPLICATION_STATUS_ID),
          stageEvent("evt-ok", "2026-09-07T09:00:00Z", SYNTHETIC_OPEN_STATUS_ID),
        ],
      }),
    );

    expect(result.orderedEventIds).toEqual(["evt-ok"]);
    expect(codes(result)).toContain("invalid_event_time");
    expect(HISTORY_ISSUE_SEVERITY.invalid_event_time).toBe("blocking");
  });

  it("carries the lead identity into every issue and never leaks source text", () => {
    const result = buildLeadHistory(
      buildInput({
        currentStatusId: SYNTHETIC_WON_STATUS_ID,
        events: [stageEvent("evt-bad", "not-an-instant", SYNTHETIC_WON_STATUS_ID)],
      }),
    );

    for (const issue of result.issues) {
      expect(issue.accountId).toBe(ACCOUNT_ID);
      expect(issue.amoLeadId).toBe(LEAD_ID);
      expect(JSON.stringify(issue.safeDetails)).not.toContain("not-an-instant");
    }
  });

  it("returns issues sorted by code so repeated runs are byte-equivalent", () => {
    const result = buildLeadHistory(
      buildInput({
        currentStatusId: SYNTHETIC_WON_STATUS_ID,
        events: [
          stageEvent("evt-1", "2026-09-07T09:00:00Z", SYNTHETIC_APPLICATION_STATUS_ID),
          stageEvent("evt-1", "2026-09-07T10:00:00Z", LATER_STATUS_ID),
          stageEvent("evt-2", "nope", LATER_STATUS_ID),
        ],
      }),
    );

    expect(codes(result)).toEqual([...codes(result)].sort());
  });

  it("rejects an invalid identity instead of guessing", () => {
    expect(() => buildLeadHistory(buildInput({ amoLeadId: 0 }))).toThrow(AppError);
    expect(() => buildLeadHistory(buildInput({ snapshotAt: "nope" }))).toThrow(AppError);
    expect(() =>
      buildLeadHistory(buildInput({ applicationStatusId: SYNTHETIC_WON_STATUS_ID })),
    ).toThrow(AppError);
  });
});

describe("extractHistoryEvent", () => {
  const baseEvent = {
    amoEventId: "evt-1",
    eventType: "lead_status_changed",
    occurredAt: "2026-09-07T09:00:00.000Z",
    payload: {
      id: "evt-1",
      type: "lead_status_changed",
      entity_id: LEAD_ID,
      entity_type: "lead",
      value_before: [{ lead_status: { id: SYNTHETIC_OPEN_STATUS_ID } }],
      value_after: [{ lead_status: { id: SYNTHETIC_APPLICATION_STATUS_ID } }],
    },
  };

  it("reads a status change with both ends of the move", () => {
    expect(extractHistoryEvent(baseEvent)).toEqual({
      status: "event",
      event: {
        kind: "stage",
        amoEventId: "evt-1",
        occurredAt: "2026-09-07T09:00:00.000Z",
        fromStatusId: SYNTHETIC_OPEN_STATUS_ID,
        toStatusId: SYNTHETIC_APPLICATION_STATUS_ID,
      },
    });
  });

  it("accepts a status change that has no previous status", () => {
    const extraction = extractHistoryEvent({
      ...baseEvent,
      payload: { ...baseEvent.payload, value_before: [] },
    });

    expect(extraction).toEqual({
      status: "event",
      event: {
        kind: "stage",
        amoEventId: "evt-1",
        occurredAt: "2026-09-07T09:00:00.000Z",
        fromStatusId: null,
        toStatusId: SYNTHETIC_APPLICATION_STATUS_ID,
      },
    });
  });

  it("reads a responsible handover", () => {
    const extraction = extractHistoryEvent({
      amoEventId: "evt-2",
      eventType: "entity_responsible_changed",
      occurredAt: "2026-09-08T09:00:00.000Z",
      payload: {
        entity_type: "lead",
        value_before: [{ responsible_user: { id: 601 } }],
        value_after: [{ responsible_user: { id: 602 } }],
      },
    });

    expect(extraction).toEqual({
      status: "event",
      event: {
        kind: "responsible",
        amoEventId: "evt-2",
        occurredAt: "2026-09-08T09:00:00.000Z",
        fromUserId: 601,
        toUserId: 602,
      },
    });
  });

  it("ignores event types that carry no timeline meaning", () => {
    expect(
      extractHistoryEvent({
        amoEventId: "evt-3",
        eventType: "lead_added",
        occurredAt: "2026-09-08T09:00:00.000Z",
        payload: { entity_type: "lead" },
      }),
    ).toEqual({ status: "ignored" });
  });

  it("reports a history event whose payload cannot be read", () => {
    for (const payload of [
      null,
      { entity_type: "lead", value_after: [] },
      { entity_type: "lead", value_after: [{ lead_status: { id: 0 } }] },
      { entity_type: "lead", value_after: [{ lead_status: { id: "770" } }] },
      { entity_type: "lead", value_after: "770" },
    ]) {
      expect(extractHistoryEvent({ ...baseEvent, payload })).toEqual({
        status: "malformed",
      });
    }
  });

  it("ignores a history event that belongs to another entity kind", () => {
    expect(
      extractHistoryEvent({
        ...baseEvent,
        payload: { ...baseEvent.payload, entity_type: "contact" },
      }),
    ).toEqual({ status: "ignored" });
  });

  it("treats a missing responsible as an unassigned lead, not as malformed", () => {
    expect(
      extractHistoryEvent({
        amoEventId: "evt-4",
        eventType: "entity_responsible_changed",
        occurredAt: "2026-09-08T09:00:00.000Z",
        payload: { entity_type: "lead", value_before: [], value_after: [] },
      }),
    ).toEqual({
      status: "event",
      event: {
        kind: "responsible",
        amoEventId: "evt-4",
        occurredAt: "2026-09-08T09:00:00.000Z",
        fromUserId: null,
        toUserId: null,
      },
    });
  });
});
