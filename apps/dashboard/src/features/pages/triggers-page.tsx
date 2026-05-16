import { Button } from "@mistle/ui";
import { PlusIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { CollectionEmptyState } from "../shared/collection-empty-state.js";
import { PageFrame } from "../shared/page-frame.js";
import { readKeysetPaginationCursors } from "../shared/pagination-search-params.js";
import {
  normalizeTriggerListSearch,
  toTriggerListServerFilters,
  type TriggerListFilter,
} from "../triggers/trigger-list-model.js";
import { toTriggerListItemViewModel } from "../triggers/trigger-list-view-model.js";
import { TriggerListView } from "../triggers/trigger-list-view.js";
import { triggersListQueryKey } from "../triggers/triggers-query-keys.js";
import { listTriggers } from "../triggers/triggers-service.js";

const TRIGGERS_LIST_LIMIT = 25;

export function TriggersPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeFilter, setActiveFilter] = useState<TriggerListFilter>("all");
  const [searchValue, setSearchValue] = useState("");
  const { after, before } = readKeysetPaginationCursors(searchParams);
  const serverFilters = toTriggerListServerFilters(activeFilter);
  const normalizedSearch = normalizeTriggerListSearch(searchValue);
  const listQueryFilters = {
    ...serverFilters,
    ...(normalizedSearch === undefined ? {} : { search: normalizedSearch }),
  };
  const listQueryInput = {
    limit: TRIGGERS_LIST_LIMIT,
    after,
    before,
    ...listQueryFilters,
  };

  const triggersQuery = useQuery({
    queryKey: triggersListQueryKey(listQueryInput),
    queryFn: async ({ signal }) =>
      listTriggers({
        ...listQueryInput,
        signal,
      }),
    retry: false,
  });

  const items = triggersQuery.data?.items.map(toTriggerListItemViewModel) ?? [];

  const errorMessage = triggersQuery.isError
    ? resolveApiErrorMessage({
        error: triggersQuery.error,
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

  function resetPagination(): void {
    setSearchParams(new URLSearchParams());
  }

  function updateFilter(nextFilter: TriggerListFilter): void {
    setActiveFilter(nextFilter);
    resetPagination();
  }

  function updateSearchValue(nextValue: string): void {
    setSearchValue(nextValue);
    resetPagination();
  }

  function createTrigger(): void {
    void navigate("/triggers/new");
  }

  const hasActiveListQuery = activeFilter !== "all" || normalizedSearch !== undefined;
  const canShowSummary = triggersQuery.data !== undefined && !triggersQuery.isError;
  const hasNoTriggers = !hasActiveListQuery && triggersQuery.data?.totalResults === 0;
  const isLoadingInitialList = triggersQuery.isPending && !hasActiveListQuery;

  return (
    <PageFrame
      headerActions={
        <Button onClick={createTrigger} type="button">
          Create trigger
        </Button>
      }
      title="Triggers"
    >
      {isLoadingInitialList ? null : hasNoTriggers && errorMessage === null ? (
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
        <TriggerListView
          activeFilter={activeFilter}
          errorMessage={errorMessage}
          hasNextPage={triggersQuery.data?.nextPage != null}
          hasPreviousPage={triggersQuery.data?.previousPage != null}
          items={items}
          onFilterChange={updateFilter}
          nextPageDisabled={triggersQuery.isFetching || triggersQuery.isPending}
          onNextPage={() => {
            const nextPage = triggersQuery.data?.nextPage;
            if (nextPage === null || nextPage === undefined) {
              return;
            }

            updatePagination({
              nextAfter: nextPage.after,
              nextBefore: null,
            });
          }}
          onOpenTrigger={(triggerId) => {
            void navigate(`/triggers/${triggerId}`);
          }}
          onPreviousPage={() => {
            const previousPage = triggersQuery.data?.previousPage;
            if (previousPage === null || previousPage === undefined) {
              return;
            }

            updatePagination({
              nextAfter: null,
              nextBefore: previousPage.before,
            });
          }}
          onSearchValueChange={updateSearchValue}
          previousPageDisabled={triggersQuery.isFetching || triggersQuery.isPending}
          searchValue={searchValue}
          totalResults={canShowSummary ? triggersQuery.data.totalResults : null}
        />
      )}
    </PageFrame>
  );
}
