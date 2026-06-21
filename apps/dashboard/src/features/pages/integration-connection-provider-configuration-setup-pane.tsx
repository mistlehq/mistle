import type { IntegrationFormConnectionMethodProviderConfigurationSetup } from "@mistle/integrations-core";
import { Button, Notice } from "@mistle/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import {
  ConfiguredSecretField,
  SavingTextField,
  type SavingFieldState,
} from "../forms/configured-secret-field.js";
import { updateFormIntegrationConnection } from "../integrations/integrations-service.js";
import type { IntegrationConnection } from "../integrations/integrations-service.js";
import { useManifestWebhookCallbackState } from "../integrations/manifest-webhook-callback-state.js";
import { FormPageActionBar, FormPageSection, FormPageStack } from "../shared/form-page.js";
import { SectionHeader } from "../shared/section-header.js";
import { IntegrationConnectionSetupWebhookCallbackValue } from "./integration-connection-setup-flow.js";
import { SETTINGS_INTEGRATIONS_QUERY_KEY } from "./use-integrations-directory-state.js";

const IdleFieldState = {
  status: "idle",
  errorMessage: null,
} satisfies SavingFieldState;

const SavingFieldStateValue = {
  status: "saving",
  errorMessage: null,
} satisfies SavingFieldState;

function noop(): void {
  return;
}

function createInitialProviderConfigurationSetupDraft(input: {
  connection: IntegrationConnection;
  setup: IntegrationFormConnectionMethodProviderConfigurationSetup;
}): Record<string, string> {
  const draft: Record<string, string> = {};

  for (const field of input.setup.fields.configFields) {
    const value = input.connection.config?.[field.configKey];
    draft[field.name] = typeof value === "string" ? value : "";
  }

  for (const field of input.setup.fields.secretFields) {
    draft[field.name] = "";
  }

  return draft;
}

function normalizeProviderConfigurationSetupDraft(input: {
  draft: Record<string, string>;
  setup: IntegrationFormConnectionMethodProviderConfigurationSetup;
}): Record<string, string> {
  const nextDraft: Record<string, string> = {};

  for (const field of input.setup.fields.configFields) {
    nextDraft[field.name] = input.draft[field.name]?.trim() ?? "";
  }

  for (const field of input.setup.fields.secretFields) {
    nextDraft[field.name] = "";
  }

  return nextDraft;
}

function buildProviderConfigurationSetupConfig(input: {
  connection: IntegrationConnection;
  draft: Record<string, string>;
  methodId: string;
  setup: IntegrationFormConnectionMethodProviderConfigurationSetup;
}): Record<string, unknown> {
  const config: Record<string, unknown> = {
    ...(input.connection.config ?? {}),
    connection_method: input.methodId,
  };

  for (const field of input.setup.fields.configFields) {
    config[field.configKey] = input.draft[field.name]?.trim() ?? "";
  }

  return config;
}

function buildProviderConfigurationSetupSecrets(input: {
  draft: Record<string, string>;
  setup: IntegrationFormConnectionMethodProviderConfigurationSetup;
}): Record<string, string> | undefined {
  const secrets: Record<string, string> = {};

  for (const field of input.setup.fields.secretFields) {
    const value = input.draft[field.name]?.trim() ?? "";
    if (value.length > 0) {
      secrets[field.name] = value;
    }
  }

  return Object.keys(secrets).length === 0 ? undefined : secrets;
}

function isProviderConfigurationSetupDraftComplete(input: {
  configuredSecretNames: ReadonlySet<string>;
  draft: Record<string, string>;
  setup: IntegrationFormConnectionMethodProviderConfigurationSetup;
}): boolean {
  const configFieldsComplete = input.setup.fields.configFields.every(
    (field) => field.required !== true || (input.draft[field.name]?.trim().length ?? 0) > 0,
  );
  const secretFieldsComplete = input.setup.fields.secretFields.every(
    (field) =>
      field.required !== true ||
      input.configuredSecretNames.has(field.name) ||
      (input.draft[field.name]?.trim().length ?? 0) > 0,
  );

  return configFieldsComplete && secretFieldsComplete;
}

function resolveConfiguredSecretFieldKeys(input: {
  connection: IntegrationConnection;
  setup: IntegrationFormConnectionMethodProviderConfigurationSetup;
}): ReadonlySet<string> {
  const configuredSecretNames = new Set(input.connection.configuredSecretNames ?? []);
  return new Set(
    input.setup.fields.secretFields
      .map((field) => field.name)
      .filter((fieldName) => configuredSecretNames.has(fieldName)),
  );
}

function renderInputType(
  inputType: "password" | "text" | "textarea",
): "password" | "text" | undefined {
  if (inputType === "textarea") {
    return undefined;
  }

  return inputType;
}

