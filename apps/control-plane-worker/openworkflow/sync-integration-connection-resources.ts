import { SyncIntegrationConnectionResourcesWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "../src/openworkflow/context.js";
import { syncIntegrationConnectionResources } from "../src/runtime/services/sync-integration-connection-resources.js";

export const SyncIntegrationConnectionResourcesWorkflow = defineWorkflow(
  SyncIntegrationConnectionResourcesWorkflowSpec,
  async ({ input, step }) => {
    const { controlPlaneInternalClient, db, integrationRegistry } = await getWorkflowContext();

    return step.run({ name: "sync-integration-connection-resources" }, async () =>
      syncIntegrationConnectionResources(
        {
          db,
          integrationRegistry,
          resolveIntegrationCredential: async (resolveInput) =>
            controlPlaneInternalClient.resolveIntegrationCredential(resolveInput),
          resolveIntegrationTargetSecrets: async (resolveInput) => {
            const resolvedSecrets =
              await controlPlaneInternalClient.resolveIntegrationTargetSecrets({
                targets: [
                  {
                    targetKey: resolveInput.targetKey,
                    encryptedSecrets: resolveInput.encryptedSecrets,
                  },
                ],
              });

            const resolvedTarget = resolvedSecrets.targets[0];
            if (resolvedTarget === undefined) {
              throw new Error(
                `Resolved target secrets for '${resolveInput.targetKey}' were not returned.`,
              );
            }

            return {
              secrets: resolvedTarget.secrets,
            };
          },
        },
        input,
      ),
    );
  },
);
