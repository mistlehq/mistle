import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { listIntegrationDirectory } from "../integrations/integrations-service.js";
import { listSandboxProfiles } from "../sandbox-profiles/sandbox-profiles-service.js";
import type { SandboxProfile } from "../sandbox-profiles/sandbox-profiles-types.js";
import {
  buildWebhookAutomationConnectionOptions,
  buildWebhookAutomationSandboxProfileOptions,
} from "./webhook-automation-list-helpers.js";

export const WEBHOOK_AUTOMATION_SANDBOX_PROFILES_QUERY_KEY: readonly [
  "automations",
  "sandbox-profiles",
] = ["automations", "sandbox-profiles"];

export const WEBHOOK_AUTOMATION_INTEGRATION_DIRECTORY_QUERY_KEY: readonly [
  "automations",
  "integration-directory",
] = ["automations", "integration-directory"];

async function listAllSandboxProfiles(input: {
  signal?: AbortSignal;
}): Promise<readonly SandboxProfile[]> {
  const items: SandboxProfile[] = [];
  let after: string | null = null;

  for (;;) {
    const result = await listSandboxProfiles({
      limit: 100,
      after,
      before: null,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });

    items.push(...result.items);

    if (result.nextPage === null) {
      return items;
    }

    after = result.nextPage.after;
  }
}

export function useWebhookAutomationPrerequisites(input?: { preservedConnectionId?: string }) {
  const integrationDirectoryQuery = useQuery({
    queryKey: WEBHOOK_AUTOMATION_INTEGRATION_DIRECTORY_QUERY_KEY,
    queryFn: async ({ signal }) => listIntegrationDirectory({ signal }),
    retry: false,
  });

  const sandboxProfilesQuery = useQuery({
    queryKey: WEBHOOK_AUTOMATION_SANDBOX_PROFILES_QUERY_KEY,
    queryFn: async ({ signal }) => listAllSandboxProfiles({ signal }),
    retry: false,
  });

  const connectionOptions = useMemo(
    () =>
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
          }),
    [input?.preservedConnectionId, integrationDirectoryQuery.data],
  );

  const sandboxProfileOptions = useMemo(
    () =>
      sandboxProfilesQuery.data === undefined
        ? []
        : buildWebhookAutomationSandboxProfileOptions({
            sandboxProfiles: sandboxProfilesQuery.data,
          }),
    [sandboxProfilesQuery.data],
  );

  const errorMessage =
    integrationDirectoryQuery.isError || sandboxProfilesQuery.isError
      ? resolveApiErrorMessage({
          error: integrationDirectoryQuery.error ?? sandboxProfilesQuery.error,
          fallbackMessage: "Could not load automation prerequisites.",
        })
      : null;

  function refetchAll(): void {
    void integrationDirectoryQuery.refetch();
    void sandboxProfilesQuery.refetch();
  }

  return {
    connectionOptions,
    sandboxProfileOptions,
    integrationDirectoryQuery,
    sandboxProfilesQuery,
    errorMessage,
    isPending: integrationDirectoryQuery.isPending || sandboxProfilesQuery.isPending,
    refetchAll,
  };
}
