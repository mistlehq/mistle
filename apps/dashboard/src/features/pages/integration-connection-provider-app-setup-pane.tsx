import type {
  IntegrationFormConnectionMethodSetupExistingAppConfigFieldInstructions,
  IntegrationFormConnectionMethodSetupExistingAppSecretFieldInstructions,
  IntegrationFormConnectionMethodSetupInstructions,
  IntegrationFormConnectionMethodSetupStartForm,
} from "@mistle/integrations-core";
import { Button } from "@mistle/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import type { SavingFieldState } from "../forms/configured-secret-field.js";
import {
  startProviderAppSetup,
  updateFormIntegrationConnection,
} from "../integrations/integrations-service.js";
import type { IntegrationConnection } from "../integrations/integrations-service.js";
import {
  parseManifestJsonObject,
  validateManifestJsonObject,
} from "../integrations/manifest-json-editor.js";
import {
  type ManifestWebhookCallbackState,
  useManifestWebhookCallbackState,
} from "../integrations/manifest-webhook-callback-state.js";
import { FormPageActionBar, FormPageStack } from "../shared/form-page.js";
import { SectionHeader } from "../shared/section-header.js";
import {
  ExistingAppSetupFieldsPanel,
  getSetupFieldState,
  useExistingAppSetupAutoSave,
  useSetupManifestDraft,
} from "./integration-connection-app-setup-shared.js";
import {
  IntegrationConnectionSetupManifestPanel,
  IntegrationConnectionSetupModeTabs,
  IntegrationConnectionSetupWebhookCallbackValue,
  type IntegrationConnectionSetupMode,
  useIntegrationConnectionSetupStartForm,
} from "./integration-connection-setup-flow.js";
import type { IntegrationSetupAppManifestDraftBuilder } from "./integration-connection-setup-manifest-draft.js";
import {
  hasConfiguredSetupSecretField,
  resolveConfiguredSetupSecretFieldKeys,
} from "./integration-connection-setup-secret-fields.js";
import { SETTINGS_INTEGRATIONS_QUERY_KEY } from "./use-integrations-directory-state.js";

type ProviderAppSetupMode = IntegrationConnectionSetupMode;
type ProviderAppSetupFieldKey = string;

function normalizeInputValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function createInitialExistingAppDraft(input: {
  connection: IntegrationConnection;
  setupInstructions: IntegrationFormConnectionMethodSetupInstructions;
}): Record<ProviderAppSetupFieldKey, string> {
  const draft: Record<ProviderAppSetupFieldKey, string> = {};

  for (const field of input.setupInstructions.existingApp.configFields) {
    draft[field.name] = normalizeInputValue(input.connection.config?.[field.configKey]);
  }

  for (const field of input.setupInstructions.existingApp.secretFields) {
    draft[field.name] = "";
  }

  return draft;
}

function resolveExistingAppFieldKeys(
  setupInstructions: IntegrationFormConnectionMethodSetupInstructions,
): readonly ProviderAppSetupFieldKey[] {
  return [
    ...setupInstructions.existingApp.configFields.map((field) => field.name),
    ...setupInstructions.existingApp.secretFields.map((field) => field.name),
  ];
}

function resolveExistingAppConfigFieldKeys(
  setupInstructions: IntegrationFormConnectionMethodSetupInstructions,
): readonly ProviderAppSetupFieldKey[] {
  return setupInstructions.existingApp.configFields.map((field) => field.name);
}

function resolveExistingAppSecretFieldKeys(
  setupInstructions: IntegrationFormConnectionMethodSetupInstructions,
): readonly ProviderAppSetupFieldKey[] {
  return setupInstructions.existingApp.secretFields.map((field) => field.name);
}

function isExistingAppSecretFieldKey(input: {
  fieldKey: ProviderAppSetupFieldKey;
  setupInstructions: IntegrationFormConnectionMethodSetupInstructions;
}): boolean {
  return input.setupInstructions.existingApp.secretFields.some(
    (field) => field.name === input.fieldKey,
  );
}

function resolveConfiguredSecretFieldKeys(input: {
  connection: IntegrationConnection;
  setupInstructions: IntegrationFormConnectionMethodSetupInstructions;
}): ReadonlySet<ProviderAppSetupFieldKey> {
  return resolveConfiguredSetupSecretFieldKeys({
    configuredSecretNames: input.connection.configuredSecretNames,
    fieldKeys: resolveExistingAppSecretFieldKeys(input.setupInstructions),
  });
}

