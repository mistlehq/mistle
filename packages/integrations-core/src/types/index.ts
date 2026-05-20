import type { z } from "zod";

import type { AgentRuntimeRegistry } from "../agent-runtimes/index.js";
import type { AgentPtyLaunchSpec } from "../agent-runtimes/types.js";
import type { ConnectionCapabilitySet } from "../capabilities/index.js";
import type { IntegrationRegistry } from "../registry/index.js";

export type IntegrationKind = "agent" | "git" | "connector" | "sandbox";

export const IntegrationKinds: {
  AGENT: IntegrationKind;
  GIT: IntegrationKind;
  CONNECTOR: IntegrationKind;
  SANDBOX: IntegrationKind;
} = {
  AGENT: "agent",
  GIT: "git",
  CONNECTOR: "connector",
  SANDBOX: "sandbox",
};

export type SandboxRuntimeResourceField = {
  min: number;
  max: number;
  step: number;
  default: number;
};

export type SandboxRuntimeMemoryResourceField = SandboxRuntimeResourceField & {
  minPerVcpu?: number;
  maxPerVcpu?: number;
};

export type SandboxRuntimeResourceCapabilities = {
  vcpuCount: SandboxRuntimeResourceField;
  memoryMb: SandboxRuntimeMemoryResourceField;
  storageMb?: SandboxRuntimeResourceField;
};

export type IntegrationSandboxRuntimeDefinition = {
  providerId: string;
  displayName: string;
  resourceCapabilities: SandboxRuntimeResourceCapabilities;
};

export type IntegrationConnectionMethodId = string;

export const IntegrationConnectionMethodIds: {
  API_KEY: IntegrationConnectionMethodId;
  OAUTH2_AUTHORIZATION_CODE: IntegrationConnectionMethodId;
  GITHUB_APP_INSTALLATION: IntegrationConnectionMethodId;
  AWS_ASSUME_ROLE: IntegrationConnectionMethodId;
} = {
  API_KEY: "api-key",
  OAUTH2_AUTHORIZATION_CODE: "oauth2-authorization-code",
  GITHUB_APP_INSTALLATION: "github-app-installation",
  AWS_ASSUME_ROLE: "aws-assume-role",
};

export function createOAuth2AuthorizationCodeCredentialSlotKeys(input: {
  familyId: string;
  variantId: string;
}): {
  accessToken: string;
  refreshToken: string;
  clientSecret: string;
} {
  const prefix = `${input.familyId}.${input.variantId}.${IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE}`;

  return {
    accessToken: `${prefix}.access-token`,
    refreshToken: `${prefix}.refresh-token`,
    clientSecret: `${prefix}.client-secret`,
  };
}

export type IntegrationConnectionMethodKind = "form" | "redirect" | "device-authorization";

export const IntegrationConnectionMethodKinds: {
  FORM: IntegrationConnectionMethodKind;
  REDIRECT: IntegrationConnectionMethodKind;
  DEVICE_AUTHORIZATION: IntegrationConnectionMethodKind;
} = {
  FORM: "form",
  REDIRECT: "redirect",
  DEVICE_AUTHORIZATION: "device-authorization",
};

export type IntegrationConnectionMethodSecretField = {
  name: string;
  label: string;
  placeholder?: string;
  description?: string;
  optional?: boolean;
  inputType: "password" | "text" | "textarea";
  secretType: string;
  slotKey: string;
};

export type IntegrationBrowserSafeConnectionMethodSecretField = Omit<
  IntegrationConnectionMethodSecretField,
  "secretType"
>;

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

export type IdentityLinkingPrincipalKey = {
  keyType: string;
  keyValue: string;
};

export type IdentityLinkingCredentialSecret = {
  secretKind: string;
  plaintext: string;
  metadata?: Record<string, unknown> | undefined;
  expiresAt?: string | undefined;
};

export type CompletedIdentityLinkingAuthorization = {
  providerSubjectId: string;
  profile?: Record<string, unknown> | undefined;
  keys: readonly [IdentityLinkingPrincipalKey, ...IdentityLinkingPrincipalKey[]];
  credential?:
    | {
        credentialKind: string;
        scopes?: string[] | undefined;
        accessTokenExpiresAt?: string | undefined;
        refreshTokenExpiresAt?: string | undefined;
        secrets: readonly [IdentityLinkingCredentialSecret, ...IdentityLinkingCredentialSecret[]];
      }
    | undefined;
};

export type IdentityLinkingConnectionSecretResolver = (input: {
  slotKey: string;
}) => MaybePromise<string>;

export type IntegrationIdentityLinkingConnectionSupportInput<
  TConnectionConfig = Record<string, unknown>,
> = {
  connection: IntegrationConnection & {
    config: TConnectionConfig;
  };
  availableConnectionSecretSlotKeys: ReadonlySet<string>;
};

export type IntegrationIdentityLinkingStartAuthorizationInput<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TConnectionConfig = Record<string, unknown>,
> = {
  organizationId: string;
  userId: string;
  providerFamily: string;
  target: IntegrationResolvedTarget<TTargetConfig, TTargetSecrets>;
  connection: IntegrationConnection & {
    config: TConnectionConfig;
  };
  state: string;
  redirectUrl: string;
  resolveConnectionSecret: IdentityLinkingConnectionSecretResolver;
};

export type StartedIdentityLinkingAuthorization = {
  authorizationUrl: string;
  pkceVerifier?: string | undefined;
  providerState?: Record<string, unknown> | undefined;
};

export type IntegrationIdentityLinkingCompleteAuthorizationInput<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TConnectionConfig = Record<string, unknown>,
> = {
  organizationId: string;
  userId: string;
  providerFamily: string;
  target: IntegrationResolvedTarget<TTargetConfig, TTargetSecrets>;
  connection: IntegrationConnection & {
    config: TConnectionConfig;
  };
  query: URLSearchParams;
  redirectUrl: string;
  now: string;
  pkceVerifier?: string | undefined;
  providerState?: Record<string, unknown> | undefined;
  resolveConnectionSecret: IdentityLinkingConnectionSecretResolver;
};

export type IntegrationIdentityLinkingStoredCredential = {
  credentialKind: string;
  scopes?: string[] | undefined;
  accessTokenExpiresAt?: string | undefined;
  refreshTokenExpiresAt?: string | undefined;
};

export type IdentityLinkingCredentialSecretResolver = (input: {
  secretKind: string;
}) => MaybePromise<string>;

export type RefreshedIdentityLinkingCredential = {
  credentialKind: string;
  scopes?: string[] | undefined;
  accessTokenExpiresAt?: string | undefined;
  refreshTokenExpiresAt?: string | undefined;
  secrets: readonly [IdentityLinkingCredentialSecret, ...IdentityLinkingCredentialSecret[]];
};

export type IntegrationIdentityLinkingRefreshCredentialInput<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TConnectionConfig = Record<string, unknown>,
> = {
  organizationId: string;
  userId: string;
  providerFamily: string;
  target: IntegrationResolvedTarget<TTargetConfig, TTargetSecrets>;
  connection: IntegrationConnection & {
    config: TConnectionConfig;
  };
  credential: IntegrationIdentityLinkingStoredCredential;
  now: string;
  resolveConnectionSecret: IdentityLinkingConnectionSecretResolver;
  resolveCredentialSecret: IdentityLinkingCredentialSecretResolver;
};

