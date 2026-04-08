import type { AnyIntegrationDefinition } from "@mistle/integrations-core";
import { createBrowserIntegrationRegistry } from "@mistle/integrations-definitions/browser";
import { createOpenAiRawBindingCapabilities } from "@mistle/integrations-definitions/openai";
import { useState } from "react";
import type React from "react";

import {
  IntegrationConnectionDialog,
  type IntegrationConnectionMethodId,
} from "../integrations/integration-connection-dialog.js";
import type { IntegrationConnectionMethod } from "../integrations/integrations-service-shared.js";
import type { OpenIntegrationConnectionDialogInput } from "./integration-connection-dialog-state-types.js";
import {
  type OrganizationIntegrationsSettingsPageCard,
  OrganizationIntegrationsSettingsPageView,
} from "./organization-integrations-settings-page-view.js";
import {
  createOpenIntegrationConnectionDialogState,
  hasIntegrationConnectionDialogChanges,
  isIntegrationConnectionDisplayNameChanged,
  resolveConnectionMethodFormUiModel,
  resolveDefaultMethodId,
  resolveIntegrationConnectionDialogValidationError,
  resolveNextDraftForMethodChange,
} from "./use-integration-connection-dialog-state-helpers.js";

const IntegrationRegistry = createBrowserIntegrationRegistry();
type BuiltInIntegrationVariantId =
  | "github-cloud"
  | "github-enterprise-server"
  | "jira-default"
  | "linear-default"
  | "openai-default";

type StoryIntegrationSpec = {
  cardDescription?: string;
  connectError?: string | null;
  initialMethodId?: IntegrationConnectionMethodId;
  initialSecrets?: Record<string, string>;
  pending?: boolean;
  targetKey?: string;
  variantId: BuiltInIntegrationVariantId;
};

function getDefinitionOrThrow(input: {
  familyId: string;
  variantId: BuiltInIntegrationVariantId;
}): AnyIntegrationDefinition {
  const definition = IntegrationRegistry.getDefinition({
    familyId: input.familyId,
    variantId: input.variantId,
  });
  if (definition === null) {
    throw new Error(
      `Missing browser integration definition '${input.familyId}/${input.variantId}' for Storybook.`,
    );
  }

  if (definition === undefined) {
    throw new Error(
      `Browser integration definition '${input.familyId}/${input.variantId}' resolved to undefined.`,
    );
  }

  return definition;
}

function getStoryDefinitionOrThrow(
  variantId: BuiltInIntegrationVariantId,
): AnyIntegrationDefinition {
  if (variantId === "github-cloud" || variantId === "github-enterprise-server") {
    return getDefinitionOrThrow({
      familyId: "github",
      variantId,
    });
  }

  if (variantId === "jira-default") {
    return getDefinitionOrThrow({
      familyId: "jira",
      variantId,
    });
  }

  if (variantId === "linear-default") {
    return getDefinitionOrThrow({
      familyId: "linear",
      variantId,
    });
  }

  return getDefinitionOrThrow({
    familyId: "openai",
    variantId,
  });
}

function resolveConnectionMethodsOrThrow(
  definition: AnyIntegrationDefinition,
): readonly IntegrationConnectionMethod[] {
  if (definition.connectionMethods === undefined || definition.connectionMethods.length === 0) {
    throw new Error(
      `Integration definition '${definition.familyId}/${definition.variantId}' has no connection methods.`,
    );
  }

  return definition.connectionMethods.map((method) => {
    if (method.kind === "form") {
      return {
        id: method.id,
        kind: method.kind,
        label: method.label,
        secretFields: method.secretFields.map((secretField) => ({
          description: secretField.description,
          inputType: secretField.inputType,
          label: secretField.label,
          name: secretField.name,
          placeholder: secretField.placeholder,
        })),
      };
    }

    return {
      id: method.id,
      kind: method.kind,
      label: method.label,
      ui: method.ui,
    };
  });
}

