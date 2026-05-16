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
import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { IntegrationLogo } from "../integrations/integration-logo.js";
import type {
  IntegrationConnection,
  IntegrationTarget,
  IntegrationWebhookSource,
} from "../integrations/integrations-service.js";
import {
  sandboxProfileVersionTriggerConfigQueryKey,
  sandboxProfileVersionsQueryKey,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import {
  getSandboxProfileVersionTriggerConfig,
  listSandboxProfileVersions,
} from "../sandbox-profiles/sandbox-profiles-service.js";
import type {
  SandboxProfileVersion,
  SandboxProfileVersionTriggerConfig,
} from "../sandbox-profiles/sandbox-profiles-types.js";
import { ActionTile } from "../shared/action-tile.js";
import { readKeysetPaginationCursors } from "../shared/pagination-search-params.js";
import { TablePagination } from "../shared/table-pagination.js";
import {
  createProfileTriggerDetailPath,
  createProfileTriggersPath,
} from "../triggers/trigger-editor-navigation.js";
import { TriggerIssueIndicator } from "../triggers/trigger-list-indicators.js";
import type { TriggerListItemViewModel } from "../triggers/trigger-list-types.js";
import { toTriggerListItemViewModel } from "../triggers/trigger-list-view-model.js";
import {
  resolveTriggerTemplateEventOptionIds,
  TriggerTemplates,
  type TriggerTemplate,
} from "../triggers/trigger-templates.js";
import { triggersListQueryKey } from "../triggers/triggers-query-keys.js";
import { listTriggers } from "../triggers/triggers-service.js";
import { useWebhookTriggerEventPrerequisites } from "../triggers/use-webhook-trigger-prerequisites.js";
import type { WebhookTriggerEventOption } from "../triggers/webhook-trigger-event-types.js";
import {
  buildWebhookTriggerEventOptions,
  resolveEligibleProfileTriggerConnectionIds,
} from "../triggers/webhook-trigger-option-builders.js";
import { TriggerEditorContent } from "./trigger-editor-content.js";

const ProfileTriggersListLimit = 25;

type TriggerTemplateAvailability =
  | {
      kind: "available";
      template: TriggerTemplate;
    }
  | {
      kind: "unavailable";
      reason: string;
      template: TriggerTemplate;
    };

function createTriggerCreatePath(profileId: string, templateId?: string): string {
  const searchParams = new URLSearchParams({
    sandboxProfileId: profileId,
  });
  if (templateId !== undefined) {
    searchParams.set("template", templateId);
  }

  return `/triggers/new?${searchParams.toString()}`;
}

function TriggerTemplateIcon(input: { template: TriggerTemplate }): React.JSX.Element | null {
  if (input.template.logoKey === undefined) {
    return null;
  }

  return <IntegrationLogo alt={`${input.template.title} logo`} logoKey={input.template.logoKey} />;
}

function TriggerTemplateList(input: {
  errorMessage: string | null;
  isPending: boolean;
  onCreateFromTemplate: (templateId: string) => void;
  templates: readonly TriggerTemplateAvailability[];
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6 py-3">
      <div>
        <h2 className="text-2xl font-semibold">Create from template</h2>
        <p className="mt-2 text-base text-muted-foreground">
          Choose a starting point for the trigger you want to create.
        </p>
      </div>
      {input.errorMessage === null ? null : (
        <Notice title="Could not load trigger templates" variant="alert">
          {input.errorMessage}
        </Notice>
      )}
      {input.isPending ? <div className="min-h-48" /> : null}
      {!input.isPending && input.errorMessage === null ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {input.templates.map((item) => (
            <ActionTile
              action={
                item.kind === "available" ? (
                  <Button
                    className="w-full"
                    onClick={() => {
                      input.onCreateFromTemplate(item.template.id);
                    }}
                    type="button"
                    variant="outline"
                  >
                    Select
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">{item.reason}</p>
                )
              }
              actionContainerClassName={
                item.kind === "available" ? "w-full" : "w-full justify-start"
              }
              className={`gap-5 px-4 py-5 sm:flex-col sm:items-stretch sm:justify-between ${
                item.kind === "available" ? "" : "opacity-75"
              }`}
              contentClassName="w-full"
              description={item.template.description}
              key={item.template.id}
              leading={<TriggerTemplateIcon template={item.template} />}
              title={item.template.title}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function resolveActiveSandboxProfileVersion(
  versions: readonly SandboxProfileVersion[],
): number | null {
  return versions.find((version) => version.isActive)?.version ?? null;
}

function isTriggerTemplateAvailable(input: {
  eventOptions: readonly WebhookTriggerEventOption[];
  template: Extract<TriggerTemplate, { kind: "trigger" }>;
}): boolean {
  return resolveTriggerTemplateEventOptionIds(input) !== null;
}

function resolveTriggerTemplateAvailability(input: {
  triggerConfig: SandboxProfileVersionTriggerConfig;
  connections: readonly IntegrationConnection[];
  eventOptions: readonly WebhookTriggerEventOption[];
  selectableConnectionIds: readonly string[];
  targets: readonly IntegrationTarget[];
  template: TriggerTemplate;
  webhookSources: readonly IntegrationWebhookSource[];
}): TriggerTemplateAvailability {
  const template = input.template;
  if (template.kind === "scheduled") {
    return {
      kind: "available",
      template,
    };
  }

  if (
    isTriggerTemplateAvailable({
      eventOptions: input.eventOptions,
      template,
    })
  ) {
    return {
      kind: "available",
      template,
    };
  }

  const matchingTargets = input.targets.filter((target) =>
    target.supportedWebhookEvents?.some((eventDefinition) =>
      template.eventTypes.includes(eventDefinition.eventType),
    ),
  );
  const matchingConnections = input.connections.filter((connection) =>
    matchingTargets.some((target) => target.targetKey === connection.targetKey),
  );
  const firstMatchingTarget = matchingTargets[0];
  const integrationName = firstMatchingTarget?.displayName ?? "the required integration";
  const matchingConnectionIds = new Set(matchingConnections.map((connection) => connection.id));
  const hasProfileBinding = input.triggerConfig.bindings.some((binding) =>
    matchingConnectionIds.has(binding.connectionId),
  );
  if (!hasProfileBinding) {
    return {
      kind: "unavailable",
      reason: `${integrationName} connection required.`,
      template,
    };
  }

  const selectableConnectionIds = new Set(input.selectableConnectionIds);
  const profileConnections = matchingConnections.filter((connection) =>
    selectableConnectionIds.has(connection.id),
  );
  const hasActiveWebhookSource = input.webhookSources.some(
    (source) =>
      source.status === "active" &&
      profileConnections.some((connection) => connection.id === source.integrationConnectionId),
  );
  if (!hasActiveWebhookSource) {
    return {
      kind: "unavailable",
      reason: `The ${integrationName} connection for this sandbox profile does not have an active webhook source.`,
      template,
    };
  }

  return {
    kind: "unavailable",
    reason: `The ${integrationName} connection has not synced the required event capability.`,
    template,
  };
}

function SourceSummary(input: { item: TriggerListItemViewModel }): React.JSX.Element {
  if (input.item.source.kind === "schedule") {
    const timing =
      input.item.source.nextScheduledAtLabel === null
        ? `Not scheduled ${input.item.source.timezoneOffsetLabel}`
        : `Next ${input.item.source.nextScheduledAtLabel} ${input.item.source.timezoneOffsetLabel}`;

    return (
      <>
        <span className="truncate font-mono text-xs text-muted-foreground">
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

function TriggerKindIcon(input: { kind: TriggerListItemViewModel["kind"] }): React.JSX.Element {
  if (input.kind === "schedule") {
    return (
      <>
        <CalendarDotsIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="sr-only">Scheduled trigger</span>
      </>
    );
  }

  return (
    <>
      <WebhooksLogoIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="sr-only">Webhook trigger</span>
    </>
  );
}

function ProfileTriggerListRow(input: {
  item: TriggerListItemViewModel;
  selected: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <div
      className={`w-full min-w-0 border-l-2 transition-colors ${
        input.selected
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      <div className="grid w-full min-w-0 grid-cols-[1.25rem_minmax(0,1fr)_1.25rem] gap-x-3 px-3 py-3">
        <span className="flex h-5 items-center justify-center">
          <TriggerIssueIndicator enabled={input.item.enabled} issue={input.item.issue} />
        </span>
        <button
          aria-current={input.selected ? "true" : undefined}
          aria-label={`Select trigger ${input.item.name}`}
          className="flex min-w-0 flex-col items-start text-left"
          onClick={input.onSelect}
          type="button"
        >
          <span className="block w-full truncate text-sm leading-5 font-semibold text-foreground">
            {input.item.name}
          </span>
          <span className="mt-2 flex min-w-0 flex-col gap-1">
            <SourceSummary item={input.item} />
          </span>
          <span className="mt-2 text-xs text-muted-foreground">
            Updated {input.item.updatedAtLabel}
          </span>
        </button>
        <span className="flex h-5 items-center justify-center">
          <TriggerKindIcon kind={input.item.kind} />
        </span>
      </div>
    </div>
  );
}

function ProfileTriggerDetail(input: { profileId: string }): React.JSX.Element {
  const navigate = useNavigate();
  const params = useParams();
  const triggerId = params["triggerId"];
  const backPath = createProfileTriggersPath(input.profileId);

  if (triggerId === undefined) {
    return (
      <div className="flex min-h-64 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Select a trigger to view and edit it.
      </div>
    );
  }

  return (
    <TriggerEditorContent
      triggerId={triggerId}
      backPath={backPath}
      deleteSuccessPath={backPath}
      navigate={navigate}
      requiredSandboxProfileId={input.profileId}
    />
  );
}

export function SandboxProfileTriggersSection(input: { profileId: string }): React.JSX.Element {
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isMobileTriggerSelectOpen, setIsMobileTriggerSelectOpen] = useState(false);
  const { after, before } = readKeysetPaginationCursors(searchParams);
  const triggerId = params["triggerId"];
  const shouldLoadTemplates = triggerId === undefined;
  const triggersQuery = useQuery({
    queryKey: triggersListQueryKey({
      limit: ProfileTriggersListLimit,
      after,
      before,
      sandboxProfileId: input.profileId,
    }),
    queryFn: async ({ signal }) =>
      listTriggers({
        limit: ProfileTriggersListLimit,
        after,
        before,
        sandboxProfileId: input.profileId,
        signal,
      }),
    retry: false,
  });
  const profileVersionsQuery = useQuery({
    queryKey: sandboxProfileVersionsQueryKey(input.profileId),
    queryFn: async ({ signal }) =>
      listSandboxProfileVersions({
        profileId: input.profileId,
        signal,
      }),
    enabled: shouldLoadTemplates,
    retry: false,
  });
  const activeSandboxProfileVersion = useMemo(
    () => resolveActiveSandboxProfileVersion(profileVersionsQuery.data?.versions ?? []),
    [profileVersionsQuery.data?.versions],
  );
  const triggerConfigQuery = useQuery({
    queryKey: sandboxProfileVersionTriggerConfigQueryKey({
      profileId: input.profileId,
      version: activeSandboxProfileVersion ?? 0,
    }),
    queryFn: async ({ signal }) => {
      if (activeSandboxProfileVersion === null) {
        throw new Error("An active sandbox profile version is required.");
      }

      return getSandboxProfileVersionTriggerConfig({
        profileId: input.profileId,
        version: activeSandboxProfileVersion,
        signal,
      });
    },
    enabled: shouldLoadTemplates && activeSandboxProfileVersion !== null,
    retry: false,
  });
  const eventPrerequisites = useWebhookTriggerEventPrerequisites({
    enabled: shouldLoadTemplates && activeSandboxProfileVersion !== null,
  });

  const items = triggersQuery.data?.items.map(toTriggerListItemViewModel) ?? [];
  const selectedTrigger =
    triggerId === undefined ? null : (items.find((item) => item.id === triggerId) ?? null);
  const errorMessage = triggersQuery.isError
    ? resolveApiErrorMessage({
        error: triggersQuery.error,
        fallbackMessage: "Could not load triggers.",
      })
    : null;
  const triggerTemplateAvailability = useMemo(() => {
    const triggerConfig = triggerConfigQuery.data;
    const directoryData = eventPrerequisites.directoryData;
    if (triggerConfig === undefined || directoryData === undefined) {
      return [];
    }

    const selectableConnectionIds = resolveEligibleProfileTriggerConnectionIds({
      bindings: triggerConfig.bindings,
      connections: directoryData.connections,
      targets: directoryData.targets,
    });
    const eventOptions = buildWebhookTriggerEventOptions({
      connections: directoryData.connections,
      targets: directoryData.targets,
      webhookSources: directoryData.webhookSources,
      selectableConnectionIds,
      selectedEventIds: [],
    });

    return TriggerTemplates.map((template) =>
      resolveTriggerTemplateAvailability({
        triggerConfig,
        connections: directoryData.connections,
        eventOptions,
        selectableConnectionIds,
        targets: directoryData.targets,
        template,
        webhookSources: directoryData.webhookSources,
      }),
    );
  }, [triggerConfigQuery.data, eventPrerequisites.directoryData]);
  const templateErrorMessage =
    profileVersionsQuery.isError || triggerConfigQuery.isError
      ? resolveApiErrorMessage({
          error: profileVersionsQuery.error ?? triggerConfigQuery.error,
          fallbackMessage: "Could not load trigger templates.",
        })
      : eventPrerequisites.errorMessage;
  const templatesPending =
    profileVersionsQuery.isPending ||
    (activeSandboxProfileVersion !== null &&
      (triggerConfigQuery.isPending || eventPrerequisites.isPending));

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

  function selectTrigger(item: TriggerListItemViewModel): void {
    void navigate(
      createProfileTriggerDetailPath({
        profileId: input.profileId,
        triggerId: item.id,
        searchParams,
      }),
    );
  }

  function createFromTemplate(templateId: string): void {
    void navigate(createTriggerCreatePath(input.profileId, templateId));
  }

  function goToNextPage(): void {
    const nextPage = triggersQuery.data?.nextPage;
    if (nextPage === null || nextPage === undefined) {
      return;
    }

    updatePagination({
      nextAfter: nextPage.after,
      nextBefore: null,
    });
  }

  function goToPreviousPage(): void {
    const previousPage = triggersQuery.data?.previousPage;
    if (previousPage === null || previousPage === undefined) {
      return;
    }

    updatePagination({
      nextAfter: null,
      nextBefore: previousPage.before,
    });
  }

  function renderPagination(): React.JSX.Element | null {
    if (triggersQuery.data?.nextPage == null && triggersQuery.data?.previousPage == null) {
      return null;
    }

    return (
      <TablePagination
        hasNextPage={triggersQuery.data?.nextPage != null}
        hasPreviousPage={triggersQuery.data?.previousPage != null}
        nextPageDisabled={triggersQuery.isFetching || triggersQuery.isPending}
        onNextPage={goToNextPage}
        onPreviousPage={goToPreviousPage}
        previousPageDisabled={triggersQuery.isFetching || triggersQuery.isPending}
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
        <Notice title="Could not load triggers" variant="alert">
          {errorMessage}
        </Notice>
      )}

      <div className="flex flex-col gap-3 md:hidden">
        <Button
          onClick={() => {
            void navigate(createTriggerCreatePath(input.profileId));
          }}
          type="button"
        >
          <PlusIcon />
          Create Trigger
        </Button>
        {triggersQuery.isPending || items.length === 0 ? null : (
          <Select
            onOpenChange={setIsMobileTriggerSelectOpen}
            onValueChange={(nextTriggerId) => {
              const nextTrigger = items.find((item) => item.id === nextTriggerId);
              if (nextTrigger === undefined) {
                return;
              }

              selectTrigger(nextTrigger);
              setIsMobileTriggerSelectOpen(false);
            }}
            value={selectedTrigger?.id ?? ""}
          >
            <SelectTrigger aria-label="Select trigger" className="w-full">
              <SelectValue placeholder="Select trigger">
                {selectedTrigger?.name ?? "Select trigger"}
              </SelectValue>
            </SelectTrigger>
            {isMobileTriggerSelectOpen ? (
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
        <nav aria-label="Triggers" className="hidden min-h-0 flex-col md:flex">
          <div className="py-3 pl-4 pr-3">
            <Button
              className="w-full justify-start"
              onClick={() => {
                void navigate(createTriggerCreatePath(input.profileId));
              }}
              type="button"
            >
              <PlusIcon />
              Create Trigger
            </Button>
          </div>
          {triggersQuery.isPending || items.length === 0
            ? null
            : items.map((item) => (
                <ProfileTriggerListRow
                  item={item}
                  key={item.id}
                  onSelect={() => {
                    selectTrigger(item);
                  }}
                  selected={item.id === triggerId}
                />
              ))}
          {renderDesktopPagination()}
        </nav>
        <div aria-hidden className="hidden bg-border md:block" />
        <div className="min-w-0 md:pl-8">
          {triggerId === undefined && !triggersQuery.isPending && errorMessage === null ? (
            <TriggerTemplateList
              errorMessage={templateErrorMessage}
              isPending={templatesPending}
              onCreateFromTemplate={createFromTemplate}
              templates={triggerTemplateAvailability}
            />
          ) : (
            <ProfileTriggerDetail profileId={input.profileId} />
          )}
        </div>
      </div>
    </div>
  );
}