export type IntegrationIdentityLinkingResolveWebhookActorInput<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
> = {
  organizationId: string;
  providerFamily: string;
  target: IntegrationResolvedTarget<TTargetConfig, TTargetSecrets>;
  event: IntegrationWebhookEvent;
};

export type IntegrationIdentityLinkingCapability<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TConnectionConfig = Record<string, unknown>,
> = {
  eligibleConnectionMethodIds: ReadonlyArray<IntegrationConnectionMethodId>;
  supportsConnection?(
    input: IntegrationIdentityLinkingConnectionSupportInput<TConnectionConfig>,
  ): MaybePromise<boolean>;
  startAuthorization?(
    input: IntegrationIdentityLinkingStartAuthorizationInput<
      TTargetConfig,
      TTargetSecrets,
      TConnectionConfig
    >,
  ): MaybePromise<StartedIdentityLinkingAuthorization>;
  completeAuthorization?(
    input: IntegrationIdentityLinkingCompleteAuthorizationInput<
      TTargetConfig,
      TTargetSecrets,
      TConnectionConfig
    >,
  ): MaybePromise<CompletedIdentityLinkingAuthorization>;
  refreshCredential?(
    input: IntegrationIdentityLinkingRefreshCredentialInput<
      TTargetConfig,
      TTargetSecrets,
      TConnectionConfig
    >,
  ): MaybePromise<RefreshedIdentityLinkingCredential>;
  resolveWebhookActor?(
    input: IntegrationIdentityLinkingResolveWebhookActorInput<TTargetConfig, TTargetSecrets>,
  ): MaybePromise<readonly [IdentityLinkingPrincipalKey, ...IdentityLinkingPrincipalKey[]] | null>;
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
  slotKey?: string;
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
  definitions?: IntegrationDefinitionsBundle;
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

export type IntegrationConnectionMethodCreateUi = {
  submitLabel: string;
  helperText: string;
};

export type IntegrationConnectionMethodReauthorizeUi = {
  actionLabel: string;
  pendingLabel: string;
};

export type IntegrationDeviceAuthorizationConnectionMethodCreateUi = {
  submitLabel: string;
};

export type IntegrationConnectionMethodPendingUi = {
  title?: string;
  description?: string;
};

export type IntegrationFormConnectionMethodCreateBehavior = "single-step" | "draft-then-setup";

export const IntegrationFormConnectionMethodCreateBehaviors: {
  SINGLE_STEP: IntegrationFormConnectionMethodCreateBehavior;
  DRAFT_THEN_SETUP: IntegrationFormConnectionMethodCreateBehavior;
} = {
  SINGLE_STEP: "single-step",
  DRAFT_THEN_SETUP: "draft-then-setup",
};

export type IntegrationFormConnectionMethodSetupManifestDraftInput = {
  controlPlaneBaseUrl: string;
  webhookCallbackUrl: string;
};

export type IntegrationFormConnectionMethodSetupManifestDraft = {
  build(
    this: void,
    input: IntegrationFormConnectionMethodSetupManifestDraftInput,
  ): Record<string, unknown>;
};

export type IntegrationFormConnectionMethodSetupStartFormAction = {
  href: string;
  label: string;
  opensInNewWindow?: boolean | undefined;
};

export type IntegrationFormConnectionMethodSetupStartFormField = {
  actions?: ReadonlyArray<IntegrationFormConnectionMethodSetupStartFormAction> | undefined;
  description?: string | undefined;
  inputType: "password" | "radio" | "text" | "textarea";
  label: string;
  name: string;
  options?:
    | ReadonlyArray<{
        label: string;
        value: string;
      }>
    | undefined;
  placeholder?: string | undefined;
  required?: boolean | undefined;
  visibleWhen?:
    | {
        field: string;
        value: string;
      }
    | undefined;
};

export type IntegrationFormConnectionMethodSetupStartForm = {
  fields: ReadonlyArray<IntegrationFormConnectionMethodSetupStartFormField>;
  submitLabel: string;
};

export type IntegrationFormConnectionMethodSetupPaneMetadata = {
  kind: "provider-app";
};

export type IntegrationFormConnectionMethodProviderAppSetupExistingAppConfigField = {
  configKey: string;
  label: string;
  name: string;
  required: boolean;
};

export type IntegrationFormConnectionMethodProviderAppSetupExistingAppSecretField = {
  inputType: "password" | "textarea";
  label: string;
  name: string;
  placeholder?: string | undefined;
  rows?: number | undefined;
  required: boolean;
  secretLabel: string;
};

export type IntegrationFormConnectionMethodProviderAppSetupExistingAppStartAction = {
  expectedResultKind: "redirect";
  installedDetection?:
    | {
        configFields?: ReadonlyArray<string> | undefined;
        externalSubject?: boolean | undefined;
      }
    | undefined;
  installedLabel: string;
  installedOpensInNewWindow?: boolean | undefined;
  pendingLabel?: string | undefined;
  routeSegment: string;
  startErrorMessage: string;
  unexpectedResultMessage: string;
  windowTitle: string;
};

export type IntegrationFormConnectionMethodProviderAppSetup = {
  description: string;
  installedNoticeTitle?: string | undefined;
  existingApp: {
    configFields: ReadonlyArray<IntegrationFormConnectionMethodProviderAppSetupExistingAppConfigField>;
    connectLabel: string;
    description: string;
    installedDetection: {
      configFields: ReadonlyArray<string>;
      secretFields: ReadonlyArray<string>;
    };
    saveErrorMessage: string;
    secretFields: ReadonlyArray<IntegrationFormConnectionMethodProviderAppSetupExistingAppSecretField>;
    startAction?: IntegrationFormConnectionMethodProviderAppSetupExistingAppStartAction | undefined;
    title: string;
  };
  manifest: {
    createErrorMessage: string;
    description: string;
    startAction: {
      expectedResultKind: "form-post" | "redirect";
      manifestBodyField: string;
      unexpectedResultMessage: string;
    };
    title: string;
  };
  title: string;
  urls: {
    description: string;
    setupCallback?:
      | {
          label: string;
          path: string;
        }
      | undefined;
    title: string;
    webhookCallback: {
      errorTitle: string;
      label: string;
      missingMessage: string;
      missingTitle: string;
    };
  };
};

export type IntegrationFormConnectionMethodSetupFlowMetadata = {
  completionRequirements?: IntegrationFormConnectionMethodSetupCompletionRequirement | undefined;
  providerAppSetup?: IntegrationFormConnectionMethodProviderAppSetup | undefined;
  routeSegment: string;
  setupPane?: IntegrationFormConnectionMethodSetupPaneMetadata | undefined;
  startForm?: IntegrationFormConnectionMethodSetupStartForm | undefined;
};

export type IntegrationFormConnectionMethodSetupFlow =
  IntegrationFormConnectionMethodSetupFlowMetadata & {
    appManifestDraft?: IntegrationFormConnectionMethodSetupManifestDraft | undefined;
  };

export type IntegrationConnectionMethodDetailFieldSourceLeaf =
  | {
      field: string;
      kind: "config-field";
    }
  | {
      kind: "connection-external-subject";
    };

export type IntegrationConnectionMethodDetailFieldSource =
  | IntegrationConnectionMethodDetailFieldSourceLeaf
  | {
      kind: "first-of";
      sources: readonly IntegrationConnectionMethodDetailFieldSourceLeaf[];
    };

export type IntegrationConnectionMethodDetailField = {
  label: string;
  required?: boolean | undefined;
  source: IntegrationConnectionMethodDetailFieldSource;
};

export type IntegrationConnectionMethodDetailMetadata = {
  installation?:
    | {
        actionLabel?: string | undefined;
        fields?: ReadonlyArray<IntegrationConnectionMethodDetailField> | undefined;
        hideWebhookSourceSection?: boolean | undefined;
        includeWebhookCallbackUrl?: boolean | undefined;
        postInstallationSetupPath?: string | undefined;
      }
    | undefined;
};

export type IntegrationManagedWebhookSourcePostCreateMetadata = {
  autoCreate?: boolean | undefined;
  failureNoticeTitle: string;
  successNoticeTitle: string;
};

export type IntegrationFormConnectionMethodPostCreateMetadata = {
  managedWebhookSource?: IntegrationManagedWebhookSourcePostCreateMetadata | undefined;
};

export type IntegrationProviderAppSetupStartResult =
  | {
      kind: "form-post";
      fields: Record<string, string>;
      submissionUrl: string;
    }
  | {
      authorizationUrl: string;
      kind: "redirect";
    };

export type IntegrationProviderAppSetupConnectionUpdate = {
  config?: Record<string, unknown>;
  externalSubjectId?: string | null;
};

export type IntegrationProviderAppSetupCompletionRedirect =
  | {
      kind: "connection-detail";
      notice?: string;
    }
  | {
      kind: "setup-route";
      query?: Record<string, string>;
    };

export type IntegrationProviderAppSetupResult = {
  completionRedirect?: IntegrationProviderAppSetupCompletionRedirect;
  connection?: IntegrationProviderAppSetupConnectionUpdate;
  secrets?: Record<string, string>;
  webhookSource?: {
    providerMetadata?: Record<string, unknown>;
  };
};

export type IntegrationProviderAppSetupCompleteResult = IntegrationProviderAppSetupResult & {
  completionRedirect: IntegrationProviderAppSetupCompletionRedirect;
};

export type IntegrationProviderAppSetupConnectionSecretResolver = (input: {
  secretKind: string;
  slotKey: string;
}) => MaybePromise<string>;

export type IntegrationProviderAppSetupStartInput<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TConnectionConfig = Record<string, unknown>,
> = {
  body: Record<string, unknown>;
  connection: IntegrationConnection & {
    config: TConnectionConfig;
  };
  controlPlaneBaseUrl: string;
  redirectState: string;
  resolveConnectionSecret: IntegrationProviderAppSetupConnectionSecretResolver;
  target: IntegrationResolvedTarget<TTargetConfig, TTargetSecrets>;
  webhookCallbackUrl?: string;
};

export type IntegrationProviderAppSetupCompleteInput<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TConnectionConfig = Record<string, unknown>,
> = {
  callbackRouteKey: string;
  connection: IntegrationConnection & {
    config: TConnectionConfig;
  };
  controlPlaneBaseUrl: string;
  query: URLSearchParams;
  resolveConnectionSecret: IntegrationProviderAppSetupConnectionSecretResolver;
  target: IntegrationResolvedTarget<TTargetConfig, TTargetSecrets>;
};

export type IntegrationProviderAppSetupFlowCapability<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TConnectionConfig = Record<string, unknown>,
> = {
  additionalCallbackRouteKeys?: readonly string[];
  callbackRouteKey?: string;
  methodId: IntegrationConnectionMethodId;
  requiresWebhookCallbackUrl?: boolean;
  routeSegment: string;
  complete?(
    input: IntegrationProviderAppSetupCompleteInput<
      TTargetConfig,
      TTargetSecrets,
      TConnectionConfig
    >,
  ): MaybePromise<IntegrationProviderAppSetupCompleteResult>;
  start?(
    input: IntegrationProviderAppSetupStartInput<TTargetConfig, TTargetSecrets, TConnectionConfig>,
  ): MaybePromise<
    IntegrationProviderAppSetupResult & { start: IntegrationProviderAppSetupStartResult }
  >;
};

export type IntegrationProviderAppSetupCapability<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TConnectionConfig = Record<string, unknown>,
> = {
  flows: ReadonlyArray<
    IntegrationProviderAppSetupFlowCapability<TTargetConfig, TTargetSecrets, TConnectionConfig>
  >;
};

export type IntegrationFormConnectionMethodSetupCompletionRequirementLeaf =
  | {
      kind: "connection-external-subject";
    }
  | {
      field: string;
      kind: "config-field";
    }
  | {
      field: string;
      kind: "secret-field";
    };

export type IntegrationFormConnectionMethodSetupCompletionRequirement =
  | IntegrationFormConnectionMethodSetupCompletionRequirementLeaf
  | {
      anyOf: readonly IntegrationFormConnectionMethodSetupCompletionRequirementLeaf[];
      kind: "any-of";
    }
  | {
      allOf: readonly IntegrationFormConnectionMethodSetupCompletionRequirementLeaf[];
      kind: "all-of";
    };

type IntegrationConnectionMethodDefinitionBase<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TBindingConfig = Record<string, unknown>,
  TConnectionConfig = Record<string, unknown>,
> = {
  connectionDetail?: IntegrationConnectionMethodDetailMetadata;
  id: IntegrationConnectionMethodId;
  label: string;
  configSchema?: IntegrationConfigSchema<TConnectionConfig>;
  configForm?: IntegrationFormDefinition<
    TTargetConfig,
    TTargetSecrets,
    TBindingConfig,
    TConnectionConfig
  >;
};

export type IntegrationFormConnectionMethodDefinition<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TBindingConfig = Record<string, unknown>,
  TConnectionConfig = Record<string, unknown>,
> = IntegrationConnectionMethodDefinitionBase<
  TTargetConfig,
  TTargetSecrets,
  TBindingConfig,
  TConnectionConfig
> & {
  kind: "form";
  createBehavior?: IntegrationFormConnectionMethodCreateBehavior;
  postCreate?: IntegrationFormConnectionMethodPostCreateMetadata;
  setupFlow?: IntegrationFormConnectionMethodSetupFlow;
  secretFields: ReadonlyArray<IntegrationConnectionMethodSecretField>;
  ui?: {
    create?: IntegrationConnectionMethodCreateUi;
  };
};

export type IntegrationRedirectConnectionMethodDefinition<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TBindingConfig = Record<string, unknown>,
  TConnectionConfig = Record<string, unknown>,
> = IntegrationConnectionMethodDefinitionBase<
  TTargetConfig,
  TTargetSecrets,
  TBindingConfig,
  TConnectionConfig
> & {
  kind: "redirect";
  secretFields?: never;
  startConfigSchema?: IntegrationConfigSchema<Record<string, unknown>>;
  startConfigForm?: IntegrationFormDefinition<
    TTargetConfig,
    TTargetSecrets,
    TBindingConfig,
    Record<string, unknown>
  >;
  ui: {
    create: IntegrationConnectionMethodCreateUi;
    reauthorize?: IntegrationConnectionMethodReauthorizeUi;
  };
};

export type IntegrationDeviceAuthorizationConnectionMethodDefinition<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TBindingConfig = Record<string, unknown>,
  TConnectionConfig = Record<string, unknown>,
> = IntegrationConnectionMethodDefinitionBase<
  TTargetConfig,
  TTargetSecrets,
  TBindingConfig,
  TConnectionConfig
> & {
  kind: "device-authorization";
  secretFields?: never;
  ui: {
    create: IntegrationDeviceAuthorizationConnectionMethodCreateUi;
    pending?: IntegrationConnectionMethodPendingUi;
  };
};

export type IntegrationConnectionMethodDefinition<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TBindingConfig = Record<string, unknown>,
  TConnectionConfig = Record<string, unknown>,
> =
  | IntegrationFormConnectionMethodDefinition<
      TTargetConfig,
      TTargetSecrets,
      TBindingConfig,
      TConnectionConfig
    >
  | IntegrationRedirectConnectionMethodDefinition<
      TTargetConfig,
      TTargetSecrets,
      TBindingConfig,
      TConnectionConfig
    >
  | IntegrationDeviceAuthorizationConnectionMethodDefinition<
      TTargetConfig,
      TTargetSecrets,
      TBindingConfig,
      TConnectionConfig
    >;

type MaybePromise<TValue> = TValue | Promise<TValue>;

export type ProxyRequestContext = {
  sandboxInstanceId: string;
  sessionUrl: string;
};

export type ProxyMutableRequest = {
  method: string;
  url: URL;
  headers: Headers;
  body: Uint8Array | undefined;
};

export type IntegrationEgressRequestMiddleware = {
  id: string;
  handle(input: {
    ctx: ProxyRequestContext;
    request: ProxyMutableRequest;
  }): MaybePromise<ProxyMutableRequest>;
};

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
  kind: "integration";
  bindingId: string;
  connectionId: string;
  targetKey: string;
  familyId: string;
  variantId: string;
};

