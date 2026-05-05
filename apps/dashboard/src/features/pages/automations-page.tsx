import { Button } from "@mistle/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import type {
  AutomationListItemViewModel,
  AutomationListScheduleSourceViewModel,
} from "../automations/automation-list-types.js";
import { AutomationListView } from "../automations/automation-list-view.js";
import { listAutomations } from "../automations/automations-service.js";
import type { AutomationListItem } from "../automations/automations-types.js";
import { formatAutomationUpdatedAt } from "../automations/webhook-automation-formatters.js";
import { automationsListQueryKey } from "../automations/webhook-automations-query-keys.js";
import { formatDateTime, formatTimeZoneOffset } from "../shared/date-formatters.js";
import { PageFrame } from "../shared/page-frame.js";

const AUTOMATIONS_LIST_LIMIT = 25;

function parseCursor(rawValue: string | null): string | null {
  if (rawValue === null) {
    return null;
  }

  const normalized = rawValue.trim();
  return normalized.length === 0 ? null : normalized;
}

function toAutomationListScheduleSourceViewModel(
  source: Extract<AutomationListItem["source"], { kind: "schedule" }>,
): AutomationListScheduleSourceViewModel {
  const offsetDateTime = source.nextScheduledAt ?? new Date().toISOString();

  return {
    kind: "schedule",
    cronExpression: source.cronExpression,
    timezone: source.timezone,
    nextScheduledAtLabel:
      source.nextScheduledAt === null
        ? null
        : formatDateTime(source.nextScheduledAt, source.timezone),
    timezoneOffsetLabel: formatTimeZoneOffset({
      isoDateTime: offsetDateTime,
      timeZone: source.timezone,
    }),
  };
}

function toAutomationListItemViewModel(
  automation: AutomationListItem,
): AutomationListItemViewModel {
  return {
    id: automation.id,
    kind: automation.kind,
    name: automation.name,
    enabled: automation.enabled,
    target: automation.target,
    ...(automation.issue === undefined ? {} : { issue: automation.issue }),
    source:
      automation.source.kind === "webhook"
        ? automation.source
        : toAutomationListScheduleSourceViewModel(automation.source),
    updatedAtLabel: formatAutomationUpdatedAt(automation.updatedAt),
  };
}

export function AutomationsPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const after = parseCursor(searchParams.get("after"));
  const before = after === null ? parseCursor(searchParams.get("before")) : null;

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
