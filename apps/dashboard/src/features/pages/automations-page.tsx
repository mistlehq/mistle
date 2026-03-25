import { Button } from "@mistle/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { formatWebhookAutomationUpdatedAt } from "../automations/webhook-automation-list-helpers.js";
import { WebhookAutomationListView } from "../automations/webhook-automation-list-view.js";
import { webhookAutomationsListQueryKey } from "../automations/webhook-automations-query-keys.js";
import { listWebhookAutomations } from "../automations/webhook-automations-service.js";

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
    automationsQuery.data?.items.map((automation) => ({
      ...automation,
      updatedAtLabel: formatWebhookAutomationUpdatedAt(automation.updatedAt),
    })) ?? [];

  const errorMessage = automationsQuery.isError
    ? resolveApiErrorMessage({
        error: automationsQuery.error,
        fallbackMessage: "Could not load automations.",
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

  const canShowSummary = automationsQuery.data !== undefined && !automationsQuery.isError;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-row items-start justify-between gap-3">
        <h1 className="text-xl font-semibold">Automations</h1>
        <Button
          onClick={() => {
            void navigate("/automations/new");
          }}
          type="button"
        >
          Create automation
        </Button>
      </div>

      <WebhookAutomationListView
        errorMessage={errorMessage}
        hasNextPage={automationsQuery.data?.nextPage != null}
        hasPreviousPage={automationsQuery.data?.previousPage != null}
        isLoading={automationsQuery.isPending}
        items={items}
        nextPageDisabled={automationsQuery.isFetching || automationsQuery.isPending}
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
        onOpenAutomation={(automationId) => {
          void navigate(`/automations/${automationId}`);
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
        onRetry={() => {
          void automationsQuery.refetch();
        }}
        previousPageDisabled={automationsQuery.isFetching || automationsQuery.isPending}
        totalResults={canShowSummary ? automationsQuery.data.totalResults : null}
      />
    </div>
  );
}
