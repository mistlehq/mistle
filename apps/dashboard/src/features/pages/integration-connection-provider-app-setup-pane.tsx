import type {
  IntegrationFormConnectionMethodProviderAppSetup,
  IntegrationFormConnectionMethodSetupStartForm,
} from "@mistle/integrations-core";
import { Button } from "@mistle/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
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
  buildProviderAppSetupConfig,
  buildProviderAppSetupConfigFieldInputs,
  buildProviderAppSetupSecretFieldInputs,
  buildProviderAppSetupSecrets,
  buildProviderAppSetupStartBody,
  createInitialProviderAppSetupDraft,
  getProviderAppSetupFieldValidationMessage,
  isProviderAppInstalled,
  isProviderAppRequiredFieldReady,
  isProviderAppSetupFieldStable,
  isProviderAppSetupSecretFieldKey,
  normalizeProviderAppSetupValue,
  resolveProviderAppSetupFieldKeys,
  resolveProviderAppSetupRequiredFieldKeys,
  resolveProviderAppSetupSavedFieldKeys,
  resolveProviderAppSetupSecretFieldKeys,
  shouldPersistProviderAppSetupField,
  type ProviderAppSetupFieldKey,
} from "./integration-connection-provider-app-setup-model.js";
import {
  IntegrationConnectionSetupManifestPanel,
  IntegrationConnectionSetupModeTabs,
  IntegrationConnectionSetupWebhookCallbackValue,
  type IntegrationConnectionSetupMode,
  useIntegrationConnectionSetupStartForm,
} from "./integration-connection-setup-flow.js";
import type { IntegrationSetupAppManifestDraftBuilder } from "./integration-connection-setup-manifest-draft.js";
import { resolveConfiguredSetupSecretFieldKeys } from "./integration-connection-setup-secret-fields.js";
import { SETTINGS_INTEGRATIONS_QUERY_KEY } from "./use-integrations-directory-state.js";

function resolveConfiguredSecretFieldKeys(input: {
  connection: IntegrationConnection;
  providerAppSetup: IntegrationFormConnectionMethodProviderAppSetup;
}): ReadonlySet<ProviderAppSetupFieldKey> {
  return resolveConfiguredSetupSecretFieldKeys({
    configuredSecretNames: input.connection.configuredSecretNames,
    fieldKeys: resolveProviderAppSetupSecretFieldKeys(input.providerAppSetup),
  });
}

