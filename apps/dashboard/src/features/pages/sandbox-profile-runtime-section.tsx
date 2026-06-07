import { createBrowserDefinitionsBundle } from "@mistle/integrations-definitions/browser";
import {
  Button,
  Checkbox,
  CopyableValue,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldContent,
  FieldGroup,
  FieldHeader,
  FieldLabel,
  FieldLabelWithTooltip,
  Input,
  Notice,
  SectionBlock,
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Slider,
  TextLink,
} from "@mistle/ui";
import { CheckIcon, EyeIcon, PlusIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link as RouterLink } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { IntegrationLogo } from "../integrations/integration-logo.js";
import type {
  SandboxProviderSummary,
  SandboxProfileVersion,
} from "../sandbox-profiles/sandbox-profiles-types.js";
import {
  ApiKeyPermissionOptions,
  DefaultApiKeyPermissions,
} from "../settings/api-keys/api-key-permissions.js";
import type { ApiKey, CreatedApiKey } from "../settings/api-keys/api-keys-service.js";
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
} from "./sandbox-profile-binding-config-editor.js";
import {
  createDefaultSandboxResources,
  DockerSandboxProviderId,
  resolveManagedSandboxProvider,
} from "./sandbox-profile-runtime-defaults.js";
import { SandboxProfileSectionCard } from "./sandbox-profile-section-card.js";

const Definitions = createBrowserDefinitionsBundle();
const IntegrationRegistry = Definitions.integrationRegistry;
const AgentRuntimeRegistry = Definitions.agentRuntimeRegistry;

const MissingProviderValue = "__missing_provider__";
const MissingConnectionValue = "__missing_connection__";
const NoMistleMcpApiKeyValue = "__no_mistle_mcp_api_key__";
const CreateMistleMcpApiKeyValue = "__create_mistle_mcp_api_key__";
const ManagedSandboxRuntimeOptionValue = "__managed_sandbox_runtime__";
const OrganizationSandboxRuntimeOptionPrefix = "organization:";

type SandboxCredentialSource = "managed" | "organization";
type AgentRuntimeId = SandboxProfileVersion["agentRuntimeId"];
type SandboxRuntimeOption =
  | {
      kind: "managed";
      provider: SandboxProviderSummary;
      value: typeof ManagedSandboxRuntimeOptionValue;
    }
  | {
      kind: "organization";
      provider: SandboxProviderSummary;
      value: string;
    };

export type SandboxProfileRuntimeDraftChanges = {
  agentRuntimeId: AgentRuntimeId;
  mistleMcpEnabled: boolean;
  mistleMcpApiKeyId: string | null;
  sandboxProvider: string;
  sandboxConnectionId: string | null;
  sandboxResources: SandboxProfileVersion["sandboxResources"];
};

export type SandboxProfileRuntimeDraftState = {
  agentRuntimeId: AgentRuntimeId | undefined;
  sourceVersionKey: string | undefined;
  hasUnpersistedChanges: boolean;
  applyDraftSaveError?: (error: unknown) => void;
  applySavedRuntimeConfig?: (runtimeConfig: SandboxProfileRuntimeDraftChanges) => void;
  buildDraftChanges?: () => SandboxProfileRuntimeDraftChanges;
};

type RuntimeConfigState = {
  agentRuntimeId: AgentRuntimeId;
  credentialSource: SandboxCredentialSource;
  mistleMcpEnabled: boolean;
  mistleMcpApiKeyId: string | null;
  sandboxProvider: string | null;
  sandboxConnectionId: string | null;
  sandboxResources: SandboxProfileVersion["sandboxResources"];
};

type ResourceCapability = NonNullable<SandboxProviderSummary["resourceCapabilities"]>["vcpuCount"];

export function createRuntimeDraftSourceVersionKey(
  version: Pick<SandboxProfileVersion, "sandboxProfileId" | "version">,
): string {
  return `${version.sandboxProfileId}:${String(version.version)}`;
}

