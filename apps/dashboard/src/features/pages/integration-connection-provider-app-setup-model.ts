import type { IntegrationFormConnectionMethodProviderAppSetup } from "@mistle/integrations-core";
import {
  GitHubOrganizationOnlyAppManifestEvents,
  GitHubOrganizationOnlyAppManifestPermissions,
} from "@mistle/integrations-definitions/browser";

import type { IntegrationConnection } from "../integrations/integrations-service.js";
import {
  createManifestJsonDraft,
  parseManifestJsonObject,
  validateManifestJsonObject,
} from "../integrations/manifest-json-editor.js";
import type { IntegrationConnectionSetupStartFormState } from "./integration-connection-setup-flow.js";
import { hasConfiguredSetupSecretField } from "./integration-connection-setup-secret-fields.js";

const GitHubProviderAppManifestOwnerKindFieldName = "ownerKind";
const GitHubProviderAppManifestOrganizationOwnerKind = "organization";
const GitHubProviderAppManifestPersonalOwnerKind = "personal";

export function createInitialProviderAppSetupDraft(input: {
  connection: IntegrationConnection;
  providerAppSetup: IntegrationFormConnectionMethodProviderAppSetup;
}): Record<string, string> {
  const draft: Record<string, string> = {};

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
  draft: Record<string, string>;
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
  draft: Record<string, string>;
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
  configuredSecretFieldKeys: ReadonlySet<string>;
  draft: Record<string, string>;
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
  setupStartFormState: Pick<
    IntegrationConnectionSetupStartFormState,
    "isFieldVisible" | "resolveRequiredValue" | "values"
  >;
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

export function updateGitHubProviderAppManifestForSetupStartFormValue(input: {
  fieldName: string;
  manifestValue: string;
  value: string;
}): string {
  if (input.fieldName !== GitHubProviderAppManifestOwnerKindFieldName) {
    return input.manifestValue;
  }

  if (
    input.value !== GitHubProviderAppManifestOrganizationOwnerKind &&
    input.value !== GitHubProviderAppManifestPersonalOwnerKind
  ) {
    throw new Error(`Unsupported GitHub App manifest owner kind '${input.value}'.`);
  }

  if (validateManifestJsonObject(input.manifestValue).status === "invalid") {
    return input.manifestValue;
  }

  const manifest = parseManifestJsonObject(input.manifestValue);
  const defaultPermissions = parseDefaultPermissions(manifest.default_permissions);
  for (const permission of Object.keys(GitHubOrganizationOnlyAppManifestPermissions)) {
    delete defaultPermissions[permission];
  }
  const defaultEvents = parseDefaultEvents(manifest.default_events).filter(
    (event) => !GitHubOrganizationOnlyAppManifestEvents.includes(event),
  );

  if (input.value === GitHubProviderAppManifestOrganizationOwnerKind) {
    return createManifestJsonDraft({
      ...manifest,
      default_events: [...defaultEvents, ...GitHubOrganizationOnlyAppManifestEvents],
      default_permissions: {
        ...defaultPermissions,
        ...GitHubOrganizationOnlyAppManifestPermissions,
      },
    });
  }

  return createManifestJsonDraft({
    ...manifest,
    default_events: defaultEvents,
    default_permissions: defaultPermissions,
  });
}

export function buildProviderAppSetupConfigFieldInputs(input: {
  draft: Record<string, string>;
  providerAppSetup: IntegrationFormConnectionMethodProviderAppSetup;
  routeSegment: string;
}): readonly {
  fieldKey: string;
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
  configuredSecretFieldKeys: ReadonlySet<string>;
  draft: Record<string, string>;
  providerAppSetup: IntegrationFormConnectionMethodProviderAppSetup;
  routeSegment: string;
}): readonly {
  configured: boolean;
  fieldKey: string;
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

function parseDefaultPermissions(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

function parseDefaultEvents(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((event) => typeof event === "string");
}
