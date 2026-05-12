import { createBrowserDefinitionsBundle } from "@mistle/integrations-definitions/browser";
import {
  Field,
  FieldContent,
  FieldHeader,
  FieldLabel,
  Input,
  Notice,
  SectionBlock,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  TextLink,
} from "@mistle/ui";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link as RouterLink } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { resolveIntegrationLogoPath } from "../integrations/logo.js";
import type {
  SandboxProviderSummary,
  SandboxProfileVersion,
} from "../sandbox-profiles/sandbox-profiles-types.js";
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
} from "./sandbox-profile-binding-config-editor.js";
import { SandboxProfileSectionCard } from "./sandbox-profile-section-card.js";

const Definitions = createBrowserDefinitionsBundle();
const IntegrationRegistry = Definitions.integrationRegistry;

const MissingProviderValue = "__missing_provider__";
const MissingConnectionValue = "__missing_connection__";
const DockerSandboxProviderId = "docker";

type SandboxCredentialSource = "managed" | "organization";
type AgentRuntimeId = SandboxProfileVersion["agentRuntimeId"];

export type SandboxProfileRuntimeDraftChanges = {
  agentRuntimeId: AgentRuntimeId;
  sandboxProvider: string;
  sandboxConnectionId: string | null;
  sandboxResources: SandboxProfileVersion["sandboxResources"];
};

export type SandboxProfileRuntimeDraftState = {
  hasUnpersistedChanges: boolean;
  applyDraftSaveError?: (error: unknown) => void;
  applySavedRuntimeConfig?: (runtimeConfig: SandboxProfileRuntimeDraftChanges) => void;
  buildDraftChanges?: () => SandboxProfileRuntimeDraftChanges;
};

type RuntimeConfigState = {
  agentRuntimeId: AgentRuntimeId;
  credentialSource: SandboxCredentialSource;
  sandboxProvider: string | null;
  sandboxConnectionId: string | null;
  sandboxResources: SandboxProfileVersion["sandboxResources"];
};

type ResourceCapability = NonNullable<SandboxProviderSummary["resourceCapabilities"]>["vcpuCount"];