function SetupUrls(input: {
  providerAppSetup: IntegrationFormConnectionMethodProviderAppSetup;
  webhookCallbackState: ManifestWebhookCallbackState;
}): React.JSX.Element {
  const webhookCallbackInstructions = input.providerAppSetup.urls.webhookCallback;

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        description={input.providerAppSetup.urls.description}
        title={input.providerAppSetup.urls.title}
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

export function ProviderAppSetupPane(input: {
  connection: IntegrationConnection;
  manifestDraftBuilder: IntegrationSetupAppManifestDraftBuilder;
  methodId: string;
  routeSegment: string;
  providerAppSetup: IntegrationFormConnectionMethodProviderAppSetup;
  setupStartForm: IntegrationFormConnectionMethodSetupStartForm;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [setupMode, setSetupMode] = useState<IntegrationConnectionSetupMode>(() =>
    isProviderAppInstalled({
      connection: input.connection,
      providerAppSetup: input.providerAppSetup,
    })
      ? "existing-app"
      : "manifest",
  );
  const setupStartFormState = useIntegrationConnectionSetupStartForm(input.setupStartForm);
  const [configuredSecretFieldKeys, setConfiguredSecretFieldKeys] = useState(() =>
    resolveConfiguredSecretFieldKeys({
      connection: input.connection,
      providerAppSetup: input.providerAppSetup,
    }),
  );
  const [isSecretReplacementDialogOpen, setIsSecretReplacementDialogOpen] = useState(false);
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null);
  const existingAppFieldKeys = useMemo(
    () => resolveProviderAppSetupFieldKeys(input.providerAppSetup),
    [input.providerAppSetup],
  );
  const existingAppAutoSave = useExistingAppSetupAutoSave<
    ProviderAppSetupFieldKey,
    IntegrationConnection
  >({
    clearActionError: () => {
      setActionErrorMessage(null);
    },
    createInitialDraft: () =>
      createInitialProviderAppSetupDraft({
        connection: input.connection,
        providerAppSetup: input.providerAppSetup,
      }),
    fieldKeys: existingAppFieldKeys,
    normalizeValue: normalizeProviderAppSetupValue,
    onFieldSaved: (updatedConnection, fieldKey) => {
      if (
        isProviderAppSetupSecretFieldKey({
          fieldKey,
          providerAppSetup: input.providerAppSetup,
        })
      ) {
        setConfiguredSecretFieldKeys(
          resolveConfiguredSecretFieldKeys({
            connection: updatedConnection,
            providerAppSetup: input.providerAppSetup,
          }),
        );
      }
    },
    resolveSavedFieldKeys: (fieldKey) =>
      resolveProviderAppSetupSavedFieldKeys({
        fieldKey,
        providerAppSetup: input.providerAppSetup,
      }),
    resolveSaveErrorMessage: (error) =>
      resolveApiErrorMessage({
        error,
        fallbackMessage: input.providerAppSetup.existingApp.saveErrorMessage,
      }),
    saveField: async ({ draft, fieldKey }) => {
      const secrets = buildProviderAppSetupSecrets({
        draft,
        fieldKey,
        providerAppSetup: input.providerAppSetup,
      });
      const updatedConnection = await updateFormIntegrationConnection({
        connectionId: input.connection.id,
        displayName: input.connection.displayName,
        config: buildProviderAppSetupConfig({
          methodId: input.methodId,
          draft,
          providerAppSetup: input.providerAppSetup,
        }),
        ...(secrets === undefined ? {} : { secrets }),
      });

      await queryClient.invalidateQueries({
        queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
      });

      return updatedConnection;
    },
    shouldPersistField: ({ draft, fieldKey }) =>
      shouldPersistProviderAppSetupField({
        draft,
        fieldKey,
        providerAppSetup: input.providerAppSetup,
      }),
    validateField: ({ draft, fieldKey }) =>
      getProviderAppSetupFieldValidationMessage({
        draft,
        fieldKey,
        providerAppSetup: input.providerAppSetup,
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
        body: buildProviderAppSetupStartBody({
          manifest: parseManifestJsonObject(manifestDraft.manifestValue),
          providerAppSetup: input.providerAppSetup,
          setupStartFormFields: input.setupStartForm.fields,
          setupStartFormState,
        }),
        fallbackMessage: input.providerAppSetup.manifest.createErrorMessage,
      }),
  });

  async function createProviderApp(): Promise<void> {
    setActionErrorMessage(null);
    try {
      const started = await startManifestMutation.mutateAsync();
      if (started.kind !== input.providerAppSetup.manifest.startAction.expectedResultKind) {
        throw new Error(input.providerAppSetup.manifest.startAction.unexpectedResultMessage);
      }

      globalThis.location.assign(started.authorizationUrl);
    } catch (error) {
      setActionErrorMessage(
        resolveApiErrorMessage({
          error,
          fallbackMessage: input.providerAppSetup.manifest.createErrorMessage,
        }),
      );
    }
  }

  const manifestValidation = validateManifestJsonObject(manifestDraft.manifestValue);
  const canCreateManifest =
    manifestValidation.status === "valid" &&
    webhookCallbackState.kind === "ready" &&
    setupStartFormState.requiredFieldsComplete;
  const requiredFieldKeys = resolveProviderAppSetupRequiredFieldKeys(input.providerAppSetup);
  const requiredFieldsReady = requiredFieldKeys.every((fieldKey) =>
    isProviderAppRequiredFieldReady({
      fieldKey,
      draft: existingAppAutoSave.draft,
      savedDraft: existingAppAutoSave.savedDraft,
      fieldState: getSetupFieldState(existingAppAutoSave.fieldStates, fieldKey),
      isConfiguredOnServer: configuredSecretFieldKeys.has(fieldKey),
    }),
  );
  const allFieldsStable = existingAppFieldKeys.every((fieldKey) =>
    isProviderAppSetupFieldStable({
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
        description={input.providerAppSetup.description}
        existingAppContent={
          <ExistingAppSetupFieldsPanel
            configFields={buildProviderAppSetupConfigFieldInputs({
              draft: existingAppAutoSave.draft,
              providerAppSetup: input.providerAppSetup,
              routeSegment: input.routeSegment,
            })}
            description={input.providerAppSetup.existingApp.description}
            fieldStates={existingAppAutoSave.fieldStates}
            onCommitField={(fieldKey) => {
              void existingAppAutoSave.persistField(fieldKey);
            }}
            onReplacementDialogOpenChange={setIsSecretReplacementDialogOpen}
            onRevertSecretReplacement={existingAppAutoSave.revertField}
            onUpdateFieldDraft={existingAppAutoSave.updateFieldDraft}
            secretFields={buildProviderAppSetupSecretFieldInputs({
              configuredSecretFieldKeys,
              draft: existingAppAutoSave.draft,
              providerAppSetup: input.providerAppSetup,
              routeSegment: input.routeSegment,
            })}
            title={input.providerAppSetup.existingApp.title}
          />
        }
        footer={
          <>
            {setupMode === "existing-app" ? (
              <SetupUrls
                providerAppSetup={input.providerAppSetup}
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
                  {input.providerAppSetup.existingApp.connectLabel}
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
            manifestDescription={input.providerAppSetup.manifest.description}
            manifestTitle={input.providerAppSetup.manifest.title}
            manifestValidation={manifestValidation}
            manifestValue={manifestDraft.manifestValue}
            onManifestChange={manifestDraft.onManifestChange}
            onSetupStartFormValueChange={setupStartFormState.updateValue}
            setupStartForm={input.setupStartForm}
            setupStartFormValues={setupStartFormState.values}
          />
        }
        onModeChange={setSetupMode}
        title={input.providerAppSetup.title}
        value={setupMode}
      />
    </FormPageStack>
  );
}