export type MistleMcpServerSource = {
  kind: "mistle";
};

export type ResolvedIntegrationMcpServerSource =
  | IntegrationBindingMcpServerSource
  | MistleMcpServerSource;

export type IntegrationBindingMcpServer = {
  source: IntegrationBindingMcpServerSource;
  server: IntegrationMcpServer;
};

export type ResolvedIntegrationMcpServer = {
  source: ResolvedIntegrationMcpServerSource;
  server: Omit<IntegrationMcpServer, "url" | "env" | "httpHeaders"> & {
    url?: string;
    env?: Readonly<Record<string, string>>;
    httpHeaders?: Readonly<Record<string, string>>;
  };
};

export type SandboxPathRefs = {
  // The interactive sandbox session runs as root, so home-scoped config and the
  // default shell cwd both live under /root.
  userHomeDir: string;
  // Integrations clone repositories and materialize project files under this
  // workspace root. The current sandbox contract intentionally points this at the
  // same path as userHomeDir so the session behaves like a conventional root-owned VM.
  workspaceDir: string;
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
  connection: IntegrationConnection & {
    secrets?: Record<string, string>;
  };
  binding?: Pick<IntegrationBinding, "id" | "kind"> & { config: Record<string, unknown> };
  secretType: string;
  slotKey?: string;
};

