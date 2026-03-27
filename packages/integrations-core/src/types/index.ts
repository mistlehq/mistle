import type { z } from "zod";

import type { AgentIntegrationHooks } from "../agent/index.js";

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

export type IntegrationConnectionMethodId = "api-key" | "oauth2" | "github-app-installation";

export const IntegrationConnectionMethodIds: {
  API_KEY: IntegrationConnectionMethodId;
  OAUTH2: IntegrationConnectionMethodId;
  GITHUB_APP_INSTALLATION: IntegrationConnectionMethodId;
} = {
  API_KEY: "api-key",
  OAUTH2: "oauth2",
  GITHUB_APP_INSTALLATION: "github-app-installation",
};

export type IntegrationConnectionMethodKind = "api-key" | "oauth2" | "redirect";

export const IntegrationConnectionMethodKinds: {
  API_KEY: IntegrationConnectionMethodKind;
  OAUTH2: IntegrationConnectionMethodKind;
  REDIRECT: IntegrationConnectionMethodKind;
} = {
  API_KEY: "api-key",
  OAUTH2: "oauth2",
  REDIRECT: "redirect",
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

export type IntegrationConnectionMethodDefinition<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TBindingConfig = Record<string, unknown>,
  TConnectionConfig = Record<string, unknown>,
> = {
  id: IntegrationConnectionMethodId;
  label: string;
  kind: IntegrationConnectionMethodKind;
  configSchema?: IntegrationConfigSchema<TConnectionConfig>;
  configForm?: IntegrationFormDefinition<
    TTargetConfig,
    TTargetSecrets,
    TBindingConfig,
    TConnectionConfig
  >;
};

type MaybePromise<TValue> = TValue | Promise<TValue>;

export type IntegrationMcpValue = string;

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

export type SandboxPathRefs = {
  userHomeDir: string;
  userProjectsDir: string;
  runtimeDataDir: string;
  runtimeArtifactDir: string;
  runtimeArtifactBinDir: string;
};

export type CompileBindingRefs = {
  sandboxPaths: SandboxPathRefs;
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
};

export type IntegrationCredentialResolverInput = {
  organizationId: string;
  targetKey: string;
  connectionId: string;
  target: IntegrationResolvedTarget;
  connection: IntegrationConnection;
  binding?: Pick<IntegrationBinding, "id" | "kind"> & { config: Record<string, unknown> };
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

export type IntegrationRedirectCredentialMaterial = {
  purpose: string;
  secretType: string;
  plaintext: string;
  metadata?: Record<string, unknown>;
};

export type IntegrationRedirectStartInput<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
> = {
  organizationId: string;
  targetKey: string;
  target: IntegrationResolvedTarget<TTargetConfig, TTargetSecrets>;
  state: string;
};

export type IntegrationRedirectStartResult = {
  authorizationUrl: string;
};

export type IntegrationRedirectCompleteInput<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
> = {
  organizationId: string;
  targetKey: string;
  target: IntegrationResolvedTarget<TTargetConfig, TTargetSecrets>;
  query: URLSearchParams;
};

export type IntegrationRedirectCompleteResult = {
  externalSubjectId?: string;
  connectionConfig: Record<string, unknown>;
  credentialMaterials: ReadonlyArray<IntegrationRedirectCredentialMaterial>;
};

export type IntegrationRedirectHandler<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
> = {
  start(
    input: IntegrationRedirectStartInput<TTargetConfig, TTargetSecrets>,
  ): MaybePromise<IntegrationRedirectStartResult>;
  complete(
    input: IntegrationRedirectCompleteInput<TTargetConfig, TTargetSecrets>,
  ): MaybePromise<IntegrationRedirectCompleteResult>;
};

export type IntegrationOAuth2StartAuthorizationInput<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
> = {
  organizationId: string;
  targetKey: string;
  target: IntegrationResolvedTarget<TTargetConfig, TTargetSecrets>;
  state: string;
  redirectUrl: string;
  pkce?: {
    challenge: string;
    challengeMethod: "S256";
  };
};

export type IntegrationOAuth2StartAuthorizationResult = {
  authorizationUrl: string;
};

export type IntegrationOAuth2CompleteAuthorizationCodeGrantInput<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
> = {
  organizationId: string;
  targetKey: string;
  target: IntegrationResolvedTarget<TTargetConfig, TTargetSecrets>;
  query: URLSearchParams;
  redirectUrl: string;
  pkceVerifier?: string;
};

export type IntegrationOAuth2CompleteAuthorizationCodeGrantResult = {
  externalSubjectId?: string;
  connectionConfig: Record<string, unknown>;
  accessToken: string;
  accessTokenExpiresAt?: string;
  refreshToken?: string;
  refreshTokenExpiresAt?: string;
  credentialMetadata?: Record<string, unknown>;
};

export type IntegrationOAuth2RefreshAccessTokenInput<
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
  refreshToken: string;
};

export type IntegrationOAuth2RefreshAccessTokenResult = {
  accessToken: string;
  accessTokenExpiresAt?: string;
  refreshToken?: string;
  refreshTokenExpiresAt?: string;
  credentialMetadata?: Record<string, unknown>;
};

export type IntegrationOAuth2RefreshAccessTokenErrorClassification = "temporary" | "permanent";

export const IntegrationOAuth2RefreshAccessTokenErrorClassifications: {
  TEMPORARY: IntegrationOAuth2RefreshAccessTokenErrorClassification;
  PERMANENT: IntegrationOAuth2RefreshAccessTokenErrorClassification;
} = {
  TEMPORARY: "temporary",
  PERMANENT: "permanent",
};

export class IntegrationOAuth2RefreshAccessTokenError extends Error {
  readonly classification: IntegrationOAuth2RefreshAccessTokenErrorClassification;
  readonly code: string | undefined;

  constructor(input: {
    message: string;
    classification: IntegrationOAuth2RefreshAccessTokenErrorClassification;
    code?: string;
  }) {
    super(input.message);
    this.name = "IntegrationOAuth2RefreshAccessTokenError";
    this.classification = input.classification;
    this.code = input.code;
  }
}

export type IntegrationOAuth2Capability<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TConnectionConfig = Record<string, unknown>,
> = {
  startAuthorization(
    input: IntegrationOAuth2StartAuthorizationInput<TTargetConfig, TTargetSecrets>,
  ): MaybePromise<IntegrationOAuth2StartAuthorizationResult>;
  completeAuthorizationCodeGrant(
    input: IntegrationOAuth2CompleteAuthorizationCodeGrantInput<TTargetConfig, TTargetSecrets>,
  ): MaybePromise<IntegrationOAuth2CompleteAuthorizationCodeGrantResult>;
  refreshAccessToken(
    input: IntegrationOAuth2RefreshAccessTokenInput<
      TTargetConfig,
      TTargetSecrets,
      TConnectionConfig
    >,
  ): MaybePromise<IntegrationOAuth2RefreshAccessTokenResult>;
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

export type IntegrationWebhookImmediateResponse = {
  status: number;
  headers?: Readonly<Record<string, string>>;
  contentType?: string;
  body?: string | Record<string, unknown>;
};

export type IntegrationWebhookRequestInput<
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
  sourceOrderKey?: string;
};

export type IntegrationWebhookRequestResolution =
  | {
      kind: "event";
      event: IntegrationWebhookEvent;
    }
  | {
      kind: "response";
      response: IntegrationWebhookImmediateResponse;
    };

export type IntegrationWebhookResolvedRequest =
  | ({
      kind: "event";
    } & IntegrationWebhookResolvedEvent)
  | {
      kind: "response";
      response: IntegrationWebhookImmediateResponse;
    };

export type IntegrationWebhookHandler<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TConnectionSecrets = Record<string, string>,
> = {
  resolveWebhookRequest(
    input: IntegrationWebhookRequestInput<TTargetConfig, TTargetSecrets>,
  ): MaybePromise<IntegrationWebhookRequestResolution>;
  resolveConnection(
    input: IntegrationWebhookResolveConnectionInput<TTargetConfig, TTargetSecrets>,
  ): MaybePromise<IntegrationWebhookResolveConnectionResult>;
  verify(
    input: IntegrationWebhookVerifyInput<TTargetConfig, TTargetSecrets, TConnectionSecrets>,
  ): MaybePromise<IntegrationWebhookVerifyResult>;
};

export type EgressCredentialResolverRef = {
  connectionId: string;
  secretType: string;
  purpose?: string;
  resolverKey?: string;
};

export type EgressCredentialRoute = {
  egressRuleId: string;
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
    /**
     * Optional fixed username used when the upstream expects Basic auth in the
     * form of username:secret rather than just a secret value.
     */
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
  sandboxPaths: SandboxPathRefs;
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
  env?: Readonly<Record<string, string>>;
  lifecycle: RuntimeArtifactLifecycle<
    ReadonlyArray<RuntimeArtifactCommand> | RuntimeArtifactLifecycleBuilder
  >;
};

export type CompiledRuntimeArtifactSpec = {
  artifactKey: string;
  name: string;
  description?: string;
  env?: Readonly<Record<string, string>>;
  lifecycle: RuntimeArtifactLifecycle<ReadonlyArray<RuntimeArtifactCommand>>;
};

export const RuntimeFileWriteMode = {
  OVERWRITE: "overwrite",
  IF_ABSENT: "if-absent",
} as const;

export type RuntimeFileWriteMode = (typeof RuntimeFileWriteMode)[keyof typeof RuntimeFileWriteMode];

export type RuntimeClientSetupFile = {
  fileId: string;
  path: string;
  mode: number;
  content: string;
  writeMode?: RuntimeFileWriteMode;
};

type RuntimeClientSetupBase<TEnvValue> = {
  env: Record<string, TEnvValue>;
  files: ReadonlyArray<RuntimeClientSetupFile>;
  launchArgs?: ReadonlyArray<string>;
};

export type CompiledRuntimeClientSetup = RuntimeClientSetupBase<string>;

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

export type CompiledRuntimeClient = RuntimeClientBase<string>;

export type RuntimeClient = RuntimeClientBase<string>;

export type CompileBindingEgressRoute = Omit<EgressCredentialRoute, "egressRuleId" | "bindingId">;

export type CompileBindingAgentRuntime = {
  runtimeKey: string;
  clientId: string;
  endpointKey: string;
  adapterKey: string;
};

export type CompiledAgentRuntime = CompileBindingAgentRuntime & {
  bindingId: string;
};

type GitCloneWorkspaceSourceBase = {
  sourceKind: "git-clone";
  resourceKind: "repository";
  path: string;
  originUrl: string;
};

export type CompileBindingWorkspaceSource = GitCloneWorkspaceSourceBase;

export type CompiledWorkspaceSource = GitCloneWorkspaceSourceBase;

export type CompileBindingResult = {
  egressRoutes: ReadonlyArray<CompileBindingEgressRoute>;
  artifacts: ReadonlyArray<RuntimeArtifactSpec>;
  runtimeClients: ReadonlyArray<CompiledRuntimeClient>;
  /**
   * Sources that should appear in the workspace before runtime clients start.
   * Definitions describe them in binding-local terms and the compiler resolves
   * any route references into concrete compiled route IDs.
   */
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

export type IntegrationWebhookEventParameterOptionDefinition = {
  value: string;
  label: string;
};

export type IntegrationWebhookEventParameterDefinition =
  | {
      id: string;
      label: string;
      kind: "resource-select";
      resourceKind: string;
      payloadPath: ReadonlyArray<string>;
      prefix?: string | undefined;
      placeholder?: string | undefined;
    }
  | {
      id: string;
      label: string;
      kind: "string";
      payloadPath: ReadonlyArray<string>;
      matchMode?: "eq" | "contains" | undefined;
      defaultValue?: string | undefined;
      defaultEnabled?: boolean | undefined;
      uiHint?: "explicit-invocation" | undefined;
      prefix?: string | undefined;
      placeholder?: string | undefined;
    }
  | {
      id: string;
      label: string;
      kind: "enum-select";
      payloadPath: ReadonlyArray<string>;
      matchMode: "eq" | "exists";
      options: ReadonlyArray<IntegrationWebhookEventParameterOptionDefinition>;
      prefix?: string | undefined;
      placeholder?: string | undefined;
    };

export type IntegrationWebhookEventDefinition = {
  eventType: string;
  providerEventType: string;
  displayName: string;
  category?: string | undefined;
  conversationKeyOptions?:
    | ReadonlyArray<{
        id: string;
        label: string;
        description: string;
        template: string;
      }>
    | undefined;
  parameters?: ReadonlyArray<IntegrationWebhookEventParameterDefinition> | undefined;
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
  TConnectionConfig = Record<string, unknown>,
> = {
  familyId: string;
  variantId: string;
  kind: IntegrationKind;
  agent?: AgentIntegrationHooks;
  displayName: string;
  description?: string;
  logoKey: string;
  targetConfigSchema: TTargetConfigSchema;
  targetConfigForm?: IntegrationFormDefinition<
    ParsedSchemaOutput<TTargetConfigSchema>,
    ParsedSchemaOutput<TTargetSecretsSchema>,
    ParsedSchemaOutput<TBindingConfigSchema>,
    TConnectionConfig
  >;
  targetSecretSchema: TTargetSecretsSchema;
  targetSecretForm?: IntegrationFormDefinition<
    ParsedSchemaOutput<TTargetConfigSchema>,
    ParsedSchemaOutput<TTargetSecretsSchema>,
    ParsedSchemaOutput<TBindingConfigSchema>,
    TConnectionConfig
  >;
  bindingConfigSchema: TBindingConfigSchema;
  bindingConfigForm?: IntegrationFormDefinition<
    ParsedSchemaOutput<TTargetConfigSchema>,
    ParsedSchemaOutput<TTargetSecretsSchema>,
    ParsedSchemaOutput<TBindingConfigSchema>,
    TConnectionConfig
  >;
  connectionMethods: ReadonlyArray<
    IntegrationConnectionMethodDefinition<
      ParsedSchemaOutput<TTargetConfigSchema>,
      ParsedSchemaOutput<TTargetSecretsSchema>,
      ParsedSchemaOutput<TBindingConfigSchema>,
      TConnectionConfig
    >
  >;
  credentialResolvers?: IntegrationCredentialResolvers;
  oauth2?: IntegrationOAuth2Capability<
    ParsedSchemaOutput<TTargetConfigSchema>,
    ParsedSchemaOutput<TTargetSecretsSchema>,
    TConnectionConfig
  >;
  redirectHandler?: IntegrationRedirectHandler<
    ParsedSchemaOutput<TTargetConfigSchema>,
    ParsedSchemaOutput<TTargetSecretsSchema>
  >;
  supportedWebhookEvents?: ReadonlyArray<IntegrationWebhookEventDefinition>;
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
      TConnectionConfig
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
      TConnectionConfig
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
  Record<string, unknown>
>;

export type IntegrationFormConnectionMethodDefinition<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TBindingConfig = Record<string, unknown>,
  TConnectionConfig = Record<string, unknown>,
> = Omit<
  IntegrationConnectionMethodDefinition<
    TTargetConfig,
    TTargetSecrets,
    TBindingConfig,
    TConnectionConfig
  >,
  "configSchema"
> & {
  configSchema?: IntegrationConfigSchema<Record<string, unknown>>;
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

export const SandboxImageSources = {
  BASE: "base",
  PROFILE_BASE: "profile-base",
} as const;

export type SandboxImageSource = (typeof SandboxImageSources)[keyof typeof SandboxImageSources];

export type ResolvedSandboxImage =
  | {
      source: typeof SandboxImageSources.PROFILE_BASE;
      imageRef: string;
      sandboxProfileId: string;
      version: number;
    }
  | {
      source: typeof SandboxImageSources.BASE;
      imageRef: string;
    };

export type CompiledRuntimePlan = {
  sandboxProfileId: string;
  version: number;
  image: ResolvedSandboxImage;
  egressRoutes: ReadonlyArray<EgressCredentialRoute>;
  artifacts: ReadonlyArray<CompiledRuntimeArtifactSpec>;
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
  bindings: ReadonlyArray<CompileRuntimePlanBindingInput>;
  registry: IntegrationDefinitionResolver;
};
