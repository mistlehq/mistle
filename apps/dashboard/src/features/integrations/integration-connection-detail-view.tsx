import { Badge, Button, Notice } from "@mistle/ui";
import { ArrowClockwiseIcon, PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";

import type { IntegrationWebhookSourceSectionState } from "../pages/use-integration-webhook-source-state.js";
import { AutoSaveEditableHeading } from "../shared/auto-save-editable-heading.js";
import {
  formatConnectionStatusLabel,
  formatResourceHeading,
  formatResourceInlineMetadata,
  formatSyncStateLabel,
} from "./integration-connection-detail-formatters.js";
import type {
  IntegrationConnectionResource,
  IntegrationWebhookSource,
} from "./integrations-service.js";

export type IntegrationConnectionDetailResourceSummary = {
  count: number;
  isRefreshing?: boolean;
  kind: string;
  lastErrorMessage?: string;
  lastSyncedAt?: string;
  syncState: "never-synced" | "syncing" | "ready" | "error";
};

export type IntegrationConnectionDetailItem = {
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
  resources: readonly IntegrationConnectionDetailResourceSummary[];
  status: "active" | "error" | "revoked";
};

export type IntegrationConnectionDetailViewProps = {
  connections: readonly IntegrationConnectionDetailItem[];
  logoKey?: string;
  onCreateWebhookSource?: (input: { connectionId: string }) => void;
  onDeleteConnection?: (connectionId: string) => void;
  onDeleteWebhookSource?: (input: { connectionId: string; webhookSourceId: string }) => void;
  onEditApiKey?: (connectionId: string) => void;
  onRefreshResource?: (input: { connectionId: string; kind: string }) => void;
  resourceItemsByKey?: ReadonlyMap<
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
  showWebhookSources?: boolean;
  webhookSourceStateByConnectionId?: ReadonlyMap<string, IntegrationWebhookSourceSectionState>;
};

export function IntegrationConnectionDetailView(
  props: IntegrationConnectionDetailViewProps,
): React.JSX.Element {
  if (props.connections.length === 0) {
    return (
      <div className="overflow-hidden rounded-md border bg-card">
        <div className="p-4">
          <p className="text-muted-foreground text-sm">No connections found for this target.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {props.connections.map((connection) => (
        <ConnectionCardWithOptionalProps
          connection={connection}
          key={connection.id}
          props={props}
        />
      ))}
    </div>
  );
}

function ConnectionCardWithOptionalProps(input: {
  connection: IntegrationConnectionDetailItem;
  props: IntegrationConnectionDetailViewProps;
}): React.JSX.Element {
  const webhookSourceState =
    input.props.webhookSourceStateByConnectionId?.get(input.connection.id) ?? undefined;

  return (
    <ConnectionCard
      connection={input.connection}
      {...(input.props.onDeleteConnection === undefined
        ? {}
        : { onDeleteConnection: input.props.onDeleteConnection })}
      {...(input.props.onEditApiKey === undefined
        ? {}
        : { onEditApiKey: input.props.onEditApiKey })}
      {...(input.props.onRefreshResource === undefined
        ? {}
        : { onRefreshResource: input.props.onRefreshResource })}
      {...(input.props.resourceItemsByKey === undefined
        ? {}
        : { resourceItemsByKey: input.props.resourceItemsByKey })}
      {...(webhookSourceState === undefined ? {} : { webhookSourceState })}
      {...(input.props.onCreateWebhookSource === undefined
        ? {}
        : { onCreateWebhookSource: input.props.onCreateWebhookSource })}
      {...(input.props.onDeleteWebhookSource === undefined
        ? {}
        : { onDeleteWebhookSource: input.props.onDeleteWebhookSource })}
      {...(input.props.showWebhookSources === undefined
        ? {}
        : { showWebhookSources: input.props.showWebhookSources })}
      {...(input.props.titleEditor === undefined ? {} : { titleEditor: input.props.titleEditor })}
    />
  );
}

function ConnectionCard(input: {
  connection: IntegrationConnectionDetailItem;
  onCreateWebhookSource?: (input: { connectionId: string }) => void;
  onDeleteConnection?: (connectionId: string) => void;
  onDeleteWebhookSource?: (input: { connectionId: string; webhookSourceId: string }) => void;
  onEditApiKey?: (connectionId: string) => void;
  onRefreshResource?: (input: { connectionId: string; kind: string }) => void;
  resourceItemsByKey?: IntegrationConnectionDetailViewProps["resourceItemsByKey"];
  showWebhookSources?: boolean;
  titleEditor?: IntegrationConnectionDetailViewProps["titleEditor"];
  webhookSourceState?: IntegrationWebhookSourceSectionState;
}): React.JSX.Element {
  return (
    <section className="gap-4 flex flex-col overflow-hidden rounded-md border bg-card p-4">
      <div className="gap-4 flex flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="gap-2 flex flex-wrap items-start">
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
              <Badge variant="outline">
                {formatConnectionStatusLabel(input.connection.status)}
              </Badge>
            )}
          </div>
          {input.onDeleteConnection && input.connection.canDelete ? (
            <Button
              aria-label={`Delete connection ${input.connection.displayName}`}
              className="shrink-0"
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
          ) : null}
        </div>
        <ConnectionAuthSection
          authMethodId={input.connection.authMethodId}
          authMethodLabel={input.connection.authMethodLabel}
          connectionId={input.connection.id}
          onEditApiKey={input.onEditApiKey}
        />
      </div>

      {input.connection.contextItems === undefined ||
      input.connection.contextItems.length === 0 ? null : (
        <div className="gap-3 flex flex-col">
          <h3 className="font-medium text-sm">Connection context</h3>
          <div className="gap-3 grid grid-cols-1 md:grid-cols-2">
            {input.connection.contextItems.map((item) => (
              <MetadataField key={item.label} label={item.label} value={item.value} />
            ))}
          </div>
        </div>
      )}

      {input.connection.resources.length === 0 ? null : (
        <div className="gap-2 flex flex-col">
          <div>
            {input.connection.resources.map((resource) => (
              <ResourceSection
                connectionId={input.connection.id}
                key={resource.kind}
                onRefreshResource={input.onRefreshResource}
                resource={resource}
                resourceItems={
                  input.resourceItemsByKey?.get(`${input.connection.id}:${resource.kind}`) ?? null
                }
              />
            ))}
          </div>
        </div>
      )}

      {input.showWebhookSources === true && input.webhookSourceState !== undefined ? (
        <WebhookSourcesSection
          connectionId={input.connection.id}
          onCreateWebhookSource={input.onCreateWebhookSource}
          onDeleteWebhookSource={input.onDeleteWebhookSource}
          state={input.webhookSourceState}
        />
      ) : null}
    </section>
  );
}

