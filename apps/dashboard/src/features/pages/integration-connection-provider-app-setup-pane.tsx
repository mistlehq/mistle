import type {
  IntegrationFormConnectionMethodProviderAppSetup,
  IntegrationFormConnectionMethodSetupStartForm,
} from "@mistle/integrations-core";
import { Button, CopyableValue, Notice } from "@mistle/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { getDashboardConfig } from "../../config.js";
import { resolveApiErrorMessage } from "../api/error-message.js";
import {
  startProviderAppSetup,
  updateFormIntegrationConnection,
} from "../integrations/integrations-service.js";
import type { StartedProviderAppSetup } from "../integrations/integrations-service.js";
import type { IntegrationConnection } from "../integrations/integrations-service.js";
import {
  parseManifestJsonObject,
  validateManifestJsonObject,
} from "../integrations/manifest-json-editor.js";
import {
  type ManifestWebhookCallbackState,
  useManifestWebhookCallbackState,
} from "../integrations/manifest-webhook-callback-state.js";
import { openDeferredExternalWindow } from "../shared/external-window.js";
import { FormPageActionBar, FormPageSection, FormPageStack } from "../shared/form-page.js";
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
  hasProviderAppSetupDraftValues,
  isProviderAppExistingAppStartActionInstalled,
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
  const setupCallbackInstructions = input.providerAppSetup.urls.setupCallback;

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        description={input.providerAppSetup.urls.description}
        title={input.providerAppSetup.urls.title}
      />
      <div className="flex flex-col gap-4">
        {setupCallbackInstructions === undefined ? null : (
          <CopyableValue
            label={setupCallbackInstructions.label}
            value={new URL(
              setupCallbackInstructions.path,
              getDashboardConfig().controlPlaneApiOrigin,
            ).toString()}
          />
        )}
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

function ManifestCreatedState(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        description="Your GitHub App is ready. Continue the installation in GitHub to connect it to Mistle."
        title="GitHub App created"
      />
    </div>
  );
}

function submitProviderAppSetupFormPost(input: {
  submissionUrl: string;
  fields: Record<string, string>;
}): void {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = input.submissionUrl;
  form.target = "_self";
  form.style.display = "none";

  for (const [name, value] of Object.entries(input.fields)) {
    const field = document.createElement("input");
    field.type = "hidden";
    field.name = name;
    field.value = value;
    form.append(field);
  }

  document.body.append(form);
  form.submit();
}

function completeProviderAppSetupStart(input: {
  expectedResultKind: "form-post" | "redirect";
  result: StartedProviderAppSetup;
  unexpectedResultMessage: string;
}): void {
  if (input.result.kind !== input.expectedResultKind) {
    throw new Error(input.unexpectedResultMessage);
  }

  if (input.result.kind === "redirect") {
    globalThis.location.assign(input.result.authorizationUrl);
    return;
  }

  submitProviderAppSetupFormPost({
    submissionUrl: input.result.submissionUrl,
    fields: input.result.fields,
  });
}

