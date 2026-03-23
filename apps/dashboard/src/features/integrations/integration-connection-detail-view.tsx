import { Alert, AlertDescription, Badge, Button } from "@mistle/ui";
import { ArrowClockwiseIcon, PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { EditableHeading } from "../shared/editable-heading.js";
import {
  formatConnectionStatusLabel,
  formatResourceHeading,
  formatResourceInlineMetadata,
  formatSyncStateLabel,
} from "./integration-connection-detail-formatters.js";
import type { IntegrationConnectionResource } from "./integrations-service.js";

export type IntegrationConnectionDetailResourceSummary = {
  count: number;
  isRefreshing?: boolean;
  kind: string;
  lastErrorMessage?: string;
  lastSyncedAt?: string;
  syncState: "never-synced" | "syncing" | "ready" | "error";
};

export type IntegrationConnectionDetailItem = {
  authMethodId?: "api-key" | "oauth2" | "github-app-installation" | null;
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
  onDeleteConnection?: (connectionId: string) => void;
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
        connectionIdWithError: string | null;
        errorMessage?: string;
        onCommit: (connectionId: string, draftValue: string) => void;
        onEditCancel: () => void;
        onEditStart: () => void;
        saveDisabled: boolean;
      }
    | undefined;
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
        <ConnectionCard
          connection={connection}
          key={connection.id}
          {...(props.onDeleteConnection === undefined
            ? {}
            : { onDeleteConnection: props.onDeleteConnection })}
          {...(props.onEditApiKey === undefined ? {} : { onEditApiKey: props.onEditApiKey })}
          {...(props.onRefreshResource === undefined
            ? {}
            : { onRefreshResource: props.onRefreshResource })}
          {...(props.resourceItemsByKey === undefined
            ? {}
            : { resourceItemsByKey: props.resourceItemsByKey })}
          {...(props.titleEditor === undefined ? {} : { titleEditor: props.titleEditor })}
        />
      ))}
    </div>
  );
}

function ConnectionCard(input: {
  connection: IntegrationConnectionDetailItem;
  onDeleteConnection?: (connectionId: string) => void;
  onEditApiKey?: (connectionId: string) => void;
  onRefreshResource?: (input: { connectionId: string; kind: string }) => void;
  resourceItemsByKey?: IntegrationConnectionDetailViewProps["resourceItemsByKey"];
  titleEditor?: IntegrationConnectionDetailViewProps["titleEditor"];
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
              variant="destructive"
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
    </section>
  );
}

function EditableConnectionTitle(input: {
  connection: IntegrationConnectionDetailItem;
  titleEditor: NonNullable<IntegrationConnectionDetailViewProps["titleEditor"]>;
}): React.JSX.Element {
  const [draftValue, setDraftValue] = useState(input.connection.displayName);
  const [isEditing, setIsEditing] = useState(false);

  return (
    <EditableHeading
      ariaLabel="Connection name"
      cancelOnEscape={true}
      draftValue={draftValue}
      editButtonLabel="Edit connection name"
      errorMessage={
        input.titleEditor.connectionIdWithError === input.connection.id
          ? input.titleEditor.errorMessage
          : undefined
      }
      headingClassName="text-base font-semibold leading-tight"
      isEditing={isEditing}
      maxWidthClassName="max-w-3xl"
      onCancel={() => {
        setDraftValue(input.connection.displayName);
        setIsEditing(false);
        input.titleEditor.onEditCancel();
      }}
      onCommit={() => {
        input.titleEditor.onCommit(input.connection.id, draftValue);
        if (draftValue.trim().length > 0) {
          setIsEditing(false);
        }
      }}
      onDraftValueChange={(nextValue) => {
        setDraftValue(nextValue);
      }}
      onEditStart={() => {
        setDraftValue(input.connection.displayName);
        setIsEditing(true);
        input.titleEditor.onEditStart();
      }}
      placeholder="Connection name"
      saveDisabled={input.titleEditor.saveDisabled}
      value={input.connection.displayName}
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
      <div className="gap-1 flex flex-col">
        <InlineField label="Auth method" value="API key" />
        <div className="inline-flex items-center gap-1.5 text-sm">
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
        <Alert variant="destructive">
          <AlertDescription>{input.resource.lastErrorMessage}</AlertDescription>
        </Alert>
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
    return <p className="text-destructive text-sm">{input.errorMessage}</p>;
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
