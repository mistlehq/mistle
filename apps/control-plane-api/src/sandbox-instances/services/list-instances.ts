import {
  DataPlaneSandboxInstancesClientError,
  type DataPlaneSandboxInstancesClient,
  type ListSandboxInstancesResponse,
} from "@mistle/data-plane-internal-client";
import { getControlPlaneDatabaseSchema, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { and, eq, ilike, or } from "drizzle-orm";

import { resolveUserDisplayName } from "../../lib/user-display-name.js";
import { escapeLikePattern } from "../../organizations/services/directory-shared.js";
import { SandboxInstancesBadRequestCodes, SandboxInstancesBadRequestError } from "../errors.js";
import type { ListSandboxInstancesResult } from "./types.js";

const MAX_TRIGGER_RUN_FILTER_IDS = 5_000;

function createEmptyListResult(): ListSandboxInstancesResult {
  return {
    items: [],
    nextPage: null,
    previousPage: null,
    totalResults: 0,
  };
}

function assertUserVisibleSandboxSource(
  source: ListSandboxInstancesResponse["items"][number]["source"],
): "dashboard" | "webhook" | "schedule" {
  if (source === "system") {
    throw new Error("Internal snapshot sandbox instances must not be exposed to control-plane.");
  }

  return source;
}

async function resolveStartedByNames(
  db: ControlPlaneDatabase,
  input: {
    organizationId: string;
    items: ListSandboxInstancesResponse["items"];
  },
): Promise<Map<string, string>> {
  const startedByUserIds = [
    ...new Set(
      input.items
        .map((item) => item.startedBy)
        .filter((starter) => starter.kind === "user")
        .map((starter) => starter.id),
    ),
  ];
  const startedByTriggerRunIds = [
    ...new Set(
      input.items
        .map((item) => item.startedBy)
        .filter((starter) => starter.kind === "system")
        .map((starter) => starter.id),
    ),
  ];

  const startedByNames = new Map<string, string>();

  if (startedByUserIds.length > 0) {
    const users = await db.query.users.findMany({
      columns: {
        id: true,
        name: true,
        email: true,
      },
      where: (table, { inArray }) => inArray(table.id, startedByUserIds),
    });

    for (const user of users) {
      startedByNames.set(
        user.id,
        resolveUserDisplayName({
          name: user.name,
          email: user.email,
        }),
      );
    }
  }

  if (startedByTriggerRunIds.length > 0) {
    const triggerRuns = await db.query.triggerRuns.findMany({
      columns: {
        id: true,
        triggerId: true,
      },
      where: (table, { inArray }) => inArray(table.id, startedByTriggerRunIds),
    });
    const triggerIds = [...new Set(triggerRuns.map((triggerRun) => triggerRun.triggerId))];

    if (triggerIds.length > 0) {
      const triggers = await db.query.triggers.findMany({
        columns: {
          id: true,
          name: true,
        },
        where: (table, { and, eq, inArray }) =>
          and(eq(table.organizationId, input.organizationId), inArray(table.id, triggerIds)),
      });
      const triggerNamesById = new Map(triggers.map((trigger) => [trigger.id, trigger.name]));

      for (const triggerRun of triggerRuns) {
        const triggerName = triggerNamesById.get(triggerRun.triggerId);
        if (triggerName !== undefined) {
          startedByNames.set(triggerRun.id, triggerName);
        }
      }
    }
  }

  return startedByNames;
}

async function resolveSandboxProfileDisplayNames(
  db: ControlPlaneDatabase,
  input: {
    organizationId: string;
    items: ListSandboxInstancesResponse["items"];
  },
): Promise<Map<string, string>> {
  const sandboxProfileIds = [...new Set(input.items.map((item) => item.sandboxProfileId))];
  if (sandboxProfileIds.length === 0) {
    return new Map();
  }

  const sandboxProfiles = await db.query.sandboxProfiles.findMany({
    columns: {
      id: true,
      displayName: true,
    },
    where: (table, { and, eq, inArray }) =>
      and(eq(table.organizationId, input.organizationId), inArray(table.id, sandboxProfileIds)),
  });

  return new Map(
    sandboxProfiles.map((sandboxProfile) => [sandboxProfile.id, sandboxProfile.displayName]),
  );
}

type ListInstancesStartedByFilter =
  | {
      startedByKind: "system" | "user";
      startedById: string;
    }
  | {
      startedByKind?: undefined;
      startedById?: undefined;
    };

type ListInstancesFilterInput = {
  userId?: string;
  search?: string;
  owner?: "me";
  startedFrom?: "manual" | "trigger" | "event" | "schedule";
  triggerId?: string;
};

async function resolveMatchingSandboxProfileIds(
  db: ControlPlaneDatabase,
  input: {
    organizationId: string;
    search: string;
  },
): Promise<string[]> {
  const tables = getControlPlaneDatabaseSchema(db);
  const searchPattern = `%${escapeLikePattern(input.search)}%`;
  const rows = await db
    .select({ id: tables.sandboxProfiles.id })
    .from(tables.sandboxProfiles)
    .where(
      and(
        eq(tables.sandboxProfiles.organizationId, input.organizationId),
        or(
          ilike(tables.sandboxProfiles.id, searchPattern),
          ilike(tables.sandboxProfiles.displayName, searchPattern),
        ),
      ),
    );

  return rows.map((row) => row.id);
}

async function resolveMatchingUserIds(
  db: ControlPlaneDatabase,
  input: {
    search: string;
  },
): Promise<string[]> {
  const tables = getControlPlaneDatabaseSchema(db);
  const searchPattern = `%${escapeLikePattern(input.search)}%`;
  const rows = await db
    .select({ id: tables.users.id })
    .from(tables.users)
    .where(or(ilike(tables.users.name, searchPattern), ilike(tables.users.email, searchPattern)));

  return rows.map((row) => row.id);
}

async function resolveMatchingTriggerRunIds(
  db: ControlPlaneDatabase,
  input:
    | {
        kind: "search";
        organizationId: string;
        search: string;
      }
    | {
        kind: "trigger";
        organizationId: string;
        triggerId: string;
      },
): Promise<string[]> {
  const tables = getControlPlaneDatabaseSchema(db);
  const triggerRows =
    input.kind === "search"
      ? await db
          .select({ id: tables.triggers.id })
          .from(tables.triggers)
          .where(
            and(
              eq(tables.triggers.organizationId, input.organizationId),
              ilike(tables.triggers.name, `%${escapeLikePattern(input.search)}%`),
            ),
          )
      : await db
          .select({ id: tables.triggers.id })
          .from(tables.triggers)
          .where(
            and(
              eq(tables.triggers.organizationId, input.organizationId),
              eq(tables.triggers.id, input.triggerId),
            ),
          );

  const triggerIds = triggerRows.map((row) => row.id);
  if (triggerIds.length === 0) {
    return [];
  }

  const triggerRuns = await db.query.triggerRuns.findMany({
    columns: {
      id: true,
    },
    where: (table, { inArray }) => inArray(table.triggerId, triggerIds),
  });

  return triggerRuns.map((triggerRun) => triggerRun.id);
}

function assertTriggerRunFilterWithinBound(input: {
  kind: "search" | "trigger";
  triggerRunIds: string[] | undefined;
}): void {
  if (
    input.triggerRunIds === undefined ||
    input.triggerRunIds.length <= MAX_TRIGGER_RUN_FILTER_IDS
  ) {
    return;
  }

  const filterLabel = input.kind === "trigger" ? "trigger" : "search";
  throw new SandboxInstancesBadRequestError(
    SandboxInstancesBadRequestCodes.INVALID_LIST_INSTANCES_INPUT,
    `The ${filterLabel} filter matches too many trigger runs. Narrow the filter before listing sessions.`,
  );
}

export async function listInstances(
  {
    db,
    dataPlaneClient,
  }: {
    db: ControlPlaneDatabase;
    dataPlaneClient: DataPlaneSandboxInstancesClient;
  },
  input: {
    organizationId: string;
    limit?: number;
    after?: string;
    before?: string;
  } & ListInstancesStartedByFilter &
    ListInstancesFilterInput,
): Promise<ListSandboxInstancesResult> {
  try {
    if (input.owner === "me" && input.userId === undefined) {
      throw new SandboxInstancesBadRequestError(
        SandboxInstancesBadRequestCodes.INVALID_LIST_INSTANCES_INPUT,
        "The owner=me filter requires a user-authenticated request.",
      );
    }

    const matchingSandboxProfileIds =
      input.search === undefined
        ? undefined
        : await resolveMatchingSandboxProfileIds(db, {
            organizationId: input.organizationId,
            search: input.search,
          });
    const matchingUserIds =
      input.search === undefined
        ? undefined
        : await resolveMatchingUserIds(db, {
            search: input.search,
          });
    const matchingSearchTriggerRunIds =
      input.search === undefined
        ? undefined
        : await resolveMatchingTriggerRunIds(db, {
            kind: "search",
            organizationId: input.organizationId,
            search: input.search,
          });
    const triggerTriggerRunIds =
      input.triggerId === undefined
        ? undefined
        : await resolveMatchingTriggerRunIds(db, {
            kind: "trigger",
            organizationId: input.organizationId,
            triggerId: input.triggerId,
          });

    assertTriggerRunFilterWithinBound({
      kind: "search",
      triggerRunIds: matchingSearchTriggerRunIds,
    });
    assertTriggerRunFilterWithinBound({
      kind: "trigger",
      triggerRunIds: triggerTriggerRunIds,
    });

    if (triggerTriggerRunIds !== undefined && triggerTriggerRunIds.length === 0) {
      return createEmptyListResult();
    }

    const sandboxInstances = await dataPlaneClient.listSandboxInstances({
      organizationId: input.organizationId,
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(input.startedByKind === undefined
        ? {}
        : { startedByKind: input.startedByKind, startedById: input.startedById }),
      ...(input.owner === undefined
        ? {}
        : {
            startedByScope: "self",
            startedByUserId: input.userId,
          }),
      ...(input.startedFrom === "manual" ? { source: "dashboard" } : {}),
      ...(input.startedFrom === "trigger" ? { source: "trigger" } : {}),
      ...(input.startedFrom === "event" ? { source: "webhook" } : {}),
      ...(input.startedFrom === "schedule" ? { source: "schedule" } : {}),
      ...(input.search === undefined ? {} : { titleSearch: input.search }),
      ...(matchingSandboxProfileIds === undefined || matchingSandboxProfileIds.length === 0
        ? {}
        : { matchingSandboxProfileIds }),
      ...(matchingUserIds === undefined || matchingUserIds.length === 0
        ? {}
        : { matchingStartedByUserIds: matchingUserIds }),
      ...(matchingSearchTriggerRunIds === undefined || matchingSearchTriggerRunIds.length === 0
        ? {}
        : { matchingStartedBySystemIds: matchingSearchTriggerRunIds }),
      ...(triggerTriggerRunIds === undefined ? {} : { startedBySystemIds: triggerTriggerRunIds }),
      ...(input.after === undefined ? {} : { after: input.after }),
      ...(input.before === undefined ? {} : { before: input.before }),
    });

    const startedByNames = await resolveStartedByNames(db, {
      organizationId: input.organizationId,
      items: sandboxInstances.items,
    });
    const sandboxProfileDisplayNames = await resolveSandboxProfileDisplayNames(db, {
      organizationId: input.organizationId,
      items: sandboxInstances.items,
    });
    return {
      ...sandboxInstances,
      items: sandboxInstances.items.map((item) => ({
        ...item,
        source: assertUserVisibleSandboxSource(item.source),
        title: item.title,
        sandboxProfileDisplayName: sandboxProfileDisplayNames.get(item.sandboxProfileId) ?? null,
        startedBy: {
          ...item.startedBy,
          name: startedByNames.get(item.startedBy.id) ?? null,
        },
      })),
    };
  } catch (error) {
    if (error instanceof DataPlaneSandboxInstancesClientError && error.status === 400) {
      throw new SandboxInstancesBadRequestError(
        SandboxInstancesBadRequestCodes.INVALID_LIST_INSTANCES_INPUT,
        error.body?.message ?? error.message,
      );
    }

    throw error;
  }
}