export function SandboxProfileRuntimeSection(input: {
  apiKeys: readonly ApiKey[];
  apiKeysAreLoading?: boolean | undefined;
  apiKeysLoadErrorMessage?: string | null | undefined;
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  disabled: boolean;
  isDraft: boolean;
  onCreateApiKey?:
    | ((input: { name: string; permissions: readonly string[] }) => Promise<CreatedApiKey>)
    | undefined;
  onDraftStateChange?: (state: SandboxProfileRuntimeDraftState) => void;
  providers: readonly SandboxProviderSummary[];
  sectionChrome?: boolean;
  version: SandboxProfileVersion;
}): React.JSX.Element {
  const persistedRuntime = createRuntimeConfigState({
    providers: input.providers,
    version: input.version,
  });
  const [draftRuntime, setDraftRuntime] = useState<RuntimeConfigState>(persistedRuntime);
  const [persistedRuntimeState, setPersistedRuntimeState] =
    useState<RuntimeConfigState>(persistedRuntime);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const draftRuntimeRef = useRef(draftRuntime);
  draftRuntimeRef.current = draftRuntime;

  const selectedProvider = findProvider({
    providerId: draftRuntime.sandboxProvider,
    providers: input.providers,
  });
  const fieldIsReadOnly = input.disabled || !input.isDraft;
  const matchingConnections =
    selectedProvider === null
      ? []
      : resolveConnectionsForProvider({
          availableConnections: input.availableConnections,
          availableTargets: input.availableTargets,
          providerId: selectedProvider.id,
        });
  const providerOptions = createProviderOptions(input.providers);
  const selectedProviderOption = findSelectedProviderOption({
    options: providerOptions,
    runtime: draftRuntime,
  });
  const readOnlyRuntime = persistedRuntimeState;
  const readOnlyProvider = findProvider({
    providerId: readOnlyRuntime.sandboxProvider,
    providers: input.providers,
  });
  const inlineRuntimeFields = input.sectionChrome === false;

  const buildDraftChanges = useCallback((): SandboxProfileRuntimeDraftChanges => {
    const runtime = draftRuntimeRef.current;
    const provider = runtime.sandboxProvider;
    if (provider === null) {
      throw new Error("Sandbox runtime provider is missing.");
    }

    if (runtime.credentialSource === "organization" && runtime.sandboxConnectionId === null) {
      setSaveErrorMessage("Select a workspace API key connection before saving sandbox runtime.");
      throw new Error("Sandbox runtime credentials are missing.");
    }

    if (runtime.mistleMcpEnabled && runtime.mistleMcpApiKeyId === null) {
      if (input.apiKeysAreLoading === true) {
        setSaveErrorMessage("Wait for API keys to finish loading before saving.");
        throw new Error("Mistle MCP API keys are loading.");
      }

      if (input.apiKeysLoadErrorMessage !== null && input.apiKeysLoadErrorMessage !== undefined) {
        setSaveErrorMessage(input.apiKeysLoadErrorMessage);
        throw new Error("Mistle MCP API keys could not be loaded.");
      }

      setSaveErrorMessage("Select an API key before saving Mistle resource access.");
      throw new Error("Mistle MCP API key is missing.");
    }

    return {
      agentRuntimeId: runtime.agentRuntimeId,
      mistleMcpEnabled: runtime.mistleMcpEnabled,
      mistleMcpApiKeyId: runtime.mistleMcpEnabled ? runtime.mistleMcpApiKeyId : null,
      sandboxProvider: provider,
      sandboxConnectionId: runtime.sandboxConnectionId,
      sandboxResources: runtime.sandboxResources,
    };
  }, [input.apiKeysAreLoading, input.apiKeysLoadErrorMessage]);

  const applySavedRuntimeConfig = useCallback(
    (runtimeConfig: SandboxProfileRuntimeDraftChanges): void => {
      const nextRuntime = {
        credentialSource: resolveCredentialSource({
          connectionId: runtimeConfig.sandboxConnectionId,
        }),
        agentRuntimeId: runtimeConfig.agentRuntimeId,
        mistleMcpEnabled: runtimeConfig.mistleMcpEnabled,
        mistleMcpApiKeyId: runtimeConfig.mistleMcpApiKeyId,
        sandboxProvider: runtimeConfig.sandboxProvider,
        sandboxConnectionId: runtimeConfig.sandboxConnectionId,
        sandboxResources: runtimeConfig.sandboxResources,
      };
      setDraftRuntime(nextRuntime);
      setPersistedRuntimeState(nextRuntime);
      setSaveErrorMessage(null);
    },
    [input.providers],
  );

  const applyDraftSaveError = useCallback((error: unknown): void => {
    setSaveErrorMessage(
      resolveApiErrorMessage({
        error,
        fallbackMessage: "Could not save sandbox runtime settings.",
      }),
    );
  }, []);

  useEffect(() => {
    const nextRuntime = createRuntimeConfigState({
      providers: input.providers,
      version: input.version,
    });
    setDraftRuntime(nextRuntime);
    setPersistedRuntimeState(nextRuntime);
    setSaveErrorMessage(null);
  }, [
    input.providers,
    input.version.agentRuntimeId,
    input.version.mistleMcpApiKeyId,
    input.version.mistleMcpEnabled,
    input.version.sandboxConnectionId,
    input.version.sandboxProvider,
    input.version.sandboxResources,
    input.version.version,
  ]);

  useEffect(() => {
    input.onDraftStateChange?.({
      agentRuntimeId: draftRuntime.agentRuntimeId,
      sourceVersionKey: createRuntimeDraftSourceVersionKey(input.version),
      applyDraftSaveError,
      applySavedRuntimeConfig,
      buildDraftChanges,
      hasUnpersistedChanges: !runtimeConfigStatesAreEqual(draftRuntime, persistedRuntimeState),
    });
  }, [
    applyDraftSaveError,
    applySavedRuntimeConfig,
    buildDraftChanges,
    draftRuntime,
    input.onDraftStateChange,
    persistedRuntimeState,
  ]);

  function updateProvider(choiceValue: string | null): void {
    if (choiceValue === null) {
      return;
    }

    const option = providerOptions.find((candidate) => candidate.value === choiceValue);
    if (option === undefined) {
      return;
    }

    const currentRuntime = draftRuntimeRef.current;
    setDraftRuntime({
      agentRuntimeId: currentRuntime.agentRuntimeId,
      credentialSource: option.kind,
      mistleMcpEnabled: currentRuntime.mistleMcpEnabled,
      mistleMcpApiKeyId: currentRuntime.mistleMcpApiKeyId,
      sandboxProvider: option.provider.id,
      sandboxConnectionId: null,
      sandboxResources:
        currentRuntime.sandboxProvider === option.provider.id
          ? currentRuntime.sandboxResources
          : createDefaultSandboxResources(option.provider),
    });
    setSaveErrorMessage(null);
  }

  function updateConnection(value: string | null): void {
    if (value === null || value === MissingConnectionValue) {
      return;
    }

    setDraftRuntime((currentRuntime) => ({
      ...currentRuntime,
      sandboxConnectionId: value,
    }));
    setSaveErrorMessage(null);
  }

  function updateResourceField(
    field: keyof NonNullable<SandboxProfileVersion["sandboxResources"]>,
    value: number,
  ): void {
    setDraftRuntime((currentRuntime) => {
      if (currentRuntime.sandboxResources === null) {
        return currentRuntime;
      }

      const provider = findProvider({
        providerId: currentRuntime.sandboxProvider,
        providers: input.providers,
      });
      return {
        ...currentRuntime,
        sandboxResources: createNextResourcesForFieldChange({
          field,
          provider,
          resources: currentRuntime.sandboxResources,
          value,
        }),
      };
    });
    setSaveErrorMessage(null);
  }

  function updateAgentRuntime(value: string | null): void {
    if (value === null || !isAgentRuntimeId(value)) {
      return;
    }

    setDraftRuntime((currentRuntime) => ({
      ...currentRuntime,
      agentRuntimeId: value,
    }));
    setSaveErrorMessage(null);
  }

  function updateMistleMcpApiKey(value: string | null): void {
    if (value === null || value === CreateMistleMcpApiKeyValue) {
      return;
    }

    if (value === NoMistleMcpApiKeyValue) {
      setDraftRuntime((currentRuntime) => ({
        ...currentRuntime,
        mistleMcpEnabled: false,
        mistleMcpApiKeyId: null,
      }));
      setSaveErrorMessage(null);
      return;
    }

    setDraftRuntime((currentRuntime) => ({
      ...currentRuntime,
      mistleMcpEnabled: true,
      mistleMcpApiKeyId: value,
    }));
    setSaveErrorMessage(null);
  }

  const providerFieldLabel = "Sandbox provider";
  const agentRuntimeField = (
    <Field
      contentWidth={inlineRuntimeFields ? "fill" : "fit"}
      orientation={inlineRuntimeFields ? "horizontal" : "vertical"}
    >
      <FieldHeader>
        <FieldLabel htmlFor="sandbox-profile-agent-runtime">Agent</FieldLabel>
      </FieldHeader>
      <FieldContent>
        <Select onValueChange={updateAgentRuntime} value={draftRuntime.agentRuntimeId}>
          <SelectTrigger id="sandbox-profile-agent-runtime">
            <SelectValue>
              <AgentRuntimeOptionLabel runtimeId={draftRuntime.agentRuntimeId} />
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {AgentRuntimeRegistry.listRuntimes().map((runtime) => (
              <SelectItem key={runtime.runtimeId} value={runtime.runtimeId}>
                <AgentRuntimeOptionLabel runtimeId={runtime.runtimeId} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldContent>
    </Field>
  );
  const mistleMcpAccessContent = (
    <MistleMcpAccessField
      apiKeyId={draftRuntime.mistleMcpApiKeyId}
      apiKeys={input.apiKeys}
      apiKeysAreLoading={input.apiKeysAreLoading === true}
      apiKeysLoadErrorMessage={input.apiKeysLoadErrorMessage ?? null}
      disabled={fieldIsReadOnly}
      enabled={draftRuntime.mistleMcpEnabled}
      horizontal={inlineRuntimeFields}
      onApiKeyChange={updateMistleMcpApiKey}
      onCreateApiKey={input.onCreateApiKey}
      readOnly={fieldIsReadOnly}
    />
  );
  const agentRuntimeContent = fieldIsReadOnly ? (
    <div className="grid gap-3">
      <SandboxProfileAgentRuntimeReadOnlySummary
        horizontal={inlineRuntimeFields}
        runtimeId={draftRuntime.agentRuntimeId}
      />
      {mistleMcpAccessContent}
    </div>
  ) : (
    <div className="grid gap-4">
      {agentRuntimeField}
      {mistleMcpAccessContent}
    </div>
  );
  const providerField = (
    <Field
      contentWidth={inlineRuntimeFields ? "fill" : "fit"}
      orientation={inlineRuntimeFields ? "horizontal" : "vertical"}
    >
      <FieldHeader>
        <FieldLabel htmlFor="sandbox-profile-runtime-provider">{providerFieldLabel}</FieldLabel>
      </FieldHeader>
      <FieldContent>
        <Select
          onValueChange={updateProvider}
          value={selectedProviderOption?.value ?? MissingProviderValue}
        >
          <SelectTrigger id="sandbox-profile-runtime-provider">
            <SelectValue placeholder="Select sandbox provider">
              {selectedProvider === null ? (
                <span className="text-muted-foreground">
                  {draftRuntime.sandboxProvider === null
                    ? "Select sandbox provider"
                    : "Sandbox provider unavailable"}
                </span>
              ) : (
                <SandboxRuntimeOptionLabel
                  option={
                    selectedProviderOption ??
                    createUnavailableRuntimeOption({
                      credentialSource: draftRuntime.credentialSource,
                      provider: selectedProvider,
                    })
                  }
                />
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {selectedProvider === null ? (
              <SelectItem disabled value={MissingProviderValue}>
                {draftRuntime.sandboxProvider === null
                  ? "Select sandbox provider"
                  : "Sandbox provider unavailable"}
              </SelectItem>
            ) : null}
            {providerOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <SandboxRuntimeOptionLabel option={option} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldContent>
    </Field>
  );

  const runtimeFields = fieldIsReadOnly ? (
    <SandboxProfileRuntimeReadOnlySummary
      connection={resolveConnection({
        connectionId: readOnlyRuntime.sandboxConnectionId,
        connections: input.availableConnections,
      })}
      provider={readOnlyProvider}
      providerFieldLabel={providerFieldLabel}
      runtime={readOnlyRuntime}
      horizontal={inlineRuntimeFields}
    />
  ) : (
    <div className="grid gap-4">
      {providerField}
      <SandboxProviderConnectionField
        connectionId={draftRuntime.sandboxConnectionId}
        connections={matchingConnections}
        credentialSource={draftRuntime.credentialSource}
        onConnectionChange={updateConnection}
        providerTarget={findSandboxProviderTarget({
          availableTargets: input.availableTargets,
          providerId: selectedProvider?.id ?? null,
        })}
        horizontal={inlineRuntimeFields}
        provider={selectedProvider}
      />

      <SandboxProviderResourceFields
        disabled={fieldIsReadOnly}
        onResourceFieldChange={updateResourceField}
        provider={selectedProvider}
        resources={draftRuntime.sandboxResources}
      />
    </div>
  );

  if (inlineRuntimeFields) {
    return (
      <div className="grid gap-3">
        {saveErrorMessage === null ? null : <Notice variant="alert">{saveErrorMessage}</Notice>}
        <SandboxProfileSectionCard>{agentRuntimeContent}</SandboxProfileSectionCard>
        <SandboxProfileSectionCard>{runtimeFields}</SandboxProfileSectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {saveErrorMessage === null ? null : <Notice variant="alert">{saveErrorMessage}</Notice>}
      <SectionBlock title="Agent">{agentRuntimeContent}</SectionBlock>
      <SectionBlock title="Sandbox provider">{runtimeFields}</SectionBlock>
    </div>
  );
}

function SandboxProviderConnectionField(input: {
  connectionId: string | null;
  connections: readonly IntegrationConnectionSummary[];
  credentialSource: SandboxCredentialSource;
  horizontal?: boolean | undefined;
  onConnectionChange: (value: string | null) => void;
  provider: SandboxProviderSummary | null;
  providerTarget: IntegrationTargetSummary | null;
}): React.JSX.Element | null {
  if (
    input.provider === null ||
    !input.provider.supportsOrganizationConnection ||
    input.credentialSource === "managed"
  ) {
    return null;
  }

  const selectedConnection = resolveConnection({
    connectionId: input.connectionId,
    connections: input.connections,
  });
  const connectionValue = input.connectionId ?? MissingConnectionValue;
  return (
    <Field
      contentWidth={input.horizontal === true ? "fill" : "fit"}
      orientation={input.horizontal === true ? "horizontal" : "vertical"}
    >
      <FieldHeader>
        <FieldLabel htmlFor="sandbox-profile-runtime-connection">Connection</FieldLabel>
      </FieldHeader>
      <FieldContent>
        <Select onValueChange={input.onConnectionChange} value={connectionValue}>
          <SelectTrigger id="sandbox-profile-runtime-connection">
            <SelectValue placeholder="Select credentials">
              {selectedConnection === null ? (
                <span className="text-muted-foreground">Select connection</span>
              ) : (
                selectedConnection.displayName
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {input.connectionId !== null && selectedConnection === null ? (
              <SelectItem disabled value={input.connectionId}>
                Missing connection
              </SelectItem>
            ) : null}
            {input.connectionId === null ? (
              <SelectItem disabled value={MissingConnectionValue}>
                Select connection
              </SelectItem>
            ) : null}
            {input.connections.map((connection) => (
              <SelectItem key={connection.id} value={connection.id}>
                {connection.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {input.connections.length > 0 || input.providerTarget === null ? null : (
          <TextLink
            className="mt-2 inline-flex text-sm font-medium"
            render={<RouterLink to={`/integrations/${input.providerTarget.targetKey}/add`} />}
          >
            Add an API key in integrations
          </TextLink>
        )}
      </FieldContent>
    </Field>
  );
}

function SandboxProviderResourceFields(input: {
  disabled: boolean;
  onResourceFieldChange: (
    field: keyof NonNullable<SandboxProfileVersion["sandboxResources"]>,
    value: number,
  ) => void;
  provider: SandboxProviderSummary | null;
  resources: SandboxProfileVersion["sandboxResources"];
}): React.JSX.Element | null {
  if (
    input.provider === null ||
    input.provider.resourceCapabilities === null ||
    input.resources === null
  ) {
    return null;
  }

  const capabilities = input.provider.resourceCapabilities;
  const memoryCapability = createMemoryCapabilityForVcpu({
    capability: capabilities.memoryMb,
    vcpuCount: input.resources.vcpuCount,
  });
  return (
    <>
      <ResourceSliderField
        capability={capabilities.vcpuCount}
        disabled={input.disabled}
        formatValue={formatCpuResourceValue}
        id="sandbox-profile-runtime-vcpu"
        label="CPU"
        onChange={(value) => {
          input.onResourceFieldChange("vcpuCount", value);
        }}
        value={input.resources.vcpuCount}
      />
      <ResourceSliderField
        capability={memoryCapability}
        disabled={input.disabled}
        formatValue={formatMemoryResourceValue}
        id="sandbox-profile-runtime-memory"
        label="Memory (MB)"
        onChange={(value) => {
          input.onResourceFieldChange("memoryMb", value);
        }}
        value={clampResourceValue(input.resources.memoryMb, memoryCapability)}
      />
      {capabilities.diskMb === undefined ? null : (
        <ResourceNumberField
          capability={capabilities.diskMb}
          disabled={input.disabled}
          id="sandbox-profile-runtime-disk"
          label="Disk (MB)"
          onChange={(value) => {
            input.onResourceFieldChange("diskMb", value);
          }}
          value={input.resources.diskMb ?? capabilities.diskMb.default}
        />
      )}
    </>
  );
}

function createNextResourcesForFieldChange(input: {
  field: keyof NonNullable<SandboxProfileVersion["sandboxResources"]>;
  provider: SandboxProviderSummary | null;
  resources: NonNullable<SandboxProfileVersion["sandboxResources"]>;
  value: number;
}): NonNullable<SandboxProfileVersion["sandboxResources"]> {
  const nextResources = {
    ...input.resources,
    [input.field]: input.value,
  };

  if (
    input.field !== "vcpuCount" ||
    input.provider === null ||
    input.provider.resourceCapabilities === null
  ) {
    return nextResources;
  }

  const memoryCapability = createMemoryCapabilityForVcpu({
    capability: input.provider.resourceCapabilities.memoryMb,
    vcpuCount: nextResources.vcpuCount,
  });

  return {
    ...nextResources,
    memoryMb: clampResourceValue(nextResources.memoryMb, memoryCapability),
  };
}

function createMemoryCapabilityForVcpu(input: {
  capability: NonNullable<SandboxProviderSummary["resourceCapabilities"]>["memoryMb"];
  vcpuCount: number;
}): ResourceCapability {
  const min = Math.max(
    input.capability.min,
    input.capability.minPerVcpu === undefined
      ? input.capability.min
      : input.vcpuCount * input.capability.minPerVcpu,
  );
  const max = Math.min(
    input.capability.max,
    input.capability.maxPerVcpu === undefined
      ? input.capability.max
      : input.vcpuCount * input.capability.maxPerVcpu,
  );

  return {
    min,
    max,
    step: input.capability.step,
    default: clampResourceValue(input.capability.default, {
      min,
      max,
      step: input.capability.step,
      default: input.capability.default,
    }),
  };
}

function clampResourceValue(value: number, capability: ResourceCapability): number {
  return Math.min(Math.max(value, capability.min), capability.max);
}

function ResourceNumberField(input: {
  capability: ResourceCapability;
  disabled: boolean;
  id: string;
  label: string;
  onChange: (value: number) => void;
  value: number;
}): React.JSX.Element {
  return (
    <Field contentWidth="fill" orientation="horizontal">
      <FieldHeader>
        <FieldLabel htmlFor={input.id}>{input.label}</FieldLabel>
      </FieldHeader>
      <FieldContent>
        <Input
          disabled={input.disabled}
          id={input.id}
          max={input.capability.max}
          min={input.capability.min}
          onChange={(event) => {
            const nextValue = event.currentTarget.valueAsNumber;
            if (Number.isNaN(nextValue)) {
              return;
            }

            input.onChange(nextValue);
          }}
          step={input.capability.step}
          type="number"
          value={input.value}
        />
      </FieldContent>
    </Field>
  );
}

function ResourceSliderField(input: {
  capability: ResourceCapability;
  disabled: boolean;
  formatValue: (value: number) => string;
  id: string;
  label: string;
  onChange: (value: number) => void;
  value: number;
}): React.JSX.Element {
  return (
    <Field contentWidth="fill" orientation="horizontal">
      <FieldHeader>
        <FieldLabel>{input.label}</FieldLabel>
      </FieldHeader>
      <FieldContent>
        <div className="flex items-center gap-4">
          <Slider
            aria-label={input.label}
            className="[&_[data-slot=slider-range]]:bg-primary/80 [&_[data-slot=slider-thumb]]:size-5 [&_[data-slot=slider-track]]:h-2 [&_[data-slot=slider-track]]:bg-border min-w-0 flex-1"
            disabled={input.disabled}
            id={input.id}
            max={input.capability.max}
            min={input.capability.min}
            onValueChange={(values) => {
              const nextValue = Array.isArray(values) ? values[0] : values;
              if (nextValue === undefined) {
                return;
              }

              input.onChange(nextValue);
            }}
            step={input.capability.step}
            value={[input.value]}
          />
          <span className="min-w-20 shrink-0 text-right text-sm font-medium">
            {input.formatValue(input.value)}
          </span>
        </div>
      </FieldContent>
    </Field>
  );
}

function SandboxProfileRuntimeReadOnlySummary(input: {
  connection: IntegrationConnectionSummary | null;
  horizontal: boolean;
  provider: SandboxProviderSummary | null;
  providerFieldLabel: string;
  runtime: RuntimeConfigState;
}): React.JSX.Element {
  const shouldShowConnection =
    input.provider !== null &&
    input.provider.supportsOrganizationConnection &&
    input.runtime.credentialSource === "organization";
  return (
    <div className="grid gap-4">
      <ReadOnlyRuntimeField horizontal={input.horizontal} label={input.providerFieldLabel}>
        {input.provider === null ? (
          input.runtime.sandboxProvider
        ) : input.runtime.credentialSource === "managed" ? (
          <MistleProviderLabel />
        ) : (
          <ProviderOptionLabel provider={input.provider} />
        )}
      </ReadOnlyRuntimeField>
      {shouldShowConnection ? (
        <ReadOnlyRuntimeField horizontal={input.horizontal} label="Connection">
          {input.connection?.displayName ??
            input.runtime.sandboxConnectionId ??
            "Select connection"}
        </ReadOnlyRuntimeField>
      ) : null}
      <SandboxProviderReadOnlyResourceFields
        horizontal={input.horizontal}
        provider={input.provider}
        resources={input.runtime.sandboxResources}
      />
    </div>
  );
}

function SandboxProfileAgentRuntimeReadOnlySummary(input: {
  horizontal: boolean;
  runtimeId: AgentRuntimeId;
}): React.JSX.Element {
  return (
    <ReadOnlyRuntimeField horizontal={input.horizontal} label="Agent">
      <AgentRuntimeOptionLabel runtimeId={input.runtimeId} />
    </ReadOnlyRuntimeField>
  );
}

function MistleMcpAccessField(input: {
  apiKeyId: string | null;
  apiKeys: readonly ApiKey[];
  apiKeysAreLoading: boolean;
  apiKeysLoadErrorMessage: string | null;
  disabled: boolean;
  enabled: boolean;
  horizontal: boolean;
  onApiKeyChange: (value: string | null) => void;
  onCreateApiKey:
    | ((input: { name: string; permissions: readonly string[] }) => Promise<CreatedApiKey>)
    | undefined;
  readOnly: boolean;
}): React.JSX.Element {
  const selectedApiKey = resolveApiKey({
    apiKeyId: input.apiKeyId,
    apiKeys: input.apiKeys,
  });

  if (input.readOnly) {
    return (
      <div className="grid gap-3">
        <ReadOnlyRuntimeField horizontal={input.horizontal} label="Mistle resources">
          {resolveReadOnlyMistleMcpAccessValue({
            apiKeyId: input.apiKeyId,
            enabled: input.enabled,
            selectedApiKey,
          })}
        </ReadOnlyRuntimeField>
      </div>
    );
  }

  return (
    <MistleMcpApiKeyField
      apiKeyId={input.apiKeyId}
      apiKeys={input.apiKeys}
      apiKeysAreLoading={input.apiKeysAreLoading}
      apiKeysLoadErrorMessage={input.apiKeysLoadErrorMessage}
      disabled={input.disabled}
      horizontal={input.horizontal}
      onApiKeyChange={input.onApiKeyChange}
      onCreateApiKey={input.onCreateApiKey}
      selectedApiKey={selectedApiKey}
    />
  );
}

function MistleMcpApiKeyField(input: {
  apiKeyId: string | null;
  apiKeys: readonly ApiKey[];
  apiKeysAreLoading: boolean;
  apiKeysLoadErrorMessage: string | null;
  disabled: boolean;
  horizontal: boolean;
  onApiKeyChange: (value: string | null) => void;
  onCreateApiKey:
    | ((input: { name: string; permissions: readonly string[] }) => Promise<CreatedApiKey>)
    | undefined;
  selectedApiKey: ApiKey | null;
}): React.JSX.Element {
  const [createDialogIsOpen, setCreateDialogIsOpen] = useState(false);
  const apiKeyValue = input.apiKeyId ?? NoMistleMcpApiKeyValue;

  function openCreateApiKeyDialog(): void {
    setCreateDialogIsOpen(true);
  }

  function handleApiKeyValueChange(value: string | null): void {
    if (value === CreateMistleMcpApiKeyValue) {
      openCreateApiKeyDialog();
      return;
    }

    input.onApiKeyChange(value);
  }

  if (input.apiKeysAreLoading) {
    return (
      <MistleMcpAccessFieldShell horizontal={input.horizontal}>
        <FieldContent>
          <Notice title="Loading API keys">API keys are still loading.</Notice>
        </FieldContent>
      </MistleMcpAccessFieldShell>
    );
  }

  if (input.apiKeysLoadErrorMessage !== null) {
    return (
      <MistleMcpAccessFieldShell horizontal={input.horizontal}>
        <FieldContent>
          <Notice title="Could not load API keys" variant="alert">
            {input.apiKeysLoadErrorMessage}
          </Notice>
          <CreateApiKeyDialogTrigger
            buttonText="Create new API key"
            createDialogIsOpen={createDialogIsOpen}
            disabled={input.disabled}
            onApiKeyChange={input.onApiKeyChange}
            onCreateApiKey={input.onCreateApiKey}
            onCreateDialogOpenChange={setCreateDialogIsOpen}
          />
        </FieldContent>
      </MistleMcpAccessFieldShell>
    );
  }

  if (input.apiKeys.length === 0) {
    return (
      <MistleMcpAccessFieldShell horizontal={input.horizontal}>
        <FieldContent>
          <CreateApiKeyDialogTrigger
            buttonText="Create new API key"
            createDialogIsOpen={createDialogIsOpen}
            disabled={input.disabled}
            onApiKeyChange={input.onApiKeyChange}
            onCreateApiKey={input.onCreateApiKey}
            onCreateDialogOpenChange={setCreateDialogIsOpen}
          />
        </FieldContent>
      </MistleMcpAccessFieldShell>
    );
  }

  return (
    <MistleMcpAccessFieldShell horizontal={input.horizontal}>
      <FieldContent>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            disabled={input.disabled}
            onValueChange={handleApiKeyValueChange}
            value={apiKeyValue}
          >
            <SelectTrigger id="sandbox-profile-mistle-mcp-api-key">
              <SelectValue placeholder="Select API key">
                {input.selectedApiKey === null ? "None" : input.selectedApiKey.name}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NoMistleMcpApiKeyValue}>None</SelectItem>
              {input.apiKeyId !== null && input.selectedApiKey === null ? (
                <SelectItem disabled value={input.apiKeyId}>
                  Missing API key
                </SelectItem>
              ) : null}
              {input.apiKeys.map((apiKey) => (
                <SelectItem key={apiKey.id} value={apiKey.id}>
                  {apiKey.name}
                </SelectItem>
              ))}
              <SelectSeparator />
              <SelectItem
                className="text-primary focus:text-primary"
                onClick={openCreateApiKeyDialog}
                value={CreateMistleMcpApiKeyValue}
              >
                <span className="flex items-center gap-2">
                  <PlusIcon aria-hidden className="size-4" />
                  Create new API key
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
          {input.selectedApiKey === null ? null : (
            <MistleResourceAccessSummary apiKey={input.selectedApiKey} />
          )}
        </div>
        {input.onCreateApiKey === undefined ? null : (
          <CreateApiKeyDialog
            onApiKeyChange={input.onApiKeyChange}
            onCreateApiKey={input.onCreateApiKey}
            onOpenChange={setCreateDialogIsOpen}
            open={createDialogIsOpen}
          />
        )}
      </FieldContent>
    </MistleMcpAccessFieldShell>
  );
}

function MistleMcpAccessFieldShell(input: {
  children: ReactNode;
  horizontal: boolean;
}): React.JSX.Element {
  return (
    <Field
      contentWidth={input.horizontal ? "fill" : "fit"}
      orientation={input.horizontal ? "horizontal" : "vertical"}
    >
      <FieldHeader>
        <FieldLabelWithTooltip
          htmlFor="sandbox-profile-mistle-mcp-api-key"
          tooltip="Lets this profile's agent use the selected organization API key to access Mistle, such as reading or updating sandbox profiles, starting sessions, and connecting to session resources. Access is limited by the API key's permissions."
          tooltipContentClassName="max-w-80"
          tooltipLabel="Explain Mistle resources"
        >
          Mistle resources
        </FieldLabelWithTooltip>
      </FieldHeader>
      {input.children}
    </Field>
  );
}

function resolveReadOnlyMistleMcpAccessValue(input: {
  apiKeyId: string | null;
  enabled: boolean;
  selectedApiKey: ApiKey | null;
}): string {
  if (!input.enabled || input.apiKeyId === null) {
    return "None";
  }

  return input.selectedApiKey?.name ?? input.apiKeyId;
}

function CreateApiKeyDialogTrigger(input: {
  buttonText: string;
  createDialogIsOpen: boolean;
  disabled: boolean;
  onApiKeyChange: (value: string | null) => void;
  onCreateApiKey:
    | ((input: { name: string; permissions: readonly string[] }) => Promise<CreatedApiKey>)
    | undefined;
  onCreateDialogOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  return (
    <>
      <Button
        className="w-fit"
        disabled={input.disabled || input.onCreateApiKey === undefined}
        onClick={() => {
          input.onCreateDialogOpenChange(true);
        }}
        size="sm"
        type="button"
        variant="outline"
      >
        <PlusIcon aria-hidden />
        {input.buttonText}
      </Button>
      {input.onCreateApiKey === undefined ? null : (
        <CreateApiKeyDialog
          onApiKeyChange={input.onApiKeyChange}
          onCreateApiKey={input.onCreateApiKey}
          onOpenChange={input.onCreateDialogOpenChange}
          open={input.createDialogIsOpen}
        />
      )}
    </>
  );
}

const MistleResourcePermissionGroups = [
  {
    label: "Sandbox profiles",
    actions: [
      { label: "Read sandbox profiles", permission: "sandboxProfile:read" },
      { label: "Create sandbox profiles", permission: "sandboxProfile:create" },
      { label: "Update sandbox profiles", permission: "sandboxProfile:update" },
      { label: "Delete sandbox profiles", permission: "sandboxProfile:delete" },
    ],
  },
  {
    label: "Sessions",
    actions: [
      { label: "Create sessions", permission: "sandboxSession:create" },
      { label: "Read sessions", permission: "sandboxSession:read" },
      { label: "Resume sessions", permission: "sandboxSession:resume" },
      { label: "Connect to sessions", permission: "sandboxSession:connect" },
    ],
  },
  {
    label: "Triggers",
    actions: [
      { label: "Read triggers", permission: "triggerWebhook:read" },
      { label: "Create triggers", permission: "triggerWebhook:create" },
      { label: "Update triggers", permission: "triggerWebhook:update" },
      { label: "Delete triggers", permission: "triggerWebhook:delete" },
    ],
  },
] as const;

function MistleResourceAccessSummary(input: { apiKey: ApiKey }): React.JSX.Element {
  const [detailsAreOpen, setDetailsAreOpen] = useState(false);
  const resourceGroups = createAllowedMistleResourceGroups(input.apiKey.permissions);
  const resourceCount = resourceGroups.length;
  const resourceCountLabel =
    resourceCount === 1 ? "1 resource" : `${String(resourceCount)} resources`;

  return (
    <>
      <Button
        aria-label={`View allowed Mistle resources: ${resourceCountLabel}`}
        className="text-muted-foreground"
        onClick={() => {
          setDetailsAreOpen(true);
        }}
        size="sm"
        title="View allowed Mistle resources"
        type="button"
        variant="ghost"
      >
        <span>{resourceCountLabel}</span>
        <EyeIcon aria-hidden />
      </Button>
      <Dialog onOpenChange={setDetailsAreOpen} open={detailsAreOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Allowed Mistle resources</DialogTitle>
            <DialogDescription>
              This profile&apos;s agent can use {input.apiKey.name} for these Mistle resources.
              Access is limited by that API key&apos;s permissions.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            {resourceGroups.map((group) => (
              <MistleResourceAccessGroup group={group} key={group.label} />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

type AllowedMistleResourceGroup = {
  actions: readonly string[];
  label: string;
};

function createAllowedMistleResourceGroups(
  permissions: readonly string[],
): readonly AllowedMistleResourceGroup[] {
  return MistleResourcePermissionGroups.map((group) => ({
    label: group.label,
    actions: group.actions
      .filter((action) => permissions.includes(action.permission))
      .map((action) => action.label),
  })).filter((group) => group.actions.length > 0);
}

function MistleResourceAccessGroup(input: {
  group: AllowedMistleResourceGroup;
}): React.JSX.Element {
  return (
    <section className="overflow-hidden rounded-md border">
      <div className="bg-muted/50 border-b px-3 py-2 text-sm font-medium">{input.group.label}</div>
      <div className="grid gap-2 p-3 sm:grid-cols-2">
        {input.group.actions.map((action) => (
          <div
            className="text-muted-foreground flex min-w-0 items-center gap-2 text-sm"
            key={action}
          >
            <CheckIcon aria-hidden className="text-primary size-4 shrink-0" />
            {action}
          </div>
        ))}
      </div>
    </section>
  );
}

function CreateApiKeyDialog(input: {
  onApiKeyChange: (value: string | null) => void;
  onCreateApiKey: (input: {
    name: string;
    permissions: readonly string[];
  }) => Promise<CreatedApiKey>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [selectedPermissions, setSelectedPermissions] =
    useState<readonly string[]>(DefaultApiKeyPermissions);
  const [createErrorMessage, setCreateErrorMessage] = useState<string | null>(null);
  const [createdApiKey, setCreatedApiKey] = useState<CreatedApiKey | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const trimmedName = name.trim();
  const canCreate = trimmedName.length > 0 && selectedPermissions.length > 0 && !isCreating;

  function closeDialog(): void {
    if (isCreating) {
      return;
    }

    input.onOpenChange(false);
    setName("");
    setSelectedPermissions(DefaultApiKeyPermissions);
    setCreateErrorMessage(null);
    setCreatedApiKey(null);
  }

  async function submitApiKeyCreate(): Promise<void> {
    if (!canCreate) {
      return;
    }

    setIsCreating(true);
    setCreateErrorMessage(null);
    try {
      const created = await input.onCreateApiKey({
        name: trimmedName,
        permissions: selectedPermissions,
      });
      setCreatedApiKey(created);
      input.onApiKeyChange(created.apiKey.id);
    } catch (error) {
      setCreateErrorMessage(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not create API key.",
        }),
      );
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <Dialog
      isBusy={isCreating}
      isDismissible={!isCreating}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          input.onOpenChange(true);
          return;
        }

        closeDialog();
      }}
      open={input.open}
    >
      <DialogContent
        formProps={{
          onSubmit: (event) => {
            event.preventDefault();
            void submitApiKeyCreate();
          },
        }}
      >
        <DialogHeader>
          <DialogTitle>Create new API key</DialogTitle>
          <DialogDescription>
            Create an organization API key for programmatic access.
          </DialogDescription>
        </DialogHeader>

        {createdApiKey === null ? (
          <CreateApiKeyDialogForm
            createErrorMessage={createErrorMessage}
            isCreating={isCreating}
            name={name}
            onNameChange={setName}
            onPermissionChange={setSelectedPermissions}
            selectedPermissions={selectedPermissions}
          />
        ) : (
          <CreatedApiKeyTokenNotice createdApiKey={createdApiKey} />
        )}

        <DialogFooter>
          {createdApiKey === null ? (
            <>
              <Button disabled={isCreating} onClick={closeDialog} type="button" variant="outline">
                Cancel
              </Button>
              <Button disabled={!canCreate} type="submit">
                <PlusIcon aria-hidden />
                {isCreating ? "Creating..." : "Create API key"}
              </Button>
            </>
          ) : (
            <Button onClick={closeDialog} type="button">
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateApiKeyDialogForm(input: {
  createErrorMessage: string | null;
  isCreating: boolean;
  name: string;
  onNameChange: (name: string) => void;
  onPermissionChange: (permissions: readonly string[]) => void;
  selectedPermissions: readonly string[];
}): React.JSX.Element {
  const allPermissionValues = ApiKeyPermissionOptions.map((option) => option.value);
  const allPermissionsSelected = input.selectedPermissions.length === allPermissionValues.length;
  const somePermissionsSelected = !allPermissionsSelected && input.selectedPermissions.length > 0;
  const selectedPermissionCountLabel =
    input.selectedPermissions.length === 1
      ? "1 selected"
      : `${String(input.selectedPermissions.length)} selected`;

  function toggleAllPermissions(checked: boolean): void {
    input.onPermissionChange(checked ? allPermissionValues : []);
  }

  return (
    <div className="grid gap-4">
      {input.createErrorMessage === null ? null : (
        <Notice variant="alert">{input.createErrorMessage}</Notice>
      )}
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="sandbox-profile-create-api-key-name">Name</FieldLabel>
          <FieldContent>
            <Input
              autoComplete="off"
              disabled={input.isCreating}
              id="sandbox-profile-create-api-key-name"
              onChange={(event) => {
                input.onNameChange(event.currentTarget.value);
              }}
              placeholder="Sandbox agent key"
              value={input.name}
            />
          </FieldContent>
        </Field>
        <Field>
          <FieldLabel>Permissions</FieldLabel>
          <FieldContent>
            <div className="overflow-hidden rounded-md border bg-background">
              <div className="flex items-center justify-between gap-3 border-b px-3 py-2.5 text-sm">
                <label className="inline-flex min-w-0 items-center gap-3">
                  <Checkbox
                    checked={allPermissionsSelected}
                    disabled={input.isCreating}
                    indeterminate={somePermissionsSelected}
                    onCheckedChange={toggleAllPermissions}
                  />
                  <span className="font-medium">Select all</span>
                </label>
                <span className="text-muted-foreground shrink-0">
                  {selectedPermissionCountLabel}
                </span>
              </div>
              <div className="divide-y max-h-72 overflow-y-auto">
                {ApiKeyPermissionOptions.map((option) => (
                  <label className="flex gap-3 px-3 py-3 text-sm" key={option.value}>
                    <Checkbox
                      aria-label={option.label}
                      checked={input.selectedPermissions.includes(option.value)}
                      disabled={input.isCreating}
                      onCheckedChange={(checked) => {
                        input.onPermissionChange(
                          checked === true
                            ? [...input.selectedPermissions, option.value]
                            : input.selectedPermissions.filter(
                                (permission) => permission !== option.value,
                              ),
                        );
                      }}
                    />
                    <span className="flex min-w-0 items-center">
                      <span className="font-medium">{option.label}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </FieldContent>
        </Field>
      </FieldGroup>
    </div>
  );
}

function CreatedApiKeyTokenNotice(input: { createdApiKey: CreatedApiKey }): React.JSX.Element {
  return (
    <Notice variant="success">
      <div className="flex flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="text-base font-medium">API key created</div>
          <p>
            This key has been selected for Mistle resource access. Copy the token only if you also
            want to use {input.createdApiKey.apiKey.name} outside this profile editor; it will not
            be shown again.
          </p>
        </div>
        <CopyableValue
          copyAriaLabel="Copy API key token"
          label="Token"
          value={input.createdApiKey.token}
        />
      </div>
    </Notice>
  );
}

function AgentRuntimeOptionLabel(input: { runtimeId: string }): React.JSX.Element {
  const runtime = AgentRuntimeRegistry.getRuntimeOrThrow({ runtimeId: input.runtimeId });

  return (
    <span className="flex items-center gap-2">
      <IntegrationLogo alt="" className="size-4 rounded-sm" logoKey={runtime.logoKey} />
      {runtime.displayName}
    </span>
  );
}

function isAgentRuntimeId(runtimeId: string): runtimeId is AgentRuntimeId {
  return AgentRuntimeRegistry.getRuntime({ runtimeId }) !== undefined;
}

function SandboxProviderReadOnlyResourceFields(input: {
  horizontal: boolean;
  provider: SandboxProviderSummary | null;
  resources: SandboxProfileVersion["sandboxResources"];
}): React.JSX.Element | null {
  if (
    input.provider === null ||
    input.provider.resourceCapabilities === null ||
    input.resources === null
  ) {
    return null;
  }

  const capabilities = input.provider.resourceCapabilities;
  return (
    <>
      <ReadOnlyRuntimeField horizontal={input.horizontal} label="CPU">
        {formatCpuResourceValue(input.resources.vcpuCount)}
      </ReadOnlyRuntimeField>
      <ReadOnlyRuntimeField horizontal={input.horizontal} label="Memory (MB)">
        {formatMemoryResourceValue(input.resources.memoryMb)}
      </ReadOnlyRuntimeField>
      {capabilities.diskMb === undefined ? null : (
        <ReadOnlyRuntimeField horizontal={input.horizontal} label="Disk (MB)">
          {formatMemoryResourceValue(input.resources.diskMb ?? capabilities.diskMb.default)}
        </ReadOnlyRuntimeField>
      )}
    </>
  );
}

function ReadOnlyRuntimeField(input: {
  children: ReactNode;
  horizontal: boolean;
  label: string;
}): React.JSX.Element {
  return (
    <Field
      contentWidth={input.horizontal ? "fill" : "fit"}
      orientation={input.horizontal ? "horizontal" : "vertical"}
    >
      <FieldHeader>
        <FieldLabel>{input.label}</FieldLabel>
      </FieldHeader>
      <FieldContent>
        <span className="flex min-h-9 items-center text-sm font-medium">{input.children}</span>
      </FieldContent>
    </Field>
  );
}

function ProviderOptionLabel(input: { provider: SandboxProviderSummary }): React.JSX.Element {
  const logoKey = resolveSandboxProviderLogoKey(input.provider);
  return (
    <span className="flex items-center gap-2">
      {logoKey === undefined ? null : (
        <IntegrationLogo alt="" className="size-4 rounded-sm" logoKey={logoKey} />
      )}
      {input.provider.displayName}
    </span>
  );
}

function SandboxRuntimeOptionLabel(input: { option: SandboxRuntimeOption }): React.JSX.Element {
  if (input.option.kind === "managed") {
    return <MistleProviderLabel />;
  }

  return <ProviderOptionLabel provider={input.option.provider} />;
}

function MistleProviderLabel(): React.JSX.Element {
  return (
    <span className="flex items-center gap-2">
      <img
        alt=""
        aria-hidden="true"
        className="size-4 rounded-sm object-contain"
        src="/brand/logo.webp"
      />
      Mistle
    </span>
  );
}

function createProviderOptions(
  providers: readonly SandboxProviderSummary[],
): readonly SandboxRuntimeOption[] {
  const options: SandboxRuntimeOption[] = [];
  const managedProvider = resolveManagedSandboxProvider(providers);
  if (managedProvider !== undefined) {
    options.push({
      kind: "managed",
      provider: managedProvider,
      value: ManagedSandboxRuntimeOptionValue,
    });
  }

  for (const provider of providers) {
    if (provider.id === DockerSandboxProviderId && !provider.managed) {
      continue;
    }

    if (provider.supportsOrganizationConnection) {
      options.push({
        kind: "organization",
        provider,
        value: `${OrganizationSandboxRuntimeOptionPrefix}${provider.id}`,
      });
    }
  }

  return options;
}

function resolveSandboxProviderLogoKey(provider: SandboxProviderSummary): string | undefined {
  if (provider.id === DockerSandboxProviderId) {
    return DockerSandboxProviderId;
  }

  const definition = IntegrationRegistry.listDefinitions().find(
    (candidate) =>
      candidate.kind === "sandbox" && candidate.sandboxRuntime?.providerId === provider.id,
  );

  if (definition === undefined) {
    throw new Error(`Sandbox runtime definition for provider '${provider.id}' was not found.`);
  }

  return definition.logoKey;
}

function findSandboxProviderTarget(input: {
  availableTargets: readonly IntegrationTargetSummary[];
  providerId: string | null;
}): IntegrationTargetSummary | null {
  if (input.providerId === null) {
    return null;
  }

  return (
    input.availableTargets.find(
      (target) => resolveSandboxProviderIdFromTarget(target) === input.providerId,
    ) ?? null
  );
}

function createRuntimeConfigState(input: {
  providers: readonly SandboxProviderSummary[];
  version: SandboxProfileVersion;
}): RuntimeConfigState {
  return {
    agentRuntimeId: input.version.agentRuntimeId,
    credentialSource: resolveCredentialSource({
      connectionId: input.version.sandboxConnectionId,
    }),
    mistleMcpEnabled: input.version.mistleMcpEnabled,
    mistleMcpApiKeyId: input.version.mistleMcpApiKeyId,
    sandboxProvider: input.version.sandboxProvider,
    sandboxConnectionId: input.version.sandboxConnectionId,
    sandboxResources: input.version.sandboxResources,
  };
}

function resolveCredentialSource(input: { connectionId: string | null }): SandboxCredentialSource {
  if (input.connectionId !== null) {
    return "organization";
  }

  return "managed";
}

function findProvider(input: {
  providerId: string | null;
  providers: readonly SandboxProviderSummary[];
}): SandboxProviderSummary | null {
  if (input.providerId === null) {
    return null;
  }

  return input.providers.find((provider) => provider.id === input.providerId) ?? null;
}

function findSelectedProviderOption(input: {
  options: readonly SandboxRuntimeOption[];
  runtime: RuntimeConfigState;
}): SandboxRuntimeOption | null {
  if (input.runtime.sandboxProvider === null) {
    return null;
  }

  return (
    input.options.find(
      (option) =>
        option.provider.id === input.runtime.sandboxProvider &&
        option.kind === input.runtime.credentialSource,
    ) ?? null
  );
}

function createUnavailableRuntimeOption(input: {
  credentialSource: SandboxCredentialSource;
  provider: SandboxProviderSummary;
}): SandboxRuntimeOption {
  if (input.credentialSource === "managed") {
    return {
      kind: "managed",
      provider: input.provider,
      value: ManagedSandboxRuntimeOptionValue,
    };
  }

  return {
    kind: "organization",
    provider: input.provider,
    value: `${OrganizationSandboxRuntimeOptionPrefix}${input.provider.id}`,
  };
}

function resolveConnection(input: {
  connectionId: string | null;
  connections: readonly IntegrationConnectionSummary[];
}): IntegrationConnectionSummary | null {
  if (input.connectionId === null) {
    return null;
  }

  return input.connections.find((connection) => connection.id === input.connectionId) ?? null;
}

function resolveApiKey(input: {
  apiKeyId: string | null;
  apiKeys: readonly ApiKey[];
}): ApiKey | null {
  if (input.apiKeyId === null) {
    return null;
  }

  return input.apiKeys.find((apiKey) => apiKey.id === input.apiKeyId) ?? null;
}

function resolveConnectionsForProvider(input: {
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  providerId: string;
}): readonly IntegrationConnectionSummary[] {
  const targetKeys = new Set(
    input.availableTargets
      .filter((target) => resolveSandboxProviderIdFromTarget(target) === input.providerId)
      .map((target) => target.targetKey),
  );

  return input.availableConnections.filter((connection) => targetKeys.has(connection.targetKey));
}

function resolveSandboxProviderIdFromTarget(target: IntegrationTargetSummary): string | undefined {
  const definition = IntegrationRegistry.getDefinition({
    familyId: target.familyId,
    variantId: target.variantId,
  });

  if (definition?.kind !== "sandbox") {
    return undefined;
  }

  return definition.sandboxRuntime?.providerId;
}

function runtimeConfigStatesAreEqual(left: RuntimeConfigState, right: RuntimeConfigState): boolean {
  return (
    left.agentRuntimeId === right.agentRuntimeId &&
    left.credentialSource === right.credentialSource &&
    left.mistleMcpEnabled === right.mistleMcpEnabled &&
    left.mistleMcpApiKeyId === right.mistleMcpApiKeyId &&
    left.sandboxProvider === right.sandboxProvider &&
    left.sandboxConnectionId === right.sandboxConnectionId &&
    resourcesAreEqual(left.sandboxResources, right.sandboxResources)
  );
}

function resourcesAreEqual(
  left: SandboxProfileVersion["sandboxResources"],
  right: SandboxProfileVersion["sandboxResources"],
): boolean {
  if (left === null || right === null) {
    return left === right;
  }

  return (
    left.vcpuCount === right.vcpuCount &&
    left.memoryMb === right.memoryMb &&
    left.diskMb === right.diskMb
  );
}

function formatCpuResourceValue(value: number): string {
  return `${String(value)} vCPU`;
}

function formatMemoryResourceValue(value: number): string {
  return `${String(value)} MB`;
}
