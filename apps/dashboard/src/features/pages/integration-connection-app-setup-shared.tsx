import { useState } from "react";

import {
  ConfiguredSecretField,
  SavingTextField,
  type SavingFieldState,
} from "../forms/configured-secret-field.js";
import { createManifestJsonDraft } from "../integrations/manifest-json-editor.js";
import type { ManifestWebhookCallbackState } from "../integrations/manifest-webhook-callback-state.js";
import { SectionHeader } from "../shared/section-header.js";
import {
  type IntegrationSetupAppManifestDraftBuilder,
  resolveManifestDraftControlPlaneBaseUrl,
} from "./integration-connection-setup-manifest-draft.js";

type ExistingAppSetupTextField<FieldKey extends string> = {
  fieldKey: FieldKey;
  id: string;
  label: string;
  required?: boolean;
  value: string;
};

type ExistingAppSetupSecretField<SecretFieldKey extends string> = {
  fieldKey: SecretFieldKey;
  id: string;
  label: string;
  secretLabel: string;
  value: string;
  configured: boolean;
  required?: boolean;
  placeholder?: string;
  replacementStaged?: boolean;
  rows?: number;
  type?: "password";
  multiline?: boolean;
};

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

export function useSetupManifestDraft(input: {
  manifestDraftBuilder: IntegrationSetupAppManifestDraftBuilder;
  webhookCallbackState: ManifestWebhookCallbackState;
}): {
  manifestValue: string;
  onManifestChange: (nextValue: string) => void;
} {
  const [manifestValue, setManifestValue] = useState("");
  const [hasEditedManifest, setHasEditedManifest] = useState(false);
  const webhookCallbackUrl =
    input.webhookCallbackState.kind === "ready" ? input.webhookCallbackState.value : null;
  const resolvedManifestValue =
    webhookCallbackUrl === null || hasEditedManifest
      ? manifestValue
      : createManifestJsonDraft(
          input.manifestDraftBuilder({
            controlPlaneBaseUrl: resolveManifestDraftControlPlaneBaseUrl({
              webhookCallbackUrl,
            }),
            webhookCallbackUrl,
          }),
        );

  function onManifestChange(nextValue: string): void {
    setHasEditedManifest(true);
    setManifestValue(nextValue);
  }

  return {
    manifestValue: resolvedManifestValue,
    onManifestChange,
  };
}

export function ExistingAppSetupFieldsPanel<FieldKey extends string>(input: {
  configFields: readonly ExistingAppSetupTextField<FieldKey>[];
  description: string;
  isSaving?: boolean;
  onUpdateFieldDraft: (fieldKey: FieldKey, nextValue: string) => void;
  secretFields: readonly ExistingAppSetupSecretField<FieldKey>[];
  title: string;
}): React.JSX.Element {
  const fieldState = input.isSaving === true ? SavingFieldStateValue : IdleFieldState;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <SectionHeader description={input.description} title={input.title} />
        {input.configFields.map((field) => (
          <SavingTextField
            fieldState={fieldState}
            id={field.id}
            key={field.fieldKey}
            label={field.label}
            onBlur={noop}
            onChange={(nextValue) => {
              input.onUpdateFieldDraft(field.fieldKey, nextValue);
            }}
            {...(field.required === undefined ? {} : { required: field.required })}
            value={field.value}
          />
        ))}
      </div>

      <div className="flex flex-col gap-4">
        <SectionHeader title="Secrets" />
        {input.secretFields.map((field) => (
          <ConfiguredSecretField
            confirmReplacement={false}
            configured={field.configured}
            fieldState={fieldState}
            id={field.id}
            key={field.fieldKey}
            label={field.label}
            {...(field.multiline === undefined ? {} : { multiline: field.multiline })}
            onChange={(nextValue) => {
              input.onUpdateFieldDraft(field.fieldKey, nextValue);
            }}
            {...(field.placeholder === undefined ? {} : { placeholder: field.placeholder })}
            {...(field.replacementStaged === undefined
              ? {}
              : { replacementStaged: field.replacementStaged })}
            {...(field.required === undefined ? {} : { required: field.required })}
            {...(field.rows === undefined ? {} : { rows: field.rows })}
            secretLabel={field.secretLabel}
            {...(field.type === undefined ? {} : { type: field.type })}
            value={field.value}
          />
        ))}
      </div>
    </div>
  );
}
