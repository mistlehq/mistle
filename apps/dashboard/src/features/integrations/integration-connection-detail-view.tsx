import { JiraSupportedWebhookEvents } from "@mistle/integrations-definitions";
import {
  Badge,
  Button,
  Notice,
  Select,
  SelectContent,
  SelectItem,
  SectionHeader,
  SelectTrigger,
  SelectValue,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@mistle/ui";
import {
  ArrowClockwiseIcon,
  CaretDownIcon,
  CaretRightIcon,
  InfoIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useState } from "react";

import type { IntegrationWebhookSourceSectionState } from "../pages/use-integration-webhook-source-state.js";
import { AutoSaveTitleHeading } from "../shared/auto-save-editable-heading.js";
import { CopyableValue } from "../shared/copyable-value.js";
import {
  formatConnectionStatusLabel,
  formatResourceCountSummary,
  formatResourceInlineMetadata,
  formatResourceLabel,
  formatSyncStateLabel,
  formatWebhookSourceStatusLabel,
} from "./integration-connection-detail-formatters.js";
import type {
  IntegrationConnectionResource,
  IntegrationWebhookSource,
} from "./integrations-service.js";

const JiraWebhookEventDisplayNameByType = new Map(
  JiraSupportedWebhookEvents.map((eventDefinition) => {
    return [eventDefinition.eventType, eventDefinition.displayName] as const;
  }),
);

export type IntegrationConnectionDetailResourceSummary = {
  count: number;
  isRefreshing?: boolean;
  kind: string;
  lastErrorMessage?: string;
  lastSyncedAt?: string;
  syncState: "never-synced" | "syncing" | "ready" | "error";
};

export type IntegrationConnectionDetailItem = {
  authFields?: readonly {
    label: string;
    value: string;
  }[];
  authSecretLabels?: readonly string[];
  authMethodId?: string | null;
  authMethodLabel?: string | null;
  bindingCount: number;
  canDelete: boolean;
  contextItems?: readonly {
    label: string;
    value: string;
  }[];
  displayName: string;
  id: string;
  installActionLabel?: string;
  resources: readonly IntegrationConnectionDetailResourceSummary[];
  setup?:
    | {
        description?: string;
        errorMessage?: string;
        isPending?: boolean;
        postInstallationSetupUrl?: string;
      }
    | undefined;
  status: "active" | "error" | "revoked";
};

export type IntegrationConnectionDetailViewProps = {
  connections: readonly IntegrationConnectionDetailItem[];
  logoKey?: string;
  onCreateWebhookSource?: (input: { connectionId: string }) => void;
  onDeleteConnection?: (connectionId: string) => void;
  onDeleteWebhookSource?: (input: { connectionId: string; webhookSourceId: string }) => void;
  onEditAuthentication?: (connectionId: string) => void;
  onStartGitHubAppInstallation?: (connectionId: string) => Promise<void> | void;
  onRefreshResource?: (input: { connectionId: string; kind: string }) => void;
  resourceContentByKey?: ReadonlyMap<
    string,
    {
      errorMessage: string | null;
      isLoading: boolean;
      items: readonly IntegrationConnectionResource[];
      kind: string;
    }
  >;
  titleEditor?:
    | {
        disabled: boolean;
        errorMessageByConnectionId: Readonly<Record<string, string | undefined>>;
        onStartEditing: (connectionId: string) => void;
        onSave: (connectionId: string, draftValue: string) => Promise<void> | void;
      }
    | undefined;
  webhookPolicy?:
    | {
        canCreateWebhookSource: boolean;
        canDeleteWebhookSource: boolean;
        showWebhookSources: boolean;
      }
    | undefined;
  webhookSourceStateByConnectionId?: ReadonlyMap<string, IntegrationWebhookSourceSectionState>;
};

type WebhookSectionUiState = {
  hideInlineDeleteAction: boolean;
  showCreateAction: boolean;
  showStandaloneDeleteAction: boolean;
  standaloneSource: IntegrationWebhookSource | undefined;
};

function resolveWebhookSectionUiState(input: {
  canCreateWebhookSource: boolean;
  canDeleteWebhookSource: boolean;
  state: IntegrationWebhookSourceSectionState;
}): WebhookSectionUiState {
  const standaloneSource = input.state.items.length === 1 ? input.state.items[0] : undefined;

  return {
    standaloneSource,
    hideInlineDeleteAction: standaloneSource !== undefined,
    showCreateAction: input.canCreateWebhookSource && input.state.items.length === 0,
    showStandaloneDeleteAction:
      standaloneSource !== undefined &&
      input.canDeleteWebhookSource &&
      standaloneSource.remoteRegistrationId !== undefined,
  };
}

function resolveConnectionDetailPaneViewState(input: {
  connection: IntegrationConnectionDetailItem;
  webhookPolicy: IntegrationConnectionDetailViewProps["webhookPolicy"];
  webhookSourceState: IntegrationWebhookSourceSectionState | undefined;
}) {
  const setup =
    input.connection.setup === undefined
      ? undefined
      : {
          ...input.connection.setup,
          ...(input.connection.authMethodId === "github-app-installation" &&
          input.webhookSourceState?.items[0]?.callbackUrl !== undefined
            ? { callbackUrl: input.webhookSourceState.items[0].callbackUrl }
            : {}),
        };
  const hasSetupSection =
    setup !== undefined &&
    (setup.description !== undefined ||
      setup.errorMessage !== undefined ||
      setup.postInstallationSetupUrl !== undefined ||
      ("callbackUrl" in setup && setup.callbackUrl !== undefined));
  const shouldRenderWebhookSection =
    input.webhookPolicy?.showWebhookSources === true && input.webhookSourceState !== undefined;

  return {
    hasSetupSection,
    setup,
    webhookSectionUiState:
      !shouldRenderWebhookSection || input.webhookSourceState === undefined
        ? null
        : resolveWebhookSectionUiState({
            canCreateWebhookSource: input.webhookPolicy?.canCreateWebhookSource === true,
            canDeleteWebhookSource: input.webhookPolicy?.canDeleteWebhookSource === true,
            state: input.webhookSourceState,
          }),
  };
}

export function IntegrationConnectionDetailView(
  props: IntegrationConnectionDetailViewProps,
): React.JSX.Element {
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(
    props.connections[0]?.id ?? null,
  );

  if (props.connections.length === 0) {
    return <p className="text-muted-foreground text-sm">No connections found for this target.</p>;
  }

  const selectedConnection =
    props.connections.find((connection) => connection.id === selectedConnectionId) ??
    props.connections[0];

  if (selectedConnection === undefined) {
    throw new Error("Expected at least one integration connection.");
  }

  const selectedWebhookSourceState = props.webhookSourceStateByConnectionId?.get(
    selectedConnection.id,
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="md:hidden">
        <Select
          onValueChange={(nextConnectionId) => {
            setSelectedConnectionId(nextConnectionId);
          }}
          value={selectedConnection.id}
        >
          <SelectTrigger aria-label="Select connection" className="w-full">
            <SelectValue placeholder="Select connection">
              {selectedConnection.displayName}
            </SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {props.connections.map((connection) => (
              <SelectItem key={connection.id} value={connection.id}>
                {connection.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-6 md:grid md:grid-cols-[10rem_1px_minmax(0,1fr)] md:gap-0 lg:grid-cols-[11rem_1px_minmax(0,1fr)]">
        <nav aria-label="Connections" className="hidden flex-col md:flex">
          {props.connections.map((connection) => {
            const isSelected = connection.id === selectedConnection.id;
            return (
              <button
                aria-current={isSelected ? "true" : undefined}
                aria-label={`Select connection ${connection.displayName}`}
                className={`flex w-full flex-col items-start gap-1 border-l-2 py-3 pl-4 pr-3 text-left transition-colors ${
                  isSelected
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                key={connection.id}
                onClick={() => {
                  setSelectedConnectionId(connection.id);
                }}
                type="button"
              >
                <span className="text-sm font-medium leading-tight">{connection.displayName}</span>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {connection.authMethodLabel === undefined ||
                  connection.authMethodLabel === null ? null : (
                    <span>{connection.authMethodLabel}</span>
                  )}
                  {connection.status === "active" ? null : (
                    <Badge variant="outline">
                      {formatConnectionStatusLabel(connection.status)}
                    </Badge>
                  )}
                </div>
              </button>
            );
          })}
        </nav>
        <div aria-hidden className="bg-border hidden md:block" />
        <div className="min-w-0 md:pl-8">
          <ConnectionDetailPane
            connection={selectedConnection}
            {...(props.onCreateWebhookSource === undefined
              ? {}
              : { onCreateWebhookSource: props.onCreateWebhookSource })}
            {...(props.onDeleteConnection === undefined
              ? {}
              : { onDeleteConnection: props.onDeleteConnection })}
            {...(props.onDeleteWebhookSource === undefined
              ? {}
              : { onDeleteWebhookSource: props.onDeleteWebhookSource })}
            {...(props.onEditAuthentication === undefined
              ? {}
              : { onEditAuthentication: props.onEditAuthentication })}
            {...(props.onRefreshResource === undefined
              ? {}
              : { onRefreshResource: props.onRefreshResource })}
            {...(props.onStartGitHubAppInstallation === undefined
              ? {}
              : { onStartGitHubAppInstallation: props.onStartGitHubAppInstallation })}
            {...(props.resourceContentByKey === undefined
              ? {}
              : { resourceContentByKey: props.resourceContentByKey })}
            {...(props.webhookPolicy === undefined ? {} : { webhookPolicy: props.webhookPolicy })}
            {...(props.titleEditor === undefined ? {} : { titleEditor: props.titleEditor })}
            {...(selectedWebhookSourceState === undefined
              ? {}
              : { webhookSourceState: selectedWebhookSourceState })}
          />
        </div>
      </div>
    </div>
  );
}

function ConnectionDetailPane(input: {
  connection: IntegrationConnectionDetailItem;
  onCreateWebhookSource?: (input: { connectionId: string }) => void;
  onDeleteConnection?: (connectionId: string) => void;
  onDeleteWebhookSource?: (input: { connectionId: string; webhookSourceId: string }) => void;
  onEditAuthentication?: (connectionId: string) => void;
  onStartGitHubAppInstallation?: (connectionId: string) => Promise<void> | void;
  onRefreshResource?: (input: { connectionId: string; kind: string }) => void;
  resourceContentByKey?: IntegrationConnectionDetailViewProps["resourceContentByKey"];
  titleEditor?: IntegrationConnectionDetailViewProps["titleEditor"];
  webhookPolicy?: IntegrationConnectionDetailViewProps["webhookPolicy"];
  webhookSourceState?: IntegrationWebhookSourceSectionState;
}): React.JSX.Element {
  const deleteConnectionMessage = resolveDeleteConnectionMessage(input.connection);
  const webhookSourceState = input.webhookSourceState;
  const viewState = resolveConnectionDetailPaneViewState({
    connection: input.connection,
    webhookPolicy: input.webhookPolicy,
    webhookSourceState,
  });

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 gap-3 flex flex-col items-start">
            {input.titleEditor ? (
              <EditableConnectionTitle
                connection={input.connection}
                titleEditor={input.titleEditor}
              />
            ) : (
              <h2 className="text-base font-semibold leading-tight">
                {input.connection.displayName}
              </h2>
            )}
            {input.connection.status === "active" ? null : (
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">
                  {formatConnectionStatusLabel(input.connection.status)}
                </Badge>
              </div>
            )}
          </div>
          {input.onDeleteConnection ? (
            deleteConnectionMessage === null ? (
              <Button
                aria-label={`Delete connection ${input.connection.displayName}`}
                className="mt-0.5 shrink-0"
                onClick={() => {
                  input.onDeleteConnection?.(input.connection.id);
                }}
                size="icon-sm"
                type="button"
                variant="outline"
                title="Delete connection"
              >
                <TrashIcon aria-hidden className="size-4" />
              </Button>
            ) : (
              <Tooltip delay={0}>
                <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
                  <Button
                    aria-label={`Delete connection ${input.connection.displayName}`}
                    className="mt-0.5 shrink-0"
                    disabled={true}
                    size="icon-sm"
                    type="button"
                    variant="outline"
                    title={deleteConnectionMessage}
                  >
                    <TrashIcon aria-hidden className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">{deleteConnectionMessage}</TooltipContent>
              </Tooltip>
            )
          ) : null}
        </div>
      </header>

      {viewState.hasSetupSection ? (
        <SectionBlock
          action={
            input.onStartGitHubAppInstallation !== undefined &&
            input.connection.installActionLabel !== undefined ? (
              <Button
                disabled={input.connection.setup?.isPending ?? false}
                onClick={() => {
                  void input.onStartGitHubAppInstallation?.(input.connection.id);
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                {input.connection.setup?.isPending === true
                  ? "Starting install..."
                  : input.connection.installActionLabel}
              </Button>
            ) : null
          }
          title="Setup"
        >
          <div className="flex flex-col gap-4">
            <SetupSection
              {...(viewState.setup === undefined ||
              !("callbackUrl" in viewState.setup) ||
              viewState.setup.callbackUrl === undefined
                ? {}
                : { callbackUrl: viewState.setup.callbackUrl })}
              {...(viewState.setup?.description === undefined
                ? {}
                : { description: viewState.setup.description })}
              {...(viewState.setup?.postInstallationSetupUrl === undefined
                ? {}
                : { postInstallationSetupUrl: viewState.setup.postInstallationSetupUrl })}
            />
            {viewState.setup?.errorMessage === undefined ? null : (
              <Notice variant="alert">{viewState.setup.errorMessage}</Notice>
            )}
          </div>
        </SectionBlock>
      ) : null}

      <SectionBlock
        action={
          input.connection.authMethodId !== undefined &&
          input.connection.authMethodId !== null &&
          input.onEditAuthentication !== undefined ? (
            <Button
              aria-label="Edit"
              onClick={() => {
                input.onEditAuthentication?.(input.connection.id);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              Edit
            </Button>
          ) : viewState.hasSetupSection ||
            input.onStartGitHubAppInstallation === undefined ||
            input.connection.installActionLabel === undefined ? null : (
            <Button
              disabled={input.connection.setup?.isPending ?? false}
              onClick={() => {
                void input.onStartGitHubAppInstallation?.(input.connection.id);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              {input.connection.setup?.isPending === true
                ? "Starting install..."
                : input.connection.installActionLabel}
            </Button>
          )
        }
        title="Authentication"
      >
        <ConnectionAuthSection
          authMethodId={input.connection.authMethodId}
          authMethodLabel={input.connection.authMethodLabel}
          {...(input.connection.authFields === undefined
            ? {}
            : { authFields: input.connection.authFields })}
          {...(input.connection.authSecretLabels === undefined
            ? {}
            : { authSecretLabels: input.connection.authSecretLabels })}
        />
      </SectionBlock>

      {input.connection.resources.length === 0 ? null : (
        <SectionBlock title="Resources">
          <ResourcesSection
            connectionId={input.connection.id}
            onRefreshResource={input.onRefreshResource}
            resourceContentByKey={input.resourceContentByKey}
            resources={input.connection.resources}
          />
        </SectionBlock>
      )}

      {viewState.webhookSectionUiState !== null && webhookSourceState !== undefined ? (
        <SectionBlock
          action={
            viewState.webhookSectionUiState.showCreateAction === true &&
            input.onCreateWebhookSource !== undefined ? (
              <Button
                disabled={webhookSourceState.isCreating}
                onClick={() => {
                  input.onCreateWebhookSource?.({ connectionId: input.connection.id });
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                {webhookSourceState.isCreating ? "Creating..." : "Create webhook"}
              </Button>
            ) : viewState.webhookSectionUiState.showStandaloneDeleteAction === true &&
              viewState.webhookSectionUiState.standaloneSource !== undefined &&
              input.onDeleteWebhookSource !== undefined ? (
              (() => {
                const standaloneSource = viewState.webhookSectionUiState.standaloneSource;

                return (
                  <Button
                    aria-label={`Delete webhook source ${standaloneSource.displayName}`}
                    disabled={webhookSourceState.deletingWebhookSourceId === standaloneSource.id}
                    onClick={() => {
                      input.onDeleteWebhookSource?.({
                        connectionId: input.connection.id,
                        webhookSourceId: standaloneSource.id,
                      });
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {webhookSourceState.deletingWebhookSourceId === standaloneSource.id
                      ? "Deleting..."
                      : "Delete webhook"}
                  </Button>
                );
              })()
            ) : null
          }
          title="Webhook"
        >
          <WebhookSourcesSection
            connectionId={input.connection.id}
            hideDeleteAction={viewState.webhookSectionUiState.hideInlineDeleteAction}
            onCreateWebhookSource={undefined}
            onDeleteWebhookSource={input.onDeleteWebhookSource}
            state={webhookSourceState}
          />
        </SectionBlock>
      ) : null}

      {input.connection.contextItems === undefined ||
      input.connection.contextItems.length === 0 ? null : (
        <SectionBlock title="Details">
          <div className="flex flex-col gap-4">
            <div className="gap-3 grid grid-cols-1 md:grid-cols-2">
              {input.connection.contextItems.map((item) => (
                <MetadataField key={item.label} label={item.label} value={item.value} />
              ))}
            </div>
          </div>
        </SectionBlock>
      )}
    </section>
  );
}

function SectionBlock(input: {
  action?: React.ReactNode;
  children: React.ReactNode;
  description?: string;
  title: string;
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-0">
      <div className="flex flex-col gap-0">
        <SectionHeader action={input.action} title={input.title} />
        {input.description === undefined ? null : (
          <p className="text-muted-foreground text-xs">{input.description}</p>
        )}
      </div>
      {input.children}
    </section>
  );
}

function resolveDeleteConnectionMessage(
  connection: Pick<IntegrationConnectionDetailItem, "bindingCount" | "canDelete">,
): string | null {
  if (connection.canDelete) {
    return null;
  }

  if (connection.bindingCount > 0) {
    return `This connection can't be deleted while it has ${connection.bindingCount} ${connection.bindingCount === 1 ? "binding" : "bindings"}.`;
  }

  return "This connection can't be deleted while it is still in use.";
}

function EditableConnectionTitle(input: {
  connection: IntegrationConnectionDetailItem;
  titleEditor: NonNullable<IntegrationConnectionDetailViewProps["titleEditor"]>;
}): React.JSX.Element {
  const connectionErrorMessage = input.titleEditor.errorMessageByConnectionId[input.connection.id];

  return (
    <AutoSaveTitleHeading
      ariaLabel="Connection name"
      disabled={input.titleEditor.disabled}
      emptyDisplayText={input.connection.displayName}
      editButtonLabel="Edit connection name"
      headingClassName="text-base font-semibold leading-tight"
      maxWidthClassName="max-w-3xl"
      onEditStart={() => {
        input.titleEditor.onStartEditing(input.connection.id);
      }}
      onSave={async (nextValue) => {
        await input.titleEditor.onSave(input.connection.id, nextValue.trim());
      }}
      placeholder="Connection name"
      requiredLabel="Connection name"
      value={input.connection.displayName}
      {...(connectionErrorMessage === undefined ? {} : { errorMessage: connectionErrorMessage })}
    />
  );
}

function shouldShowResourceSyncStateBadge(
  syncState: IntegrationConnectionDetailResourceSummary["syncState"],
): boolean {
  return syncState !== "ready" && syncState !== "syncing";
}

function ConnectionAuthSection(input: {
  authFields?: readonly {
    label: string;
    value: string;
  }[];
  authSecretLabels?: readonly string[];
  authMethodId: IntegrationConnectionDetailItem["authMethodId"] | undefined;
  authMethodLabel: string | null | undefined;
}): React.JSX.Element | null {
  const authFields =
    input.authFields === undefined || input.authFields.length === 0
      ? input.authMethodLabel === undefined || input.authMethodLabel === null
        ? []
        : [{ label: "Method", value: input.authMethodLabel }]
      : input.authFields;

  if (authFields.length === 0) {
    return null;
  }
  const authSecretLabels = input.authSecretLabels ?? [];

  return (
    <div
      aria-label="Connection authentication"
      className="gap-3 flex flex-col"
      {...(input.authMethodId === undefined ? {} : { "data-auth-method-id": input.authMethodId })}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {authFields.map((field) => (
          <MetadataField key={field.label} label={field.label} value={field.value} />
        ))}
        {authSecretLabels.map((label) => (
          <MetadataField key={label} label={label} value="**********" />
        ))}
      </div>
    </div>
  );
}

function MetadataField(input: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="gap-1.5 flex flex-col">
      <p className="text-muted-foreground text-xs uppercase tracking-wide">{input.label}</p>
      <p className="break-all text-sm">{input.value}</p>
    </div>
  );
}

function MetadataBadgeListField(input: {
  items: readonly string[];
  label: string;
}): React.JSX.Element | null {
  if (input.items.length === 0) {
    return null;
  }

  return (
    <div className="gap-1.5 flex flex-col">
      <p className="text-muted-foreground text-xs uppercase tracking-wide">{input.label}</p>
      <div className="flex flex-wrap gap-2">
        {input.items.map((item) => (
          <span className="rounded-full border px-2.5 py-1 text-xs" key={item}>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function SetupSection(input: {
  callbackUrl?: string;
  description?: string;
  postInstallationSetupUrl?: string;
}): React.JSX.Element | null {
  if (
    input.description === undefined &&
    input.callbackUrl === undefined &&
    input.postInstallationSetupUrl === undefined
  ) {
    return null;
  }

  const resolvedPostInstallationSetupUrl = resolveGitHubPostInstallationSetupUrl({
    ...(input.callbackUrl === undefined ? {} : { callbackUrl: input.callbackUrl }),
    ...(input.postInstallationSetupUrl === undefined
      ? {}
      : { fallbackUrl: input.postInstallationSetupUrl }),
  });

  return (
    <div className="gap-3 flex flex-col">
      {input.description === undefined ? null : (
        <p className="text-muted-foreground text-xs">{input.description}</p>
      )}
      {resolvedPostInstallationSetupUrl === undefined && input.callbackUrl === undefined ? null : (
        <div className="flex flex-col gap-3">
          {resolvedPostInstallationSetupUrl === undefined ? null : (
            <CopyableValue
              label="Post-installation setup URL"
              value={resolvedPostInstallationSetupUrl}
            />
          )}
          {input.callbackUrl === undefined ? null : (
            <CopyableValue label="Webhook callback URL" value={input.callbackUrl} />
          )}
        </div>
      )}
    </div>
  );
}

function resolveGitHubPostInstallationSetupUrl(input: {
  callbackUrl?: string;
  fallbackUrl?: string;
}): string | undefined {
  if (input.callbackUrl !== undefined) {
    try {
      return new URL(
        "/p/integration/callbacks/github-app-installation",
        input.callbackUrl,
      ).toString();
    } catch {
      return input.fallbackUrl;
    }
  }

  return input.fallbackUrl;
}

function ResourceScopeRow(input: {
  className?: string;
  connectionId: string;
  onRefreshResource: ((input: { connectionId: string; kind: string }) => void) | undefined;
  resource: IntegrationConnectionDetailResourceSummary;
  resourceItems: {
    errorMessage: string | null;
    isLoading: boolean;
    items: readonly IntegrationConnectionResource[];
    kind: string;
  } | null;
}): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const resourceLabel = formatResourceLabel(input.resource.kind);
  const rowClassName = [input.className].filter(Boolean).join(" ");
  const resourceCount = input.resource.count;
  const resourceStateIndicator = resolveResourceStateIndicator({
    errorMessage: input.resourceItems?.errorMessage ?? null,
    kindLabel: resourceLabel,
  });
  const shouldReplaceMetadataWithPreviewError = input.resourceItems?.errorMessage != null;

  return (
    <div className={rowClassName}>
      <div className={`flex flex-col gap-2 pt-1 ${isExpanded ? "pb-4" : "pb-1"}`}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex items-center gap-2">
            <Button
              aria-label={`${isExpanded ? "Collapse" : "Expand"} ${resourceLabel.toLowerCase()} resources`}
              className="-ml-2 h-auto justify-start rounded-sm px-1 py-0 text-left text-muted-foreground shadow-none transition-colors hover:bg-transparent hover:text-foreground"
              onClick={() => {
                setIsExpanded((current) => !current);
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              {isExpanded ? (
                <CaretDownIcon aria-hidden className="size-4" />
              ) : (
                <CaretRightIcon aria-hidden className="size-4" />
              )}
              <span className="text-sm font-medium leading-tight">
                {resourceLabel} <span className="text-current/80">- {resourceCount}</span>
              </span>
            </Button>
            {shouldShowResourceSyncStateBadge(input.resource.syncState) ? (
              <Badge variant="secondary">{formatSyncStateLabel(input.resource.syncState)}</Badge>
            ) : null}
          </div>
          <div className="flex items-center gap-2 sm:shrink-0">
            {shouldReplaceMetadataWithPreviewError ? (
              <div className="flex items-center">{resourceStateIndicator}</div>
            ) : (
              <div className="text-muted-foreground text-xs">
                <span className="sr-only">{formatResourceCountSummary(input.resource)}. </span>
                {formatResourceInlineMetadata(input.resource)}
              </div>
            )}
            {input.onRefreshResource ? (
              <Button
                aria-label={`Refresh ${input.resource.kind}`}
                disabled={input.resource.isRefreshing === true}
                onClick={() => {
                  input.onRefreshResource?.({
                    connectionId: input.connectionId,
                    kind: input.resource.kind,
                  });
                }}
                size="icon-sm"
                title="Sync resource"
                type="button"
                variant="outline"
              >
                <ArrowClockwiseIcon
                  aria-hidden
                  className={
                    input.resource.isRefreshing === true ? "size-4 animate-spin" : "size-4"
                  }
                />
              </Button>
            ) : null}
          </div>
        </div>
        {input.resource.lastErrorMessage ? (
          <Notice variant="alert">{input.resource.lastErrorMessage}</Notice>
        ) : null}
        {input.resourceItems?.errorMessage === null ? resourceStateIndicator : null}
        {isExpanded && input.resourceItems !== null && input.resourceItems.items.length > 0 ? (
          <div className="gap-2 flex flex-wrap pl-5">
            {input.resourceItems.items.map((item) => (
              <span className="rounded-full border px-2.5 py-1 text-xs" key={item.id}>
                {item.displayName}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ResourcesSection(input: {
  connectionId: string;
  onRefreshResource: ((input: { connectionId: string; kind: string }) => void) | undefined;
  resourceContentByKey: IntegrationConnectionDetailViewProps["resourceContentByKey"];
  resources: readonly IntegrationConnectionDetailResourceSummary[];
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      {input.resources.map((resource, index) => (
        <ResourceScopeRow
          connectionId={input.connectionId}
          key={`${input.connectionId}:${resource.kind}`}
          onRefreshResource={input.onRefreshResource}
          resource={resource}
          resourceItems={
            input.resourceContentByKey?.get(`${input.connectionId}:${resource.kind}`) ?? null
          }
          {...(index === 0 ? {} : { className: "" })}
        />
      ))}
    </div>
  );
}

function resolveResourceStateIndicator(input: {
  errorMessage: string | null;
  kindLabel: string;
}): React.JSX.Element | null {
  if (input.errorMessage !== null) {
    return (
      <Tooltip delay={0}>
        <TooltipTrigger
          aria-label={`View ${input.kindLabel.toLowerCase()} load error`}
          render={<Badge render={<span aria-hidden="true" />} variant="destructive" />}
        >
          Error
          <InfoIcon className="size-3.5" data-icon="inline-end" />
        </TooltipTrigger>
        <TooltipContent className="max-w-80 whitespace-pre-wrap text-left" side="top">
          {input.errorMessage}
        </TooltipContent>
      </Tooltip>
    );
  }

  return null;
}

function WebhookSourcesSection(input: {
  connectionId: string;
  hideDeleteAction: boolean;
  onCreateWebhookSource: ((input: { connectionId: string }) => void) | undefined;
  onDeleteWebhookSource:
    | ((input: { connectionId: string; webhookSourceId: string }) => void)
    | undefined;
  state: IntegrationWebhookSourceSectionState;
}): React.JSX.Element {
  return (
    <div className="gap-3 pt-2 flex flex-col">
      {input.onCreateWebhookSource ? (
        <div className="flex items-start justify-end gap-3">
          <Button
            disabled={input.state.isCreating}
            onClick={() => {
              input.onCreateWebhookSource?.({
                connectionId: input.connectionId,
              });
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            {input.state.isCreating ? "Creating..." : "Create webhook"}
          </Button>
        </div>
      ) : null}

      {input.state.loadErrorMessage === null ? null : (
        <Notice variant="alert">{input.state.loadErrorMessage}</Notice>
      )}
      {input.state.createErrorMessage === null ? null : (
        <Notice variant="alert">{input.state.createErrorMessage}</Notice>
      )}
      {input.state.deleteErrorMessage === null ? null : (
        <Notice variant="alert">{input.state.deleteErrorMessage}</Notice>
      )}
      {input.state.revealedWebhookSecret === null ? null : (
        <Notice title="Webhook secret">
          <code className="break-all text-xs">{input.state.revealedWebhookSecret}</code>
        </Notice>
      )}

      {input.state.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading webhook sources...</p>
      ) : input.state.items.length === 0 ? (
        <Notice>
          {input.onCreateWebhookSource === undefined
            ? "No webhook is configured for this connection."
            : "Create a webhook to receive events."}
        </Notice>
      ) : (
        <div className="gap-3 flex flex-col">
          {input.state.items.map((source) => (
            <WebhookSourceCard
              connectionId={input.connectionId}
              deletingWebhookSourceId={input.state.deletingWebhookSourceId}
              hideDeleteAction={input.hideDeleteAction}
              key={source.id}
              onDeleteWebhookSource={input.onDeleteWebhookSource}
              source={source}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WebhookSourceCard(input: {
  connectionId: string;
  deletingWebhookSourceId: string | null;
  hideDeleteAction: boolean;
  onDeleteWebhookSource:
    | ((input: { connectionId: string; webhookSourceId: string }) => void)
    | undefined;
  source: IntegrationWebhookSource;
}): React.JSX.Element {
  const isDeleting = input.deletingWebhookSourceId === input.source.id;
  const isDeleteSupported =
    !input.hideDeleteAction &&
    input.onDeleteWebhookSource !== undefined &&
    input.source.remoteRegistrationId !== undefined;
  const registeredEventLabels = resolveWebhookRegisteredEventLabels(input.source.providerMetadata);
  const shouldShowHeaderText = !input.hideDeleteAction && input.source.displayName !== "";
  const shouldShowHeaderRow = shouldShowHeaderText || isDeleteSupported;

  return (
    <div className="flex flex-col gap-3">
      {shouldShowHeaderRow ? (
        <div className="flex items-start justify-between gap-3">
          {shouldShowHeaderText ? (
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              {input.source.displayName}
            </p>
          ) : (
            <span />
          )}
          {isDeleteSupported ? (
            <Button
              aria-label={`Delete webhook source ${input.source.displayName}`}
              disabled={isDeleting}
              onClick={() => {
                input.onDeleteWebhookSource?.({
                  connectionId: input.connectionId,
                  webhookSourceId: input.source.id,
                });
              }}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <TrashIcon aria-hidden className="size-4" />
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="gap-3 flex flex-col">
        <div className="gap-1.5 flex flex-col">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">Status</p>
          <p className="text-sm">{formatWebhookSourceStatusLabel(input.source.status)}</p>
        </div>
        {input.source.remoteRegistrationId === undefined ? null : (
          <MetadataField label="Provider registration" value={input.source.remoteRegistrationId} />
        )}
        <MetadataBadgeListField items={registeredEventLabels} label="Registered events" />
        {input.source.callbackUrl === undefined ? null : (
          <CopyableValue label="Webhook URL" value={input.source.callbackUrl} />
        )}
      </div>
    </div>
  );
}

function isStringArray(input: unknown): input is string[] {
  return Array.isArray(input) && input.every((item) => typeof item === "string");
}

function resolveWebhookRegisteredEventLabels(
  providerMetadata: IntegrationWebhookSource["providerMetadata"],
): readonly string[] {
  const registeredEvents = providerMetadata["registeredEvents"];

  if (!isStringArray(registeredEvents)) {
    return [];
  }

  return registeredEvents.map((eventType): string => {
    return JiraWebhookEventDisplayNameByType.get(eventType) ?? eventType;
  });
}