export type IntegrationCredentialResolverValueResult = {
  kind: "value";
  value: string;
  expiresAt?: string | undefined;
};

export type IntegrationCredentialResolverAwsSessionResult = {
  kind: "aws_session";
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiresAt: string;
};

export type IntegrationCredentialResolverResult =
  | IntegrationCredentialResolverValueResult
  | IntegrationCredentialResolverAwsSessionResult;

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
  slotKey: string;
  secretType: string;
  plaintext: string;
  metadata?: Record<string, unknown>;
  expiresAt?: string;
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

export type IntegrationDeviceAuthorizationStartInput<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
> = {
  organizationId: string;
  targetKey: string;
  target: IntegrationResolvedTarget<TTargetConfig, TTargetSecrets>;
  methodId: IntegrationConnectionMethodId;
  displayName?: string;
};

export type IntegrationDeviceAuthorizationStartResult = {
  verificationUrl: string;
  userCode: string;
  verificationUrlComplete?: string;
  expiresAt?: string;
  pollAfterMs?: number;
  providerState: Record<string, unknown>;
};

export type IntegrationDeviceAuthorizationPollInput<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
> = {
  organizationId: string;
  targetKey: string;
  target: IntegrationResolvedTarget<TTargetConfig, TTargetSecrets>;
  methodId: IntegrationConnectionMethodId;
  providerState: Record<string, unknown>;
};

export type IntegrationDeviceAuthorizationPollResult<TConnectionConfig = Record<string, unknown>> =
  | {
      status: "pending";
      providerState: Record<string, unknown>;
      expiresAt?: string;
      pollAfterMs?: number;
    }
  | {
      status: "completed";
      externalSubjectId?: string;
      connectionConfig: TConnectionConfig;
      accessToken: string;
      accessTokenExpiresAt?: string;
      refreshToken: string;
      refreshTokenExpiresAt?: string;
      credentialMetadata?: Record<string, unknown>;
    }
  | {
      status: "failed";
      code: string;
      message: string;
      permanent: boolean;
    };

export type IntegrationDeviceAuthorizationCancelInput<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
> = {
  organizationId: string;
  targetKey: string;
  target: IntegrationResolvedTarget<TTargetConfig, TTargetSecrets>;
  methodId: IntegrationConnectionMethodId;
  providerState: Record<string, unknown>;
};

export type IntegrationDeviceAuthorizationCapability<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TConnectionConfig = Record<string, unknown>,
> = {
  startDeviceAuthorization(
    input: IntegrationDeviceAuthorizationStartInput<TTargetConfig, TTargetSecrets>,
  ): MaybePromise<IntegrationDeviceAuthorizationStartResult>;
  pollDeviceAuthorization(
    input: IntegrationDeviceAuthorizationPollInput<TTargetConfig, TTargetSecrets>,
  ): MaybePromise<IntegrationDeviceAuthorizationPollResult<TConnectionConfig>>;
  cancelDeviceAuthorization?(
    input: IntegrationDeviceAuthorizationCancelInput<TTargetConfig, TTargetSecrets>,
  ): MaybePromise<void>;
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

export type IntegrationOAuth2AuthorizationCodeStartAuthorizationInput<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
> = {
  organizationId: string;
  targetKey: string;
  target: IntegrationResolvedTarget<TTargetConfig, TTargetSecrets>;
  connectionConfig: Record<string, unknown>;
  state: string;
  redirectUrl: string;
  pkce?: {
    challenge: string;
    challengeMethod: "S256";
  };
};

export type IntegrationOAuth2AuthorizationCodeStartAuthorizationResult = {
  authorizationUrl: string;
  providerState?: Record<string, unknown>;
};

export type IntegrationOAuth2AuthorizationCodeCompleteGrantInput<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
> = {
  organizationId: string;
  targetKey: string;
  target: IntegrationResolvedTarget<TTargetConfig, TTargetSecrets>;
  query: URLSearchParams;
  redirectUrl: string;
  pkceVerifier?: string;
  providerState?: Record<string, unknown>;
};

export type IntegrationOAuth2AuthorizationCodeCompleteGrantResult = {
  externalSubjectId?: string;
  connectionConfig: Record<string, unknown>;
  accessToken: string;
  accessTokenExpiresAt?: string;
  refreshToken?: string;
  refreshTokenExpiresAt?: string;
  clientSecret?: string;
  credentialMetadata?: Record<string, unknown>;
};

export type IntegrationOAuth2AuthorizationCodeRefreshAccessTokenInput<
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
  clientSecret?: string;
};

