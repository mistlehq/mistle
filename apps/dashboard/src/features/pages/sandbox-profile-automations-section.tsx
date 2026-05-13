import {
  Button,
  Notice,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mistle/ui";
import { CalendarDotsIcon, PlusIcon, WebhooksLogoIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import {
  createProfileAutomationDetailPath,
  createProfileAutomationsPath,
} from "../automations/automation-editor-navigation.js";
import { AutomationIssueIndicator } from "../automations/automation-list-indicators.js";
import type { AutomationListItemViewModel } from "../automations/automation-list-types.js";
import { toAutomationListItemViewModel } from "../automations/automation-list-view-model.js";
import { automationsListQueryKey } from "../automations/automations-query-keys.js";
import { listAutomations } from "../automations/automations-service.js";
import { getScheduledAutomation } from "../automations/scheduled-automations-service.js";
import { getWebhookAutomation } from "../automations/webhook-automations-service.js";
import { readKeysetPaginationCursors } from "../shared/pagination-search-params.js";
import { TablePagination } from "../shared/table-pagination.js";
import { EditScheduledAutomationEditor } from "./scheduled-automation-editor-page.js";
import { EditWebhookAutomationEditor } from "./webhook-automation-editor-page.js";

const ProfileAutomationsListLimit = 25;

function createAutomationCreatePath(profileId: string): string {
  const searchParams = new URLSearchParams({
    sandboxProfileId: profileId,
  });

  return `/automations/new?${searchParams.toString()}`;
}

function SourceSummary(input: { item: AutomationListItemViewModel }): React.JSX.Element {
  if (input.item.source.kind === "schedule") {
    const timing =
      input.item.source.nextScheduledAtLabel === null
        ? `Not scheduled ${input.item.source.timezoneOffsetLabel}`
        : `Next ${input.item.source.nextScheduledAtLabel} ${input.item.source.timezoneOffsetLabel}`;

    return (
      <>
        <span className="truncate font-mono text-xs text-foreground">
          {input.item.source.cronExpression}
        </span>
        <span className="truncate text-xs text-muted-foreground">{timing}</span>
      </>
    );
  }

  const firstEvent = input.item.source.events[0];
  if (firstEvent === undefined) {
    return <span className="truncate text-xs text-muted-foreground">No events</span>;
  }

  const remainingCount = input.item.source.events.length - 1;
  return (
    <span className="truncate text-xs text-muted-foreground">
      {firstEvent.label}
      {remainingCount > 0 ? ` +${String(remainingCount)}` : ""}
    </span>
  );
}

function AutomationKindIcon(input: {
  kind: AutomationListItemViewModel["kind"];
}): React.JSX.Element {
  if (input.kind === "schedule") {
    return (
      <>
        <CalendarDotsIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="sr-only">Scheduled automation</span>
      </>
    );
  }

  return (
    <>
      <WebhooksLogoIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="sr-only">Webhook automation</span>
    </>
  );
}

function ProfileAutomationListRow(input: {
  item: AutomationListItemViewModel;
  selected: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <div
      className={`flex w-full min-w-0 border-l-2 py-3 pl-4 pr-3 transition-colors ${
        input.selected
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      <div className="flex w-full min-w-0 items-start gap-2">
        <AutomationIssueIndicator enabled={input.item.enabled} issue={input.item.issue} />
        <button
          aria-current={input.selected ? "true" : undefined}
          aria-label={`Select automation ${input.item.name}`}
          className="flex min-w-0 flex-1 flex-col items-start gap-2 text-left"
          onClick={input.onSelect}
          type="button"
        >
          <span className="flex w-full min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{input.item.name}</span>
            <AutomationKindIcon kind={input.item.kind} />
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <SourceSummary item={input.item} />
          </span>
          <span className="text-xs text-muted-foreground">Updated {input.item.updatedAtLabel}</span>
        </button>
      </div>
    </div>
  );
}

type ProfileAutomationDetailResolution =
  | {
      kind: "schedule";
    }
  | {
      kind: "webhook";
    }
  | {
      kind: "not-found";
    };

async function resolveProfileAutomationDetail(input: {
  automationId: string;
  profileId: string;
  signal?: AbortSignal;
}): Promise<ProfileAutomationDetailResolution> {
  const [scheduledResult, webhookResult] = await Promise.allSettled([
    getScheduledAutomation({
      automationId: input.automationId,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
    getWebhookAutomation({
      automationId: input.automationId,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
  ]);

  if (
    scheduledResult.status === "fulfilled" &&
    scheduledResult.value.target.sandboxProfileId === input.profileId
  ) {
    return {
      kind: "schedule",
    };
  }

  if (
    webhookResult.status === "fulfilled" &&
    webhookResult.value.target.sandboxProfileId === input.profileId
  ) {
    return {
      kind: "webhook",
    };
  }

  if (scheduledResult.status === "rejected" && webhookResult.status === "rejected") {
    throw scheduledResult.reason;
  }

  return {
    kind: "not-found",
  };
}

function ProfileAutomationDetail(input: {
  profileId: string;
  selectedAutomation: AutomationListItemViewModel | null;
}): React.JSX.Element {
  const navigate = useNavigate();
  const params = useParams();
  const automationId = params["automationId"];
  const backPath = createProfileAutomationsPath(input.profileId);
  const detailResolutionQuery = useQuery({
    queryKey: ["sandbox-profile-automation-detail-resolution", input.profileId, automationId],
    queryFn: async ({ signal }) => {
      if (automationId === undefined) {
        throw new Error("Automation id is required.");
      }

      return resolveProfileAutomationDetail({
        automationId,
        profileId: input.profileId,
        signal,
      });
    },
    enabled: automationId !== undefined && input.selectedAutomation === null,
    retry: false,
  });

  if (automationId === undefined) {
    return (
      <div className="flex min-h-64 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Select an automation to view and edit it.
      </div>
    );
  }

  const selectedAutomationKind =
    input.selectedAutomation?.kind ?? detailResolutionQuery.data?.kind ?? null;

  if (detailResolutionQuery.isPending && input.selectedAutomation === null) {
    return <div className="min-h-64" />;
  }

  if (detailResolutionQuery.isError && input.selectedAutomation === null) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-4 p-6 text-center">
        <Notice title="Could not load automation" variant="alert">
          {resolveApiErrorMessage({
            error: detailResolutionQuery.error,
            fallbackMessage: "Could not load automation.",
          })}
        </Notice>
        <Button
          onClick={() => {
            void navigate(backPath);
          }}
          type="button"
          variant="outline"
        >
          Back to automations
        </Button>
      </div>
    );
  }

  if (selectedAutomationKind === null || selectedAutomationKind === "not-found") {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-4 p-6 text-center">
        <Notice title="Automation not found for this sandbox profile" variant="alert">
          The selected automation is not available for this sandbox profile.
        </Notice>
        <Button
          onClick={() => {
            void navigate(backPath);
          }}
          type="button"
          variant="outline"
        >
          Back to automations
        </Button>
      </div>
    );
  }

  if (selectedAutomationKind === "schedule") {
    return (
      <EditScheduledAutomationEditor
        automationId={automationId}
        backPath={backPath}
        deleteSuccessPath={backPath}
        navigate={navigate}
      />
    );
  }

  return (
    <EditWebhookAutomationEditor
      automationId={automationId}
      backPath={backPath}
      deleteSuccessPath={backPath}
      navigate={navigate}
    />
  );
}

export function SandboxProfileAutomationsSection(input: { profileId: string }): React.JSX.Element {
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isMobileAutomationSelectOpen, setIsMobileAutomationSelectOpen] = useState(false);
  const { after, before } = readKeysetPaginationCursors(searchParams);
  const automationId = params["automationId"];
  const automationsQuery = useQuery({
    queryKey: automationsListQueryKey({
      limit: ProfileAutomationsListLimit,
      after,
      before,
      sandboxProfileId: input.profileId,
    }),
    queryFn: async ({ signal }) =>
      listAutomations({
        limit: ProfileAutomationsListLimit,
        after,
        before,
        sandboxProfileId: input.profileId,
        signal,
      }),
    retry: false,
  });

  const items = automationsQuery.data?.items.map(toAutomationListItemViewModel) ?? [];
  const selectedAutomation =
    automationId === undefined ? null : (items.find((item) => item.id === automationId) ?? null);
  const errorMessage = automationsQuery.isError
    ? resolveApiErrorMessage({
        error: automationsQuery.error,
        fallbackMessage: "Could not load automations.",
      })
    : null;

  function updatePagination(inputValue: {
    nextAfter: string | null;
    nextBefore: string | null;
  }): void {
    const nextSearchParams = new URLSearchParams();
    if (inputValue.nextAfter !== null) {
      nextSearchParams.set("after", inputValue.nextAfter);
    }
    if (inputValue.nextBefore !== null) {
      nextSearchParams.set("before", inputValue.nextBefore);
    }
    setSearchParams(nextSearchParams);
  }

  function selectAutomation(item: AutomationListItemViewModel): void {
    void navigate(
      createProfileAutomationDetailPath({
        profileId: input.profileId,
        automationId: item.id,
        searchParams,
      }),
    );
  }

  function goToNextPage(): void {
    const nextPage = automationsQuery.data?.nextPage;
    if (nextPage === null || nextPage === undefined) {
      return;
    }

    updatePagination({
      nextAfter: nextPage.after,
      nextBefore: null,
    });
  }

  function goToPreviousPage(): void {
    const previousPage = automationsQuery.data?.previousPage;
    if (previousPage === null || previousPage === undefined) {
      return;
    }

    updatePagination({
      nextAfter: null,
      nextBefore: previousPage.before,
    });
  }

  function renderPagination(): React.JSX.Element | null {
    if (automationsQuery.data?.nextPage == null && automationsQuery.data?.previousPage == null) {
      return null;
    }

    return (
      <TablePagination
        hasNextPage={automationsQuery.data?.nextPage != null}
        hasPreviousPage={automationsQuery.data?.previousPage != null}
        nextPageDisabled={automationsQuery.isFetching || automationsQuery.isPending}
        onNextPage={goToNextPage}
        onPreviousPage={goToPreviousPage}
        previousPageDisabled={automationsQuery.isFetching || automationsQuery.isPending}
      />
    );
  }

  function renderDesktopPagination(): React.JSX.Element | null {
    const pagination = renderPagination();
    if (pagination === null) {
      return null;
    }

    return <div className="pt-3 pl-4 pr-3">{pagination}</div>;
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      {errorMessage === null ? null : (
        <Notice title="Could not load automations" variant="alert">
          {errorMessage}
        </Notice>
      )}

      <div className="flex flex-col gap-3 md:hidden">
        <Button
          onClick={() => {
            void navigate(createAutomationCreatePath(input.profileId));
          }}
          type="button"
        >
          <PlusIcon />
          Create Automation
        </Button>
        {automationsQuery.isPending || items.length === 0 ? null : (
          <Select
            onOpenChange={setIsMobileAutomationSelectOpen}
            onValueChange={(nextAutomationId) => {
              const nextAutomation = items.find((item) => item.id === nextAutomationId);
              if (nextAutomation === undefined) {
                return;
              }

              selectAutomation(nextAutomation);
              setIsMobileAutomationSelectOpen(false);
            }}
            value={selectedAutomation?.id ?? ""}
          >
            <SelectTrigger aria-label="Select automation" className="w-full">
              <SelectValue placeholder="Select automation">
                {selectedAutomation?.name ?? "Select automation"}
              </SelectValue>
            </SelectTrigger>
            {isMobileAutomationSelectOpen ? (
              <SelectContent>
                {items.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            ) : null}
          </Select>
        )}
        {renderPagination()}
      </div>

      <div className="flex flex-col gap-6 md:grid md:grid-cols-[16rem_1px_minmax(0,1fr)] md:gap-0 lg:grid-cols-[18rem_1px_minmax(0,1fr)]">
        <nav aria-label="Automations" className="hidden min-h-0 flex-col md:flex">
          <div className="py-3 pl-4 pr-3">
            <Button
              className="w-full justify-start"
              onClick={() => {
                void navigate(createAutomationCreatePath(input.profileId));
              }}
              type="button"
            >
              <PlusIcon />
              Create Automation
            </Button>
          </div>
          {automationsQuery.isPending || items.length === 0
            ? null
            : items.map((item) => (
                <ProfileAutomationListRow
                  item={item}
                  key={item.id}
                  onSelect={() => {
                    selectAutomation(item);
                  }}
                  selected={item.id === automationId}
                />
              ))}
          {renderDesktopPagination()}
        </nav>
        <div aria-hidden className="hidden bg-border md:block" />
        <div className="min-w-0 md:pl-8">
          {items.length === 0 && !automationsQuery.isPending && errorMessage === null ? (
            <div className="py-3 text-sm text-muted-foreground">
              No automations use this sandbox profile.
            </div>
          ) : (
            <ProfileAutomationDetail
              profileId={input.profileId}
              selectedAutomation={selectedAutomation}
            />
          )}
        </div>
      </div>
    </div>
  );
}
