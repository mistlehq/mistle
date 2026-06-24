import { IntegrationCredentialSecretKinds } from "@mistle/db/control-plane";
import { createOAuth2AuthorizationCodeCredentialSlotKeys } from "@mistle/integrations-core";
import { RefreshIntegrationConnectionOAuth2CredentialWorkflowSpec } from "@mistle/workflow-registry/control-plane";

import { getWorkflowContext } from "../core/context.js";
import { defineTracedControlPlaneWorkflow } from "../core/tracing.js";

export const RefreshIntegrationConnectionOAuth2CredentialWorkflow =
  defineTracedControlPlaneWorkflow(
    RefreshIntegrationConnectionOAuth2CredentialWorkflowSpec,
    async ({ input, step }) => {
      const { controlPlaneInternalClient, db } = await getWorkflowContext();

      return step.run({ name: "refresh-integration-connection-oauth2-credential" }, async () => {
        const connection = await db.query.integrationConnections.findFirst({
          columns: {
            id: true,
            organizationId: true,
          },
          where: (table, { and, eq }) =>
            and(eq(table.id, input.connectionId), eq(table.organizationId, input.organizationId)),
          with: {
            target: {
              columns: {
                familyId: true,
                variantId: true,
              },
            },
          },
        });

        if (connection === undefined) {
          throw new Error(`Integration connection '${input.connectionId}' was not found.`);
        }

        const target = connection.target;
        if (target === null) {
          throw new Error(
            `Integration connection '${input.connectionId}' is missing its target relation.`,
          );
        }

        const slotKeys = createOAuth2AuthorizationCodeCredentialSlotKeys({
          familyId: target.familyId,
          variantId: target.variantId,
        });

        await controlPlaneInternalClient.resolveIntegrationCredential({
          connectionId: connection.id,
          forceRefresh: true,
          secretType: IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
          slotKey: slotKeys.accessToken,
        });

        return {
          organizationId: input.organizationId,
          connectionId: input.connectionId,
          refreshedAt: new Date().toISOString(),
        };
      });
    },
  );
