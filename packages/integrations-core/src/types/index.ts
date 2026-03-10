import type { z } from "zod";

export type IntegrationKind = "agent" | "git" | "connector";

export const IntegrationKinds: {
  AGENT: IntegrationKind;
  GIT: IntegrationKind;
  CONNECTOR: IntegrationKind;
} = {
  AGENT: "agent",
  GIT: "git",
  CONNECTOR: "connector",
};

export type IntegrationSupportedAuthScheme = "oauth" | "api-key";

export const IntegrationSupportedAuthSchemes: {
  OAUTH: IntegrationSupportedAuthScheme;
  API_KEY: IntegrationSupportedAuthScheme;
} = {
  OAUTH: "oauth",
  API_KEY: "api-key",
};

export type IntegrationTarget = {
  familyId: string;
  variantId: string;
  enabled: boolean;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
};

export type IntegrationConnectionStatus = "active" | "error" | "revoked";

export const IntegrationConnectionStatuses: {
  ACTIVE: IntegrationConnectionStatus;
  ERROR: IntegrationConnectionStatus;
  REVOKED: IntegrationConnectionStatus;
} = {
  ACTIVE: "active",
  ERROR: "error",
  REVOKED: "revoked",
};

export type IntegrationConnection = {
  id: string;
  status: IntegrationConnectionStatus;
  externalSubjectId?: string;
  config: Record<string, unknown>;
};

export type IntegrationBinding = {
  id: string;
  kind: IntegrationKind;
  connectionId: string;
  config: Record<string, unknown>;
};

export type IntegrationResourceSelectionMode = "single" | "multi";

export const IntegrationResourceSelectionModes: {
  SINGLE: IntegrationResourceSelectionMode;
  MULTI: IntegrationResourceSelectionMode;
} = {
  SINGLE: "single",
  MULTI: "multi",
};

export type IntegrationResourceSyncState = "never-synced" | "syncing" | "ready" | "error";

export const IntegrationResourceSyncStates: {
  NEVER_SYNCED: IntegrationResourceSyncState;
  SYNCING: IntegrationResourceSyncState;
  READY: IntegrationResourceSyncState;
  ERROR: IntegrationResourceSyncState;
} = {
  NEVER_SYNCED: "never-synced",
  SYNCING: "syncing",
  READY: "ready",
  ERROR: "error",
};

export type IntegrationFormConnectionResourceSummary = {
  kind: string;
  selectionMode: IntegrationResourceSelectionMode;
  count: number;
  syncState: IntegrationResourceSyncState;
  lastSyncedAt?: string | undefined;
};

export type IntegrationResourceCredentialRef = {
  secretType: string;
  purpose?: string;
  resolverKey?: string;
};

export type IntegrationResourceCredentialSelectorInput = {
  connection: IntegrationConnection;
  kind: string;
};

export type IntegrationResourceCredentialSelector = (
  input: IntegrationResourceCredentialSelectorInput,
) => IntegrationResourceCredentialRef | undefined;

export type IntegrationResourceDefinition = {
  kind: string;
  selectionMode: IntegrationResourceSelectionMode;
  bindingField: string;
  displayNameSingular: string;
  displayNamePlural: string;
  description?: string;
  credential?: IntegrationResourceCredentialRef | IntegrationResourceCredentialSelector;
};

export type DiscoveredIntegrationResource = {
  externalId?: string;
  handle: string;
  displayName: string;
  metadata: Record<string, unknown>;
};

export type ListConnectionResourcesInput<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TConnectionConfig = Record<string, unknown>,
> = {
  organizationId: string;
  targetKey: string;
  target: IntegrationResolvedTarget<TTargetConfig, TTargetSecrets>;
  connection: IntegrationConnection & {
    config: TConnectionConfig;
  };
  kind: string;
  credential?: IntegrationCredentialResolverResult;
};

export type ListConnectionResourcesResult = {
  resources: ReadonlyArray<DiscoveredIntegrationResource>;
};

export type IntegrationResourceSyncTrigger = {
  eventType: string;
  resourceKinds: ReadonlyArray<string>;
};

export type IntegrationConfigSchema<TOutput> = z.ZodType<TOutput>;

type ParsedSchemaOutput<TSchema extends IntegrationConfigSchema<unknown>> =
  TSchema extends IntegrationConfigSchema<infer TOutput> ? TOutput : never;