function resolveDescriptionOrThrow(definition: AnyIntegrationDefinition): string {
  if (definition.description === undefined) {
    throw new Error(
      `Integration definition '${definition.familyId}/${definition.variantId}' is missing a description.`,
    );
  }

  return definition.description;
}

function createTargetConfig(variantId: BuiltInIntegrationVariantId): Record<string, unknown> {
  if (variantId === "github-cloud") {
    return {
      api_base_url: "https://api.github.com",
      web_base_url: "https://github.com",
      app_id: "17452",
      app_slug: "mistle-cloud",
      client_id: "Iv1.cloudstorybook",
    };
  }

  if (variantId === "github-enterprise-server") {
    return {
      api_base_url: "https://github.acme.example/api/v3",
      web_base_url: "https://github.acme.example",
      app_id: "88421",
      app_slug: "mistle-ghes",
      client_id: "Iv1.ghesstorybook",
    };
  }

  if (variantId === "openai-default") {
    return {
      api_base_url: "https://api.openai.com/v1",
      binding_capabilities: createOpenAiRawBindingCapabilities(),
    };
  }

  return {};
}

function createConnectedCards(): readonly OrganizationIntegrationsSettingsPageCard[] {
  return [
    {
      actionLabel: "View",
      configStatus: "valid",
      description: "1 connection",
      displayName: "GitHub",
      logoKey: "github",
      onAction: () => {},
      targetKey: "github-cloud",
    },
  ];
}

function createDialogInput(
  spec: StoryIntegrationSpec,
): Extract<OpenIntegrationConnectionDialogInput, { mode: "create" }> {
  const definition = getStoryDefinitionOrThrow(spec.variantId);
  const methods = resolveConnectionMethodsOrThrow(definition);

  return {
    mode: "create",
    methods,
    targetConfig: createTargetConfig(spec.variantId),
    targetDisplayName: definition.displayName,
    targetFamilyId: definition.familyId,
    targetKey: spec.targetKey ?? definition.variantId,
    targetVariantId: definition.variantId,
  };
}

export function createAvailableCardsOverview(): readonly OrganizationIntegrationsSettingsPageCard[] {
  const specs: readonly StoryIntegrationSpec[] = [
    { variantId: "jira-default" },
    { variantId: "github-cloud" },
    { variantId: "github-enterprise-server" },
    { variantId: "linear-default" },
    { variantId: "openai-default" },
  ];

  return specs.map((spec) => {
    const definition = getStoryDefinitionOrThrow(spec.variantId);

    return {
      actionLabel: "Add",
      configStatus: "valid",
      description: resolveDescriptionOrThrow(definition),
      displayName: definition.displayName,
      ...(definition.logoKey === undefined ? {} : { logoKey: definition.logoKey }),
      onAction: () => {},
      targetKey: definition.variantId,
    };
  });
}

