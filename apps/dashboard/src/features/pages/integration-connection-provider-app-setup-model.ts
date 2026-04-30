import type { IntegrationFormConnectionMethodProviderAppSetup } from "@mistle/integrations-core";

import type { SavingFieldState } from "../forms/configured-secret-field.js";
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

export function resolveProviderAppSetupFieldKeys(
  providerAppSetup: IntegrationFormConnectionMethodProviderAppSetup,
): readonly ProviderAppSetupFieldKey[] {
  return [
    ...providerAppSetup.existingApp.configFields.map((field) => field.name),
    ...providerAppSetup.existingApp.secretFields.map((field) => field.name),
  ];
}

export function resolveProviderAppSetupSecretFieldKeys(
  providerAppSetup: IntegrationFormConnectionMethodProviderAppSetup,
): readonly ProviderAppSetupFieldKey[] {
  return providerAppSetup.existingApp.secretFields.map((field) => field.name);
}

export function resolveProviderAppSetupRequiredFieldKeys(
  providerAppSetup: IntegrationFormConnectionMethodProviderAppSetup,
): readonly ProviderAppSetupFieldKey[] {
  return [
    ...providerAppSetup.existingApp.configFields
      .filter((field) => field.required)
      .map((field) => field.name),
    ...providerAppSetup.existingApp.secretFields
      .filter((field) => field.required)
      .map((field) => field.name),
  ];
}

export function isProviderAppSetupSecretFieldKey(input: {
  fieldKey: ProviderAppSetupFieldKey;
  providerAppSetup: IntegrationFormConnectionMethodProviderAppSetup;
}): boolean {
  return input.providerAppSetup.existingApp.secretFields.some(
    (field) => field.name === input.fieldKey,
  );
}

export function isProviderAppInstalled(input: {
  connection: IntegrationConnection;
  providerAppSetup: IntegrationFormConnectionMethodProviderAppSetup;
}): boolean {
  const { installedDetection } = input.providerAppSetup.existingApp;
  const configFieldsByName = new Map(
    input.providerAppSetup.existingApp.configFields.map((field) => [field.name, field.configKey]),
  );

  return (
    installedDetection.configFields.every((fieldName) => {
      const configKey = configFieldsByName.get(fieldName);
      if (configKey === undefined) {
        throw new Error(
          `Provider app setup does not define config field '${fieldName}' used by installed detection.`,
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

export function buildProviderAppSetupSecrets(input: {
  draft: Record<ProviderAppSetupFieldKey, string>;
  fieldKey: ProviderAppSetupFieldKey;
  providerAppSetup: IntegrationFormConnectionMethodProviderAppSetup;
}): Record<string, string> | undefined {
  if (
    !isProviderAppSetupSecretFieldKey({
      fieldKey: input.fieldKey,
      providerAppSetup: input.providerAppSetup,
    })
  ) {
    return undefined;
  }

  const value = normalizeProviderAppSetupValue(input.draft[input.fieldKey] ?? "");
  return value.length === 0 ? undefined : { [input.fieldKey]: value };
}

export function isProviderAppSetupFieldStable(input: {
  fieldKey: ProviderAppSetupFieldKey;
  draft: Record<ProviderAppSetupFieldKey, string>;
  savedDraft: Record<ProviderAppSetupFieldKey, string>;
  fieldState: SavingFieldState;
}): boolean {
  return (
    input.fieldState.status !== "saving" &&
    input.fieldState.errorMessage === null &&
    !isProviderAppSetupFieldDirty(input)
  );
}

export function getProviderAppSetupFieldValidationMessage(input: {
  fieldKey: ProviderAppSetupFieldKey;
  draft: Record<ProviderAppSetupFieldKey, string>;
  providerAppSetup: IntegrationFormConnectionMethodProviderAppSetup;
}): string | null {
  const normalizedValue = normalizeProviderAppSetupValue(input.draft[input.fieldKey] ?? "");
  if (normalizedValue.length > 0) {
    return null;
  }

  const configField =
    input.providerAppSetup.existingApp.configFields.find(
      (field) => field.name === input.fieldKey,
    ) ?? null;
  if (configField !== null && configField.required) {
    return `${configField.label} is required.`;
  }

  const secretField =
    input.providerAppSetup.existingApp.secretFields.find(
      (field) => field.name === input.fieldKey,
    ) ?? null;
  if (secretField !== null && secretField.required) {
    return `${secretField.label} is required.`;
  }

  return null;
}

export function shouldPersistProviderAppSetupField(input: {
  fieldKey: ProviderAppSetupFieldKey;
  draft: Record<ProviderAppSetupFieldKey, string>;
  providerAppSetup: IntegrationFormConnectionMethodProviderAppSetup;
}): boolean {
  if (
    !isProviderAppSetupSecretFieldKey({
      fieldKey: input.fieldKey,
      providerAppSetup: input.providerAppSetup,
    })
  ) {
    return true;
  }

  return normalizeProviderAppSetupValue(input.draft[input.fieldKey] ?? "").length > 0;
}

export function isProviderAppRequiredFieldReady(input: {
  fieldKey: ProviderAppSetupFieldKey;
  draft: Record<ProviderAppSetupFieldKey, string>;
  savedDraft: Record<ProviderAppSetupFieldKey, string>;
  fieldState: SavingFieldState;
  isConfiguredOnServer: boolean;
}): boolean {
  const draftValue = normalizeProviderAppSetupValue(input.draft[input.fieldKey] ?? "");
  const savedValue = normalizeProviderAppSetupValue(input.savedDraft[input.fieldKey] ?? "");

  if (
    input.isConfiguredOnServer &&
    draftValue.length === 0 &&
    savedValue.length === 0 &&
    isProviderAppSetupFieldStable(input)
  ) {
    return true;
  }

  return savedValue.length > 0 && isProviderAppSetupFieldStable(input);
}

export function resolveProviderAppSetupSavedFieldKeys(input: {
  fieldKey: ProviderAppSetupFieldKey;
  providerAppSetup: IntegrationFormConnectionMethodProviderAppSetup;
}): readonly ProviderAppSetupFieldKey[] {
  const configFieldKeys = input.providerAppSetup.existingApp.configFields.map(
    (field) => field.name,
  );

  if (
    isProviderAppSetupSecretFieldKey({
      fieldKey: input.fieldKey,
      providerAppSetup: input.providerAppSetup,
    })
  ) {
    return [...configFieldKeys, input.fieldKey];
  }

  return configFieldKeys;
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
    required: field.required && !input.configuredSecretFieldKeys.has(field.name),
    ...(field.rows === undefined ? {} : { rows: field.rows }),
    secretLabel: field.secretLabel,
    value: input.draft[field.name] ?? "",
  }));
}

function normalizeInputValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isProviderAppSetupFieldDirty(input: {
  fieldKey: ProviderAppSetupFieldKey;
  draft: Record<ProviderAppSetupFieldKey, string>;
  savedDraft: Record<ProviderAppSetupFieldKey, string>;
}): boolean {
  return (
    normalizeProviderAppSetupValue(input.draft[input.fieldKey] ?? "") !==
    normalizeProviderAppSetupValue(input.savedDraft[input.fieldKey] ?? "")
  );
}
