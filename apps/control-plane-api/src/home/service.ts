import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import {
  IntegrationConnectionStatuses,
  type ControlPlaneDatabase,
  SandboxProfileVersionStates,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { IntegrationKinds, type IntegrationRegistry } from "@mistle/integrations-core";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { listInstances } from "../sandbox-instances/services/list-instances.js";
import type { HomeSummaryResponse } from "./schema.js";

const HOME_RECENT_SESSIONS_LIMIT = 5;

const HomeSummaryRowSchema = z
  .object({
    hasProfiles: z.boolean(),
    hasUsableProfiles: z.boolean(),
    hasTriggers: z.boolean(),
  })
  .strict();

export async function getHomeSummary(
  input: {
    db: ControlPlaneDatabase;
    dataPlaneClient: DataPlaneSandboxInstancesClient;
    integrationRegistry: IntegrationRegistry;
  },
  params: {
    organizationId: string;
    userId: string;
  },
): Promise<HomeSummaryResponse> {
  const tables = getControlPlaneDatabaseSchema(input.db);

  const agentCapableTargetLocators = input.integrationRegistry
    .listDefinitions()
    .filter((definition) => definition.kind === IntegrationKinds.AGENT)
    .map((definition) => ({
      familyId: definition.familyId,
      variantId: definition.variantId,
    }));
  const webhookCapableTargetLocators = input.integrationRegistry
    .listDefinitions()
    .filter((definition) => (definition.supportedWebhookEvents?.length ?? 0) > 0)
    .map((definition) => ({
      familyId: definition.familyId,
      variantId: definition.variantId,
    }));
  const [agentCapableIntegrationResult, summaryResult, startedSessionResult, recentSessionsResult] =
    await Promise.all([
      input.db
        .select({
          familyId: tables.integrationTargets.familyId,
          variantId: tables.integrationTargets.variantId,
        })
        .from(tables.integrationConnections)
        .innerJoin(
          tables.integrationTargets,
          sql`${tables.integrationTargets.targetKey} = ${tables.integrationConnections.targetKey}`,
        )
        .where(
          sql`${tables.integrationConnections.organizationId} = ${params.organizationId}
          and ${tables.integrationConnections.status} = ${IntegrationConnectionStatuses.ACTIVE}
          and ${tables.integrationTargets.enabled} = true`,
        ),
      input.db.execute(sql<{
        hasProfiles: boolean;
        hasUsableProfiles: boolean;
        hasTriggers: boolean;
      }>`select
        exists(
          select 1
          from ${tables.sandboxProfiles} as sp
          where sp."organization_id" = ${params.organizationId}
        ) as "hasProfiles",
        exists(
          select 1
          from ${tables.sandboxProfiles} as sp
          where sp."organization_id" = ${params.organizationId}
            and sp."active_version" is not null
            and exists (
              select 1
              from ${tables.sandboxProfileVersions} as spv
              where spv."sandbox_profile_id" = sp."id"
                and spv."version" = sp."active_version"
                and spv."state" = ${SandboxProfileVersionStates.PUBLISHED}
            )
        ) as "hasUsableProfiles",
        exists(
          select 1
          from ${tables.triggers} as a
          where a."organization_id" = ${params.organizationId}
        ) as "hasTriggers"`),
      input.dataPlaneClient.listSandboxInstances({
        organizationId: params.organizationId,
        limit: 1,
      }),
      listInstances(
        {
          db: input.db,
          dataPlaneClient: input.dataPlaneClient,
        },
        {
          organizationId: params.organizationId,
          userId: params.userId,
          limit: HOME_RECENT_SESSIONS_LIMIT,
          startedByKind: "user",
          startedById: params.userId,
        },
      ),
    ]);

  const summary = HomeSummaryRowSchema.parse(
    summaryResult.rows[0] ?? {
      hasProfiles: false,
      hasUsableProfiles: false,
      hasTriggers: false,
    },
  );
  const hasAgentCapableIntegrations = agentCapableIntegrationResult.some((row) =>
    agentCapableTargetLocators.some(
      (targetLocator) =>
        row.familyId === targetLocator.familyId && row.variantId === targetLocator.variantId,
    ),
  );
  const hasWebhookCapableIntegration = agentCapableIntegrationResult.some((row) =>
    webhookCapableTargetLocators.some(
      (targetLocator) =>
        row.familyId === targetLocator.familyId && row.variantId === targetLocator.variantId,
    ),
  );

  return {
    onboarding: {
      hasIntegrations: hasAgentCapableIntegrations,
      hasProfiles: summary.hasProfiles,
      hasUsableProfiles: summary.hasUsableProfiles,
      hasStartedSession: startedSessionResult.items.length > 0,
      hasWebhookCapableIntegration,
      hasTriggers: summary.hasTriggers,
    },
    recentSessions: recentSessionsResult.items,
  };
}