export function IntegrationSettingsAddFlowStory(spec: StoryIntegrationSpec): React.JSX.Element {
  const openInput = createDialogInput(spec);
  const defaultMethodId =
    spec.initialMethodId ??
    resolveDefaultMethodId(
      resolveConnectionMethodsOrThrow(getStoryDefinitionOrThrow(spec.variantId)),
    );
  const initialState = createOpenIntegrationConnectionDialogState({
    defaultMethodId,
    openInput,
  });
  const startsWithoutSelectedMethod =
    openInput.methods.length > 1 && spec.initialMethodId === undefined;
  const [draft, setDraft] = useState(() => ({
    ...initialState.draft,
    connectionDisplayNameValue: "",
    error: spec.connectError ?? initialState.draft.error,
    methodId: startsWithoutSelectedMethod ? "" : initialState.draft.methodId,
    secrets: spec.initialSecrets ?? initialState.draft.secrets,
  }));

  const dialog = initialState.dialog;
  const configForm =
    draft.methodId.length === 0
      ? {
          mode: "none" as const,
        }
      : resolveConnectionMethodFormUiModel({
          dialog,
          methodId: draft.methodId,
          currentValue: draft.configValue,
        });
  const definition = getStoryDefinitionOrThrow(spec.variantId);
  const availableCards: readonly OrganizationIntegrationsSettingsPageCard[] = [
    {
      actionLabel: "Add",
      configStatus: "valid",
      description: spec.cardDescription ?? resolveDescriptionOrThrow(definition),
      displayName: openInput.targetDisplayName,
      ...(definition.logoKey === undefined ? {} : { logoKey: definition.logoKey }),
      onAction: () => {},
      targetKey: openInput.targetKey,
    },
  ];

  return (
    <OrganizationIntegrationsSettingsPageView
      availableCards={availableCards}
      connectedCards={createConnectedCards()}
      connectionDialog={
        <IntegrationConnectionDialog
          configForm={configForm}
          configValue={draft.configValue}
          connectionDisplayNamePlaceholder={draft.connectionDisplayNamePlaceholder}
          connectionDisplayNameValue={draft.connectionDisplayNameValue}
          connectError={draft.error}
          dialog={dialog}
          hasChanges={hasIntegrationConnectionDialogChanges({
            dialog,
            configValue: draft.configValue,
            connectionDisplayNamePlaceholder: draft.connectionDisplayNamePlaceholder,
            connectionDisplayNameValue: draft.connectionDisplayNameValue,
            initialConfigValue: draft.initialConfigValue,
            secrets: draft.secrets,
          })}
          isConnectionDisplayNameChanged={isIntegrationConnectionDisplayNameChanged({
            dialog,
            connectionDisplayNamePlaceholder: draft.connectionDisplayNamePlaceholder,
            connectionDisplayNameValue: draft.connectionDisplayNameValue,
          })}
          isSecretChanged={Object.values(draft.secrets).some((value) => value.trim().length > 0)}
          methodId={draft.methodId}
          onClose={() => {}}
          onConfigChange={(value) => {
            setDraft((currentDraft) => ({
              ...currentDraft,
              configValue: value,
              error: null,
            }));
          }}
          onConnectionDisplayNameChange={(value) => {
            setDraft((currentDraft) => ({
              ...currentDraft,
              connectionDisplayNameValue: value,
              error: null,
            }));
          }}
          onMethodChange={(methodId) => {
            setDraft((currentDraft) =>
              resolveNextDraftForMethodChange({
                dialog,
                nextMethodId: methodId,
                currentDraft,
              }),
            );
          }}
          onSecretChange={(name, value) => {
            setDraft((currentDraft) => ({
              ...currentDraft,
              error: null,
              secrets: {
                ...currentDraft.secrets,
                [name]: value,
              },
            }));
          }}
          onSubmit={() => {
            setDraft((currentDraft) => ({
              ...currentDraft,
              error:
                currentDraft.methodId.length === 0
                  ? "Authentication method is required."
                  : (resolveIntegrationConnectionDialogValidationError({
                      dialog,
                      methodId: currentDraft.methodId,
                      connectionDisplayNameValue: currentDraft.connectionDisplayNameValue,
                      secrets: currentDraft.secrets,
                    }) ?? null),
            }));
          }}
          pending={spec.pending ?? false}
          secrets={draft.secrets}
        />
      }
      isLoading={false}
      loadErrorMessage={null}
    />
  );
}

export const AddFlowStorySpecs = {
  GitHubCloud: {
    variantId: "github-cloud",
  },
  GitHubEnterpriseServer: {
    variantId: "github-enterprise-server",
  },
  Jira: {
    variantId: "jira-default",
  },
  Linear: {
    variantId: "linear-default",
  },
  OpenAI: {
    variantId: "openai-default",
  },
} satisfies Record<string, StoryIntegrationSpec>;
