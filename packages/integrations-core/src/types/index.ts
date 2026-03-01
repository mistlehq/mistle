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

export type CompileBindingRefs = {
  egressUrl: EgressUrlRef;
};

export type CompileBindingInput<
  TTargetConfig = Record<string, unknown>,
  TBindingConfig = Record<string, unknown>,
> = {
  organizationId: string;
  sandboxProfileId: string;
  version: number;
  targetKey: string;
  target: Omit<IntegrationTarget, "config"> & { config: TTargetConfig };
  connection: IntegrationConnection;
  binding: Pick<IntegrationBinding, "id" | "kind"> & { config: TBindingConfig };
  refs: CompileBindingRefs;
  runtimeContext: {
    sandboxdEgressBaseUrl: string;
  };
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
  credentialResolver: {
    connectionId: string;
    secretType: string;
  };
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
  remove?: THook;
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

type RuntimeClientSetupBase<TEnvValue> = {
  clientId: string;
  env: Record<string, TEnvValue>;
  files: ReadonlyArray<{ fileId: string; path: string; mode: number; content: string }>;
  launchArgs?: ReadonlyArray<string>;
};

export type CompiledRuntimeClientSetup = RuntimeClientSetupBase<string | EgressUrlRef>;

export type RuntimeClientSetup = RuntimeClientSetupBase<string>;

export type CompileBindingEgressRoute = Omit<EgressCredentialRoute, "routeId" | "bindingId">;

export type CompileBindingResult = {
  egressRoutes: ReadonlyArray<CompileBindingEgressRoute>;
  artifacts: ReadonlyArray<RuntimeArtifactSpec>;
  runtimeClientSetups: ReadonlyArray<CompiledRuntimeClientSetup>;
};

export type CompiledBindingResult = {
  egressRoutes: ReadonlyArray<EgressCredentialRoute>;
  artifacts: ReadonlyArray<CompiledRuntimeArtifactSpec>;
  runtimeClientSetups: ReadonlyArray<CompiledRuntimeClientSetup>;
};

export type IntegrationDefinition<
  TTargetConfigSchema extends IntegrationConfigSchema<unknown> = IntegrationConfigSchema<
    Record<string, unknown>
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
  bindingConfigSchema: TBindingConfigSchema;
  supportedAuthSchemes: ReadonlyArray<IntegrationSupportedAuthScheme>;
  triggerEventTypes: ReadonlyArray<string>;
  userConfigSlots: ReadonlyArray<IntegrationUserConfigSlot>;
  compileBinding(
    input: CompileBindingInput<
      ParsedSchemaOutput<TTargetConfigSchema>,
      ParsedSchemaOutput<TBindingConfigSchema>
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
      source: "instance-latest-snapshot";
      imageRef: string;
      instanceId: string;
    }
  | {
      source: "profile-version-base";
      imageRef: string;
      sandboxProfileId: string;
      version: number;
    }
  | {
      source: "default-base";
      imageRef: string;
    };

export type CompiledRuntimePlan = {
  sandboxProfileId: string;
  version: number;
  image: ResolvedSandboxImage;
  egressRoutes: ReadonlyArray<EgressCredentialRoute>;
  artifacts: ReadonlyArray<CompiledRuntimeArtifactSpec>;
  runtimeClientSetups: ReadonlyArray<RuntimeClientSetup>;
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
  registry: IntegrationDefinitionResolver;
};