type ParsedOptionalSchemaOutput<TSchema extends IntegrationConfigSchema<unknown> | undefined> =
  TSchema extends IntegrationConfigSchema<infer TOutput> ? TOutput : Record<string, unknown>;

export type BindingWriteValidationContext<
  TTargetConfig = Record<string, unknown>,
  TBindingConfig = Record<string, unknown>,
  TConnectionConfig = Record<string, unknown>,
> = {
  targetKey: string;
  bindingIdOrDraftIndex: string;
  target: {
    familyId: string;
    variantId: string;
    config: TTargetConfig;
  };
  connection: {
    id: string;
    config: TConnectionConfig;
  };
  binding: {
    kind: string;
    config: TBindingConfig;
  };
};

export type BindingWriteValidationIssue = {
  code: `${string}.${string}`;
  field: string;
  safeMessage: string;
};

export type BindingWriteValidationResult =
  | { ok: true }
  | {
      ok: false;
      issues: readonly BindingWriteValidationIssue[];
    };

export type IntegrationFormJsonSchema = Record<string, unknown>;
export type IntegrationFormUiSchema = Record<string, unknown>;

export type ResolvedIntegrationForm = {
  schema?: IntegrationFormJsonSchema;
  uiSchema?: IntegrationFormUiSchema;
};

export type IntegrationFormContext<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TBindingConfig = Record<string, unknown>,
  TConnectionConfig = Record<string, unknown>,
> = {
  familyId: string;
  variantId: string;
  kind: IntegrationKind;
  target?: {
    rawConfig: Record<string, unknown>;
    config: TTargetConfig;
    rawSecrets?: Record<string, string>;
    secrets?: TTargetSecrets;
  };
  connection?: {
    id?: string;
    rawConfig: Record<string, unknown>;
    config: TConnectionConfig;
    resources?: readonly IntegrationFormConnectionResourceSummary[];
  };
  currentValue?: Record<string, unknown>;
  parsedCurrentValue?: TBindingConfig;
};

type IntegrationFormResolver<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TBindingConfig = Record<string, unknown>,
  TConnectionConfig = Record<string, unknown>,
> = {
  bivarianceHack(
    input: IntegrationFormContext<TTargetConfig, TTargetSecrets, TBindingConfig, TConnectionConfig>,
  ): ResolvedIntegrationForm;
}["bivarianceHack"];

export type IntegrationFormDefinition<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TBindingConfig = Record<string, unknown>,
  TConnectionConfig = Record<string, unknown>,
> =
  | ResolvedIntegrationForm
  | IntegrationFormResolver<TTargetConfig, TTargetSecrets, TBindingConfig, TConnectionConfig>;

export type IntegrationResolvedTarget<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
> = Omit<IntegrationTarget, "config" | "secrets"> & {
  config: TTargetConfig;
  secrets: TTargetSecrets;
};

type MaybePromise<TValue> = TValue | Promise<TValue>;

export type EgressUrlRef = {
  kind: "egress_url";
  routeId: string;
};

export function egressUrlRef(routeId: string): EgressUrlRef {
  return {
    kind: "egress_url",
    routeId,
  };
}

export type IntegrationMcpValue = string | EgressUrlRef;

export type IntegrationMcpTransport = "streamable-http" | "stdio";

export const IntegrationMcpTransports: {
  STREAMABLE_HTTP: IntegrationMcpTransport;
  STDIO: IntegrationMcpTransport;
} = {
  STREAMABLE_HTTP: "streamable-http",
  STDIO: "stdio",
};

export type IntegrationMcpServer = {
  serverId: string;
  serverName: string;
  transport: IntegrationMcpTransport;
  description?: string;
  url?: IntegrationMcpValue;
  command?: string;
  args?: ReadonlyArray<string>;
  env?: Readonly<Record<string, IntegrationMcpValue>>;
  httpHeaders?: Readonly<Record<string, IntegrationMcpValue>>;
};

export type IntegrationBindingMcpServerSource = {
  bindingId: string;
  connectionId: string;
  targetKey: string;
  familyId: string;
  variantId: string;
};

export type IntegrationBindingMcpServer = {
  source: IntegrationBindingMcpServerSource;
  server: IntegrationMcpServer;
};