export type IntegrationOAuth2AuthorizationCodeRefreshAccessTokenResult = {
  accessToken: string;
  accessTokenExpiresAt?: string;
  refreshToken?: string;
  refreshTokenExpiresAt?: string;
  credentialMetadata?: Record<string, unknown>;
};

export type IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassification =
  | "temporary"
  | "permanent";

export const IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications: {
  TEMPORARY: IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassification;
  PERMANENT: IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassification;
} = {
  TEMPORARY: "temporary",
  PERMANENT: "permanent",
};

export class IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError extends Error {
  readonly classification: IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassification;
  readonly code: string | undefined;

  constructor(input: {
    message: string;
    classification: IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassification;
    code?: string;
  }) {
    super(input.message);
    this.name = "IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError";
    this.classification = input.classification;
    this.code = input.code;
  }
}

export type IntegrationOAuth2AuthorizationCodeCapability<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TConnectionConfig = Record<string, unknown>,
> = {
  startAuthorization(
    input: IntegrationOAuth2AuthorizationCodeStartAuthorizationInput<TTargetConfig, TTargetSecrets>,
  ): MaybePromise<IntegrationOAuth2AuthorizationCodeStartAuthorizationResult>;
  completeAuthorizationCodeGrant(
    input: IntegrationOAuth2AuthorizationCodeCompleteGrantInput<TTargetConfig, TTargetSecrets>,
  ): MaybePromise<IntegrationOAuth2AuthorizationCodeCompleteGrantResult>;
  refreshAccessToken(
    input: IntegrationOAuth2AuthorizationCodeRefreshAccessTokenInput<
      TTargetConfig,
      TTargetSecrets,
      TConnectionConfig
    >,
  ): MaybePromise<IntegrationOAuth2AuthorizationCodeRefreshAccessTokenResult>;
};

export type IntegrationOAuth2ClientCredentialsExchangeInput<
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
  clientSecret: string;
};

export type IntegrationOAuth2ClientCredentialsExchangeResult = {
  accessToken: string;
  accessTokenExpiresAt?: string;
  credentialMetadata?: Record<string, unknown>;
};

