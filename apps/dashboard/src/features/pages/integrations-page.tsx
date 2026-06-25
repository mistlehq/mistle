import { Button, Notice, NoticeAutoHideDurationsMs } from "@mistle/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";

import { getDashboardConfig } from "../../config.js";
import { resolveApiErrorMessage } from "../api/error-message.js";
import { DeleteIntegrationConnectionDialog } from "../integrations/delete-integration-connection-dialog.js";
import { IntegrationConnectionApiKeyDialog } from "../integrations/integration-connection-api-key-dialog.js";
import { IntegrationConnectionDetailView } from "../integrations/integration-connection-detail-view.js";
import { resolveFormConnectionMethodManagedWebhookSourcePostCreate } from "../integrations/integration-connection-method-metadata.js";
import {
  resolveInstalledIntegrationConnectionNotice,
  resolveProviderAppSetupErrorConnectionNotice,
  resolveProviderAppSetupErrorNotice,
  type IntegrationConnectionNotice,
  type TargetedProviderAppSetupErrorNotice,
} from "../integrations/integration-connection-notices.js";
import { useIntegrationWebhookSourceActions } from "../integrations/integration-webhook-source-actions.js";
import {
  ManagedWebhookSetupResultSchema,
  type IntegrationConnection as IntegrationDirectoryConnection,
  type IntegrationConnectionMethod,
  type IntegrationManagedWebhookSourcePostCreate,
  type IntegrationTarget,
  type ManagedWebhookSetupResult,
} from "../integrations/integrations-service-shared.js";
import {
  repairIntegrationConnection,
  type IntegrationConnection,
} from "../integrations/integrations-service.js";
import { useRequiredOrganizationId } from "../shell/require-auth.js";
import { useOrganizationSummary } from "../shell/use-organization-summary.js";
import {
  buildIntegrationConnectionEditPath,
  isSingleApiKeySecretMethod,
} from "./integration-connection-auth-edit-routing.js";
import { renderIntegrationConnectionSetupPane } from "./integration-connection-setup-pane-registry.js";
import {
  type IntegrationConnectionSetupRoute,
  resolveIncompleteIntegrationConnectionSetupFlow,
} from "./integration-connection-setup-state.js";
import {
  buildIntegrationConnectionDetailItems,
  type ProviderAppSetupState,
  type ReauthorizationState,
  resolveIntegrationConnectionDetailWebhookPolicy,
} from "./integrations-page-view-model.js";
import { OrganizationIntegrationsSettingsPageView } from "./organization-integrations-settings-page-view.js";
import { useIntegrationConnectionEditors } from "./use-integration-connection-editors.js";
import { useIntegrationWebhookSourceState } from "./use-integration-webhook-source-state.js";
import {
  SETTINGS_INTEGRATIONS_QUERY_KEY,
  useIntegrationsDirectoryState,
} from "./use-integrations-directory-state.js";

type EmbeddedIntegrationsNavigateOptions = {
  replace?: boolean;
  state?: unknown;
};

export type EmbeddedIntegrationsRoute = {
  detailTargetKey: string | null;
  locationState?: unknown;
  navigate: (href: string, options?: EmbeddedIntegrationsNavigateOptions) => void;
  searchParams: URLSearchParams;
  setSearchParams: (searchParams: URLSearchParams, options?: { replace?: boolean }) => void;
};

function buildProviderAppSetupStateByConnectionId(input: {
  connections: readonly {
    id: string;
  }[];
  errorMessageByConnectionId: Readonly<Record<string, string | undefined>>;
  pendingConnectionId: string | null | undefined;
}): ReadonlyMap<string, ProviderAppSetupState> {
  return new Map(
    input.connections.map((connection) => {
      const errorMessage = input.errorMessageByConnectionId[connection.id];

      return [
        connection.id,
        {
          ...(errorMessage === undefined ? {} : { errorMessage }),
          isPending: input.pendingConnectionId === connection.id,
        },
      ];
    }),
  );
}

function buildReauthorizationStateByConnectionId(input: {
  connections: readonly {
    id: string;
  }[];
  errorMessageByConnectionId: Readonly<Record<string, string | undefined>>;
  pendingConnectionId: string | null | undefined;
}): ReadonlyMap<string, ReauthorizationState> {
  return new Map(
    input.connections.map((connection) => {
      const errorMessage = input.errorMessageByConnectionId[connection.id];

      return [
        connection.id,
        {
          ...(errorMessage === undefined ? {} : { errorMessage }),
          isPending: input.pendingConnectionId === connection.id,
        },
      ];
    }),
  );
}

