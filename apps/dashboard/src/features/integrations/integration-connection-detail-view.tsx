import {
  hasWebhookTriggerEventCapability,
  hasWebhookTriggerPermissionCapability,
  parseWebhookTriggerCapabilitiesProviderMetadata,
  resolveWebhookTriggerCapabilityEvents,
  type IntegrationWebhookEventDefinition,
  type IntegrationWebhookTriggerCapabilities,
  type IntegrationWebhookTriggerCapabilityEvent,
  type IntegrationWebhookTriggerProviderPermissionRequirement,
  type IntegrationWebhookTriggerRequirementSet,
} from "@mistle/integrations-core";
import { JiraWebhookEventDisplayNameByType } from "@mistle/integrations-definitions";
import {
  Badge,
  Button,
  BadgeListField,
  CopyableValue,
  DefinitionList,
  DetailLabel,
  Notice,
  Select,
  SelectContent,
  SelectItem,
  SectionBlock,
  SelectTrigger,
  SelectValue,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@mistle/ui";
import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  CircleDashedIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useState } from "react";

import type { IntegrationWebhookSourceSectionState } from "../pages/use-integration-webhook-source-state.js";
import { AutoSaveTitleHeading } from "../shared/auto-save-inline-heading.js";
import {
  formatConnectionStatusLabel,
  formatWebhookSourceStatusLabel,
} from "./integration-connection-detail-formatters.js";
import { IntegrationResourceList } from "./integration-resource-list.js";
import {
  type IntegrationResourceListItemData,
  type IntegrationResourceListItemResourceSummary,
} from "./integration-resource-row.js";
import type { IntegrationWebhookSource } from "./integrations-service.js";

export type IntegrationConnectionDetailResourceSummary = IntegrationResourceListItemResourceSummary;

export type IntegrationConnectionDetailItem = {
  authFields?: readonly {
    label: string;
    value: string;
  }[];
  authSecretLabels?: readonly string[];
  authMethodId?: string | null;
  authMethodLabel?: string | null;
  automationCount?: number;
  bindingCount: number;
  canDelete: boolean;
  contextItems?: readonly {
    label: string;
    value: string;
  }[];
  displayName: string;
  id: string;
  isIdentityLinked?: boolean;
  installation?:
    | {
        actionLabel?: string;
        description?: string;
        errorMessage?: string;
        fields?: readonly {
          label: string;
          value: string;
        }[];
        hideWebhookSourceSection?: boolean;
        includeWebhookCallbackUrl?: boolean;
        isCallbackUrlLoading?: boolean;
        isPending?: boolean;
        postInstallationSetupUrl?: string;
      }
    | undefined;
  resources: readonly IntegrationConnectionDetailResourceSummary[];
  status: "active" | "error" | "revoked";
};

