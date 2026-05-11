import type { IntegrationFormConnectionMethodProviderAppSetup } from "@mistle/integrations-core";

import type { IntegrationConnection } from "../integrations/integrations-service.js";
import { hasConfiguredSetupSecretField } from "./integration-connection-setup-secret-fields.js";

export type ProviderAppSetupFieldKey = string;

type ProviderAppSetupStartFormState = {
  isFieldVisible: (fieldName: string) => boolean;
  resolveRequiredValue: (fieldName: string) => string;
  values: Record<string, string>;
};

export function createInitialProviderAppSetupDraft(input: {
  connection: IntegrationConnection;
  providerAppSetup: IntegrationFormConnectionMethodProviderAppSetup;
}): Record<ProviderAppSetupFieldKey, string> {
  const draft: Record<ProviderAppSetupFieldKey, string> = {};

  for (const field of input.providerAppSetup.existingApp.configFields) {
    draft[field.name] = normalizeInputValue(input.connection.config?.[field.configKey]);
  }

  for (const field of input.providerAppSetup.existingApp.secretFields) {
    draft[field.name] = "";
  }

  return draft;
}

export function hasProviderAppSetupDraftValues(input: {
  connection: IntegrationConnection;
  providerAppSetup: IntegrationFormConnectionMethodProviderAppSetup;
}): boolean {
  return (
    input.providerAppSetup.existingApp.configFields.some(
      (field) => typeof input.connection.config?.[field.configKey] === "string",
    ) ||
    input.providerAppSetup.existingApp.secretFields.some((field) =>
      hasConfiguredSetupSecretField({
        configuredSecretNames: input.connection.configuredSecretNames,
        fieldName: field.name,
      }),
    )
  );
}

export function isProviderAppExistingAppStartActionInstalled(input: {
  connection: IntegrationConnection;
  providerAppSetup: IntegrationFormConnectionMethodProviderAppSetup;
}): boolean {
  const installedDetection = input.providerAppSetup.existingApp.startAction?.installedDetection;
  if (installedDetection === undefined) {
    return false;
  }

  const hasDetectedConfigFields = (installedDetection.configFields ?? []).every(
    (configKey) => typeof input.connection.config?.[configKey] === "string",
  );
  const hasDetectedExternalSubject =
    installedDetection.externalSubject !== true ||
    typeof input.connection.externalSubjectId === "string";

  return hasDetectedConfigFields && hasDetectedExternalSubject;
}

export function normalizeProviderAppSetupValue(value: string): string {
  return value.trim();
}

export function buildProviderAppSetupConfig(input: {
  methodId: string;
  draft: Record<ProviderAppSetupFieldKey, string>;
  providerAppSetup: IntegrationFormConnectionMethodProviderAppSetup;
}): Record<string, string> {
  const config: Record<string, string> = {
    connection_method: input.methodId,
  };

  for (const field of input.providerAppSetup.existingApp.configFields) {
    const value = normalizeProviderAppSetupValue(input.draft[field.name] ?? "");
    if (value.length > 0) {
      config[field.configKey] = value;
    }
  }

  return config;
}

export function buildProviderAppSetupSecretUpdates(input: {
  draft: Record<ProviderAppSetupFieldKey, string>;
  providerAppSetup: IntegrationFormConnectionMethodProviderAppSetup;
}): Record<string, string> | undefined {
  const secrets: Record<string, string> = {};

  for (const field of input.providerAppSetup.existingApp.secretFields) {
    const value = normalizeProviderAppSetupValue(input.draft[field.name] ?? "");
    if (value.length > 0) {
      secrets[field.name] = value;
    }
  }

  return Object.keys(secrets).length === 0 ? undefined : secrets;
}

export function isProviderAppRequiredDraftComplete(input: {
  configuredSecretFieldKeys: ReadonlySet<ProviderAppSetupFieldKey>;
  draft: Record<ProviderAppSetupFieldKey, string>;
  providerAppSetup: IntegrationFormConnectionMethodProviderAppSetup;
}): boolean {
  for (const field of input.providerAppSetup.existingApp.configFields) {
    if (
      field.required &&
      normalizeProviderAppSetupValue(input.draft[field.name] ?? "").length === 0
    ) {
      return false;
    }
  }

  for (const field of input.providerAppSetup.existingApp.secretFields) {
    if (!field.required) {
      continue;
    }

    const hasDraftValue = normalizeProviderAppSetupValue(input.draft[field.name] ?? "").length > 0;
    if (!hasDraftValue && !input.configuredSecretFieldKeys.has(field.name)) {
      return false;
    }
  }

  return true;
}

export function buildProviderAppSetupStartBody(input: {
  manifest: Record<string, unknown>;
  providerAppSetup: IntegrationFormConnectionMethodProviderAppSetup;
  setupStartFormFields: readonly { name: string; required?: boolean | undefined }[];
  setupStartFormState: ProviderAppSetupStartFormState;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    [input.providerAppSetup.manifest.startAction.manifestBodyField]: input.manifest,
  };

  for (const field of input.setupStartFormFields) {
    if (!input.setupStartFormState.isFieldVisible(field.name)) {
      continue;
    }

    body[field.name] =
      field.required === true
        ? input.setupStartFormState.resolveRequiredValue(field.name)
        : (input.setupStartFormState.values[field.name] ?? "");
  }

  return body;
}

export function buildProviderAppSetupConfigFieldInputs(input: {
  draft: Record<ProviderAppSetupFieldKey, string>;
  providerAppSetup: IntegrationFormConnectionMethodProviderAppSetup;
  routeSegment: string;
}): readonly {
  fieldKey: ProviderAppSetupFieldKey;
  id: string;
  label: string;
  required: boolean;
  value: string;
}[] {
  return input.providerAppSetup.existingApp.configFields.map((field) => ({
    fieldKey: field.name,
    id: `${input.routeSegment}-${field.name}`,
    label: field.label,
    required: field.required,
    value: input.draft[field.name] ?? "",
  }));
}

export function buildProviderAppSetupSecretFieldInputs(input: {
  configuredSecretFieldKeys: ReadonlySet<ProviderAppSetupFieldKey>;
  draft: Record<ProviderAppSetupFieldKey, string>;
  providerAppSetup: IntegrationFormConnectionMethodProviderAppSetup;
  routeSegment: string;
}): readonly {
  configured: boolean;
  fieldKey: ProviderAppSetupFieldKey;
  id: string;
  label: string;
  multiline?: boolean;
  placeholder?: string;
  replacementStaged?: boolean;
  required: boolean;
  rows?: number;
  secretLabel: string;
  type?: "password";
  value: string;
}[] {
  return input.providerAppSetup.existingApp.secretFields.map((field) => ({
    configured: input.configuredSecretFieldKeys.has(field.name),
    fieldKey: field.name,
    id: `${input.routeSegment}-${field.name}`,
    label: field.label,
    ...(field.inputType === "textarea" ? { multiline: true } : { type: field.inputType }),
    ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
    ...(input.configuredSecretFieldKeys.has(field.name) &&
    normalizeProviderAppSetupValue(input.draft[field.name] ?? "").length > 0
      ? { replacementStaged: true }
      : {}),
    required: field.required && !input.configuredSecretFieldKeys.has(field.name),
    ...(field.rows === undefined ? {} : { rows: field.rows }),
    secretLabel: field.secretLabel,
    value: input.draft[field.name] ?? "",
  }));
}

function normalizeInputValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