export type ResolvedIntegrationMcpServer = {
  source: IntegrationBindingMcpServerSource;
  server: Omit<IntegrationMcpServer, "url" | "env" | "httpHeaders"> & {
    url?: string;
    env?: Readonly<Record<string, string>>;
    httpHeaders?: Readonly<Record<string, string>>;
  };
};

export type CompileBindingRefs = {
  egressUrl: EgressUrlRef;
  artifactBinPath(name: string): string;
};

export type CompileBindingInput<
  TTargetConfig = Record<string, unknown>,
  TBindingConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
> = {
  organizationId: string;
  sandboxProfileId: string;
  version: number;
  targetKey: string;
  target: IntegrationResolvedTarget<TTargetConfig, TTargetSecrets>;
  connection: IntegrationConnection;
  binding: Pick<IntegrationBinding, "id" | "kind"> & { config: TBindingConfig };
  refs: CompileBindingRefs;
  runtimeContext: {
    sandboxdEgressBaseUrl: string;
  };
};

export type IntegrationCredentialResolverInput = {
  organizationId: string;
  targetKey: string;
  connectionId: string;
  target: IntegrationResolvedTarget;
  connection: IntegrationConnection;
  secretType: string;
  purpose?: string;
};

export type IntegrationCredentialResolverResult = {
  value: string;
  expiresAt?: string;
};

export type IntegrationCredentialResolver = {
  resolve(
    input: IntegrationCredentialResolverInput,
  ): MaybePromise<IntegrationCredentialResolverResult>;
};

export type IntegrationCredentialResolvers = {
  default?: IntegrationCredentialResolver;
  custom?: Record<string, IntegrationCredentialResolver>;
};

export type IntegrationOAuthCredentialMaterial = {
  purpose: string;
  secretType: string;
  plaintext: string;
  metadata?: Record<string, unknown>;
};

export type IntegrationOAuthStartInput<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
> = {
  organizationId: string;
  targetKey: string;
  target: IntegrationResolvedTarget<TTargetConfig, TTargetSecrets>;
  state: string;
};

export type IntegrationOAuthStartResult = {
  authorizationUrl: string;
};

export type IntegrationOAuthCompleteInput<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
> = {
  organizationId: string;
  targetKey: string;
  target: IntegrationResolvedTarget<TTargetConfig, TTargetSecrets>;
  query: URLSearchParams;
};

export type IntegrationOAuthCompleteResult = {
  externalSubjectId?: string;
  connectionConfig: Record<string, unknown>;
  credentialMaterials: ReadonlyArray<IntegrationOAuthCredentialMaterial>;
};

export type IntegrationOAuthHandler<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
> = {
  start(
    input: IntegrationOAuthStartInput<TTargetConfig, TTargetSecrets>,
  ): MaybePromise<IntegrationOAuthStartResult>;
  complete(
    input: IntegrationOAuthCompleteInput<TTargetConfig, TTargetSecrets>,
  ): MaybePromise<IntegrationOAuthCompleteResult>;
};

export type IntegrationWebhookHeaders = Readonly<Record<string, string>>;

export type IntegrationWebhookVerifyFailureCode =
  | "invalid-signature"
  | "invalid-headers"
  | "invalid-body";

export const IntegrationWebhookVerifyFailureCodes: {
  INVALID_SIGNATURE: IntegrationWebhookVerifyFailureCode;
  INVALID_HEADERS: IntegrationWebhookVerifyFailureCode;
  INVALID_BODY: IntegrationWebhookVerifyFailureCode;
} = {
  INVALID_SIGNATURE: "invalid-signature",
  INVALID_HEADERS: "invalid-headers",
  INVALID_BODY: "invalid-body",
};

export type IntegrationWebhookVerifyInput<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TConnectionSecrets = Record<string, string>,
> = {
  targetKey: string;
  target: IntegrationResolvedTarget<TTargetConfig, TTargetSecrets>;
  event: IntegrationWebhookEvent;
  connection: IntegrationConnection;
  connectionSecrets: TConnectionSecrets;
  headers: IntegrationWebhookHeaders;
  rawBody: Uint8Array;
};

export type IntegrationWebhookVerifyResult =
  | { ok: true }
  | {
      ok: false;
      code: IntegrationWebhookVerifyFailureCode;
      message: string;
    };

export type IntegrationWebhookResolveConnectionFailureCode =
  | "connection-not-found"
  | "connection-ambiguous"
  | "invalid-connection";

