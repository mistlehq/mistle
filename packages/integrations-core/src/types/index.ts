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

export type AgentCapabilityKind = "mcp";

export const AgentCapabilityKinds: {
  MCP: AgentCapabilityKind;
} = {
  MCP: "mcp",
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

export type IntegrationConfigSchema<TOutput> = {
  parse: (input: unknown) => TOutput;
};

type ParsedSchemaOutput<TSchema extends IntegrationConfigSchema<unknown>> =
  TSchema extends IntegrationConfigSchema<infer TOutput> ? TOutput : never;

export type IntegrationResolvedTarget<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
> = Omit<IntegrationTarget, "config" | "secrets"> & {
  config: TTargetConfig;
  secrets: TTargetSecrets;
};

export type RuntimeFileFormat = "toml" | "json" | "yaml" | "env" | "text";

export type RuntimeFileMergeStrategy = "replace" | "structured-merge";

export type RuntimeFileMergePolicy = {
  strategy?: RuntimeFileMergeStrategy;
  preservePaths?: ReadonlyArray<string>;
  replacePaths?: ReadonlyArray<string>;
  protectedPaths?: ReadonlyArray<string>;
};

export type IntegrationUserConfigSlotValueSchema = IntegrationConfigSchema<string>;

export type IntegrationFileUserConfigSlot = {
  kind: "file";
  key: string;
  label: string;
  description?: string;
  format: RuntimeFileFormat;
  required?: boolean;
  valueSchema: IntegrationUserConfigSlotValueSchema;
  applyTo: {
    clientId: string;
    fileId: string;
  };
  mergePolicy?: RuntimeFileMergePolicy;
};

export type IntegrationEnvUserConfigSlot = {
  kind: "env";
  key: string;
  label: string;
  description?: string;
  required?: boolean;
  valueSchema: IntegrationUserConfigSlotValueSchema;
  applyTo: {
    clientId: string;
    envKey: string;
  };
  policy?: {
    mutable: "user-overrides" | "base-wins";
  };
};

export type IntegrationUserConfigSlot =
  | IntegrationFileUserConfigSlot
  | IntegrationEnvUserConfigSlot;

export type IntegrationUserSecretSlot = {
  key: string;
  label: string;
  description?: string;
  required?: boolean;
  valueSchema: IntegrationUserConfigSlotValueSchema;
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

export type AgentCapabilityRefValue = string | EgressUrlRef;

export type AgentMcpCapabilityTransport = "streamable-http" | "sse" | "stdio";

export const AgentMcpCapabilityTransports: {
  STREAMABLE_HTTP: AgentMcpCapabilityTransport;
  SSE: AgentMcpCapabilityTransport;
  STDIO: AgentMcpCapabilityTransport;
} = {
  STREAMABLE_HTTP: "streamable-http",
  SSE: "sse",
  STDIO: "stdio",
};

type AgentCapabilityBase = {
  kind: AgentCapabilityKind;
  capabilityId: string;
  displayName?: string;
  description?: string;
};

export type AgentMcpCapability = AgentCapabilityBase & {
  kind: "mcp";
  serverName: string;
  transport: AgentMcpCapabilityTransport;
  endpoint: AgentCapabilityRefValue;
  headers?: Readonly<Record<string, AgentCapabilityRefValue>>;
};

export type AgentCapability = AgentMcpCapability;

export type IntegrationBindingAgentCapabilitySource = {
  bindingId: string;
  connectionId: string;
  targetKey: string;
  familyId: string;
  variantId: string;
};

export type IntegrationBindingAgentCapability = {
  source: IntegrationBindingAgentCapabilitySource;
  capability: AgentCapability;
};

export type CompileBindingRefs = {
  egressUrl: EgressUrlRef;
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
  agentCapabilities?: ReadonlyArray<IntegrationBindingAgentCapability>;
  refs: CompileBindingRefs;
  runtimeContext: {
    sandboxdEgressBaseUrl: string;
  };
};

export type IntegrationCredentialResolverInput = {
  organizationId: string;
  targetKey: string;
  connectionId: string;
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
  connectionRef: IntegrationWebhookConnectionRef;
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

export type IntegrationWebhookConnectionRef = {
  targetKey: string;
  externalSubjectId?: string;
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
  connectionRef: IntegrationWebhookConnectionRef;
};

export type IntegrationWebhookHandler<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TConnectionSecrets = Record<string, string>,
> = {
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

export type CompileBindingResult = {
  egressRoutes: ReadonlyArray<CompileBindingEgressRoute>;
  artifacts: ReadonlyArray<RuntimeArtifactSpec>;
  runtimeClients: ReadonlyArray<CompiledRuntimeClient>;
  agentCapabilities?: ReadonlyArray<AgentCapability>;
};

export type CompiledBindingResult = {
  egressRoutes: ReadonlyArray<EgressCredentialRoute>;
  artifacts: ReadonlyArray<CompiledRuntimeArtifactSpec>;
  runtimeClients: ReadonlyArray<CompiledRuntimeClient>;
  agentCapabilities?: ReadonlyArray<IntegrationBindingAgentCapability>;
};

export type IntegrationDefinitionAgentCapabilities = {
  advertises?: ReadonlyArray<AgentCapabilityKind>;
  consumes?: ReadonlyArray<AgentCapabilityKind>;
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
> = {
  familyId: string;
  variantId: string;
  kind: IntegrationKind;
  displayName: string;
  description?: string;
  logoKey: string;
  targetConfigSchema: TTargetConfigSchema;
  targetSecretSchema: TTargetSecretsSchema;
  bindingConfigSchema: TBindingConfigSchema;
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
  agentCapabilities?: IntegrationDefinitionAgentCapabilities;
  userConfigSlots: ReadonlyArray<IntegrationUserConfigSlot>;
  userSecretSlots?: ReadonlyArray<IntegrationUserSecretSlot>;
  compileBinding(
    input: CompileBindingInput<
      ParsedSchemaOutput<TTargetConfigSchema>,
      ParsedSchemaOutput<TBindingConfigSchema>,
      ParsedSchemaOutput<TTargetSecretsSchema>
    >,
  ): CompileBindingResult;
};

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
  runtimeClients: ReadonlyArray<RuntimeClient>;
};

export type IntegrationDefinitionLocator = {
  familyId: string;
  variantId: string;
};

export interface IntegrationDefinitionReader {
  getDefinition(input: IntegrationDefinitionLocator): IntegrationDefinition | undefined;
}

export interface IntegrationDefinitionResolver extends IntegrationDefinitionReader {
  getDefinitionOrThrow(input: IntegrationDefinitionLocator): IntegrationDefinition;
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
