import { Button } from "@mistle/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { WebhookAutomationListView } from "../automations/webhook-automation-list-view.js";
import { buildWebhookAutomationListItems } from "../automations/webhook-automations-page-helpers.js";
import { webhookAutomationsListQueryKey } from "../automations/webhook-automations-query-keys.js";
import { listWebhookAutomations } from "../automations/webhook-automations-service.js";
import { listIntegrationDirectory } from "../integrations/integrations-service.js";
import { listSandboxProfiles } from "../sandbox-profiles/sandbox-profiles-service.js";
import type { SandboxProfile } from "../sandbox-profiles/sandbox-profiles-types.js";

const AUTOMATIONS_LIST_LIMIT = 25;
const SANDBOX_PROFILES_QUERY_KEY: readonly ["automations", "sandbox-profiles"] = [
  "automations",
  "sandbox-profiles",
];
const INTEGRATION_DIRECTORY_QUERY_KEY: readonly ["automations", "integration-directory"] = [
  "automations",
  "integration-directory",
];

function parseCursor(rawValue: string | null): string | null {
  if (rawValue === null) {
    return null;
  }

  const normalized = rawValue.trim();
  return normalized.length === 0 ? null : normalized;
}

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

export function AutomationsPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const after = parseCursor(searchParams.get("after"));
  const before = after === null ? parseCursor(searchParams.get("before")) : null;

  const automationsQuery = useQuery({
    queryKey: webhookAutomationsListQueryKey({
      limit: AUTOMATIONS_LIST_LIMIT,
      after,
      before,
    }),
    queryFn: async ({ signal }) =>
      listWebhookAutomations({
        limit: AUTOMATIONS_LIST_LIMIT,
        after,
        before,
        signal,
      }),
    retry: false,
  });

  const integrationDirectoryQuery = useQuery({
    queryKey: INTEGRATION_DIRECTORY_QUERY_KEY,
    queryFn: async ({ signal }) => listIntegrationDirectory({ signal }),
    retry: false,
  });

  const sandboxProfilesQuery = useQuery({
    queryKey: SANDBOX_PROFILES_QUERY_KEY,
    queryFn: async ({ signal }) => listAllSandboxProfiles({ signal }),
    retry: false,
  });

  const errorMessage =
    automationsQuery.isError || integrationDirectoryQuery.isError || sandboxProfilesQuery.isError
      ? resolveApiErrorMessage({
          error:
            automationsQuery.error ?? integrationDirectoryQuery.error ?? sandboxProfilesQuery.error,
          fallbackMessage: "Could not load automations.",
        })
      : null;

  const items =
    automationsQuery.data === undefined ||
    integrationDirectoryQuery.data === undefined ||
    sandboxProfilesQuery.data === undefined
      ? []
      : buildWebhookAutomationListItems({
          automations: automationsQuery.data.items,
          connections: integrationDirectoryQuery.data.connections,
          sandboxProfiles: sandboxProfilesQuery.data,
        });

  function updatePagination(input: { nextAfter: string | null; nextBefore: string | null }): void {
    const nextSearchParams = new URLSearchParams();
    if (input.nextAfter !== null) {
      nextSearchParams.set("after", input.nextAfter);
    }
    if (input.nextBefore !== null) {
      nextSearchParams.set("before", input.nextBefore);
    }
    setSearchParams(nextSearchParams);
  }

  return (
    <div className="flex flex-col gap-4">
      <WebhookAutomationListView
        errorMessage={errorMessage}
        isLoading={
          automationsQuery.isPending ||
          integrationDirectoryQuery.isPending ||
          sandboxProfilesQuery.isPending
        }
        items={items}
        onCreateAutomation={() => {
          void navigate("/automations/new");
        }}
        onOpenAutomation={(automationId) => {
          void navigate(`/automations/${automationId}`);
        }}
        onRetry={() => {
          void automationsQuery.refetch();
          void integrationDirectoryQuery.refetch();
          void sandboxProfilesQuery.refetch();
        }}
      />

      {automationsQuery.data === undefined ||
      (automationsQuery.data.nextPage === null &&
        automationsQuery.data.previousPage === null) ? null : (
        <div className="flex justify-end gap-2">
          <Button
            disabled={automationsQuery.data.previousPage === null}
            onClick={() => {
              const previousPage = automationsQuery.data?.previousPage;
              if (previousPage === null || previousPage === undefined) {
                return;
              }

              updatePagination({
                nextAfter: null,
                nextBefore: previousPage.before,
              });
            }}
            type="button"
            variant="outline"
          >
            Previous
          </Button>
          <Button
            disabled={automationsQuery.data.nextPage === null}
            onClick={() => {
              const nextPage = automationsQuery.data?.nextPage;
              if (nextPage === null || nextPage === undefined) {
                return;
              }

              updatePagination({
                nextAfter: nextPage.after,
                nextBefore: null,
              });
            }}
            type="button"
            variant="outline"
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