function isProviderAppInstalled(input: {
  connection: IntegrationConnection;
  setupInstructions: IntegrationFormConnectionMethodSetupInstructions;
}): boolean {
  const { installedDetection } = input.setupInstructions.existingApp;
  const configFieldsByName = new Map(
    input.setupInstructions.existingApp.configFields.map((field) => [field.name, field.configKey]),
  );

  return (
    installedDetection.configFields.every((fieldName) => {
      const configKey = configFieldsByName.get(fieldName);
      if (configKey === undefined) {
        throw new Error(
          `Provider app setup instructions do not define config field '${fieldName}'.`,
        );
      }

      return typeof input.connection.config?.[configKey] === "string";
    }) &&
    installedDetection.secretFields.every((fieldName) =>
      hasConfiguredSetupSecretField({
        configuredSecretNames: input.connection.configuredSecretNames,
        fieldName,
      }),
    )
  );
}

function normalizeExistingAppSetupValue(value: string): string {
  return value.trim();
}

function buildExistingAppSetupConfig(input: {
  methodId: string;
  draft: Record<ProviderAppSetupFieldKey, string>;
  setupInstructions: IntegrationFormConnectionMethodSetupInstructions;
}): Record<string, string> {
  const config: Record<string, string> = {
    connection_method: input.methodId,
  };

  for (const field of input.setupInstructions.existingApp.configFields) {
    const value = normalizeExistingAppSetupValue(input.draft[field.name] ?? "");
    if (value.length > 0) {
      config[field.configKey] = value;
    }
  }

  return config;
}

function buildExistingAppSetupSecrets(input: {
  draft: Record<ProviderAppSetupFieldKey, string>;
  fieldKey: ProviderAppSetupFieldKey;
  setupInstructions: IntegrationFormConnectionMethodSetupInstructions;
}): Record<string, string> | undefined {
  if (
    !isExistingAppSecretFieldKey({
      fieldKey: input.fieldKey,
      setupInstructions: input.setupInstructions,
    })
  ) {
    return undefined;
  }

  const value = normalizeExistingAppSetupValue(input.draft[input.fieldKey] ?? "");
  return value.length === 0 ? undefined : { [input.fieldKey]: value };
}

function isExistingAppSetupFieldDirty(input: {
  fieldKey: ProviderAppSetupFieldKey;
  draft: Record<ProviderAppSetupFieldKey, string>;
  savedDraft: Record<ProviderAppSetupFieldKey, string>;
}): boolean {
  return (
    normalizeExistingAppSetupValue(input.draft[input.fieldKey] ?? "") !==
    normalizeExistingAppSetupValue(input.savedDraft[input.fieldKey] ?? "")
  );
}

function isExistingAppFieldStable(input: {
  fieldKey: ProviderAppSetupFieldKey;
  draft: Record<ProviderAppSetupFieldKey, string>;
  savedDraft: Record<ProviderAppSetupFieldKey, string>;
  fieldState: SavingFieldState;
}): boolean {
  return (
    input.fieldState.status !== "saving" &&
    input.fieldState.errorMessage === null &&
    !isExistingAppSetupFieldDirty({
      fieldKey: input.fieldKey,
      draft: input.draft,
      savedDraft: input.savedDraft,
    })
  );
}

function getExistingAppSetupFieldValidationMessage(input: {
  fieldKey: ProviderAppSetupFieldKey;
  draft: Record<ProviderAppSetupFieldKey, string>;
  setupInstructions: IntegrationFormConnectionMethodSetupInstructions;
}): string | null {
  const normalizedValue = normalizeExistingAppSetupValue(input.draft[input.fieldKey] ?? "");
  if (normalizedValue.length > 0) {
    return null;
  }

  const configField = resolveOptionalConfigFieldInstructions({
    fieldKey: input.fieldKey,
    setupInstructions: input.setupInstructions,
  });
  if (configField !== null && configField.required) {
    return `${configField.label} is required.`;
  }

  const secretField = resolveOptionalSecretFieldInstructions({
    fieldKey: input.fieldKey,
    setupInstructions: input.setupInstructions,
  });
  if (secretField !== null && secretField.required) {
    return `${secretField.label} is required.`;
  }

  return null;
}

function shouldPersistExistingAppSetupField(input: {
  fieldKey: ProviderAppSetupFieldKey;
  draft: Record<ProviderAppSetupFieldKey, string>;
  setupInstructions: IntegrationFormConnectionMethodSetupInstructions;
}): boolean {
  if (
    !isExistingAppSecretFieldKey({
      fieldKey: input.fieldKey,
      setupInstructions: input.setupInstructions,
    })
  ) {
    return true;
  }

  return normalizeExistingAppSetupValue(input.draft[input.fieldKey] ?? "").length > 0;
}