export type IntegrationConnectionDetailViewProps = {
  connections: readonly IntegrationConnectionDetailItem[];
  logoKey?: string;
  onCreateWebhookSource?: (input: { connectionId: string }) => void;
  onDeleteConnection?: (connectionId: string) => void;
  onDeleteWebhookSource?: (input: { connectionId: string; webhookSourceId: string }) => void;
  onEditAuthentication?: (connectionId: string) => void;
  onSelectedConnectionChange?: (connectionId: string | null) => void;
  onStartGitHubAppInstallation?: (connectionId: string) => Promise<void> | void;
  onRefreshResource?: (input: { connectionId: string; kind: string }) => void;
  resourceItemsByKey?: ReadonlyMap<string, IntegrationResourceListItemData>;
  selectedConnectionId?: string | null;
  selectedConnectionBody?: ReactNode;
  selectedConnectionNotice?: ReactNode;
  supportedWebhookEvents?: readonly IntegrationWebhookEventDefinition[];
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
  renderWebhookSourceActions?: (input: { connectionId: string }) => ReactNode;
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
  const installation =
    input.connection.installation === undefined
      ? undefined
      : {
          ...input.connection.installation,
          ...(input.connection.installation.includeWebhookCallbackUrl === true &&
          input.webhookSourceState?.items[0]?.callbackUrl !== undefined
            ? { callbackUrl: input.webhookSourceState.items[0].callbackUrl }
            : {}),
          ...(input.connection.installation.includeWebhookCallbackUrl === true &&
          input.webhookSourceState?.isLoading === true &&
          input.webhookSourceState.items[0]?.callbackUrl === undefined
            ? { isCallbackUrlLoading: true }
            : {}),
        };
  const hasInstallationSection =
    installation !== undefined &&
    (installation.description !== undefined ||
      installation.errorMessage !== undefined ||
      installation.fields?.length !== undefined ||
      installation.isCallbackUrlLoading === true ||
      installation.postInstallationSetupUrl !== undefined ||
      installation.actionLabel !== undefined ||
      ("callbackUrl" in installation && installation.callbackUrl !== undefined));
  const hidesStandaloneWebhookSection =
    input.connection.installation?.hideWebhookSourceSection === true;
  const shouldRenderWebhookSection =
    hidesStandaloneWebhookSection === false &&
    input.webhookPolicy?.showWebhookSources === true &&
    input.webhookSourceState !== undefined;

  return {
    hasInstallationSection,
    installation,
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
  const [uncontrolledSelectedConnectionId, setUncontrolledSelectedConnectionId] = useState<
    string | null
  >(props.connections[0]?.id ?? null);
  const [isMobileConnectionSelectOpen, setIsMobileConnectionSelectOpen] = useState(false);

  if (props.connections.length === 0) {
    return <p className="text-muted-foreground text-sm">No connections found for this target.</p>;
  }

  const resolvedSelectedConnectionId =
    props.selectedConnectionId ??
    uncontrolledSelectedConnectionId ??
    props.connections[0]?.id ??
    null;
  const selectedConnection =
    props.connections.find((connection) => connection.id === resolvedSelectedConnectionId) ??
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
          onOpenChange={setIsMobileConnectionSelectOpen}
          onValueChange={(nextConnectionId) => {
            if (props.selectedConnectionId === undefined) {
              setUncontrolledSelectedConnectionId(nextConnectionId);
            }
            props.onSelectedConnectionChange?.(nextConnectionId);
            setIsMobileConnectionSelectOpen(false);
          }}
          value={selectedConnection.id}
        >
          <SelectTrigger aria-label="Select connection" className="w-full">
            <SelectValue placeholder="Select connection">
              {selectedConnection.displayName}
            </SelectValue>
          </SelectTrigger>
          {isMobileConnectionSelectOpen ? (
            <SelectContent>
              {props.connections.map((connection) => (
                <SelectItem key={connection.id} value={connection.id}>
                  {connection.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          ) : null}
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
                  if (props.selectedConnectionId === undefined) {
                    setUncontrolledSelectedConnectionId(connection.id);
                  }
                  props.onSelectedConnectionChange?.(connection.id);
                }}
                type="button"
              >
                <span className="text-sm font-medium leading-tight">{connection.displayName}</span>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {connection.isIdentityLinked === true ? (
                    <Tooltip delay={0}>
                      <TooltipTrigger render={<span className="inline-flex" />}>
                        <Badge variant="outline">IDENTITY</Badge>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        This connection is configured for Identity Linking.
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
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
            {...(props.resourceItemsByKey === undefined
              ? {}
              : { resourceItemsByKey: props.resourceItemsByKey })}
            {...(props.webhookPolicy === undefined ? {} : { webhookPolicy: props.webhookPolicy })}
            {...(props.renderWebhookSourceActions === undefined
              ? {}
              : { renderWebhookSourceActions: props.renderWebhookSourceActions })}
            {...(props.titleEditor === undefined ? {} : { titleEditor: props.titleEditor })}
            {...(props.selectedConnectionBody === undefined
              ? {}
              : { customBody: props.selectedConnectionBody })}
            {...(props.selectedConnectionNotice === undefined
              ? {}
              : { selectedConnectionNotice: props.selectedConnectionNotice })}
            {...(props.supportedWebhookEvents === undefined
              ? {}
              : { supportedWebhookEvents: props.supportedWebhookEvents })}
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
  resourceItemsByKey?: IntegrationConnectionDetailViewProps["resourceItemsByKey"];
  customBody?: ReactNode;
  selectedConnectionNotice?: ReactNode;
  supportedWebhookEvents?: readonly IntegrationWebhookEventDefinition[];
  titleEditor?: IntegrationConnectionDetailViewProps["titleEditor"];
  renderWebhookSourceActions?: IntegrationConnectionDetailViewProps["renderWebhookSourceActions"];
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
  const webhookSectionAction =
    viewState.webhookSectionUiState === null || webhookSourceState === undefined
      ? null
      : resolveWebhookSectionAction({
          connectionId: input.connection.id,
          onCreateWebhookSource: input.onCreateWebhookSource,
          onDeleteWebhookSource: input.onDeleteWebhookSource,
          renderWebhookSourceActions: input.renderWebhookSourceActions,
          uiState: viewState.webhookSectionUiState,
          webhookSourceState,
        });

  return (
    <section className="flex flex-col gap-8">
      {input.selectedConnectionNotice === undefined ? null : input.selectedConnectionNotice}
      <header className="flex flex-col gap-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 gap-3 flex flex-col items-start">
            {input.titleEditor ? (
              <EditableConnectionTitle
                connection={input.connection}
                titleEditor={input.titleEditor}
              />
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold leading-tight">
                  {input.connection.displayName}
                </h2>
                {input.connection.isIdentityLinked === true ? (
                  <Tooltip delay={0}>
                    <TooltipTrigger render={<span className="inline-flex" />}>
                      <Badge variant="outline">IDENTITY</Badge>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      This connection is configured for Identity Linking.
                    </TooltipContent>
                  </Tooltip>
                ) : null}
              </div>
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

      {input.customBody === undefined ? null : input.customBody}

      {input.customBody !== undefined ? null : (
        <>
          {viewState.hasInstallationSection ? (
            <SectionBlock
              action={
                input.onStartGitHubAppInstallation !== undefined &&
                viewState.installation?.actionLabel !== undefined ? (
                  <Button
                    disabled={viewState.installation?.isPending ?? false}
                    onClick={() => {
                      void input.onStartGitHubAppInstallation?.(input.connection.id);
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {viewState.installation?.isPending === true
                      ? "Starting install..."
                      : viewState.installation.actionLabel}
                    {viewState.installation?.isPending === true ? null : (
                      <ArrowSquareOutIcon aria-hidden className="size-4" data-icon="inline-end" />
                    )}
                  </Button>
                ) : null
              }
              {...(viewState.installation?.description === undefined
                ? {}
                : { description: viewState.installation.description })}
              title="Installation"
            >
              <div className="flex flex-col gap-4">
                <InstallationSection
                  fields={viewState.installation?.fields}
                  {...(viewState.installation === undefined ||
                  !("callbackUrl" in viewState.installation) ||
                  viewState.installation.callbackUrl === undefined
                    ? {}
                    : { callbackUrl: viewState.installation.callbackUrl })}
                  {...(viewState.installation === undefined ||
                  !("isCallbackUrlLoading" in viewState.installation) ||
                  viewState.installation.isCallbackUrlLoading !== true
                    ? {}
                    : { isCallbackUrlLoading: true })}
                  {...(viewState.installation?.postInstallationSetupUrl === undefined
                    ? {}
                    : {
                        postInstallationSetupUrl: viewState.installation.postInstallationSetupUrl,
                      })}
                />
                {viewState.installation?.errorMessage === undefined ? null : (
                  <Notice variant="alert">{viewState.installation.errorMessage}</Notice>
                )}
              </div>
            </SectionBlock>
          ) : null}

          <SectionBlock
            action={
              input.connection.authMethodId !== undefined &&
              input.connection.authMethodId !== null &&
              input.connection.isIdentityLinked !== true &&
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
              ) : null
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
                resourceItemsByKey={input.resourceItemsByKey}
                resources={input.connection.resources}
              />
            </SectionBlock>
          )}

          {viewState.webhookSectionUiState !== null && webhookSourceState !== undefined ? (
            <SectionBlock action={webhookSectionAction} title="Webhook">
              <WebhookSourcesSection
                connectionId={input.connection.id}
                hideDeleteAction={viewState.webhookSectionUiState.hideInlineDeleteAction}
                onCreateWebhookSource={undefined}
                onDeleteWebhookSource={input.onDeleteWebhookSource}
                state={webhookSourceState}
                supportedWebhookEvents={input.supportedWebhookEvents ?? []}
              />
            </SectionBlock>
          ) : null}

          {input.connection.contextItems === undefined ||
          input.connection.contextItems.length === 0 ? null : (
            <SectionBlock title="Details">
              <div className="flex flex-col gap-4">
                <DefinitionList
                  items={input.connection.contextItems.map((item) => ({
                    id: item.label,
                    label: item.label,
                    value: item.value,
                  }))}
                />
              </div>
            </SectionBlock>
          )}
        </>
      )}
    </section>
  );
}

function resolveDeleteConnectionMessage(
  connection: Pick<
    IntegrationConnectionDetailItem,
    "automationCount" | "bindingCount" | "canDelete" | "isIdentityLinked"
  >,
): string | null {
  if (connection.canDelete) {
    return null;
  }

  if (connection.isIdentityLinked === true) {
    return "This connection can't be deleted while it is configured for Identity Linking.";
  }

  if (connection.bindingCount > 0) {
    return `This connection can't be deleted while it has ${connection.bindingCount} active sandbox profile ${connection.bindingCount === 1 ? "binding" : "bindings"}.`;
  }

  const automationCount = connection.automationCount ?? 0;
  if (automationCount > 0) {
    return `This connection can't be deleted while it has ${automationCount} webhook ${automationCount === 1 ? "automation" : "automations"}.`;
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
      <DefinitionList
        items={[
          ...authFields.map((field) => ({
            id: field.label,
            label: field.label,
            value: field.value,
          })),
          ...authSecretLabels.map((label) => ({
            id: label,
            label,
            value: "**********",
          })),
        ]}
      />
    </div>
  );
}

function resolveWebhookSectionAction(input: {
  connectionId: string;
  onCreateWebhookSource: ((input: { connectionId: string }) => void) | undefined;
  onDeleteWebhookSource:
    | ((input: { connectionId: string; webhookSourceId: string }) => void)
    | undefined;
  renderWebhookSourceActions: IntegrationConnectionDetailViewProps["renderWebhookSourceActions"];
  uiState: WebhookSectionUiState;
  webhookSourceState: IntegrationWebhookSourceSectionState;
}): ReactNode {
  const webhookSourceActions =
    input.renderWebhookSourceActions?.({ connectionId: input.connectionId }) ?? null;
  const webhookManagementAction = resolveWebhookManagementAction({
    connectionId: input.connectionId,
    onCreateWebhookSource: input.onCreateWebhookSource,
    onDeleteWebhookSource: input.onDeleteWebhookSource,
    uiState: input.uiState,
    webhookSourceState: input.webhookSourceState,
  });

  if (webhookSourceActions === null) {
    return webhookManagementAction;
  }

  if (webhookManagementAction === null) {
    return webhookSourceActions;
  }

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {webhookSourceActions}
      {webhookManagementAction}
    </div>
  );
}

function resolveWebhookManagementAction(input: {
  connectionId: string;
  onCreateWebhookSource: ((input: { connectionId: string }) => void) | undefined;
  onDeleteWebhookSource:
    | ((input: { connectionId: string; webhookSourceId: string }) => void)
    | undefined;
  uiState: WebhookSectionUiState;
  webhookSourceState: IntegrationWebhookSourceSectionState;
}): ReactNode {
  if (input.uiState.showCreateAction === true && input.onCreateWebhookSource !== undefined) {
    return (
      <Button
        disabled={input.webhookSourceState.isCreating}
        onClick={() => {
          input.onCreateWebhookSource?.({ connectionId: input.connectionId });
        }}
        size="sm"
        type="button"
        variant="outline"
      >
        {input.webhookSourceState.isCreating ? "Creating..." : "Create webhook"}
      </Button>
    );
  }

  const standaloneSource = input.uiState.standaloneSource;
  if (
    input.uiState.showStandaloneDeleteAction !== true ||
    standaloneSource === undefined ||
    input.onDeleteWebhookSource === undefined
  ) {
    return null;
  }

  return (
    <Button
      aria-label={`Delete webhook source ${standaloneSource.displayName}`}
      disabled={input.webhookSourceState.deletingWebhookSourceId === standaloneSource.id}
      onClick={() => {
        input.onDeleteWebhookSource?.({
          connectionId: input.connectionId,
          webhookSourceId: standaloneSource.id,
        });
      }}
      size="sm"
      type="button"
      variant="outline"
    >
      {input.webhookSourceState.deletingWebhookSourceId === standaloneSource.id
        ? "Deleting..."
        : "Delete webhook"}
    </Button>
  );
}

function InstallationSection(input: {
  fields?:
    | readonly {
        label: string;
        value: string;
      }[]
    | undefined;
  callbackUrl?: string;
  isCallbackUrlLoading?: boolean;
  postInstallationSetupUrl?: string;
}): React.JSX.Element | null {
  if (
    (input.fields === undefined || input.fields.length === 0) &&
    input.callbackUrl === undefined &&
    input.isCallbackUrlLoading !== true &&
    input.postInstallationSetupUrl === undefined
  ) {
    return null;
  }

  return (
    <div className="gap-3 flex flex-col">
      {input.fields === undefined || input.fields.length === 0 ? null : (
        <DefinitionList
          items={input.fields.map((field) => ({
            id: field.label,
            label: field.label,
            value: field.value,
          }))}
        />
      )}
      {input.postInstallationSetupUrl === undefined &&
      input.callbackUrl === undefined &&
      input.isCallbackUrlLoading !== true ? null : (
        <div className="flex flex-col gap-3">
          {input.postInstallationSetupUrl === undefined ? null : (
            <CopyableValue
              label="Post-installation setup URL"
              value={input.postInstallationSetupUrl}
            />
          )}
          {input.callbackUrl === undefined &&
          input.isCallbackUrlLoading !== true ? null : input.callbackUrl !== undefined ? (
            <CopyableValue label="Webhook callback URL" value={input.callbackUrl} />
          ) : (
            <CopyableValue label="Webhook callback URL" loading />
          )}
        </div>
      )}
    </div>
  );
}

function ResourcesSection(input: {
  connectionId: string;
  onRefreshResource: ((input: { connectionId: string; kind: string }) => void) | undefined;
  resourceItemsByKey: IntegrationConnectionDetailViewProps["resourceItemsByKey"];
  resources: readonly IntegrationConnectionDetailResourceSummary[];
}): React.JSX.Element {
  return (
    <IntegrationResourceList
      connectionId={input.connectionId}
      resources={input.resources}
      {...(input.resourceItemsByKey === undefined
        ? {}
        : { resourceItemsByKey: input.resourceItemsByKey })}
      {...(input.onRefreshResource === undefined
        ? {}
        : { onRefreshResource: input.onRefreshResource })}
    />
  );
}

function WebhookSourcesSection(input: {
  connectionId: string;
  hideDeleteAction: boolean;
  onCreateWebhookSource: ((input: { connectionId: string }) => void) | undefined;
  onDeleteWebhookSource:
    | ((input: { connectionId: string; webhookSourceId: string }) => void)
    | undefined;
  state: IntegrationWebhookSourceSectionState;
  supportedWebhookEvents: readonly IntegrationWebhookEventDefinition[];
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
        <>
          <Notice>
            {input.onCreateWebhookSource === undefined
              ? "No webhook is configured for this connection."
              : "Create a webhook to receive events."}
          </Notice>
          {input.supportedWebhookEvents.length === 0 ? null : (
            <WebhookTriggerCapabilityEventList
              capabilities={undefined}
              events={resolveWebhookTriggerCapabilityEvents({
                capabilities: undefined,
                supportedWebhookEvents: input.supportedWebhookEvents,
              })}
            />
          )}
        </>
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
              supportedWebhookEvents={input.supportedWebhookEvents}
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
  supportedWebhookEvents: readonly IntegrationWebhookEventDefinition[];
}): React.JSX.Element {
  const isDeleting = input.deletingWebhookSourceId === input.source.id;
  const isDeleteSupported =
    !input.hideDeleteAction &&
    input.onDeleteWebhookSource !== undefined &&
    input.source.remoteRegistrationId !== undefined;
  const registeredEventLabels = resolveWebhookRegisteredEventLabels(input.source.providerMetadata);
  const webhookTriggerCapabilities = parseWebhookTriggerCapabilitiesProviderMetadata(
    input.source.providerMetadata,
  );
  const webhookTriggerCapabilityEvents = resolveWebhookTriggerCapabilityEvents({
    capabilities: webhookTriggerCapabilities,
    supportedWebhookEvents: input.supportedWebhookEvents,
  });
  const shouldShowHeaderText = !input.hideDeleteAction && input.source.displayName !== "";
  const shouldShowHeaderRow = shouldShowHeaderText || isDeleteSupported;

  return (
    <div className="flex flex-col gap-3">
      {shouldShowHeaderRow ? (
        <div className="flex items-start justify-between gap-3">
          {shouldShowHeaderText ? (
            <DetailLabel as="p">{input.source.displayName}</DetailLabel>
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
        <DefinitionList
          items={[
            {
              id: "status",
              label: "Status",
              value: formatWebhookSourceStatusLabel(input.source.status),
            },
            ...(input.source.remoteRegistrationId === undefined
              ? []
              : [
                  {
                    id: "provider-registration",
                    label: "Provider registration",
                    value: input.source.remoteRegistrationId,
                  },
                ]),
          ]}
        />
        <BadgeListField
          items={registeredEventLabels.map((label) => ({
            id: label,
            label,
          }))}
          label="Registered events"
        />
        {input.source.callbackUrl === undefined ? null : (
          <CopyableValue label="Webhook URL" value={input.source.callbackUrl} />
        )}
        {webhookTriggerCapabilityEvents.length === 0 ? null : (
          <WebhookTriggerCapabilityEventList
            capabilities={webhookTriggerCapabilities}
            events={webhookTriggerCapabilityEvents}
          />
        )}
      </div>
    </div>
  );
}

function WebhookTriggerCapabilityEventList(input: {
  capabilities: IntegrationWebhookTriggerCapabilities | undefined;
  events: readonly IntegrationWebhookTriggerCapabilityEvent[];
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <DetailLabel as="p">Webhook events</DetailLabel>
      <div className="divide-border overflow-hidden rounded-md border">
        {input.events.map((event) => (
          <WebhookTriggerCapabilityEventRow
            capabilities={input.capabilities}
            event={event}
            key={event.eventDefinition.eventType}
          />
        ))}
      </div>
    </div>
  );
}

function WebhookTriggerCapabilityEventRow(input: {
  capabilities: IntegrationWebhookTriggerCapabilities | undefined;
  event: IntegrationWebhookTriggerCapabilityEvent;
}): React.JSX.Element {
  const providerRequirementSets =
    input.event.status === "enabled" && input.event.satisfiedRequirementSet !== undefined
      ? [input.event.satisfiedRequirementSet]
      : input.event.unsatisfiedRequirementSets;

  return (
    <div className="border-b px-3 py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          {input.event.status === "enabled" ? null : (
            <CircleDashedIcon
              aria-label="Not enabled"
              className="text-muted-foreground size-3.5 shrink-0"
            />
          )}
          <span
            className={`truncate text-sm font-medium ${
              input.event.status === "enabled" ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            {input.event.eventDefinition.displayName}
          </span>
        </div>
      </div>
      {providerRequirementSets.length === 0 ? null : (
        <div className="mt-2 flex flex-col gap-1.5">
          {providerRequirementSets.map((requirementSet, index) => (
            <WebhookTriggerProviderRequirementSet
              capabilities={input.capabilities}
              index={index}
              key={formatRequirementSetKey(requirementSet, index)}
              requirementSet={requirementSet}
              showAlternativeLabel={providerRequirementSets.length > 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WebhookTriggerProviderRequirementSet(input: {
  capabilities: IntegrationWebhookTriggerCapabilities | undefined;
  index: number;
  requirementSet: IntegrationWebhookTriggerRequirementSet;
  showAlternativeLabel: boolean;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      {input.showAlternativeLabel ? (
        <p className="text-muted-foreground text-xs">Option {input.index + 1}</p>
      ) : null}
      <WebhookTriggerProviderEventsRequirement
        capabilities={input.capabilities}
        event={input.requirementSet.event}
      />
      {(input.requirementSet.permissions ?? []).length === 0 ? null : (
        <WebhookTriggerProviderPermissionsRequirement
          capabilities={input.capabilities}
          permissions={input.requirementSet.permissions ?? []}
        />
      )}
    </div>
  );
}

function WebhookTriggerProviderEventsRequirement(input: {
  capabilities: IntegrationWebhookTriggerCapabilities | undefined;
  event: string | undefined;
}): React.JSX.Element | null {
  if (input.event === undefined) {
    return null;
  }

  return (
    <WebhookTriggerProviderRequirementChipGroup
      items={[
        {
          id: input.event,
          isPresent: hasWebhookTriggerEventCapability({
            capabilities: input.capabilities,
            event: input.event,
          }),
          value: input.event,
        },
      ]}
      label="Events"
    />
  );
}

function WebhookTriggerProviderRequirementChipGroup(input: {
  items: readonly {
    id: string;
    isPresent: boolean;
    value: string;
  }[];
  label: string;
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2 text-xs">
      <span className="text-muted-foreground">{input.label}</span>
      <div className="flex min-w-0 flex-wrap gap-1.5">
        {input.items.map((item) => (
          <WebhookTriggerProviderRequirementChip
            isPresent={item.isPresent}
            key={item.id}
            value={item.value}
          />
        ))}
      </div>
    </div>
  );
}

function WebhookTriggerProviderPermissionsRequirement(input: {
  capabilities: IntegrationWebhookTriggerCapabilities | undefined;
  permissions: readonly IntegrationWebhookTriggerProviderPermissionRequirement[];
}): React.JSX.Element {
  return (
    <WebhookTriggerProviderRequirementChipGroup
      items={input.permissions.map((permission) => {
        const formattedPermission = formatProviderPermissionRequirement(permission);

        return {
          id: formattedPermission,
          isPresent: hasWebhookTriggerPermissionCapability({
            capabilities: input.capabilities,
            permission,
          }),
          value: formattedPermission,
        };
      })}
      label="Permissions"
    />
  );
}

function WebhookTriggerProviderRequirementChip(input: {
  isPresent: boolean;
  value: string;
}): React.JSX.Element {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {input.isPresent ? (
        <CheckCircleIcon
          aria-label="Present"
          className="size-3.5 shrink-0 text-emerald-700"
          weight="fill"
        />
      ) : (
        <CircleDashedIcon
          aria-label="Missing"
          className="text-muted-foreground size-3.5 shrink-0"
        />
      )}
      <code className="min-w-0 break-all text-foreground">{input.value}</code>
    </span>
  );
}

function formatProviderPermissionRequirement(
  permission: IntegrationWebhookTriggerProviderPermissionRequirement,
): string {
  return permission.access === undefined
    ? permission.permission
    : `${permission.permission}:${permission.access}`;
}

function formatRequirementSetKey(
  requirementSet: IntegrationWebhookTriggerRequirementSet,
  index: number,
): string {
  const permissionKey = (requirementSet.permissions ?? [])
    .map((permission) => `${permission.permission}:${permission.access ?? ""}`)
    .join("|");

  return `${requirementSet.event ?? ""}:${permissionKey}:${index}`;
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