export const IntegrationWebhookResolveConnectionFailureCodes: {
  CONNECTION_NOT_FOUND: IntegrationWebhookResolveConnectionFailureCode;
  CONNECTION_AMBIGUOUS: IntegrationWebhookResolveConnectionFailureCode;
  INVALID_CONNECTION: IntegrationWebhookResolveConnectionFailureCode;
} = {
  CONNECTION_NOT_FOUND: "connection-not-found",
  CONNECTION_AMBIGUOUS: "connection-ambiguous",
  INVALID_CONNECTION: "invalid-connection",
};

export type IntegrationWebhookResolveConnectionInput<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
> = {
  targetKey: string;
  target: IntegrationResolvedTarget<TTargetConfig, TTargetSecrets>;
  event: IntegrationWebhookEvent;
  candidates: ReadonlyArray<IntegrationConnection>;
};

export type IntegrationWebhookResolveConnectionResult =
  | { ok: true; connectionId: string }
  | {
      ok: false;
      code: IntegrationWebhookResolveConnectionFailureCode;
      message: string;
    };

export type IntegrationWebhookResolvedEvent = {
  event: IntegrationWebhookEvent;
  connectionId: string;
};

export type IntegrationWebhookParseInput<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
> = {
  targetKey: string;
  target: IntegrationResolvedTarget<TTargetConfig, TTargetSecrets>;
  headers: IntegrationWebhookHeaders;
  rawBody: Uint8Array;
};

export type IntegrationWebhookEvent = {
  externalEventId: string;
  externalDeliveryId?: string;
  providerEventType: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt?: string;
};

export type IntegrationWebhookHandler<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TConnectionSecrets = Record<string, string>,
> = {
  resolveConnection(
    input: IntegrationWebhookResolveConnectionInput<TTargetConfig, TTargetSecrets>,
  ): MaybePromise<IntegrationWebhookResolveConnectionResult>;
  verify(
    input: IntegrationWebhookVerifyInput<TTargetConfig, TTargetSecrets, TConnectionSecrets>,
  ): MaybePromise<IntegrationWebhookVerifyResult>;
  parse(
    input: IntegrationWebhookParseInput<TTargetConfig, TTargetSecrets>,
  ): MaybePromise<IntegrationWebhookEvent>;
};

export type EgressCredentialResolverRef = {
  connectionId: string;
  secretType: string;
  purpose?: string;
  resolverKey?: string;
};

export type EgressCredentialRoute = {
  routeId: string;
  bindingId: string;
  match: {
    hosts: ReadonlyArray<string>;
    pathPrefixes?: ReadonlyArray<string>;
    methods?: ReadonlyArray<string>;
  };
  upstream: {
    baseUrl: string;
  };
  authInjection: {
    type: "bearer" | "basic" | "header" | "query";
    target: string;
    username?: string;
  };
  credentialResolver: EgressCredentialResolverRef;
};

export type RuntimeArtifactCommand = {
  args: ReadonlyArray<string>;
  env?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
};

export type RuntimeArtifactGithubReleaseAsset = {
  fileName: string;
  binaryPath: string;
  format?: "tar.gz" | "binary";
};

export type RuntimeArtifactGithubReleaseInstallInput = {
  repository: string;
  assets: {
    x86_64: RuntimeArtifactGithubReleaseAsset;
    aarch64: RuntimeArtifactGithubReleaseAsset;
  };
  installPath: string;
  timeoutMs?: number;
};

export type RuntimeArtifactRefs = {
  command: {
    exec(input: RuntimeArtifactCommand): RuntimeArtifactCommand;
  };
  artifactBinPath(name: string): string;
  mise: {
    install(input: {
      tools: ReadonlyArray<string>;
      force?: boolean;
      timeoutMs?: number;
    }): RuntimeArtifactCommand;
  };
  githubReleases: {
    installLatestBinary(input: RuntimeArtifactGithubReleaseInstallInput): RuntimeArtifactCommand;
  };
  compileContext: {
    organizationId: string;
    sandboxProfileId: string;
    version: number;
    targetKey: string;
    bindingId: string;
  };
};

export type RuntimeArtifactLifecycleBuilder = (input: {
  refs: RuntimeArtifactRefs;
}) => ReadonlyArray<RuntimeArtifactCommand>;

type RuntimeArtifactLifecycle<THook> = {
  install: THook;
  update?: THook;
  remove: THook;
};