function isExistingAppRequiredFieldReady(input: {
  fieldKey: ProviderAppSetupFieldKey;
  draft: Record<ProviderAppSetupFieldKey, string>;
  savedDraft: Record<ProviderAppSetupFieldKey, string>;
  fieldState: SavingFieldState;
  isConfiguredOnServer: boolean;
}): boolean {
  const draftValue = normalizeExistingAppSetupValue(input.draft[input.fieldKey] ?? "");
  const savedValue = normalizeExistingAppSetupValue(input.savedDraft[input.fieldKey] ?? "");

  if (
    input.isConfiguredOnServer &&
    draftValue.length === 0 &&
    savedValue.length === 0 &&
    isExistingAppFieldStable(input)
  ) {
    return true;
  }

  return savedValue.length > 0 && isExistingAppFieldStable(input);
}

function resolveExistingAppSetupSavedFieldKeys(input: {
  fieldKey: ProviderAppSetupFieldKey;
  setupInstructions: IntegrationFormConnectionMethodSetupInstructions;
}): readonly ProviderAppSetupFieldKey[] {
  const configFieldKeys = resolveExistingAppConfigFieldKeys(input.setupInstructions);

  if (
    isExistingAppSecretFieldKey({
      fieldKey: input.fieldKey,
      setupInstructions: input.setupInstructions,
    })
  ) {
    return [...configFieldKeys, input.fieldKey];
  }

  return configFieldKeys;
}

function resolveOptionalConfigFieldInstructions(input: {
  fieldKey: ProviderAppSetupFieldKey;
  setupInstructions: IntegrationFormConnectionMethodSetupInstructions;
}): IntegrationFormConnectionMethodSetupExistingAppConfigFieldInstructions | null {
  return (
    input.setupInstructions.existingApp.configFields.find(
      (candidate) => candidate.name === input.fieldKey,
    ) ?? null
  );
}

function resolveOptionalSecretFieldInstructions(input: {
  fieldKey: ProviderAppSetupFieldKey;
  setupInstructions: IntegrationFormConnectionMethodSetupInstructions;
}): IntegrationFormConnectionMethodSetupExistingAppSecretFieldInstructions | null {
  return (
    input.setupInstructions.existingApp.secretFields.find(
      (candidate) => candidate.name === input.fieldKey,
    ) ?? null
  );
}

function SetupUrls(input: {
  setupInstructions: IntegrationFormConnectionMethodSetupInstructions;
  webhookCallbackState: ManifestWebhookCallbackState;
}): React.JSX.Element {
  const webhookCallbackInstructions = input.setupInstructions.urls.webhookCallback;

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        description={input.setupInstructions.urls.description}
        title={input.setupInstructions.urls.title}
      />
      <div className="flex flex-col gap-4">
        <IntegrationConnectionSetupWebhookCallbackValue
          errorTitle={webhookCallbackInstructions.errorTitle}
          label={webhookCallbackInstructions.label}
          missingMessage={webhookCallbackInstructions.missingMessage}
          missingTitle={webhookCallbackInstructions.missingTitle}
          webhookCallbackState={input.webhookCallbackState}
        />
      </div>
    </div>
  );
}

function buildSetupStartBody(input: {
  manifest: Record<string, unknown>;
  setupInstructions: IntegrationFormConnectionMethodSetupInstructions;
  setupStartForm: IntegrationFormConnectionMethodSetupStartForm;
  setupStartFormState: ReturnType<typeof useIntegrationConnectionSetupStartForm>;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    [input.setupInstructions.manifest.startAction.manifestBodyField]: input.manifest,
  };

  for (const field of input.setupStartForm.fields) {
    body[field.name] =
      field.required === true
        ? input.setupStartFormState.resolveRequiredValue(field.name)
        : (input.setupStartFormState.values[field.name] ?? "");
  }

  return body;
}