function EditableConnectionTitle(input: {
  connection: IntegrationConnectionDetailItem;
  titleEditor: NonNullable<IntegrationConnectionDetailViewProps["titleEditor"]>;
}): React.JSX.Element {
  const connectionErrorMessage = input.titleEditor.errorMessageByConnectionId[input.connection.id];

  return (
    <AutoSaveEditableHeading
      ariaLabel="Connection name"
      disabled={input.titleEditor.disabled}
      editButtonLabel="Edit connection name"
      headingClassName="text-base font-semibold leading-tight"
      value={input.connection.displayName}
      maxWidthClassName="max-w-3xl"
      onEditStart={() => {
        input.titleEditor.onStartEditing(input.connection.id);
      }}
      onSave={async (nextValue) => {
        await input.titleEditor.onSave(input.connection.id, nextValue.trim());
      }}
      placeholder="Connection name"
      validate={(nextValue) => {
        return nextValue.trim().length === 0 ? "Connection name is required." : null;
      }}
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
  authMethodId: IntegrationConnectionDetailItem["authMethodId"] | undefined;
  authMethodLabel: string | null | undefined;
  connectionId: string;
  onEditApiKey: ((connectionId: string) => void) | undefined;
}): React.JSX.Element | null {
  if (input.authMethodLabel === undefined || input.authMethodLabel === null) {
    return null;
  }

  if (input.authMethodId === "api-key") {
    return (
      <div
        aria-label="Connection authentication"
        className="gap-1 flex flex-col"
        data-auth-method-id="api-key"
      >
        <InlineField label="Auth method" value="API key" />
        <div
          aria-label="Masked API key value"
          className="inline-flex items-center gap-1.5 text-sm"
          data-api-key-state="masked"
        >
          <InlineField label="API key" value="**********" />
          {input.onEditApiKey ? (
            <Button
              aria-label="Edit API key"
              onClick={() => {
                input.onEditApiKey?.(input.connectionId);
              }}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <PencilSimpleIcon aria-hidden className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return <InlineField label="Auth method" value={input.authMethodLabel} />;
}

function InlineField(input: { label: string; value: string }): React.JSX.Element {
  return (
    <p className="text-sm leading-tight">
      <span>{input.label}:</span> <span>{input.value}</span>
    </p>
  );
}

function MetadataField(input: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-md border p-3">
      <p className="text-muted-foreground text-xs uppercase tracking-wide">{input.label}</p>
      <p className="mt-1 text-sm">{input.value}</p>
    </div>
  );
}

function ResourceSection(input: {
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
  return (
    <div className="gap-4 flex flex-col py-3 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="gap-1 flex flex-col">
          <div className="flex items-start gap-2">
            <span className="text-sm leading-tight">
              {formatResourceHeading({
                count: input.resource.count,
                kind: input.resource.kind,
              })}
            </span>
            {shouldShowResourceSyncStateBadge(input.resource.syncState) ? (
              <Badge variant="secondary">{formatSyncStateLabel(input.resource.syncState)}</Badge>
            ) : null}
          </div>
          <p className="text-muted-foreground text-xs">
            {formatResourceInlineMetadata(input.resource)}
          </p>
        </div>
        {input.onRefreshResource ? (
          <div className="shrink-0">
            <Button
              aria-label={`Refresh ${input.resource.kind}`}
              disabled={input.resource.isRefreshing === true}
              onClick={() => {
                input.onRefreshResource?.({
                  connectionId: input.connectionId,
                  kind: input.resource.kind,
                });
              }}
              size="sm"
              title="Sync resource"
              type="button"
              variant="outline"
            >
              <ArrowClockwiseIcon
                aria-hidden
                className={input.resource.isRefreshing === true ? "size-4 animate-spin" : "size-4"}
              />
              <span>Sync</span>
            </Button>
          </div>
        ) : null}
      </div>
      {input.resource.lastErrorMessage ? (
        <Notice variant="alert">{input.resource.lastErrorMessage}</Notice>
      ) : null}
      <ResourceItemsPreview
        errorMessage={input.resourceItems?.errorMessage ?? null}
        isLoading={input.resourceItems?.isLoading ?? false}
        items={input.resourceItems?.items ?? []}
        kind={input.resource.kind}
      />
    </div>
  );
}

function ResourceItemsPreview(input: {
  errorMessage: string | null;
  isLoading: boolean;
  items: readonly IntegrationConnectionResource[];
  kind: string;
}): React.JSX.Element | null {
  if (input.isLoading) {
    return <p className="text-muted-foreground text-sm">Loading {input.kind}...</p>;
  }

  if (input.errorMessage !== null) {
    return <Notice variant="alert">{input.errorMessage}</Notice>;
  }

  if (input.items.length === 0) {
    return null;
  }

  return (
    <div className="gap-2 flex flex-wrap">
      {input.items.map((item) => (
        <span className="rounded-full border px-2.5 py-1 text-xs" key={item.id}>
          {item.displayName}
        </span>
      ))}
    </div>
  );
}

function WebhookSourcesSection(input: {
  connectionId: string;
  onCreateWebhookSource: ((input: { connectionId: string }) => void) | undefined;
  onDeleteWebhookSource:
    | ((input: { connectionId: string; webhookSourceId: string }) => void)
    | undefined;
  state: IntegrationWebhookSourceSectionState;
}): React.JSX.Element {
  return (
    <div className="gap-3 flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="gap-1 flex flex-col">
          <h3 className="font-medium text-sm">Webhooks</h3>
          <p className="text-muted-foreground text-xs">
            Manage provider webhook registrations for this connection.
          </p>
        </div>
        {input.onCreateWebhookSource ? (
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
        ) : null}
      </div>

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
        <p className="text-muted-foreground text-sm">
          No webhook sources are configured for this connection.
        </p>
      ) : (
        <div className="gap-3 flex flex-col">
          {input.state.items.map((source) => (
            <WebhookSourceCard
              connectionId={input.connectionId}
              deletingWebhookSourceId={input.state.deletingWebhookSourceId}
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
  onDeleteWebhookSource:
    | ((input: { connectionId: string; webhookSourceId: string }) => void)
    | undefined;
  source: IntegrationWebhookSource;
}): React.JSX.Element {
  const isDeleting = input.deletingWebhookSourceId === input.source.id;
  const isDeleteSupported =
    input.onDeleteWebhookSource !== undefined &&
    (input.source.endpointKey !== undefined || input.source.remoteRegistrationId !== undefined);

  return (
    <div className="gap-3 flex flex-col rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="gap-1 flex flex-col">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{input.source.displayName}</span>
            {input.source.status === "active" ? null : (
              <Badge variant="outline">{input.source.status}</Badge>
            )}
          </div>
          <p className="text-muted-foreground text-xs">Webhook source ID: {input.source.id}</p>
        </div>
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
      <div className="gap-3 grid grid-cols-1 md:grid-cols-2">
        <MetadataField label="Owner scope" value={input.source.ownerScope} />
        <MetadataField label="Target" value={input.source.targetKey} />
        {input.source.callbackUrl === undefined ? null : (
          <MetadataField label="Callback URL" value={input.source.callbackUrl} />
        )}
        {input.source.endpointKey === undefined ? null : (
          <MetadataField label="Endpoint key" value={input.source.endpointKey} />
        )}
        {input.source.remoteRegistrationId === undefined ? null : (
          <MetadataField label="Provider registration" value={input.source.remoteRegistrationId} />
        )}
      </div>
    </div>
  );
}