export type RuntimeArtifactSpec = {
  artifactKey: string;
  name: string;
  description?: string;
  lifecycle: RuntimeArtifactLifecycle<
    ReadonlyArray<RuntimeArtifactCommand> | RuntimeArtifactLifecycleBuilder
  >;
};

export type CompiledRuntimeArtifactSpec = {
  artifactKey: string;
  name: string;
  description?: string;
  lifecycle: RuntimeArtifactLifecycle<ReadonlyArray<RuntimeArtifactCommand>>;
};

export type CompiledRuntimeArtifactRemovalSpec = {
  artifactKey: string;
  commands: ReadonlyArray<RuntimeArtifactCommand>;
};

type RuntimeClientSetupBase<TEnvValue> = {
  env: Record<string, TEnvValue>;
  files: ReadonlyArray<{ fileId: string; path: string; mode: number; content: string }>;
  launchArgs?: ReadonlyArray<string>;
};

export type CompiledRuntimeClientSetup = RuntimeClientSetupBase<string | EgressUrlRef>;

export type RuntimeClientSetup = RuntimeClientSetupBase<string>;

export type RuntimeClientProcessReadiness =
  | {
      type: "none";
    }
  | {
      type: "tcp";
      host: string;
      port: number;
      timeoutMs: number;
    }
  | {
      type: "ws";
      url: string;
      timeoutMs: number;
    }
  | {
      type: "http";
      url: string;
      expectedStatus: number;
      timeoutMs: number;
    };

export type RuntimeClientProcessStopPolicy = {
  signal: "sigterm" | "sigkill";
  timeoutMs: number;
  gracePeriodMs?: number;
};

export type RuntimeClientProcessSpec = {
  processKey: string;
  command: RuntimeArtifactCommand;
  readiness: RuntimeClientProcessReadiness;
  stop: RuntimeClientProcessStopPolicy;
};

export type RuntimeClientEndpointTransport = {
  type: "ws";
  url: string;
};

export type RuntimeClientEndpointSpec = {
  endpointKey: string;
  transport: RuntimeClientEndpointTransport;
  processKey?: string;
  connectionMode: "dedicated" | "shared";
};

type RuntimeClientBase<TEnvValue> = {
  clientId: string;
  setup: RuntimeClientSetupBase<TEnvValue>;
  processes: ReadonlyArray<RuntimeClientProcessSpec>;
  endpoints: ReadonlyArray<RuntimeClientEndpointSpec>;
};

export type CompiledRuntimeClient = RuntimeClientBase<string | EgressUrlRef>;

export type RuntimeClient = RuntimeClientBase<string>;

export type CompileBindingEgressRoute = Omit<EgressCredentialRoute, "routeId" | "bindingId">;

export type CompileBindingAgentRuntime = {
  runtimeKey: string;
  clientId: string;
  endpointKey: string;
};

export type CompiledAgentRuntime = CompileBindingAgentRuntime & {
  bindingId: string;
};

type GitCloneWorkspaceSourceBase<TRouteId> = {
  sourceKind: "git-clone";
  resourceKind: "repository";
  path: string;
  originUrl: string;
  routeId: TRouteId;
};

export type CompileBindingWorkspaceSource = GitCloneWorkspaceSourceBase<EgressUrlRef>;

export type CompiledWorkspaceSource = GitCloneWorkspaceSourceBase<string>;

export type CompileBindingResult = {
  egressRoutes: ReadonlyArray<CompileBindingEgressRoute>;
  artifacts: ReadonlyArray<RuntimeArtifactSpec>;
  runtimeClients: ReadonlyArray<CompiledRuntimeClient>;
  workspaceSources?: ReadonlyArray<CompileBindingWorkspaceSource>;
  agentRuntimes?: ReadonlyArray<CompileBindingAgentRuntime>;
};

export type CompiledBindingResult = {
  egressRoutes: ReadonlyArray<EgressCredentialRoute>;
  artifacts: ReadonlyArray<CompiledRuntimeArtifactSpec>;
  runtimeClients: ReadonlyArray<CompiledRuntimeClient>;
  workspaceSources: ReadonlyArray<CompiledWorkspaceSource>;
  agentRuntimes: ReadonlyArray<CompiledAgentRuntime>;
};

export type IntegrationMcpDefinitionValue =
  | IntegrationMcpServer
  | ReadonlyArray<IntegrationMcpServer>;

