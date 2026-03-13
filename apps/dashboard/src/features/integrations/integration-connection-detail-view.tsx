import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@mistle/ui";

import { formatDate } from "../shared/date-formatters.js";
import {
  formatConnectionStatusLabel,
  formatResourceMetadata,
  formatResourceSummaryCount,
  formatSelectionModeLabel,
  formatSyncStateLabel,
} from "./integration-connection-detail-formatters.js";
import { resolveIntegrationLogoPath } from "./logo.js";

export type IntegrationConnectionDetailResourceSummary = {
  count: number;
  isRefreshing?: boolean;
  kind: string;
  lastErrorMessage?: string;
  lastSyncedAt?: string;
  selectionMode: "single" | "multi";
  syncState: "never-synced" | "syncing" | "ready" | "error";
};

export type IntegrationConnectionDetailItem = {
  authMethodLabel?: string | null;
  contextItems?: readonly {
    label: string;
    value: string;
  }[];
  createdAt: string;
  displayName: string;
  externalSubjectId?: string;
  id: string;
  resources: readonly IntegrationConnectionDetailResourceSummary[];
  status: "active" | "error" | "revoked";
  updatedAt: string;
};

export type IntegrationConnectionDetailViewProps = {
  connections: readonly IntegrationConnectionDetailItem[];
  logoKey?: string;
  onEditConnection?: (connectionId: string) => void;
  onRefreshResource?: (input: { connectionId: string; kind: string }) => void;
  onSelectConnection: (connectionId: string) => void;
  selectedConnectionId: string | null;
  targetDisplayName: string;
  targetKey: string;
};

export function IntegrationConnectionDetailView(
  props: IntegrationConnectionDetailViewProps,
): React.JSX.Element {
  const selectedConnection =
    props.connections.find((connection) => connection.id === props.selectedConnectionId) ??
    props.connections[0] ??
    null;

  return (
    <div className="gap-4 grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle className="gap-3 flex items-center text-base">
            {props.logoKey === undefined ? (
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-muted text-xs font-semibold uppercase">
                {props.targetDisplayName.slice(0, 1)}
              </span>
            ) : (
              <img
                alt={`${props.targetDisplayName} logo`}
                className="h-8 w-8 rounded-md border p-1"
                src={resolveIntegrationLogoPath({ logoKey: props.logoKey })}
              />
            )}
            <span>{props.targetDisplayName}</span>
          </CardTitle>
          <p className="text-muted-foreground text-sm">{props.targetKey}</p>
        </CardHeader>
        <CardContent className="gap-2 flex flex-col">
          {props.connections.length === 0 ? (
            <p className="text-muted-foreground text-sm">No connections found for this target.</p>
          ) : (
            props.connections.map((connection) => {
              const isSelected = selectedConnection?.id === connection.id;

              return (
                <button
                  aria-pressed={isSelected}
                  className={`rounded-md border px-3 py-2 text-left ${isSelected ? "border-foreground bg-muted/60" : "hover:bg-muted/40"}`}
                  key={connection.id}
                  onClick={() => {
                    props.onSelectConnection(connection.id);
                  }}
                  type="button"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-sm">{connection.displayName}</span>
                    <Badge variant={connection.status === "active" ? "secondary" : "outline"}>
                      {formatConnectionStatusLabel(connection.status)}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {connection.resources.length === 0
                      ? "No resource summaries"
                      : formatResourceSummaryCount(connection.resources.length)}
                  </p>
                </button>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        {selectedConnection === null ? (
          <CardContent className="py-10">
            <p className="text-muted-foreground text-sm">
              Select a connection to inspect its readiness.
            </p>
          </CardContent>
        ) : (
          <>
            <CardHeader className="gap-4 flex flex-col md:flex-row md:items-start md:justify-between">
              <div className="gap-3 flex flex-col">
                <div className="gap-2 flex flex-wrap items-center">
                  <CardTitle>{selectedConnection.displayName}</CardTitle>
                  <Badge variant={selectedConnection.status === "active" ? "secondary" : "outline"}>
                    {formatConnectionStatusLabel(selectedConnection.status)}
                  </Badge>
                </div>
                <div className="gap-2 flex flex-wrap text-sm">
                  {selectedConnection.authMethodLabel ? (
                    <span className="text-muted-foreground">
                      Auth method: {selectedConnection.authMethodLabel}
                    </span>
                  ) : null}
                  {selectedConnection.externalSubjectId ? (
                    <span className="text-muted-foreground">
                      Subject: {selectedConnection.externalSubjectId}
                    </span>
                  ) : null}
                </div>
              </div>
              {props.onEditConnection ? (
                <Button
                  onClick={() => {
                    props.onEditConnection?.(selectedConnection.id);
                  }}
                  type="button"
                  variant="outline"
                >
                  Edit connection
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="gap-6 flex flex-col">
              <div className="gap-3 grid grid-cols-1 md:grid-cols-2">
                <MetadataField label="Created" value={formatDate(selectedConnection.createdAt)} />
                <MetadataField label="Updated" value={formatDate(selectedConnection.updatedAt)} />
              </div>

              {selectedConnection.contextItems === undefined ||
              selectedConnection.contextItems.length === 0 ? null : (
                <div className="gap-3 flex flex-col">
                  <h3 className="font-medium text-sm">Connection context</h3>
                  <div className="gap-3 grid grid-cols-1 md:grid-cols-2">
                    {selectedConnection.contextItems.map((item) => (
                      <MetadataField key={item.label} label={item.label} value={item.value} />
                    ))}
                  </div>
                </div>
              )}

              <div className="gap-3 flex flex-col">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-medium text-sm">Resource readiness</h3>
                  <span className="text-muted-foreground text-xs">
                    {selectedConnection.resources.length} resource kind
                    {selectedConnection.resources.length === 1 ? "" : "s"}
                  </span>
                </div>

                {selectedConnection.resources.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    No resource-backed capabilities are visible for this connection yet.
                  </p>
                ) : (
                  <div className="gap-3 grid grid-cols-1 lg:grid-cols-2">
                    {selectedConnection.resources.map((resource) => (
                      <Card key={resource.kind}>
                        <CardHeader className="gap-2 flex flex-row items-start justify-between space-y-0">
                          <div className="gap-2 flex flex-col">
                            <CardTitle className="text-base capitalize">{resource.kind}</CardTitle>
                            <p className="text-muted-foreground text-sm">
                              {resource.count} accessible,{" "}
                              {formatSelectionModeLabel(resource.selectionMode)}
                            </p>
                          </div>
                          <Badge variant="secondary">
                            {formatSyncStateLabel(resource.syncState)}
                          </Badge>
                        </CardHeader>
                        <CardContent className="gap-3 flex flex-col">
                          <p className="text-muted-foreground text-sm">
                            {formatResourceMetadata(resource)}
                          </p>
                          {resource.lastErrorMessage ? (
                            <Alert variant="destructive">
                              <AlertDescription>{resource.lastErrorMessage}</AlertDescription>
                            </Alert>
                          ) : null}
                          {props.onRefreshResource ? (
                            <div>
                              <Button
                                disabled={resource.isRefreshing === true}
                                onClick={() => {
                                  props.onRefreshResource?.({
                                    connectionId: selectedConnection.id,
                                    kind: resource.kind,
                                  });
                                }}
                                size="sm"
                                type="button"
                                variant="outline"
                              >
                                {resource.isRefreshing === true
                                  ? "Refreshing..."
                                  : "Refresh resources"}
                              </Button>
                            </div>
                          ) : null}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </>
        )}
      </Card>
    </div>
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