export function ProviderAppSetupPane(input: {
  connection: IntegrationConnection;
  manifestDraftBuilder: IntegrationSetupAppManifestDraftBuilder;
  methodId: string;
  routeSegment: string;
  setupInstructions: IntegrationFormConnectionMethodSetupInstructions;
  setupStartForm: IntegrationFormConnectionMethodSetupStartForm;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [setupMode, setSetupMode] = useState<ProviderAppSetupMode>(() =>
    isProviderAppInstalled({
      connection: input.connection,
      setupInstructions: input.setupInstructions,
    })
      ? "existing-app"
      : "manifest",
  );
  const setupStartFormState = useIntegrationConnectionSetupStartForm(input.setupStartForm);
  const [configuredSecretFieldKeys, setConfiguredSecretFieldKeys] = useState(() =>
    resolveConfiguredSecretFieldKeys({
      connection: input.connection,
      setupInstructions: input.setupInstructions,
    }),
  );
  const [isSecretReplacementDialogOpen, setIsSecretReplacementDialogOpen] = useState(false);
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null);
  const existingAppFieldKeys = useMemo(
    () => resolveExistingAppFieldKeys(input.setupInstructions),
    [input.setupInstructions],
  );
  const existingAppAutoSave = useExistingAppSetupAutoSave<
    ProviderAppSetupFieldKey,
    IntegrationConnection
  >({
    clearActionError: () => {
      setActionErrorMessage(null);
    },
    createInitialDraft: () =>
      createInitialExistingAppDraft({
        connection: input.connection,
        setupInstructions: input.setupInstructions,
      }),
    fieldKeys: existingAppFieldKeys,
    normalizeValue: normalizeExistingAppSetupValue,
    onFieldSaved: (updatedConnection, fieldKey) => {
      if (
        isExistingAppSecretFieldKey({
          fieldKey,
          setupInstructions: input.setupInstructions,
        })
      ) {
        setConfiguredSecretFieldKeys(
          resolveConfiguredSecretFieldKeys({
            connection: updatedConnection,
            setupInstructions: input.setupInstructions,
          }),
        );
      }
    },
    resolveSavedFieldKeys: (fieldKey) =>
      resolveExistingAppSetupSavedFieldKeys({
        fieldKey,
        setupInstructions: input.setupInstructions,
      }),
    resolveSaveErrorMessage: (error) =>
      resolveApiErrorMessage({
        error,
        fallbackMessage: input.setupInstructions.existingApp.saveErrorMessage,
      }),
    saveField: async ({ draft, fieldKey }) => {
      const secrets = buildExistingAppSetupSecrets({
        draft,
        fieldKey,
        setupInstructions: input.setupInstructions,
      });
      const updatedConnection = await updateFormIntegrationConnection({
        connectionId: input.connection.id,
        displayName: input.connection.displayName,
        config: buildExistingAppSetupConfig({
          methodId: input.methodId,
          draft,
          setupInstructions: input.setupInstructions,
        }),
        ...(secrets === undefined ? {} : { secrets }),
      });

      await queryClient.invalidateQueries({
        queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
      });

      return updatedConnection;
    },
    shouldPersistField: ({ draft, fieldKey }) =>
      shouldPersistExistingAppSetupField({
        draft,
        fieldKey,
        setupInstructions: input.setupInstructions,
      }),
    validateField: ({ draft, fieldKey }) =>
      getExistingAppSetupFieldValidationMessage({
        draft,
        fieldKey,
        setupInstructions: input.setupInstructions,
      }),
  });
  const webhookCallbackState = useManifestWebhookCallbackState({
    enabled: true,
    connectionId: input.connection.id,
  });
  const manifestDraft = useSetupManifestDraft({
    manifestDraftBuilder: input.manifestDraftBuilder,
    webhookCallbackState,
  });

  const startManifestMutation = useMutation({
    mutationFn: async () =>
      startProviderAppSetup({
        connectionId: input.connection.id,
        routeSegment: input.routeSegment,
        body: buildSetupStartBody({
          manifest: parseManifestJsonObject(manifestDraft.manifestValue),
          setupInstructions: input.setupInstructions,
          setupStartForm: input.setupStartForm,
          setupStartFormState,
        }),
        fallbackMessage: input.setupInstructions.manifest.createErrorMessage,
      }),
  });

  async function createProviderApp(): Promise<void> {
    setActionErrorMessage(null);
    try {
      const started = await startManifestMutation.mutateAsync();
      if (started.kind !== input.setupInstructions.manifest.startAction.expectedResultKind) {
        throw new Error(input.setupInstructions.manifest.startAction.unexpectedResultMessage);
      }

      globalThis.location.assign(started.authorizationUrl);
    } catch (error) {
      setActionErrorMessage(
        resolveApiErrorMessage({
          error,
          fallbackMessage: input.setupInstructions.manifest.createErrorMessage,
        }),
      );
    }
  }

  const manifestValidation = validateManifestJsonObject(manifestDraft.manifestValue);
  const canCreateManifest =
    manifestValidation.status === "valid" &&
    webhookCallbackState.kind === "ready" &&
    setupStartFormState.requiredFieldsComplete;
  const requiredFieldKeys = [
    ...input.setupInstructions.existingApp.configFields
      .filter((field) => field.required)
      .map((field) => field.name),
    ...input.setupInstructions.existingApp.secretFields
      .filter((field) => field.required)
      .map((field) => field.name),
  ];
  const requiredFieldsReady = requiredFieldKeys.every((fieldKey) =>
    isExistingAppRequiredFieldReady({
      fieldKey,
      draft: existingAppAutoSave.draft,
      savedDraft: existingAppAutoSave.savedDraft,
      fieldState: getSetupFieldState(existingAppAutoSave.fieldStates, fieldKey),
      isConfiguredOnServer: configuredSecretFieldKeys.has(fieldKey),
    }),
  );
  const allFieldsStable = existingAppFieldKeys.every((fieldKey) =>
    isExistingAppFieldStable({
      fieldKey,
      draft: existingAppAutoSave.draft,
      savedDraft: existingAppAutoSave.savedDraft,
      fieldState: getSetupFieldState(existingAppAutoSave.fieldStates, fieldKey),
    }),
  );
  const canConnectExistingApp =
    requiredFieldsReady &&
    allFieldsStable &&
    !isSecretReplacementDialogOpen &&
    webhookCallbackState.kind === "ready";

  return (
    <FormPageStack>
      <IntegrationConnectionSetupModeTabs
        actionErrorMessage={actionErrorMessage}
        description={input.setupInstructions.description}
        existingAppContent={
          <ExistingAppSetupFieldsPanel
            configFields={input.setupInstructions.existingApp.configFields.map((field) => ({
              fieldKey: field.name,
              id: `${input.routeSegment}-${field.name}`,
              label: field.label,
              required: field.required,
              value: existingAppAutoSave.draft[field.name] ?? "",
            }))}
            description={input.setupInstructions.existingApp.description}
            fieldStates={existingAppAutoSave.fieldStates}
            onCommitField={(fieldKey) => {
              void existingAppAutoSave.persistField(fieldKey);
            }}
            onReplacementDialogOpenChange={setIsSecretReplacementDialogOpen}
            onRevertSecretReplacement={existingAppAutoSave.revertField}
            onUpdateFieldDraft={existingAppAutoSave.updateFieldDraft}
            secretFields={input.setupInstructions.existingApp.secretFields.map((field) => ({
              configured: configuredSecretFieldKeys.has(field.name),
              fieldKey: field.name,
              id: `${input.routeSegment}-${field.name}`,
              label: field.label,
              ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
              required: field.required && !configuredSecretFieldKeys.has(field.name),
              secretLabel: field.secretLabel,
              type: field.inputType,
              value: existingAppAutoSave.draft[field.name] ?? "",
            }))}
            title={input.setupInstructions.existingApp.title}
          />
        }
        footer={
          <>
            {setupMode === "existing-app" ? (
              <SetupUrls
                setupInstructions={input.setupInstructions}
                webhookCallbackState={webhookCallbackState}
              />
            ) : null}

            {setupMode === "existing-app" ? (
              <FormPageActionBar>
                <Button
                  disabled={!canConnectExistingApp}
                  onClick={() => {
                    void navigate(`/integrations/${input.connection.targetKey}`);
                  }}
                  type="button"
                >
                  {input.setupInstructions.existingApp.connectLabel}
                </Button>
              </FormPageActionBar>
            ) : setupMode === "manifest" ? (
              <FormPageActionBar>
                <Button
                  disabled={!canCreateManifest || startManifestMutation.isPending}
                  onClick={() => {
                    void createProviderApp();
                  }}
                  type="button"
                >
                  {input.setupStartForm.submitLabel}
                </Button>
              </FormPageActionBar>
            ) : null}
          </>
        }
        manifestContent={
          <IntegrationConnectionSetupManifestPanel
            editorId={`${input.routeSegment}-manifest-editor`}
            manifestCallbackState={webhookCallbackState}
            manifestDescription={input.setupInstructions.manifest.description}
            manifestTitle={input.setupInstructions.manifest.title}
            manifestValidation={manifestValidation}
            manifestValue={manifestDraft.manifestValue}
            onManifestChange={manifestDraft.onManifestChange}
            onSetupStartFormValueChange={setupStartFormState.updateValue}
            setupStartForm={input.setupStartForm}
            setupStartFormValues={setupStartFormState.values}
          />
        }
        onModeChange={setSetupMode}
        title={input.setupInstructions.title}
        value={setupMode}
      />
    </FormPageStack>
  );
}