function replaceDirectoryConnection(input: {
  currentData:
    | {
        targets: readonly IntegrationTarget[];
        connections: readonly IntegrationDirectoryConnection[];
      }
    | undefined;
  updatedConnection: IntegrationDirectoryConnection;
}):
  | {
      targets: readonly IntegrationTarget[];
      connections: readonly IntegrationDirectoryConnection[];
    }
  | undefined {
  if (input.currentData === undefined) {
    return undefined;
  }

  return {
    ...input.currentData,
    connections: input.currentData.connections.map((connection) =>
      connection.id === input.updatedConnection.id
        ? {
            ...connection,
            ...input.updatedConnection,
            repairAction: undefined,
          }
        : connection,
    ),
  };
}

function renderSelectedConnectionNotice(input: {
  connection: IntegrationConnection | undefined;
  connectionNotice: IntegrationConnectionNotice | null;
  onRepairConnection: (connectionId: string) => void;
  repairErrorMessage: string | undefined;
  repairPendingConnectionId: string | null;
}): React.JSX.Element | undefined {
  const notices: React.JSX.Element[] = [];

  if (input.connectionNotice !== null) {
    notices.push(
      <Notice
        autoHideAfterMs={NoticeAutoHideDurationsMs.LONG}
        dismissible
        key="connection-notice"
        resetKey={input.connectionNotice.resetKey}
        title={input.connectionNotice.title}
        variant={input.connectionNotice.variant}
      >
        {input.connectionNotice.message ?? null}
      </Notice>,
    );
  }

  const repairAction = input.connection?.repairAction;
  if (input.connection !== undefined && repairAction !== undefined) {
    const connection = input.connection;
    const isRepairPending = input.repairPendingConnectionId === connection.id;
    notices.push(
      <Notice key={repairAction.id} title={repairAction.title} variant="alert">
        <div className="flex flex-col gap-3">
          {repairAction.description === undefined ? null : <p>{repairAction.description}</p>}
          {input.repairErrorMessage === undefined ? null : <p>{input.repairErrorMessage}</p>}
          <div>
            <Button
              disabled={isRepairPending}
              onClick={() => {
                input.onRepairConnection(connection.id);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              {isRepairPending ? repairAction.pendingLabel : repairAction.actionLabel}
            </Button>
          </div>
        </div>
      </Notice>,
    );
  }

  if (notices.length === 0) {
    return undefined;
  }

  return <div className="flex flex-col gap-3">{notices}</div>;
}

function clearUrlConnectionNoticeParams(searchParams: URLSearchParams): URLSearchParams {
  const nextSearchParams = new URLSearchParams(searchParams);
  nextSearchParams.delete("connectionNotice");
  nextSearchParams.delete("providerAppSetupError");
  return nextSearchParams;
}

function resolveRouteStateConnectionNotice(input: {
  connectionMethods: readonly IntegrationConnectionMethod[] | undefined;
  detailConnectionId: string | null;
  locationState: unknown;
  selectedConnection: Pick<IntegrationConnection, "connectionMethodId" | "id"> | undefined;
}): IntegrationConnectionNotice | null {
  if (
    input.detailConnectionId === null ||
    input.selectedConnection?.id !== input.detailConnectionId
  ) {
    return null;
  }

  const managedWebhookSetup = resolveManagedWebhookSetupState(input.locationState);
  const managedWebhookSourcePostCreate = resolveManagedWebhookSourcePostCreate({
    connectionMethods: input.connectionMethods,
    selectedConnection: input.selectedConnection,
  });
  if (managedWebhookSetup === null || managedWebhookSourcePostCreate === null) {
    return null;
  }

  if (managedWebhookSetup.status === "created") {
    return {
      connectionId: input.detailConnectionId,
      resetKey: `managed-webhook-created:${input.detailConnectionId}`,
      title: managedWebhookSourcePostCreate.successNoticeTitle,
      variant: "success",
    };
  }

  return {
    connectionId: input.detailConnectionId,
    message: managedWebhookSetup.message,
    resetKey: `managed-webhook-failed:${input.detailConnectionId}`,
    title: managedWebhookSourcePostCreate.failureNoticeTitle,
    variant: "alert",
  };
}

function resolveManagedWebhookSourcePostCreate(input: {
  connectionMethods: readonly IntegrationConnectionMethod[] | undefined;
  selectedConnection: Pick<IntegrationConnection, "connectionMethodId"> | undefined;
}): IntegrationManagedWebhookSourcePostCreate | null {
  const connectionMethodId = input.selectedConnection?.connectionMethodId;
  if (connectionMethodId === undefined) {
    return null;
  }

  const method =
    input.connectionMethods?.find((candidate) => candidate.id === connectionMethodId) ?? null;
  return resolveFormConnectionMethodManagedWebhookSourcePostCreate(method);
}

function resolveManagedWebhookSetupState(state: unknown): ManagedWebhookSetupResult | null {
  if (typeof state !== "object" || state === null || !("managedWebhookSetup" in state)) {
    return null;
  }

  const parsed = ManagedWebhookSetupResultSchema.safeParse(state.managedWebhookSetup);
  return parsed.success ? parsed.data : null;
}

export function IntegrationsPage(input?: {
  embeddedRoute?: EmbeddedIntegrationsRoute;
}): React.JSX.Element | null {
  const location = useLocation();
  const routeNavigate = useNavigate();
  const params = useParams();
  const queryClient = useQueryClient();
  const [routeSearchParams, setRouteSearchParams] = useSearchParams();
  const navigate = input?.embeddedRoute?.navigate ?? routeNavigate;
  const searchParams = input?.embeddedRoute?.searchParams ?? routeSearchParams;
  const setSearchParams = input?.embeddedRoute?.setSearchParams ?? setRouteSearchParams;
  const locationState =
    input?.embeddedRoute === undefined ? location.state : input.embeddedRoute.locationState;
  const [urlConnectionNotice, setUrlConnectionNotice] =
    useState<IntegrationConnectionNotice | null>(null);
  const [urlProviderAppSetupErrorNotice, setUrlProviderAppSetupErrorNotice] =
    useState<TargetedProviderAppSetupErrorNotice | null>(null);
  const [repairErrorMessageByConnectionId, setRepairErrorMessageByConnectionId] = useState<
    Record<string, string | undefined>
  >({});
  useRequiredOrganizationId();
  const organizationSummary = useOrganizationSummary();
  const detailTargetKey = input?.embeddedRoute?.detailTargetKey ?? params["targetKey"] ?? null;
  const detailConnectionId = searchParams.get("connectionId");
  const dashboardConfig = getDashboardConfig();
  const directoryState = useIntegrationsDirectoryState({
    detailConnectionId,
    detailTargetKey,
  });
  const selectedDetailConnectionMethods =
    directoryState.selectedDetailCard?.target.connectionMethods;

  const connectionEditors = useIntegrationConnectionEditors({
    connections: directoryState.selectedDetailConnections,
    connectionMethods: selectedDetailConnectionMethods,
    queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
  });
  const webhookSourceState = useIntegrationWebhookSourceState({
    detailConnections: directoryState.selectedDetailConnections,
  });
  const webhookSourceActions = useIntegrationWebhookSourceActions({
    connections: directoryState.selectedDetailConnections,
    refreshTriggerCapabilities: webhookSourceState.refreshTriggerCapabilities,
    refreshingTriggerCapabilitiesConnectionId:
      webhookSourceState.refreshingTriggerCapabilitiesConnectionId,
  });
  const providerAppSetupStateByConnectionId = buildProviderAppSetupStateByConnectionId({
    connections: directoryState.selectedDetailConnections,
    errorMessageByConnectionId: connectionEditors.providerAppSetup.errorMessageByConnectionId,
    pendingConnectionId: connectionEditors.providerAppSetup.pendingConnectionId,
  });
  const reauthorizationStateByConnectionId = buildReauthorizationStateByConnectionId({
    connections: directoryState.selectedDetailConnections,
    errorMessageByConnectionId: connectionEditors.reauthorization.errorMessageByConnectionId,
    pendingConnectionId: connectionEditors.reauthorization.pendingConnectionId,
  });
  const repairMutation = useMutation({
    mutationFn: async (mutationInput: { connectionId: string }) =>
      repairIntegrationConnection(mutationInput),
    onMutate: (mutationInput) => {
      setRepairErrorMessageByConnectionId((current) => ({
        ...current,
        [mutationInput.connectionId]: undefined,
      }));
    },
    onError: (error, mutationInput) => {
      setRepairErrorMessageByConnectionId((current) => ({
        ...current,
        [mutationInput.connectionId]: resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not repair integration connection.",
        }),
      }));
    },
    onSuccess: (updatedConnection) => {
      queryClient.setQueryData<{
        targets: readonly IntegrationTarget[];
        connections: readonly IntegrationDirectoryConnection[];
      }>(SETTINGS_INTEGRATIONS_QUERY_KEY, (currentData) =>
        replaceDirectoryConnection({
          currentData,
          updatedConnection,
        }),
      );
    },
  });
  const repairPendingConnectionId =
    repairMutation.isPending && repairMutation.variables !== undefined
      ? repairMutation.variables.connectionId
      : null;

  if (
    detailTargetKey !== null &&
    !directoryState.integrationsQuery.isPending &&
    !directoryState.integrationsQuery.isError &&
    directoryState.selectedDetailCard === null
  ) {
    throw new Error(`Integration target '${detailTargetKey}' was not found.`);
  }

  const selectedWebhookPolicy =
    directoryState.selectedDetailCard === null
      ? undefined
      : resolveIntegrationConnectionDetailWebhookPolicy({
          webhookSource: directoryState.selectedDetailCard.target.webhookSource,
        });

  const selectedDetailConnection =
    directoryState.selectedDetailConnections.find(
      (connection) => connection.id === directoryState.activeDetailConnectionId,
    ) ?? directoryState.selectedDetailConnections[0];
  const routeStateConnectionNotice = resolveRouteStateConnectionNotice({
    connectionMethods: selectedDetailConnectionMethods,
    detailConnectionId,
    locationState,
    selectedConnection: selectedDetailConnection,
  });
  const connectionNotice =
    resolveProviderAppSetupErrorConnectionNotice({
      detailTargetKey,
      selectedConnection: selectedDetailConnection,
      urlProviderAppSetupErrorNotice,
    }) ??
    routeStateConnectionNotice ??
    (urlConnectionNotice?.connectionId === selectedDetailConnection?.id
      ? urlConnectionNotice
      : null);
  const selectedDetailConnectionSetupFlow =
    selectedDetailConnection === undefined
      ? null
      : resolveIncompleteIntegrationConnectionSetupFlow({
          connection: selectedDetailConnection,
          connectionMethods: selectedDetailConnectionMethods,
        });

  useEffect(() => {
    const providerAppSetupErrorNotice = resolveProviderAppSetupErrorNotice({
      searchParams,
    });
    if (providerAppSetupErrorNotice !== null) {
      if (detailTargetKey !== null) {
        setUrlProviderAppSetupErrorNotice({
          notice: providerAppSetupErrorNotice,
          targetKey: detailTargetKey,
        });
      }
      setSearchParams(clearUrlConnectionNoticeParams(searchParams), { replace: true });
      return;
    }

    const resolvedUrlNotice = resolveInstalledIntegrationConnectionNotice({
      connectionMethods: selectedDetailConnectionMethods,
      detailConnectionId,
      searchParams,
      selectedConnection: selectedDetailConnection,
    });

    if (resolvedUrlNotice === null) {
      return;
    }

    setUrlConnectionNotice(resolvedUrlNotice);
    setSearchParams(clearUrlConnectionNoticeParams(searchParams), { replace: true });
  }, [
    detailTargetKey,
    detailConnectionId,
    searchParams,
    selectedDetailConnection,
    selectedDetailConnectionMethods,
    setSearchParams,
  ]);

  if (directoryState.integrationsQuery.isPending) {
    return null;
  }

  const detailSurface =
    detailTargetKey === null || directoryState.selectedDetailCard === null ? null : (
      <IntegrationConnectionDetailView
        connections={buildIntegrationConnectionDetailItems({
          connections: directoryState.selectedDetailConnections,
          controlPlaneApiOrigin: dashboardConfig.controlPlaneApiOrigin,
          providerAppSetupStateByConnectionId,
          reauthorizationStateByConnectionId,
          refreshingConnectionIds: directoryState.refreshingConnectionIds,
          refreshingResourceKeys: directoryState.refreshingResourceKeys,
          ...(directoryState.selectedDetailCard === null
            ? {}
            : {
                targetConfig: Object.fromEntries(
                  Object.entries(
                    typeof directoryState.selectedDetailCard.target.config === "object" &&
                      directoryState.selectedDetailCard.target.config !== null &&
                      !Array.isArray(directoryState.selectedDetailCard.target.config)
                      ? directoryState.selectedDetailCard.target.config
                      : {},
                  ),
                ),
                ...(directoryState.selectedDetailCard.target.connectionMethods === undefined
                  ? {}
                  : {
                      targetConnectionMethods:
                        directoryState.selectedDetailCard.target.connectionMethods,
                    }),
                targetFamilyId: directoryState.selectedDetailCard.target.familyId,
                targetVariantId: directoryState.selectedDetailCard.target.variantId,
              }),
        })}
        onSelectedConnectionChange={directoryState.setActiveDetailConnectionId}
        onDeleteConnection={connectionEditors.onDeleteConnection}
        onEditAuthentication={(connectionId) => {
          const editingConnection =
            directoryState.selectedDetailConnections.find(
              (connection) => connection.id === connectionId,
            ) ?? null;
          if (editingConnection === null) {
            throw new Error(`Integration connection '${connectionId}' was not found.`);
          }

          if (editingConnection.connectionMethodId === "api-key") {
            const editingMethod =
              selectedDetailConnectionMethods?.find(
                (method) => method.id === editingConnection.connectionMethodId,
              ) ?? null;
            if (isSingleApiKeySecretMethod(editingMethod)) {
              connectionEditors.onEditApiKey(connectionId);
              return;
            }
          }

          if (editingConnection.connectionMethodId === "oauth2-authorization-code") {
            void connectionEditors.reauthorization.onStart(connectionId);
            return;
          }

          const editingMethod =
            selectedDetailConnectionMethods?.find(
              (method) => method.id === editingConnection.connectionMethodId,
            ) ?? null;
          if (editingMethod?.kind === "device-authorization") {
            void navigate(
              buildIntegrationConnectionEditPath({
                connectionId,
                detailTargetKey,
                extraSearchParams: {
                  reauthorize: "device",
                },
              }),
            );
            return;
          }

          void navigate(
            buildIntegrationConnectionEditPath({
              connectionId,
              detailTargetKey,
            }),
          );
        }}
        onStartProviderAppSetup={connectionEditors.providerAppSetup.onStartInstallation}
        onRefreshResource={directoryState.onRefreshResource}
        selectedConnectionId={directoryState.activeDetailConnectionId}
        selectedConnectionBody={renderSelectedConnectionSetupBody({
          connection: selectedDetailConnection,
          organizationName: organizationSummary.query.isSuccess
            ? organizationSummary.query.data.name
            : null,
          setupFlow: selectedDetailConnectionSetupFlow,
        })}
        selectedConnectionNotice={renderSelectedConnectionNotice({
          connection: selectedDetailConnection,
          connectionNotice,
          onRepairConnection: (connectionId) => {
            repairMutation.mutate({ connectionId });
          },
          repairErrorMessage:
            selectedDetailConnection === undefined
              ? undefined
              : repairErrorMessageByConnectionId[selectedDetailConnection.id],
          repairPendingConnectionId,
        })}
        {...(directoryState.selectedDetailCard?.target.supportedWebhookEvents === undefined
          ? {}
          : {
              supportedWebhookEvents:
                directoryState.selectedDetailCard.target.supportedWebhookEvents,
            })}
        webhookSourceStateByConnectionId={webhookSourceState.webhookSourceStateByConnectionId}
        onCreateWebhookSource={({ connectionId }) => {
          webhookSourceState.createWebhookSource({ connectionId });
        }}
        onDeleteWebhookSource={({ connectionId, webhookSourceId }) => {
          webhookSourceState.deleteWebhookSource({
            connectionId,
            webhookSourceId,
          });
        }}
        renderWebhookSourceActions={webhookSourceActions.renderWebhookSourceActions}
        webhookPolicy={selectedWebhookPolicy}
        titleEditor={connectionEditors.titleEditor}
      />
    );

  return (
    <OrganizationIntegrationsSettingsPageView
      availableCards={directoryState.availableViewCards}
      connectedCards={directoryState.connectedViewCards}
      connectionDialog={
        <>
          <IntegrationConnectionApiKeyDialog {...connectionEditors.apiKeyDialog} />
          <DeleteIntegrationConnectionDialog {...connectionEditors.deleteDialog} />
          {webhookSourceActions.dialog}
        </>
      }
      detailSurface={detailSurface}
      loadErrorMessage={
        directoryState.integrationsQuery.isError
          ? resolveApiErrorMessage({
              error: directoryState.integrationsQuery.error,
              fallbackMessage: "Could not load integrations.",
            })
          : null
      }
    />
  );
}

export function renderSelectedConnectionSetupBody(input: {
  connection: IntegrationConnection | undefined;
  organizationName: string | null;
  setupFlow: IntegrationConnectionSetupRoute | null;
}): React.JSX.Element | undefined {
  if (input.connection === undefined || input.setupFlow === null) {
    return undefined;
  }

  return renderIntegrationConnectionSetupPane({
    connection: input.connection,
    organizationName: input.organizationName ?? undefined,
    setupRoute: input.setupFlow,
  });
}
