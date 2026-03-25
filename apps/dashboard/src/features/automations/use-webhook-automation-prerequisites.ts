import { useQuery } from "@tanstack/react-query";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { listIntegrationDirectory } from "../integrations/integrations-service.js";
import { automationApplicableSandboxProfilesQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import { listAutomationApplicableSandboxProfiles } from "../sandbox-profiles/sandbox-profiles-service.js";
import {
  buildWebhookAutomationConnectionOptions,
  buildWebhookAutomationSandboxProfileOptions,
} from "./webhook-automation-list-helpers.js";

export const WEBHOOK_AUTOMATION_INTEGRATION_DIRECTORY_QUERY_KEY: readonly [
  "automations",
  "integration-directory",
] = ["automations", "integration-directory"];

export function useWebhookAutomationPrerequisites(input?: {
  preservedConnectionId?: string;
  preservedProfile?: {
    id: string;
    displayName: string;
  };
}) {
  const integrationDirectoryQuery = useQuery({
    queryKey: WEBHOOK_AUTOMATION_INTEGRATION_DIRECTORY_QUERY_KEY,
    queryFn: async ({ signal }) => listIntegrationDirectory({ signal }),
    retry: false,
  });

  const automationApplicableSandboxProfilesQuery = useQuery({
    queryKey: automationApplicableSandboxProfilesQueryKey(),
    queryFn: async ({ signal }) => listAutomationApplicableSandboxProfiles({ signal }),
    retry: false,
  });

  const connectionOptions =
    integrationDirectoryQuery.data === undefined
      ? []
      : buildWebhookAutomationConnectionOptions({
          connections: integrationDirectoryQuery.data.connections,
          targets: integrationDirectoryQuery.data.targets,
          ...(input?.preservedConnectionId === undefined
            ? {}
            : {
                preservedConnectionId: input.preservedConnectionId,
              }),
        });

  const sandboxProfileOptions =
    automationApplicableSandboxProfilesQuery.data === undefined
      ? []
      : buildWebhookAutomationSandboxProfileOptions({
          sandboxProfiles: automationApplicableSandboxProfilesQuery.data.items,
          ...(input?.preservedProfile === undefined
            ? {}
            : {
                preservedProfile: input.preservedProfile,
              }),
        });

  const errorMessage =
    integrationDirectoryQuery.isError || automationApplicableSandboxProfilesQuery.isError
      ? resolveApiErrorMessage({
          error: integrationDirectoryQuery.error ?? automationApplicableSandboxProfilesQuery.error,
          fallbackMessage: "Could not load automation prerequisites.",
        })
      : null;

  function refetchAll(): void {
    void integrationDirectoryQuery.refetch();
    void automationApplicableSandboxProfilesQuery.refetch();
  }

  return {
    connectionOptions,
    sandboxProfileOptions,
    automationApplicableSandboxProfilesQuery,
    integrationDirectoryQuery,
    errorMessage,
    isPending:
      integrationDirectoryQuery.isPending || automationApplicableSandboxProfilesQuery.isPending,
    refetchAll,
  };
}
