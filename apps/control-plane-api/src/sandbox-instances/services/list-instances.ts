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

const MAX_AUTOMATION_RUN_FILTER_IDS = 5_000;

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
  const startedByAutomationRunIds = [
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

  if (startedByAutomationRunIds.length > 0) {
    const automationRuns = await db.query.automationRuns.findMany({
      columns: {
        id: true,
        automationId: true,
      },
      where: (table, { inArray }) => inArray(table.id, startedByAutomationRunIds),
    });
    const automationIds = [
      ...new Set(automationRuns.map((automationRun) => automationRun.automationId)),
    ];

    if (automationIds.length > 0) {
      const automations = await db.query.automations.findMany({
        columns: {
          id: true,
          name: true,
        },
        where: (table, { and, eq, inArray }) =>
          and(eq(table.organizationId, input.organizationId), inArray(table.id, automationIds)),
      });
      const automationNamesById = new Map(
        automations.map((automation) => [automation.id, automation.name]),
      );

      for (const automationRun of automationRuns) {
        const automationName = automationNamesById.get(automationRun.automationId);
        if (automationName !== undefined) {
          startedByNames.set(automationRun.id, automationName);
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
  userId: string;
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

async function resolveMatchingAutomationRunIds(
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
  const automationRows =
    input.kind === "search"
      ? await db
          .select({ id: tables.automations.id })
          .from(tables.automations)
          .where(
            and(
              eq(tables.automations.organizationId, input.organizationId),
              ilike(tables.automations.name, `%${escapeLikePattern(input.search)}%`),
            ),
          )
      : await db
          .select({ id: tables.automations.id })
          .from(tables.automations)
          .where(
            and(
              eq(tables.automations.organizationId, input.organizationId),
              eq(tables.automations.id, input.triggerId),
            ),
          );

  const automationIds = automationRows.map((row) => row.id);
  if (automationIds.length === 0) {
    return [];
  }

  const automationRuns = await db.query.automationRuns.findMany({
    columns: {
      id: true,
    },
    where: (table, { inArray }) => inArray(table.automationId, automationIds),
  });

  return automationRuns.map((automationRun) => automationRun.id);
}

function assertAutomationRunFilterWithinBound(input: {
  kind: "search" | "trigger";
  automationRunIds: string[] | undefined;
}): void {
  if (
    input.automationRunIds === undefined ||
    input.automationRunIds.length <= MAX_AUTOMATION_RUN_FILTER_IDS
  ) {
    return;
  }

  const filterLabel = input.kind === "trigger" ? "trigger" : "search";
  throw new SandboxInstancesBadRequestError(
    SandboxInstancesBadRequestCodes.INVALID_LIST_INSTANCES_INPUT,
    `The ${filterLabel} filter matches too many automation runs. Narrow the filter before listing sessions.`,
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
    const matchingSearchAutomationRunIds =
      input.search === undefined
        ? undefined
        : await resolveMatchingAutomationRunIds(db, {
            kind: "search",
            organizationId: input.organizationId,
            search: input.search,
          });
    const triggerAutomationRunIds =
      input.triggerId === undefined
        ? undefined
        : await resolveMatchingAutomationRunIds(db, {
            kind: "trigger",
            organizationId: input.organizationId,
            triggerId: input.triggerId,
          });

    assertAutomationRunFilterWithinBound({
      kind: "search",
      automationRunIds: matchingSearchAutomationRunIds,
    });
    assertAutomationRunFilterWithinBound({
      kind: "trigger",
      automationRunIds: triggerAutomationRunIds,
    });

    if (triggerAutomationRunIds !== undefined && triggerAutomationRunIds.length === 0) {
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
      ...(matchingSearchAutomationRunIds === undefined ||
      matchingSearchAutomationRunIds.length === 0
        ? {}
        : { matchingStartedBySystemIds: matchingSearchAutomationRunIds }),
      ...(triggerAutomationRunIds === undefined
        ? {}
        : { startedBySystemIds: triggerAutomationRunIds }),
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