export type ResolveIntegrationMcpFn<
  TTargetConfig = Record<string, unknown>,
  TBindingConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
> = {
  bivarianceHack(
    input: CompileBindingInput<TTargetConfig, TBindingConfig, TTargetSecrets>,
  ): IntegrationMcpDefinitionValue;
}["bivarianceHack"];

export type IntegrationMcpDefinition<
  TTargetConfig = Record<string, unknown>,
  TBindingConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
> =
  | IntegrationMcpDefinitionValue
  | ResolveIntegrationMcpFn<TTargetConfig, TBindingConfig, TTargetSecrets>;

export type IntegrationMcpConfigFormat = "toml" | "json";

export const IntegrationMcpConfigFormats: {
  TOML: IntegrationMcpConfigFormat;
  JSON: IntegrationMcpConfigFormat;
} = {
  TOML: "toml",
  JSON: "json",
};

export type IntegrationMcpConfig = {
  clientId: string;
  fileId: string;
  format: IntegrationMcpConfigFormat;
  path: ReadonlyArray<string>;
};

export type IntegrationDefinition<
  TTargetConfigSchema extends IntegrationConfigSchema<unknown> = IntegrationConfigSchema<
    Record<string, unknown>
  >,
  TTargetSecretsSchema extends IntegrationConfigSchema<unknown> = IntegrationConfigSchema<
    Record<string, string>
  >,
  TBindingConfigSchema extends IntegrationConfigSchema<unknown> = IntegrationConfigSchema<
    Record<string, unknown>
  >,
  TConnectionConfigSchema extends IntegrationConfigSchema<Record<string, unknown>> | undefined =
    undefined,
> = {
  familyId: string;
  variantId: string;
  kind: IntegrationKind;
  displayName: string;
  description?: string;
  logoKey: string;
  targetConfigSchema: TTargetConfigSchema;
  targetConfigForm?: IntegrationFormDefinition<
    ParsedSchemaOutput<TTargetConfigSchema>,
    ParsedSchemaOutput<TTargetSecretsSchema>,
    ParsedSchemaOutput<TBindingConfigSchema>,
    ParsedOptionalSchemaOutput<TConnectionConfigSchema>
  >;
  targetSecretSchema: TTargetSecretsSchema;
  targetSecretForm?: IntegrationFormDefinition<
    ParsedSchemaOutput<TTargetConfigSchema>,
    ParsedSchemaOutput<TTargetSecretsSchema>,
    ParsedSchemaOutput<TBindingConfigSchema>,
    ParsedOptionalSchemaOutput<TConnectionConfigSchema>
  >;
  bindingConfigSchema: TBindingConfigSchema;
  bindingConfigForm?: IntegrationFormDefinition<
    ParsedSchemaOutput<TTargetConfigSchema>,
    ParsedSchemaOutput<TTargetSecretsSchema>,
    ParsedSchemaOutput<TBindingConfigSchema>,
    ParsedOptionalSchemaOutput<TConnectionConfigSchema>
  >;
  connectionConfigSchema?: TConnectionConfigSchema;
  connectionConfigForm?: IntegrationFormDefinition<
    ParsedSchemaOutput<TTargetConfigSchema>,
    ParsedSchemaOutput<TTargetSecretsSchema>,
    ParsedSchemaOutput<TBindingConfigSchema>,
    ParsedOptionalSchemaOutput<TConnectionConfigSchema>
  >;
  supportedAuthSchemes: ReadonlyArray<IntegrationSupportedAuthScheme>;
  credentialResolvers?: IntegrationCredentialResolvers;
  authHandlers?: {
    oauth?: IntegrationOAuthHandler<
      ParsedSchemaOutput<TTargetConfigSchema>,
      ParsedSchemaOutput<TTargetSecretsSchema>
    >;
  };
  webhookHandler?: IntegrationWebhookHandler<
    ParsedSchemaOutput<TTargetConfigSchema>,
    ParsedSchemaOutput<TTargetSecretsSchema>,
    Record<string, string>
  >;
  resourceDefinitions?: ReadonlyArray<IntegrationResourceDefinition>;
  resourceSyncTriggers?: ReadonlyArray<IntegrationResourceSyncTrigger>;
  listConnectionResources?(
    input: ListConnectionResourcesInput<
      ParsedSchemaOutput<TTargetConfigSchema>,
      ParsedSchemaOutput<TTargetSecretsSchema>,
      ParsedOptionalSchemaOutput<TConnectionConfigSchema>
    >,
  ): MaybePromise<ListConnectionResourcesResult>;
  mcp?: IntegrationMcpDefinition<
    ParsedSchemaOutput<TTargetConfigSchema>,
    ParsedSchemaOutput<TBindingConfigSchema>,
    ParsedSchemaOutput<TTargetSecretsSchema>
  >;
  mcpConfig?: IntegrationMcpConfig;
  validateBindingWriteContext?(
    input: BindingWriteValidationContext<
      ParsedSchemaOutput<TTargetConfigSchema>,
      ParsedSchemaOutput<TBindingConfigSchema>,
      ParsedOptionalSchemaOutput<TConnectionConfigSchema>
    >,
  ): BindingWriteValidationResult;
  compileBinding(
    input: CompileBindingInput<
      ParsedSchemaOutput<TTargetConfigSchema>,
      ParsedSchemaOutput<TBindingConfigSchema>,
      ParsedSchemaOutput<TTargetSecretsSchema>
    >,
  ): CompileBindingResult;
};

