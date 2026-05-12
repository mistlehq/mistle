import { Button } from "@mistle/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { toAutomationListItemViewModel } from "../automations/automation-list-view-model.js";
import { AutomationListView } from "../automations/automation-list-view.js";
import { automationsListQueryKey } from "../automations/automations-query-keys.js";
import { listAutomations } from "../automations/automations-service.js";
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
    <PageFrame
      headerActions={
        <Button
          onClick={() => {
            void navigate("/automations/new");
          }}
          type="button"
        >
          Create
        </Button>
      }
      title="Automations"
    >
      {automationsQuery.isPending ? null : (
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
