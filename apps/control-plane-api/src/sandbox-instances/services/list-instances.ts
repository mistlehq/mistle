import {
  DataPlaneSandboxInstancesClientError,
  type DataPlaneSandboxInstancesClient,
  type ListSandboxInstancesResponse,
} from "@mistle/data-plane-internal-client";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";

import { resolveUserDisplayName } from "../../lib/user-display-name.js";
import { SandboxInstancesBadRequestCodes, SandboxInstancesBadRequestError } from "../errors.js";
import type { ListSandboxInstancesResult } from "./types.js";

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
  },
): Promise<ListSandboxInstancesResult> {
  try {
    const sandboxInstances = await dataPlaneClient.listSandboxInstances({
      organizationId: input.organizationId,
      ...(input.limit === undefined ? {} : { limit: input.limit }),
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
