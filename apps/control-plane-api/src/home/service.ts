import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import {
  AutomationKinds,
  IntegrationConnectionStatuses,
  type ControlPlaneDatabase,
  SandboxProfileVersionStates,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { IntegrationKinds, type IntegrationRegistry } from "@mistle/integrations-core";
import { sql } from "drizzle-orm";
import { z } from "zod";

import type { HomeSummaryResponse } from "./schema.js";

const HomeSummaryRowSchema = z
  .object({
    hasProfiles: z.boolean(),
    hasUsableProfiles: z.boolean(),
    hasAutomations: z.boolean(),
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
  const [agentCapableIntegrationResult, summaryResult, startedSessionResult] = await Promise.all([
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
      hasAutomations: boolean;
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
          from ${tables.automations} as a
          where a."organization_id" = ${params.organizationId}
            and a."kind" = ${AutomationKinds.WEBHOOK}
        ) as "hasAutomations"`),
    // This intentionally reuses the existing list API for now because the home
    // onboarding flow is still provisional. If this surface becomes permanent,
    // replace this with a lightweight persisted existence check instead of a
    // paginated list request.
    input.dataPlaneClient.listSandboxInstances({
      organizationId: params.organizationId,
      limit: 1,
    }),
  ]);

  const summary = HomeSummaryRowSchema.parse(
    summaryResult.rows[0] ?? {
      hasProfiles: false,
      hasUsableProfiles: false,
      hasAutomations: false,
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
      hasAutomations: summary.hasAutomations,
    },
  };
}