export function ProviderConfigurationSetupPane(input: {
  connection: IntegrationConnection;
  methodId: string;
  providerConfigurationSetup: IntegrationFormConnectionMethodProviderConfigurationSetup;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const setup = input.providerConfigurationSetup;
  const webhookCallbackState = useManifestWebhookCallbackState({
    connectionId: input.connection.id,
    enabled: true,
  });
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null);
  const [configuredSecretFieldKeys, setConfiguredSecretFieldKeys] = useState(() =>
    resolveConfiguredSecretFieldKeys({
      connection: input.connection,
      setup,
    }),
  );
  const [draft, setDraft] = useState(() =>
    createInitialProviderConfigurationSetupDraft({
      connection: input.connection,
      setup,
    }),
  );
  const saveMutation = useMutation({
    mutationFn: async () => {
      const secrets = buildProviderConfigurationSetupSecrets({
        draft,
        setup,
      });
      const updatedConnection = await updateFormIntegrationConnection({
        connectionId: input.connection.id,
        displayName: input.connection.displayName,
        config: buildProviderConfigurationSetupConfig({
          connection: input.connection,
          draft,
          methodId: input.methodId,
          setup,
        }),
        ...(secrets === undefined ? {} : { secrets }),
      });

      await queryClient.invalidateQueries({
        queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
      });

      return updatedConnection;
    },
  });

  async function saveSetup(): Promise<void> {
    setActionErrorMessage(null);
    try {
      const updatedConnection = await saveMutation.mutateAsync();
      setConfiguredSecretFieldKeys(
        resolveConfiguredSecretFieldKeys({
          connection: updatedConnection,
          setup,
        }),
      );
      setDraft(
        normalizeProviderConfigurationSetupDraft({
          draft,
          setup,
        }),
      );
    } catch (error) {
      setActionErrorMessage(
        resolveApiErrorMessage({
          error,
          fallbackMessage: setup.fields.saveErrorMessage,
        }),
      );
    }
  }

  const fieldState = saveMutation.isPending ? SavingFieldStateValue : IdleFieldState;
  const canSave =
    webhookCallbackState.kind === "ready" &&
    isProviderConfigurationSetupDraftComplete({
      configuredSecretNames: configuredSecretFieldKeys,
      draft,
      setup,
    }) &&
    !saveMutation.isPending;

  return (
    <FormPageStack>
      <FormPageSection>
        <div className="flex flex-col gap-8 p-4">
          <SectionHeader description={setup.description} size="large" title={setup.title} />

          <div className="flex flex-col gap-4">
            <SectionHeader
              description={setup.webhookCallback.description}
              title={setup.webhookCallback.title}
            />
            <IntegrationConnectionSetupWebhookCallbackValue
              errorTitle={setup.webhookCallback.errorTitle}
              label={setup.webhookCallback.label}
              missingMessage={setup.webhookCallback.missingMessage}
              missingTitle={setup.webhookCallback.missingTitle}
              webhookCallbackState={webhookCallbackState}
            />
          </div>

          <div className="flex flex-col gap-3">
            <SectionHeader title={setup.instructions.title} />
            <ol className="text-muted-foreground list-decimal space-y-2 pl-5 text-sm">
              {setup.instructions.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </div>

          <div className="flex flex-col gap-4">
            <SectionHeader description={setup.fields.description} title={setup.fields.title} />
            {setup.fields.configFields.map((field) => (
              <SavingTextField
                fieldState={fieldState}
                id={`provider-configuration-${input.connection.id}-${field.name}`}
                key={field.name}
                label={field.label}
                multiline={field.inputType === "textarea"}
                onBlur={noop}
                onChange={(nextValue) => {
                  setActionErrorMessage(null);
                  setDraft((currentDraft) => ({
                    ...currentDraft,
                    [field.name]: nextValue,
                  }));
                }}
                required={field.required}
                type={field.inputType === "text" ? "text" : undefined}
                value={draft[field.name] ?? ""}
                {...(field.description === undefined ? {} : { description: field.description })}
                {...(field.placeholder === undefined ? {} : { placeholder: field.placeholder })}
                {...(field.rows === undefined ? {} : { rows: field.rows })}
              />
            ))}
            {setup.fields.secretFields.map((field) => (
              <ConfiguredSecretField
                confirmReplacement={false}
                configured={configuredSecretFieldKeys.has(field.name)}
                fieldState={fieldState}
                id={`provider-configuration-${input.connection.id}-${field.name}`}
                key={field.name}
                label={field.label}
                multiline={field.inputType === "textarea"}
                onChange={(nextValue) => {
                  setActionErrorMessage(null);
                  setDraft((currentDraft) => ({
                    ...currentDraft,
                    [field.name]: nextValue,
                  }));
                }}
                required={field.required}
                secretLabel={field.secretLabel}
                type={renderInputType(field.inputType)}
                value={draft[field.name] ?? ""}
                {...(field.description === undefined ? {} : { description: field.description })}
                {...(field.placeholder === undefined ? {} : { placeholder: field.placeholder })}
                {...(field.rows === undefined ? {} : { rows: field.rows })}
              />
            ))}
          </div>

          {actionErrorMessage === null ? null : (
            <Notice title="Could not save setup" variant="alert">
              {actionErrorMessage}
            </Notice>
          )}
        </div>
      </FormPageSection>

      <FormPageActionBar>
        <Button
          aria-busy={saveMutation.isPending}
          disabled={!canSave}
          onClick={() => {
            void saveSetup();
          }}
          type="button"
        >
          {saveMutation.isPending ? "Saving..." : setup.fields.saveLabel}
        </Button>
      </FormPageActionBar>
    </FormPageStack>
  );
}
