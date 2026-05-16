import { Button } from "@mistle/ui";
import { PlusIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { toAutomationListItemViewModel } from "../automations/automation-list-view-model.js";
import { AutomationListView } from "../automations/automation-list-view.js";
import { automationsListQueryKey } from "../automations/automations-query-keys.js";
import { listAutomations } from "../automations/automations-service.js";
import { CollectionEmptyState } from "../shared/collection-empty-state.js";
import { PageFrame } from "../shared/page-frame.js";
import { readKeysetPaginationCursors } from "../shared/pagination-search-params.js";

const AUTOMATIONS_LIST_LIMIT = 25;

export function AutomationsPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { after, before } = readKeysetPaginationCursors(searchParams);

  const automationsQuery = useQuery({
    queryKey: automationsListQueryKey({
      limit: AUTOMATIONS_LIST_LIMIT,
      after,
      before,
    }),
    queryFn: async ({ signal }) =>
      listAutomations({
        limit: AUTOMATIONS_LIST_LIMIT,
        after,
        before,
        signal,
      }),
    retry: false,
  });

  const items = automationsQuery.data?.items.map(toAutomationListItemViewModel) ?? [];

  const errorMessage = automationsQuery.isError
    ? resolveApiErrorMessage({
        error: automationsQuery.error,
        fallbackMessage: "Could not load triggers.",
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

  function createTrigger(): void {
    void navigate("/automations/new");
  }

  const canShowSummary = automationsQuery.data !== undefined && !automationsQuery.isError;
  const hasNoTriggers = automationsQuery.data?.totalResults === 0;

  return (
    <PageFrame
      headerActions={
        <Button onClick={createTrigger} type="button">
          Create trigger
        </Button>
      }
      title="Triggers"
    >
      {automationsQuery.isPending ? null : hasNoTriggers && errorMessage === null ? (
        <CollectionEmptyState
          action={
            <Button onClick={createTrigger} type="button">
              <PlusIcon aria-hidden className="size-4" />
              Create trigger
            </Button>
          }
          description="Triggers run Mistle automatically from webhook events or schedules."
          title="Create your first trigger"
        />
      ) : (
        <AutomationListView
          errorMessage={errorMessage}
          hasNextPage={automationsQuery.data?.nextPage != null}
          hasPreviousPage={automationsQuery.data?.previousPage != null}
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
          onOpenAutomation={(automation) => {
            if (automation.kind === "schedule") {
              void navigate(`/automations/schedules/${automation.id}`);
              return;
            }

            void navigate(`/automations/${automation.id}`);
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
          previousPageDisabled={automationsQuery.isFetching || automationsQuery.isPending}
          totalResults={canShowSummary ? automationsQuery.data.totalResults : null}
        />
      )}
    </PageFrame>
  );
}