export type AnyIntegrationDefinition = IntegrationDefinition<
  IntegrationConfigSchema<unknown>,
  IntegrationConfigSchema<unknown>,
  IntegrationConfigSchema<unknown>,
  IntegrationConfigSchema<Record<string, unknown>> | undefined
>;

export type TriggerFilter =
  | { op: "all"; filters: ReadonlyArray<TriggerFilter> }
  | { op: "any"; filters: ReadonlyArray<TriggerFilter> }
  | { op: "not"; filter: TriggerFilter }
  | { op: "eq"; path: string; value: string | number | boolean }
  | { op: "in"; path: string; values: ReadonlyArray<string | number> }
  | { op: "contains"; path: string; value: string }
  | { op: "startsWith"; path: string; value: string }
  | { op: "exists"; path: string };

export type TriggerAction = {
  type: "deliver-input";
  inputTemplate: string;
  conversationKeyTemplate: string;
  idempotencyKeyTemplate?: string | undefined;
};

export type TriggerRule = {
  id: string;
  sourceBindingId: string;
  eventType: string;
  filter: TriggerFilter;
  action: TriggerAction;
  enabled: boolean;
};

export type ResolvedSandboxImage =
  | {
      source: "snapshot";
      imageRef: string;
      instanceId: string;
    }
  | {
      source: "profile-base";
      imageRef: string;
      sandboxProfileId: string;
      version: number;
    }
  | {
      source: "base";
      imageRef: string;
    };

export type CompiledRuntimePlan = {
  sandboxProfileId: string;
  version: number;
  image: ResolvedSandboxImage;
  egressRoutes: ReadonlyArray<EgressCredentialRoute>;
  artifacts: ReadonlyArray<CompiledRuntimeArtifactSpec>;
  artifactRemovals: ReadonlyArray<CompiledRuntimeArtifactRemovalSpec>;
  workspaceSources: ReadonlyArray<CompiledWorkspaceSource>;
  runtimeClients: ReadonlyArray<RuntimeClient>;
  agentRuntimes: ReadonlyArray<CompiledAgentRuntime>;
};

export type IntegrationDefinitionLocator = {
  familyId: string;
  variantId: string;
};

export interface IntegrationDefinitionReader {
  getDefinition(input: IntegrationDefinitionLocator): AnyIntegrationDefinition | undefined;
}

export interface IntegrationDefinitionResolver extends IntegrationDefinitionReader {
  getDefinitionOrThrow(input: IntegrationDefinitionLocator): AnyIntegrationDefinition;
}

export type CompileRuntimePlanBindingInput = {
  targetKey: string;
  target: IntegrationTarget;
  connection: IntegrationConnection;
  binding: IntegrationBinding;
};

export type CompileRuntimePlanInput = {
  organizationId: string;
  sandboxProfileId: string;
  version: number;
  image: ResolvedSandboxImage;
  runtimeContext: {
    sandboxdEgressBaseUrl: string;
  };
  bindings: ReadonlyArray<CompileRuntimePlanBindingInput>;
  previousBindings?: ReadonlyArray<CompileRuntimePlanBindingInput>;
  registry: IntegrationDefinitionResolver;
};