export function SandboxProfileRuntimeSection(input: {
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  disabled: boolean;
  isDraft: boolean;
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

    return {
      agentRuntimeId: runtime.agentRuntimeId,
      sandboxProvider: provider,
      sandboxConnectionId: runtime.sandboxConnectionId,
      sandboxResources: runtime.sandboxResources,
    };
  }, []);

  const applySavedRuntimeConfig = useCallback(
    (runtimeConfig: SandboxProfileRuntimeDraftChanges): void => {
      const provider = findProvider({
        providerId: runtimeConfig.sandboxProvider,
        providers: input.providers,
      });
      const nextRuntime = {
        credentialSource: resolveCredentialSource({
          connectionId: runtimeConfig.sandboxConnectionId,
          provider,
        }),
        agentRuntimeId: runtimeConfig.agentRuntimeId,
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
    input.version.sandboxConnectionId,
    input.version.sandboxProvider,
    input.version.sandboxResources,
    input.version.version,
  ]);

  useEffect(() => {
    input.onDraftStateChange?.({
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

    const provider = providerOptions.find((candidate) => candidate.id === choiceValue);
    if (provider === undefined) {
      return;
    }

    setDraftRuntime({
      agentRuntimeId: draftRuntimeRef.current.agentRuntimeId,
      credentialSource: resolveDefaultCredentialSourceForProvider(provider),
      sandboxProvider: provider.id,
      sandboxConnectionId: null,
      sandboxResources: createDefaultResources(provider),
    });
    setSaveErrorMessage(null);
  }

  function updateCredentialSource(value: string | null): void {
    if (value !== "managed" && value !== "organization") {
      return;
    }

    setDraftRuntime((currentRuntime) => ({
      ...currentRuntime,
      credentialSource: value,
      sandboxConnectionId: value === "managed" ? null : currentRuntime.sandboxConnectionId,
    }));
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

      return {
        ...currentRuntime,
        sandboxResources: {
          ...currentRuntime.sandboxResources,
          [field]: value,
        },
      };
    });
    setSaveErrorMessage(null);
  }

  function updateAgentRuntime(value: string | null): void {
    if (value !== "codex" && value !== "opencode") {
      return;
    }

    setDraftRuntime((currentRuntime) => ({
      ...currentRuntime,
      agentRuntimeId: value,
    }));
    setSaveErrorMessage(null);
  }

  const providerFieldLabel = input.sectionChrome === false ? "Sandbox Runtime" : "Provider";
  const agentRuntimeField = (
    <Field
      contentWidth={input.sectionChrome === false ? "fill" : "fit"}
      orientation={input.sectionChrome === false ? "horizontal" : "vertical"}
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
            <SelectItem value="codex">
              <AgentRuntimeOptionLabel runtimeId="codex" />
            </SelectItem>
            <SelectItem value="opencode">
              <AgentRuntimeOptionLabel runtimeId="opencode" />
            </SelectItem>
          </SelectContent>
        </Select>
      </FieldContent>
    </Field>
  );
  const agentRuntimeContent = fieldIsReadOnly ? (
    <SandboxProfileAgentRuntimeReadOnlySummary runtimeId={draftRuntime.agentRuntimeId} />
  ) : (
    agentRuntimeField
  );
  const providerField = (
    <Field
      contentWidth={input.sectionChrome === false ? "fill" : "fit"}
      orientation={input.sectionChrome === false ? "horizontal" : "vertical"}
    >
      <FieldHeader>
        <FieldLabel htmlFor="sandbox-profile-runtime-provider">{providerFieldLabel}</FieldLabel>
      </FieldHeader>
      <FieldContent>
        <Select onValueChange={updateProvider} value={selectedProvider?.id ?? MissingProviderValue}>
          <SelectTrigger id="sandbox-profile-runtime-provider">
            <SelectValue placeholder="Select provider">
              {selectedProvider === null ? (
                <span className="text-muted-foreground">Unknown provider</span>
              ) : (
                <ProviderOptionLabel provider={selectedProvider} />
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {selectedProvider === null ? (
              <SelectItem disabled value={MissingProviderValue}>
                Unknown provider
              </SelectItem>
            ) : null}
            {providerOptions.map((provider) => (
              <SelectItem key={provider.id} value={provider.id}>
                <ProviderOptionLabel provider={provider} />
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
        connectionId: draftRuntime.sandboxConnectionId,
        connections: input.availableConnections,
      })}
      provider={selectedProvider}
      runtime={draftRuntime}
    />
  ) : (
    <div className="grid gap-4">
      {input.sectionChrome === false ? (
        providerField
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {providerField}

          <SandboxProviderCredentialSourceField
            credentialSource={draftRuntime.credentialSource}
            onCredentialSourceChange={updateCredentialSource}
            provider={selectedProvider}
          />
        </div>
      )}
      {input.sectionChrome === false ? (
        <SandboxProviderCredentialSourceField
          credentialSource={draftRuntime.credentialSource}
          horizontal={true}
          onCredentialSourceChange={updateCredentialSource}
          provider={selectedProvider}
        />
      ) : null}
      <SandboxProviderConnectionField
        connectionId={draftRuntime.sandboxConnectionId}
        connections={matchingConnections}
        credentialSource={draftRuntime.credentialSource}
        onConnectionChange={updateConnection}
        providerTarget={findSandboxProviderTarget({
          availableTargets: input.availableTargets,
          providerId: selectedProvider?.id ?? null,
        })}
        horizontal={input.sectionChrome === false}
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

  if (input.sectionChrome === false) {
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
      <SectionBlock title="Sandbox Runtime">{runtimeFields}</SectionBlock>
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

function SandboxProviderCredentialSourceField(input: {
  credentialSource: SandboxCredentialSource;
  horizontal?: boolean | undefined;
  onCredentialSourceChange: (value: string | null) => void;
  provider: SandboxProviderSummary | null;
}): React.JSX.Element | null {
  if (
    input.provider === null ||
    !input.provider.managed ||
    !input.provider.supportsOrganizationConnection
  ) {
    return null;
  }

  return (
    <Field
      contentWidth={input.horizontal === true ? "fill" : "fit"}
      orientation={input.horizontal === true ? "horizontal" : "vertical"}
    >
      <FieldHeader>
        <FieldLabel htmlFor="sandbox-profile-runtime-credential-source">Credentials</FieldLabel>
      </FieldHeader>
      <FieldContent>
        <Select onValueChange={input.onCredentialSourceChange} value={input.credentialSource}>
          <SelectTrigger id="sandbox-profile-runtime-credential-source">
            <SelectValue>{formatCredentialSource(input.credentialSource)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="managed">Managed by Mistle</SelectItem>
            <SelectItem value="organization">Use workspace API key</SelectItem>
          </SelectContent>
        </Select>
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
        capability={capabilities.memoryMb}
        disabled={input.disabled}
        formatValue={formatMemoryResourceValue}
        id="sandbox-profile-runtime-memory"
        label="Memory (MB)"
        onChange={(value) => {
          input.onResourceFieldChange("memoryMb", value);
        }}
        value={input.resources.memoryMb}
      />
      {capabilities.storageMb === undefined ? null : (
        <ResourceNumberField
          capability={capabilities.storageMb}
          disabled={input.disabled}
          id="sandbox-profile-runtime-storage"
          label="Storage (MB)"
          onChange={(value) => {
            input.onResourceFieldChange("storageMb", value);
          }}
          value={input.resources.storageMb ?? capabilities.storageMb.default}
        />
      )}
    </>
  );
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
  provider: SandboxProviderSummary | null;
  runtime: RuntimeConfigState;
}): React.JSX.Element {
  const shouldShowCredentials = input.runtime.sandboxConnectionId !== null;
  return (
    <div className="grid gap-4 text-sm md:grid-cols-4">
      <ReadOnlyRuntimeItem label="Provider">
        {input.provider === null ? (
          input.runtime.sandboxProvider
        ) : (
          <ProviderOptionLabel provider={input.provider} />
        )}
      </ReadOnlyRuntimeItem>
      {shouldShowCredentials ? (
        <ReadOnlyRuntimeItem label="Connection">
          {input.connection?.displayName ?? input.runtime.sandboxConnectionId}
        </ReadOnlyRuntimeItem>
      ) : null}
      <ReadOnlyRuntimeItem label="Resources">
        {formatResources(input.runtime.sandboxResources)}
      </ReadOnlyRuntimeItem>
    </div>
  );
}

function SandboxProfileAgentRuntimeReadOnlySummary(input: {
  runtimeId: AgentRuntimeId;
}): React.JSX.Element {
  return (
    <div className="text-sm">
      <ReadOnlyRuntimeItem label="Agent">
        <AgentRuntimeOptionLabel runtimeId={input.runtimeId} />
      </ReadOnlyRuntimeItem>
    </div>
  );
}

function AgentRuntimeOptionLabel(input: { runtimeId: AgentRuntimeId }): React.JSX.Element {
  const logoKey = input.runtimeId === "opencode" ? "opencode" : "openai";
  const label = input.runtimeId === "opencode" ? "OpenCode" : "Codex";

  return (
    <span className="flex items-center gap-2">
      <img alt="" className="size-4 rounded-sm" src={resolveIntegrationLogoPath({ logoKey })} />
      {label}
    </span>
  );
}

function ReadOnlyRuntimeItem(input: { children: ReactNode; label: string }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {input.label}
      </span>
      <span className="font-medium">{input.children}</span>
    </div>
  );
}

function ProviderOptionLabel(input: { provider: SandboxProviderSummary }): React.JSX.Element {
  const logoKey = resolveSandboxProviderLogoKey(input.provider);
  return (
    <span className="flex items-center gap-2">
      {logoKey === undefined ? null : (
        <img alt="" className="size-4 rounded-sm" src={resolveIntegrationLogoPath({ logoKey })} />
      )}
      {input.provider.displayName}
    </span>
  );
}

function createProviderOptions(
  providers: readonly SandboxProviderSummary[],
): readonly SandboxProviderSummary[] {
  return providers.filter((provider) => {
    if (provider.id === DockerSandboxProviderId && !provider.managed) {
      return false;
    }

    return provider.managed || provider.supportsOrganizationConnection;
  });
}

function resolveDefaultCredentialSourceForProvider(
  provider: SandboxProviderSummary,
): SandboxCredentialSource {
  if (provider.managed) {
    return "managed";
  }

  if (provider.supportsOrganizationConnection) {
    return "organization";
  }

  return "managed";
}

function resolveSandboxProviderLogoKey(provider: SandboxProviderSummary): string | undefined {
  if (provider.id === DockerSandboxProviderId) {
    return undefined;
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
  const provider = findProvider({
    providerId: input.version.sandboxProvider,
    providers: input.providers,
  });

  return {
    agentRuntimeId: input.version.agentRuntimeId,
    credentialSource: resolveCredentialSource({
      connectionId: input.version.sandboxConnectionId,
      provider,
    }),
    sandboxProvider: input.version.sandboxProvider,
    sandboxConnectionId: input.version.sandboxConnectionId,
    sandboxResources: input.version.sandboxResources,
  };
}

function resolveCredentialSource(input: {
  connectionId: string | null;
  provider: SandboxProviderSummary | null;
}): SandboxCredentialSource {
  if (input.connectionId !== null) {
    return "organization";
  }

  if (
    input.provider !== null &&
    !input.provider.managed &&
    input.provider.supportsOrganizationConnection
  ) {
    return "organization";
  }

  return "managed";
}

function formatCredentialSource(source: SandboxCredentialSource): string {
  return source === "managed" ? "Managed by Mistle" : "Use workspace API key";
}

function createDefaultResources(
  provider: SandboxProviderSummary,
): SandboxProfileVersion["sandboxResources"] {
  const capabilities = provider.resourceCapabilities;
  if (capabilities === null) {
    return null;
  }

  return {
    vcpuCount: capabilities.vcpuCount.default,
    memoryMb: capabilities.memoryMb.default,
    ...(capabilities.storageMb === undefined ? {} : { storageMb: capabilities.storageMb.default }),
  };
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

function resolveConnection(input: {
  connectionId: string | null;
  connections: readonly IntegrationConnectionSummary[];
}): IntegrationConnectionSummary | null {
  if (input.connectionId === null) {
    return null;
  }

  return input.connections.find((connection) => connection.id === input.connectionId) ?? null;
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
    left.storageMb === right.storageMb
  );
}

function formatCpuResourceValue(value: number): string {
  return `${String(value)} vCPU`;
}

function formatMemoryResourceValue(value: number): string {
  return `${String(value)} MB`;
}

function formatResources(resources: SandboxProfileVersion["sandboxResources"]): string {
  if (resources === null) {
    return "Provider managed";
  }

  return [
    `${String(resources.vcpuCount)} vCPU`,
    `${String(resources.memoryMb)} MB memory`,
    ...(resources.storageMb === undefined ? [] : [`${String(resources.storageMb)} MB storage`]),
  ].join(", ");
}