function PostManifestInstallationScreen(input: {
  actionErrorMessage: string | null;
  installLabel: string;
  isPending: boolean;
  onInstall: () => void;
  pendingLabel: string;
}): React.JSX.Element {
  return (
    <FormPageStack>
      <FormPageSection>
        <div className="flex flex-col gap-6 p-6">
          <ManifestCreatedState />
          {input.actionErrorMessage === null ? null : (
            <Notice title="Could not continue setup" variant="alert">
              {input.actionErrorMessage}
            </Notice>
          )}
          <FormPageActionBar>
            <Button
              aria-busy={input.isPending}
              disabled={input.isPending}
              onClick={input.onInstall}
              type="button"
            >
              {input.isPending ? input.pendingLabel : input.installLabel}
            </Button>
          </FormPageActionBar>
        </div>
      </FormPageSection>
    </FormPageStack>
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
  const [searchParams] = useSearchParams();
  const isManifestCreatedReturn = searchParams.get("githubAppManifest") === "created";
  const [setupMode, setSetupMode] = useState<IntegrationConnectionSetupMode>(() =>
    hasProviderAppSetupDraftValues({
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
  const [isRedirectingToExistingAppStartAction, setIsRedirectingToExistingAppStartAction] =
    useState(false);
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
  const startExistingAppActionMutation = useMutation({
    mutationFn: async () => {
      const startAction = input.providerAppSetup.existingApp.startAction;
      if (startAction === undefined) {
        throw new Error("Provider app setup does not define an existing app start action.");
      }

      return startProviderAppSetup({
        connectionId: input.connection.id,
        routeSegment: startAction.routeSegment,
        body: {},
        fallbackMessage: startAction.startErrorMessage,
      });
    },
  });

  async function createProviderApp(): Promise<void> {
    setActionErrorMessage(null);
    try {
      const started = await startManifestMutation.mutateAsync();
      completeProviderAppSetupStart({
        expectedResultKind: input.providerAppSetup.manifest.startAction.expectedResultKind,
        result: started,
        unexpectedResultMessage:
          input.providerAppSetup.manifest.startAction.unexpectedResultMessage,
      });
    } catch (error) {
      setActionErrorMessage(
        resolveApiErrorMessage({
          error,
          fallbackMessage: input.providerAppSetup.manifest.createErrorMessage,
        }),
      );
    }
  }

  async function startExistingAppAction(): Promise<void> {
    const startAction = input.providerAppSetup.existingApp.startAction;
    if (startAction === undefined) {
      void navigate(`/integrations/${input.connection.targetKey}`);
      return;
    }

    setActionErrorMessage(null);
    try {
      const started = await startExistingAppActionMutation.mutateAsync();
      setIsRedirectingToExistingAppStartAction(true);
      completeProviderAppSetupStart({
        expectedResultKind: startAction.expectedResultKind,
        result: started,
        unexpectedResultMessage: startAction.unexpectedResultMessage,
      });
    } catch (error) {
      setIsRedirectingToExistingAppStartAction(false);
      setActionErrorMessage(
        resolveApiErrorMessage({
          error,
          fallbackMessage: startAction.startErrorMessage,
        }),
      );
    }
  }

  async function startExistingAppManagementAction(): Promise<void> {
    const startAction = input.providerAppSetup.existingApp.startAction;
    if (startAction === undefined) {
      void navigate(`/integrations/${input.connection.targetKey}`);
      return;
    }

    setActionErrorMessage(null);
    const setupWindow = openDeferredExternalWindow({
      loadingMessage: startAction.windowTitle,
      title: startAction.windowTitle,
    });
    if (setupWindow === null) {
      setActionErrorMessage("Browser blocked opening a new window.");
      return;
    }

    try {
      const started = await startExistingAppActionMutation.mutateAsync();
      if (started.kind !== startAction.expectedResultKind) {
        throw new Error(startAction.unexpectedResultMessage);
      }
      if (started.kind !== "redirect") {
        throw new Error(startAction.unexpectedResultMessage);
      }

      setupWindow.navigate(started.authorizationUrl);
    } catch (error) {
      setupWindow.close();
      setActionErrorMessage(
        resolveApiErrorMessage({
          error,
          fallbackMessage: startAction.startErrorMessage,
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
  const isExistingAppStartActionInstalled = isProviderAppExistingAppStartActionInstalled({
    connection: input.connection,
    providerAppSetup: input.providerAppSetup,
  });
  const showManifestCreatedState = isManifestCreatedReturn && !isExistingAppStartActionInstalled;
  const canConnectExistingApp =
    isExistingAppStartActionInstalled ||
    (requiredFieldsReady &&
      allFieldsStable &&
      !isSecretReplacementDialogOpen &&
      webhookCallbackState.kind === "ready");
  const existingAppConnectLabel =
    isExistingAppStartActionInstalled &&
    input.providerAppSetup.existingApp.startAction !== undefined
      ? input.providerAppSetup.existingApp.startAction.installedLabel
      : input.providerAppSetup.existingApp.connectLabel;
  const isExistingAppStartActionPending =
    startExistingAppActionMutation.isPending || isRedirectingToExistingAppStartAction;

  if (showManifestCreatedState) {
    return (
      <PostManifestInstallationScreen
        actionErrorMessage={actionErrorMessage}
        installLabel={input.providerAppSetup.existingApp.connectLabel}
        isPending={isExistingAppStartActionPending}
        onInstall={() => {
          void startExistingAppAction();
        }}
        pendingLabel={
          input.providerAppSetup.existingApp.startAction?.pendingLabel ??
          input.providerAppSetup.existingApp.connectLabel
        }
      />
    );
  }

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
                  aria-busy={isExistingAppStartActionPending}
                  disabled={!canConnectExistingApp || isExistingAppStartActionPending}
                  onClick={() => {
                    if (
                      isExistingAppStartActionInstalled &&
                      input.providerAppSetup.existingApp.startAction?.installedOpensInNewWindow ===
                        true
                    ) {
                      void startExistingAppManagementAction();
                      return;
                    }

                    void startExistingAppAction();
                  }}
                  type="button"
                >
                  {isExistingAppStartActionPending
                    ? (input.providerAppSetup.existingApp.startAction?.pendingLabel ??
                      existingAppConnectLabel)
                    : existingAppConnectLabel}
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