export type IntegrationOAuth2ClientCredentialsCapability<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TConnectionConfig = Record<string, unknown>,
> = {
  exchangeClientCredentials(
    input: IntegrationOAuth2ClientCredentialsExchangeInput<
      TTargetConfig,
      TTargetSecrets,
      TConnectionConfig
    >,
  ): MaybePromise<IntegrationOAuth2ClientCredentialsExchangeResult>;
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
  webhookSourceSecrets: Record<string, string>;
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

export type IntegrationWebhookEnrichEventInput<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TConnectionSecrets = Record<string, string>,
> = {
  targetKey: string;
  target: IntegrationResolvedTarget<TTargetConfig, TTargetSecrets>;
  event: IntegrationWebhookEvent;
  connection: IntegrationConnection;
  connectionSecrets: TConnectionSecrets;
  webhookSourceSecrets: Record<string, string>;
  headers: IntegrationWebhookHeaders;
  rawBody: Uint8Array;
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
      verification: "skip";
      response: IntegrationWebhookImmediateResponse;
    }
  | {
      kind: "response";
      verification: "required";
      event: IntegrationWebhookEvent;
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
  enrichEvent?(
    input: IntegrationWebhookEnrichEventInput<TTargetConfig, TTargetSecrets, TConnectionSecrets>,
  ): MaybePromise<IntegrationWebhookEvent>;
};

export type IntegrationConnectionEgressCredentialResolverRef = {
  kind: "integration_connection";
  connectionId: string;
  secretType: string;
  slotKey?: string;
  resolverKey?: string;
};

export type LinkedPrincipalEgressCredentialResolutionMode = "required" | "preferred";

export type LinkedPrincipalEgressCredentialResolverRef = {
  kind: "linked_principal";
  providerFamily: string;
  credentialKind?: string;
  actingUserRequired: boolean;
  resolutionMode: LinkedPrincipalEgressCredentialResolutionMode;
};

export type EgressCredentialResolverRef =
  | IntegrationConnectionEgressCredentialResolverRef
  | LinkedPrincipalEgressCredentialResolverRef;

export type IntegrationEgressCredentialResolverSelectionInput = {
  organizationId: string;
  actingUserId?: string;
  request: ProxyMutableRequest;
  defaultCredentialResolver: EgressCredentialResolverRef;
};

export type EgressCredentialHeaderInjection = {
  header: string;
  credentialResolver: EgressCredentialResolverRef;
};

export type EgressCredentialRoute = {
  egressRuleId: string;
  bindingId: string;
  familyId: string;
  variantId: string;
  match: {
    hosts: ReadonlyArray<string>;
    pathPrefixes?: ReadonlyArray<string>;
    methods?: ReadonlyArray<string>;
  };
  upstream: {
    baseUrl: string;
  };
  authInjection:
    | {
        type: "bearer";
        target: string;
      }
    | {
        type: "basic";
        target: string;
        /**
         * Optional fixed username used when the upstream expects Basic auth in the
         * form of username:secret rather than just a secret value.
         */
        username?: string;
      }
    | {
        type: "header";
        target: string;
      }
    | {
        type: "query";
        target: string;
      }
    | {
        type: "aws_sigv4";
        service: string;
        region: string;
      };
  additionalHeaders?: Readonly<Record<string, string>>;
  additionalCredentialHeaders?: ReadonlyArray<EgressCredentialHeaderInjection>;
  credentialResolver: EgressCredentialResolverRef;
  requestMiddleware?: ReadonlyArray<string>;
};

export type RuntimeExecCommand = {
  args: ReadonlyArray<string>;
  env?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
};

export type RuntimeArtifactGitHubReleaseSelector =
  | {
      kind: "latest";
    }
  | {
      kind: "tag";
      match: "exact";
      tag: string;
    }
  /**
   * Avoid using `latest_matching_prefix` for sandbox-startup installs.
   *
   * It requires live upstream release discovery during sandbox initialization,
   * which is sensitive to provider rate limits and upstream availability.
   * Prefer exact pinned tags whenever possible.
   */
  | {
      kind: "tag";
      match: "latest_matching_prefix";
      prefix: string;
    };

export type RuntimeArtifactGitHubReleaseInstallAssetShape =
  | {
      fileName: string;
      format: "binary";
      sha256?: string;
    }
  | {
      fileName: string;
      format: "tar.gz";
      extractedPath: string;
      sha256?: string;
    };

export type RuntimeArtifactGitHubReleaseInstallAsset =
  | ({
      kind: "exact";
    } & RuntimeArtifactGitHubReleaseInstallAssetShape)
  | {
      kind: "by_arch";
      x86_64: RuntimeArtifactGitHubReleaseInstallAssetShape;
      aarch64: RuntimeArtifactGitHubReleaseInstallAssetShape;
    };

export type RuntimeArtifactGitHubReleaseInstallStepInput = {
  repository: string;
  release: RuntimeArtifactGitHubReleaseSelector;
  asset: RuntimeArtifactGitHubReleaseInstallAsset;
  installPath: string;
  timeoutMs?: number;
};

export type RuntimeArtifactGitHubReleaseInstallHelperAssetShape =
  | {
      fileName: string;
      format: "binary";
      sha256?: string;
    }
  | {
      fileName: string;
      format: "tar.gz";
      extractedPath: string;
      sha256?: string;
    };

export type RuntimeArtifactGitHubReleaseInstallHelperAsset =
  | ({
      kind: "exact";
    } & RuntimeArtifactGitHubReleaseInstallHelperAssetShape)
  | {
      kind: "by_arch";
      x86_64: RuntimeArtifactGitHubReleaseInstallHelperAssetShape;
      aarch64: RuntimeArtifactGitHubReleaseInstallHelperAssetShape;
    };

export type RuntimeArtifactGitHubReleaseInstallHelperInput = {
  repository: string;
  release: RuntimeArtifactGitHubReleaseSelector;
  asset: RuntimeArtifactGitHubReleaseInstallHelperAsset;
  installPath: string;
  timeoutMs?: number;
};

export type RuntimeArtifactInstallStep =
  | ({
      op: "github_release_install";
    } & RuntimeArtifactGitHubReleaseInstallStepInput)
  | {
      op: "mise_install";
      tools: ReadonlyArray<string>;
      force?: boolean;
      timeoutMs?: number;
    }
  | {
      op: "exec";
      command: RuntimeExecCommand;
    };

export type RuntimeArtifactRefs = {
  command: {
    exec(input: RuntimeExecCommand): RuntimeArtifactInstallStep;
  };
  sandboxPaths: SandboxPathRefs;
  artifactBinPath(name: string): string;
  mise: {
    install(input: {
      tools: ReadonlyArray<string>;
      force?: boolean;
      timeoutMs?: number;
    }): RuntimeArtifactInstallStep;
  };
  githubReleases: {
    install(input: RuntimeArtifactGitHubReleaseInstallHelperInput): RuntimeArtifactInstallStep;
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
}) => ReadonlyArray<RuntimeArtifactInstallStep>;

type RuntimeArtifactLifecycle<THook> = {
  install: THook;
};

export type RuntimeArtifactSpec = {
  artifactKey: string;
  name: string;
  description?: string;
  env?: Readonly<Record<string, string>>;
  lifecycle: RuntimeArtifactLifecycle<
    ReadonlyArray<RuntimeArtifactInstallStep> | RuntimeArtifactLifecycleBuilder
  >;
};

export type CompiledRuntimeArtifactSpec = {
  artifactKey: string;
  name: string;
  description?: string;
  env?: Readonly<Record<string, string>>;
  lifecycle: RuntimeArtifactLifecycle<ReadonlyArray<RuntimeArtifactInstallStep>>;
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
  command: RuntimeExecCommand;
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

export type CompileBindingEgressRoute = Omit<
  EgressCredentialRoute,
  "egressRuleId" | "bindingId" | "familyId" | "variantId"
>;

export type CompiledAgentRuntime = {
  runtimeId: string;
  runtimeKey: string;
  clientId: string;
  endpointKey: string;
  ptyLaunch: AgentPtyLaunchSpec;
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
  agentRuntimes?: ReadonlyArray<CompiledAgentRuntime>;
};

export type CompiledRuntimePlanFragment = {
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

/**
 * Metadata shown to users when configuring webhook triggers.
 *
 * `path` is the JSON path within the provider payload that the UI should
 * surface as useful context for previewing or filtering the event.
 */
export type IntegrationWebhookPayloadReference = {
  path: ReadonlyArray<string>;
  description: string;
};

/**
 * Provider-defined filter controls that the dashboard can render for a
 * supported webhook event.
 */
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
      matchMode?: "eq" | "contains" | "contains_token" | undefined;
      defaultValue?: string | undefined;
      defaultEnabled?: boolean | undefined;
      controlVariant?: "invocation-token" | undefined;
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

export type IntegrationWebhookTriggerProviderPermissionRequirement = {
  permission: string;
  access?: string | undefined;
};

export type IntegrationWebhookTriggerRequirementSet = {
  label?: string | undefined;
  event?: string | undefined;
  permissions?: ReadonlyArray<IntegrationWebhookTriggerProviderPermissionRequirement> | undefined;
};

export type IntegrationWebhookTriggerRequirements = {
  anyOf: ReadonlyArray<IntegrationWebhookTriggerRequirementSet>;
};

export const IntegrationWebhookTriggerCapabilitiesProviderMetadataKey =
  "webhookTriggerCapabilities";

export type IntegrationWebhookTriggerCapabilities = {
  events?: ReadonlyArray<string> | undefined;
  permissions?: ReadonlyArray<IntegrationWebhookTriggerProviderPermissionRequirement> | undefined;
};

/**
 * A normalized webhook event that an integration exposes to the rest of
 * Mistle. These definitions drive trigger event pickers, payload previews,
 * conversation-key selection, and provider-specific trigger parameter UIs.
 */
export type IntegrationWebhookEventDefinition = {
  /**
   * Canonical Mistle event type stored on webhook triggers and emitted by
   * webhook handlers, for example `github.issue_comment.created`.
   */
  eventType: string;
  /**
   * Raw provider event discriminator used during ingest or registration, for
   * example GitHub's `issue_comment` or Jira's `jira:issue_updated`.
   */
  providerEventType: string;
  /** Human-readable label shown in trigger UIs. */
  displayName: string;
  /** Optional top-level UI category for grouping related events. */
  category?: string | undefined;
  payloadReferences?: ReadonlyArray<IntegrationWebhookPayloadReference> | undefined;
  conversationKeyOptions?:
    | ReadonlyArray<{
        id: string;
        label: string;
        description: string;
        template: string;
      }>
    | undefined;
  parameters?: ReadonlyArray<IntegrationWebhookEventParameterDefinition> | undefined;
  requirements?: IntegrationWebhookTriggerRequirements | undefined;
};

/**
 * Describes who creates and tears down the provider-side registration.
 *
 * `implicit` means no per-source provider API lifecycle is required at runtime.
 * The source still exists locally as the canonical source-of-truth record.
 *
 * `managed` means control-plane is expected to create/update/delete the remote
 * provider registration through the integration definition hooks below.
 */
export type IntegrationWebhookSourceLifecycle = "implicit" | "managed";

export const IntegrationWebhookSourceLifecycles: {
  IMPLICIT: IntegrationWebhookSourceLifecycle;
  MANAGED: IntegrationWebhookSourceLifecycle;
} = {
  IMPLICIT: "implicit",
  MANAGED: "managed",
};

/**
 * Provider-rendered description of a webhook source as it should appear in the
 * dashboard or APIs. This is the display-facing view of a persisted source row.
 */
export type IntegrationWebhookSourceDescriptor = {
  /** User-facing source name, for example "GitHub App webhook". */
  displayName: string;
  /** Public callback URL that the provider is expected to call, if applicable. */
  callbackUrl?: string | undefined;
  /** Provider-specific metadata that higher layers may expose for debugging/UI. */
  providerMetadata: Record<string, unknown>;
};

export type IntegrationWebhookTriggerCapabilitiesRefreshUiField = {
  actions?: ReadonlyArray<IntegrationFormConnectionMethodSetupStartFormAction> | undefined;
  description?: string | undefined;
  inputType: "password" | "text" | "textarea";
  label: string;
  name: string;
  placeholder?: string | undefined;
  required?: boolean | undefined;
};

export type IntegrationWebhookTriggerCapabilitiesRefreshUi = {
  actionLabel: string;
  pendingLabel: string;
  disabledWhen?:
    | {
        missingConnectionConfigField: string;
        message: string;
      }
    | undefined;
  bodyForm?:
    | {
        fields: ReadonlyArray<IntegrationWebhookTriggerCapabilitiesRefreshUiField>;
        submitLabel: string;
        title: string;
      }
    | undefined;
};

/**
 * Persisted local source-of-truth record for one inbound webhook source.
 *
 * This record exists regardless of whether the provider uses implicit
 * app-managed webhooks or explicit managed registrations.
 */
export type IntegrationWebhookSource = {
  id: string;
  /** Integration target that owns the source. */
  targetKey: string;
  /** Organization that owns the source. */
  organizationId: string;
  /** Connection owner for the source. */
  integrationConnectionId: string;
  /** Optional persisted display name override chosen by Mistle or the provider. */
  displayName?: string | undefined;
  /** Unique public path token used by the public webhook URL. */
  endpointKey: string;
  /** Remote provider registration identifier when the provider returns one. */
  remoteRegistrationId?: string | undefined;
  /** Provider-specific persisted reconciliation state. */
  providerMetadata: Record<string, unknown>;
};

/**
 * Context supplied to `describeSource`, which converts a persisted source row
 * into a UI/API descriptor.
 */
export type IntegrationWebhookSourceDescribeInput<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TConnectionConfig = Record<string, unknown>,
> = {
  organizationId: string;
  targetKey: string;
  controlPlaneBaseUrl: string;
  target: IntegrationResolvedTarget<TTargetConfig, TTargetSecrets>;
  connection: IntegrationConnection & {
    config: TConnectionConfig;
  };
  source: IntegrationWebhookSource;
};

/**
 * Shared input for managed provider registration hooks.
 *
 * The control-plane service owns local persistence, secret generation, and
 * dependency checks. These hooks are only responsible for provider-side
 * registration lifecycle work.
 */
export type IntegrationWebhookSourceRegistrationInput<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TConnectionConfig = Record<string, unknown>,
> = {
  organizationId: string;
  targetKey: string;
  controlPlaneBaseUrl: string;
  target: IntegrationResolvedTarget<TTargetConfig, TTargetSecrets>;
  connection: IntegrationConnection & {
    config: TConnectionConfig;
  };
  connectionSecrets?: Record<string, string> | undefined;
  source: IntegrationWebhookSource;
  /** Decrypted webhook secret to register with the provider when required. */
  webhookSecret?: string | undefined;
};

export type IntegrationWebhookSourceTriggerCapabilitiesRefreshInput<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TConnectionConfig = Record<string, unknown>,
> = {
  organizationId: string;
  targetKey: string;
  controlPlaneBaseUrl: string;
  target: IntegrationResolvedTarget<TTargetConfig, TTargetSecrets>;
  connection: IntegrationConnection & {
    config: TConnectionConfig;
  };
  connectionSecrets?: Record<string, string> | undefined;
  source: IntegrationWebhookSource;
  body: unknown;
};

/**
 * Provider-side reconciliation data returned from create/update registration
 * hooks. Local persistence is handled by control-plane after the hook returns.
 */
export type IntegrationWebhookSourceRegistrationResult = {
  remoteRegistrationId?: string | undefined;
  providerMetadata?: Record<string, unknown> | undefined;
};

/**
 * Optional capability for integrations that support inbound webhook sources in
 * addition to the existing runtime `webhookHandler`.
 *
 * `webhookHandler` answers "a request arrived; how do I parse and verify it?"
 * `webhookSource` answers "what source rows exist, who owns them, and how are
 * their provider registrations described or reconciled?"
 */
export type IntegrationWebhookSourceCapability<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TConnectionConfig = Record<string, unknown>,
> = {
  /** Whether provider registration is implicit or managed. */
  lifecycle: IntegrationWebhookSourceLifecycle;
  /**
   * Optional connection-level support gate. When omitted, the source is
   * treated as supported for every connection of the definition.
   */
  supportsConnection?(input: {
    connection: IntegrationConnection & {
      config: TConnectionConfig;
    };
  }): MaybePromise<boolean>;
  /** Returns the UI/API-facing description of a persisted source row. */
  describeSource(
    input: IntegrationWebhookSourceDescribeInput<TTargetConfig, TTargetSecrets, TConnectionConfig>,
  ): MaybePromise<IntegrationWebhookSourceDescriptor>;
  /** Creates the remote/provider registration for a new source when needed. */
  createRegistration?(
    input: IntegrationWebhookSourceRegistrationInput<
      TTargetConfig,
      TTargetSecrets,
      TConnectionConfig
    >,
  ): MaybePromise<IntegrationWebhookSourceRegistrationResult>;
  /** Reconciles provider-side registration state for an existing source. */
  updateRegistration?(
    input: IntegrationWebhookSourceRegistrationInput<
      TTargetConfig,
      TTargetSecrets,
      TConnectionConfig
    >,
  ): MaybePromise<IntegrationWebhookSourceRegistrationResult>;
  /**
   * Refreshes trigger capability metadata from a provider-owned source of truth.
   *
   * Implementations must only return capabilities that were verified directly
   * from the provider. This hook must not infer or guess enabled provider events.
   */
  refreshTriggerCapabilities?(
    input: IntegrationWebhookSourceTriggerCapabilitiesRefreshInput<
      TTargetConfig,
      TTargetSecrets,
      TConnectionConfig
    >,
  ): MaybePromise<IntegrationWebhookSourceRegistrationResult>;
  /** Tears down only the remote/provider registration for a source. */
  deleteRegistration?(
    input: IntegrationWebhookSourceRegistrationInput<
      TTargetConfig,
      TTargetSecrets,
      TConnectionConfig
    >,
  ): MaybePromise<void>;
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
  displayName: string;
  description?: string;
  logoKey: string;
  sandboxRuntime?: IntegrationSandboxRuntimeDefinition;
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
  allowedRuntimeIds?: ReadonlyArray<string>;
  connectionMethods: ReadonlyArray<
    IntegrationConnectionMethodDefinition<
      ParsedSchemaOutput<TTargetConfigSchema>,
      ParsedSchemaOutput<TTargetSecretsSchema>,
      ParsedSchemaOutput<TBindingConfigSchema>,
      TConnectionConfig
    >
  >;
  identityLinking?: IntegrationIdentityLinkingCapability<
    ParsedSchemaOutput<TTargetConfigSchema>,
    ParsedSchemaOutput<TTargetSecretsSchema>,
    TConnectionConfig
  >;
  credentialResolvers?: IntegrationCredentialResolvers;
  oauth2AuthorizationCode?: IntegrationOAuth2AuthorizationCodeCapability<
    ParsedSchemaOutput<TTargetConfigSchema>,
    ParsedSchemaOutput<TTargetSecretsSchema>,
    TConnectionConfig
  >;
  oauth2ClientCredentials?: IntegrationOAuth2ClientCredentialsCapability<
    ParsedSchemaOutput<TTargetConfigSchema>,
    ParsedSchemaOutput<TTargetSecretsSchema>,
    TConnectionConfig
  >;
  deviceAuthorization?: IntegrationDeviceAuthorizationCapability<
    ParsedSchemaOutput<TTargetConfigSchema>,
    ParsedSchemaOutput<TTargetSecretsSchema>,
    TConnectionConfig
  >;
  providerAppSetup?: IntegrationProviderAppSetupCapability<
    ParsedSchemaOutput<TTargetConfigSchema>,
    ParsedSchemaOutput<TTargetSecretsSchema>,
    TConnectionConfig
  >;
  redirectHandler?: IntegrationRedirectHandler<
    ParsedSchemaOutput<TTargetConfigSchema>,
    ParsedSchemaOutput<TTargetSecretsSchema>
  >;
  /**
   * Provider-advertised webhook events that can be selected by webhook
   * triggers and emitted by `webhookHandler`.
   */
  supportedWebhookEvents?: ReadonlyArray<IntegrationWebhookEventDefinition>;
  webhookHandler?: IntegrationWebhookHandler<
    ParsedSchemaOutput<TTargetConfigSchema>,
    ParsedSchemaOutput<TTargetSecretsSchema>,
    Record<string, string>
  >;
  /**
   * Optional inbound webhook-source contract for integrations that need an
   * explicit source-of-truth record and, optionally, provider registration
   * lifecycle hooks.
   */
  webhookSource?: IntegrationWebhookSourceCapability<
    ParsedSchemaOutput<TTargetConfigSchema>,
    ParsedSchemaOutput<TTargetSecretsSchema>,
    TConnectionConfig
  >;
  webhookTriggerCapabilitiesRefreshUi?: IntegrationWebhookTriggerCapabilitiesRefreshUi | undefined;
  resourceDefinitions?: ReadonlyArray<IntegrationResourceDefinition>;
  resourceSyncTriggers?: ReadonlyArray<IntegrationResourceSyncTrigger>;
  egressRequestMiddleware?: ReadonlyArray<IntegrationEgressRequestMiddleware>;
  resolveEgressCredentialResolver?(
    input: IntegrationEgressCredentialResolverSelectionInput,
  ): MaybePromise<EgressCredentialResolverRef>;
  capabilities?: IntegrationCapabilityContributor<
    ParsedSchemaOutput<TTargetConfigSchema>,
    ParsedSchemaOutput<TBindingConfigSchema>,
    ParsedSchemaOutput<TTargetSecretsSchema>
  >;
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

export type IntegrationCapabilityContributor<
  TTargetConfig = Record<string, unknown>,
  TBindingConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
> = {
  resolveCapabilities(
    input: CompileBindingInput<TTargetConfig, TBindingConfig, TTargetSecrets>,
  ): ConnectionCapabilitySet;
};

export type IntegrationBrowserSafeFormConnectionMethodDefinition<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TBindingConfig = Record<string, unknown>,
  TConnectionConfig = Record<string, unknown>,
> = Omit<
  IntegrationFormConnectionMethodDefinition<
    TTargetConfig,
    TTargetSecrets,
    TBindingConfig,
    TConnectionConfig
  >,
  "configSchema" | "secretFields"
> & {
  configSchema?: IntegrationConfigSchema<Record<string, unknown>>;
  secretFields: ReadonlyArray<IntegrationBrowserSafeConnectionMethodSecretField>;
};

export type IntegrationBrowserSafeRedirectConnectionMethodDefinition<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TBindingConfig = Record<string, unknown>,
  TConnectionConfig = Record<string, unknown>,
> = Omit<
  IntegrationRedirectConnectionMethodDefinition<
    TTargetConfig,
    TTargetSecrets,
    TBindingConfig,
    TConnectionConfig
  >,
  "configSchema" | "startConfigSchema"
> & {
  configSchema?: IntegrationConfigSchema<Record<string, unknown>>;
  startConfigSchema?: IntegrationConfigSchema<Record<string, unknown>>;
};

export type IntegrationBrowserSafeDeviceAuthorizationConnectionMethodDefinition<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TBindingConfig = Record<string, unknown>,
  TConnectionConfig = Record<string, unknown>,
> = Omit<
  IntegrationDeviceAuthorizationConnectionMethodDefinition<
    TTargetConfig,
    TTargetSecrets,
    TBindingConfig,
    TConnectionConfig
  >,
  "configSchema"
> & {
  configSchema?: IntegrationConfigSchema<Record<string, unknown>>;
};

export type IntegrationBrowserSafeConnectionMethodDefinition<
  TTargetConfig = Record<string, unknown>,
  TTargetSecrets = Record<string, string>,
  TBindingConfig = Record<string, unknown>,
  TConnectionConfig = Record<string, unknown>,
> =
  | IntegrationBrowserSafeFormConnectionMethodDefinition<
      TTargetConfig,
      TTargetSecrets,
      TBindingConfig,
      TConnectionConfig
    >
  | IntegrationBrowserSafeRedirectConnectionMethodDefinition<
      TTargetConfig,
      TTargetSecrets,
      TBindingConfig,
      TConnectionConfig
    >
  | IntegrationBrowserSafeDeviceAuthorizationConnectionMethodDefinition<
      TTargetConfig,
      TTargetSecrets,
      TBindingConfig,
      TConnectionConfig
    >;

export type TriggerFilter =
  | { op: "all"; filters: ReadonlyArray<TriggerFilter> }
  | { op: "any"; filters: ReadonlyArray<TriggerFilter> }
  | { op: "not"; filter: TriggerFilter }
  | { op: "eq"; path: string; value: string | number | boolean }
  | { op: "in"; path: string; values: ReadonlyArray<string | number> }
  | { op: "contains"; path: string; value: string }
  | { op: "containsToken"; path: string; value: string }
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
  SNAPSHOT: "snapshot",
} as const;

export type SandboxImageSource = (typeof SandboxImageSources)[keyof typeof SandboxImageSources];

export type ResolvedSandboxImage =
  | {
      source: typeof SandboxImageSources.BASE;
      imageRef: string;
    }
  | {
      source: typeof SandboxImageSources.SNAPSHOT;
      imageRef: string;
    };

export type CompiledRuntimePlan = {
  sandboxProfileId: string;
  version: number;
  image: ResolvedSandboxImage;
  setupScript?: string;
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

export type IntegrationDefinitionsBundle = {
  integrationRegistry: IntegrationRegistry;
  agentRuntimeRegistry: AgentRuntimeRegistry;
};

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
  agentRuntimeId: string;
  bindings: ReadonlyArray<CompileRuntimePlanBindingInput>;
  mcpServers?: ReadonlyArray<ResolvedIntegrationMcpServer>;
  definitions: IntegrationDefinitionsBundle;
};
