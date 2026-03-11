import { defineWorkflow, defineWorkflowSpec } from "openworkflow";

import { getControlPlaneWorkflowRuntime } from "../runtime-context.js";
import { syncIntegrationConnectionResources } from "./service.js";

export type SyncIntegrationConnectionResourcesWorkflowInput = {
  organizationId: string;
  connectionId: string;
  kind: string;
};

export type SyncIntegrationConnectionResourcesWorkflowOutput = {
  organizationId: string;
  connectionId: string;
  kind: string;
};

export const SyncIntegrationConnectionResourcesWorkflow = defineWorkflow(
  defineWorkflowSpec<
    SyncIntegrationConnectionResourcesWorkflowInput,
    SyncIntegrationConnectionResourcesWorkflowOutput
  >({
    name: "control-plane.integration-connections.sync-resources",
    version: "1",
  }),
  async ({ input: workflowInput, step }) => {
    const runtime = await getControlPlaneWorkflowRuntime();

    return step.run({ name: "sync-integration-connection-resources" }, async () =>
      syncIntegrationConnectionResources(
        {
          db: runtime.db,
          integrationRegistry: runtime.integrationRegistry,
          resolveIntegrationCredential: async (resolveInput) =>
            runtime.controlPlaneInternalClient.resolveIntegrationCredential(resolveInput),
          resolveIntegrationTargetSecrets: async (resolveInput) => {
            const resolvedSecrets =
              await runtime.controlPlaneInternalClient.resolveIntegrationTargetSecrets({
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
        workflowInput,
      ),
    );
  },
);

export const SyncIntegrationConnectionResourcesWorkflowSpec =
  SyncIntegrationConnectionResourcesWorkflow.spec;
