import { createBrowserDefinitionsBundle } from "@mistle/integrations-definitions/browser";
import {
  Field,
  FieldContent,
  FieldHeader,
  FieldLabel,
  Input,
  Notice,
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

const Definitions = createBrowserDefinitionsBundle();
const IntegrationRegistry = Definitions.integrationRegistry;

const MissingProviderValue = "__missing_provider__";
const MissingConnectionValue = "__missing_connection__";
const DockerSandboxProviderId = "docker";

type SandboxCredentialSource = "managed" | "organization";

export type SandboxProfileRuntimeDraftChanges = {
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
  version: SandboxProfileVersion;
}): React.JSX.Element {
  const persistedRuntime = createRuntimeConfigState(input.version);
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
      setSaveErrorMessage("Select an API key connection before saving sandbox settings.");
      throw new Error("Sandbox runtime credentials are missing.");
    }

    return {
      sandboxProvider: provider,
      sandboxConnectionId: runtime.sandboxConnectionId,
      sandboxResources: runtime.sandboxResources,
    };
  }, []);

  const applySavedRuntimeConfig = useCallback(
    (runtimeConfig: SandboxProfileRuntimeDraftChanges): void => {
      const nextRuntime = {
        credentialSource: resolveCredentialSource(runtimeConfig.sandboxConnectionId),
        sandboxProvider: runtimeConfig.sandboxProvider,
        sandboxConnectionId: runtimeConfig.sandboxConnectionId,
        sandboxResources: runtimeConfig.sandboxResources,
      };
      setDraftRuntime(nextRuntime);
      setPersistedRuntimeState(nextRuntime);
      setSaveErrorMessage(null);
    },
    [],
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
    const nextRuntime = createRuntimeConfigState(input.version);
    setDraftRuntime(nextRuntime);
    setPersistedRuntimeState(nextRuntime);
    setSaveErrorMessage(null);
  }, [
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

  return (
    <div className="space-y-2">
      {saveErrorMessage === null ? null : <Notice variant="alert">{saveErrorMessage}</Notice>}
      <div className="flex max-w-5xl flex-col gap-2">
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Sandbox settings
        </h2>
        <div className="rounded-md border bg-background p-4">
          {fieldIsReadOnly ? (
            <SandboxProfileRuntimeReadOnlySummary
              connection={resolveConnection({
                connectionId: draftRuntime.sandboxConnectionId,
                connections: input.availableConnections,
              })}
              provider={selectedProvider}
              runtime={draftRuntime}
            />
          ) : (
            <div className="grid gap-5">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <Field>
                  <FieldHeader>
                    <FieldLabel htmlFor="sandbox-profile-runtime-provider">Provider</FieldLabel>
                  </FieldHeader>
                  <FieldContent>
                    <Select
                      onValueChange={updateProvider}
                      value={selectedProvider?.id ?? MissingProviderValue}
                    >
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

                <SandboxProviderCredentialSourceField
                  credentialSource={draftRuntime.credentialSource}
                  onCredentialSourceChange={updateCredentialSource}
                  provider={selectedProvider}
                />
              </div>
              <SandboxProviderConnectionField
                connectionId={draftRuntime.sandboxConnectionId}
                connections={matchingConnections}
                credentialSource={draftRuntime.credentialSource}
                onConnectionChange={updateConnection}
                providerTarget={findSandboxProviderTarget({
                  availableTargets: input.availableTargets,
                  providerId: selectedProvider?.id ?? null,
                })}
                provider={selectedProvider}
              />

              <SandboxProviderResourceFields
                disabled={fieldIsReadOnly}
                onResourceFieldChange={updateResourceField}
                provider={selectedProvider}
                resources={draftRuntime.sandboxResources}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SandboxProviderConnectionField(input: {
  connectionId: string | null;
  connections: readonly IntegrationConnectionSummary[];
  credentialSource: SandboxCredentialSource;
  onConnectionChange: (value: string | null) => void;
  provider: SandboxProviderSummary | null;
  providerTarget: IntegrationTargetSummary | null;
}): React.JSX.Element | null {
  if (input.provider === null || !input.provider.supportsOrganizationConnection) {
    return null;
  }

  const selectedConnection = resolveConnection({
    connectionId: input.connectionId,
    connections: input.connections,
  });
  const connectionValue = input.connectionId ?? MissingConnectionValue;
  const isManaged = input.credentialSource === "managed";

  return (
    <Field>
      <FieldHeader>
        <FieldLabel htmlFor="sandbox-profile-runtime-connection">Connection</FieldLabel>
      </FieldHeader>
      <FieldContent>
        <Select
          disabled={isManaged}
          onValueChange={input.onConnectionChange}
          value={connectionValue}
        >
          <SelectTrigger id="sandbox-profile-runtime-connection">
            <SelectValue placeholder="Select credentials">
              {isManaged ? (
                <span className="text-muted-foreground">Using Mistle&apos;s key</span>
              ) : selectedConnection === null ? (
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
        {isManaged || input.connections.length > 0 || input.providerTarget === null ? null : (
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
    <Field>
      <FieldHeader>
        <FieldLabel htmlFor="sandbox-profile-runtime-credential-source">API key</FieldLabel>
      </FieldHeader>
      <FieldContent>
        <Select onValueChange={input.onCredentialSourceChange} value={input.credentialSource}>
          <SelectTrigger id="sandbox-profile-runtime-credential-source">
            <SelectValue>{formatCredentialSource(input.credentialSource)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="managed">Use Mistle&apos;s key</SelectItem>
            <SelectItem value="organization">Use my API key</SelectItem>
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
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
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
    </div>
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
    <Field>
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
    <Field>
      <FieldHeader className="flex-row items-center justify-between gap-3">
        <FieldLabel>{input.label}</FieldLabel>
        <span className="text-sm font-medium">{input.formatValue(input.value)}</span>
      </FieldHeader>
      <FieldContent>
        <Slider
          aria-label={input.label}
          className="[&_[data-slot=slider-range]]:bg-primary/80 [&_[data-slot=slider-thumb]]:size-5 [&_[data-slot=slider-track]]:h-2 [&_[data-slot=slider-track]]:bg-border"
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
    <div className="grid gap-4 text-sm md:grid-cols-3">
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

function createRuntimeConfigState(version: SandboxProfileVersion): RuntimeConfigState {
  return {
    credentialSource: resolveCredentialSource(version.sandboxConnectionId),
    sandboxProvider: version.sandboxProvider,
    sandboxConnectionId: version.sandboxConnectionId,
    sandboxResources: version.sandboxResources,
  };
}

function resolveCredentialSource(connectionId: string | null): SandboxCredentialSource {
  return connectionId === null ? "managed" : "organization";
}

function formatCredentialSource(source: SandboxCredentialSource): string {
  return source === "managed" ? "Use Mistle's key" : "Use my API key";
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
