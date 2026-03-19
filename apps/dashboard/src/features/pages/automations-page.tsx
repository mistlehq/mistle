import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { useWebhookAutomationPrerequisites } from "../automations/use-webhook-automation-prerequisites.js";
import { buildWebhookAutomationListItems } from "../automations/webhook-automation-list-helpers.js";
import { WebhookAutomationListView } from "../automations/webhook-automation-list-view.js";
import { webhookAutomationsListQueryKey } from "../automations/webhook-automations-query-keys.js";
import { listWebhookAutomations } from "../automations/webhook-automations-service.js";
import { TablePagination } from "../shared/table-pagination.js";

const AUTOMATIONS_LIST_LIMIT = 25;

function parseCursor(rawValue: string | null): string | null {
  if (rawValue === null) {
    return null;
  }

  const normalized = rawValue.trim();
  return normalized.length === 0 ? null : normalized;
}

export function AutomationsPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const prerequisites = useWebhookAutomationPrerequisites();
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

  const items =
    automationsQuery.data === undefined ||
    prerequisites.integrationDirectoryQuery.data === undefined ||
    prerequisites.sandboxProfilesQuery.data === undefined
      ? []
      : buildWebhookAutomationListItems({
          automations: automationsQuery.data.items,
          connections: prerequisites.integrationDirectoryQuery.data.connections,
          sandboxProfiles: prerequisites.sandboxProfilesQuery.data,
        });

  const errorMessage =
    automationsQuery.isError || prerequisites.errorMessage !== null
      ? resolveApiErrorMessage({
          error: automationsQuery.error,
          fallbackMessage: prerequisites.errorMessage ?? "Could not load automations.",
        })
      : null;

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
        isLoading={automationsQuery.isPending || prerequisites.isPending}
        items={items}
        onCreateAutomation={() => {
          void navigate("/automations/new");
        }}
        onOpenAutomation={(automationId) => {
          void navigate(`/automations/${automationId}`);
        }}
        onRetry={() => {
          void automationsQuery.refetch();
          prerequisites.refetchAll();
        }}
      />

      {automationsQuery.data === undefined ? null : (
        <TablePagination
          hasNextPage={automationsQuery.data.nextPage !== null}
          hasPreviousPage={automationsQuery.data.previousPage !== null}
          onNextPage={() => {
            const nextPage = automationsQuery.data?.nextPage;
            if (nextPage === null || nextPage === undefined) {
              return;
            }

            updatePagination({
              nextAfter: nextPage.after,
              nextBefore: null,
            });
          }}
          onPreviousPage={() => {
            const previousPage = automationsQuery.data?.previousPage;
            if (previousPage === null || previousPage === undefined) {
              return;
            }

            updatePagination({
              nextAfter: null,
              nextBefore: previousPage.before,
            });
          }}
        />
      )}
    </div>
  );
}
