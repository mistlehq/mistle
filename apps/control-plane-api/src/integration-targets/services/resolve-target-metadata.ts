import type { IntegrationTarget as PersistedIntegrationTarget } from "@mistle/db/control-plane";
import type {
  IntegrationConnectionMethodDetailFieldSource,
  IntegrationConnectionMethodDetailFieldSourceLeaf,
  IntegrationConnectionMethodDetailMetadata,
  IntegrationConnectionMethodDefinition,
  IntegrationFormConnectionMethodPostCreateMetadata,
  IntegrationFormConnectionMethodSetupCompletionRequirement,
  IntegrationFormConnectionMethodSetupCompletionRequirementLeaf,
  IntegrationFormConnectionMethodProviderAppSetup,
  IntegrationFormConnectionMethodSetupPaneMetadata,
  IntegrationFormConnectionMethodSetupStartForm,
  IntegrationKind,
  IntegrationWebhookEventDefinition,
  IntegrationWebhookEventParameterDefinition,
  IntegrationWebhookEventParameterGroupDefinition,
  IntegrationWebhookSourceLifecycle,
} from "@mistle/integrations-core";
import { createIntegrationRegistry } from "@mistle/integrations-definitions/server";

const IntegrationRegistry = createIntegrationRegistry();

function getTargetDefinition(input: { familyId: string; variantId: string }) {
  return IntegrationRegistry.getDefinition({
    familyId: input.familyId,
    variantId: input.variantId,
  });
}

type RegisteredIntegrationDefinition = NonNullable<ReturnType<typeof getTargetDefinition>>;

export function hasTargetDefinition(input: { familyId: string; variantId: string }): boolean {
  return getTargetDefinition(input) !== undefined;
}

type ResolvedWebhookEventParameter =
  | {
      id: string;
      label: string;
      kind: "resource-select";
      resourceKind: string;
      payloadPath: string[];
      negatedMatchRequiresExists?: boolean;
      prefix?: string;
      placeholder?: string;
    }
  | {
      id: string;
      label: string;
      kind: "string";
      payloadPath: string[];
      matchMode?: "eq" | "contains" | "contains_token";
      defaultValue?: string;
      defaultEnabled?: boolean;
      controlVariant?: "invocation-token";
      negatedMatchRequiresExists?: boolean;
      prefix?: string;
      placeholder?: string;
    }
  | {
      id: string;
      label: string;
      kind: "enum-select";
      payloadPath: string[];
      matchMode: "eq" | "exists";
      options: {
        value: string;
        label: string;
      }[];
      negatedMatchRequiresExists?: boolean;
      prefix?: string;
      placeholder?: string;
    };

type ResolvedWebhookEventParameterGroup = {
  id: string;
  label: string;
  kind: "oneOf";
  options: {
    parameterId: string;
    label: string;
  }[];
};

type ResolvedWebhookEvent = {
  eventType: string;
  providerEventType: string;
  displayName: string;
  category?: string;
  requirements?: {
    anyOf: {
      label?: string;
      event?: string;
      permissions?: {
        permission: string;
        access?: string;
      }[];
    }[];
  };
  payloadReferences?: {
    path: string[];
    description: string;
  }[];
  conversationKeyOptions?: {
    id: string;
    label: string;
    description: string;
    template: string;
  }[];
  parameters?: ResolvedWebhookEventParameter[];
  parameterGroups?: ResolvedWebhookEventParameterGroup[];
};

export type ResolvedIntegrationTargetMetadata = {
  kind: IntegrationKind;
  displayName: string;
  description: string;
  logoKey?: string;
  connectionMethods?: (
    | {
        id: string;
        label: string;
        kind: "form";
        connectionDetail?: IntegrationConnectionMethodDetailMetadata;
        createBehavior?: "single-step" | "draft-then-setup";
        postCreate?: IntegrationFormConnectionMethodPostCreateMetadata;
        setupFlow?: {
          completionRequirements?: ResolvedSetupCompletionRequirement;
          providerAppSetup?: IntegrationFormConnectionMethodProviderAppSetup;
          routeSegment: string;
          setupPane?: IntegrationFormConnectionMethodSetupPaneMetadata;
          startForm?: IntegrationFormConnectionMethodSetupStartForm;
        };
        secretFields: {
          name: string;
          label: string;
          placeholder?: string;
          description?: string;
          optional: boolean;
          inputType: "password" | "text" | "textarea";
          slotKey: string;
        }[];
      }
    | {
        id: string;
        label: string;
        kind: "redirect";
        connectionDetail?: IntegrationConnectionMethodDetailMetadata;
        ui: {
          create: {
            submitLabel: string;
            helperText: string;
            showCallbackUrl?: boolean | undefined;
          };
          reauthorize?: {
            actionLabel: string;
            pendingLabel: string;
          };
        };
      }
    | {
        id: string;
        label: string;
        kind: "device-authorization";
        connectionDetail?: IntegrationConnectionMethodDetailMetadata;
        ui: {
          create: {
            submitLabel: string;
          };
          pending?: {
            title?: string;
            description?: string;
          };
        };
      }
  )[];
  webhookSource?: {
    lifecycle: IntegrationWebhookSourceLifecycle;
    requiresSourceSelection: boolean;
  };
  supportedWebhookEvents?: ResolvedWebhookEvent[];
};

type ResolvedSetupCompletionRequirement =
  | IntegrationFormConnectionMethodSetupCompletionRequirementLeaf
  | {
      anyOf: IntegrationFormConnectionMethodSetupCompletionRequirementLeaf[];
      kind: "any-of";
    }
  | {
      allOf: IntegrationFormConnectionMethodSetupCompletionRequirementLeaf[];
      kind: "all-of";
    };

function resolveConnectionMethod(
  method: IntegrationConnectionMethodDefinition,
): NonNullable<ResolvedIntegrationTargetMetadata["connectionMethods"]>[number] {
  if (method.kind === "form") {
    return {
      id: method.id,
      label: method.label,
      kind: "form",
      ...(method.connectionDetail === undefined
        ? {}
        : { connectionDetail: cloneConnectionMethodDetailMetadata(method.connectionDetail) }),
      ...(method.createBehavior === undefined ? {} : { createBehavior: method.createBehavior }),
      ...(method.postCreate === undefined
        ? {}
        : { postCreate: cloneFormConnectionMethodPostCreateMetadata(method.postCreate) }),
      ...(method.setupFlow === undefined
        ? {}
        : {
            setupFlow: {
              ...(method.setupFlow.completionRequirements === undefined
                ? {}
                : {
                    completionRequirements: cloneSetupCompletionRequirement(
                      method.setupFlow.completionRequirements,
                    ),
                  }),
              ...(method.setupFlow.providerAppSetup === undefined
                ? {}
                : {
                    providerAppSetup: cloneProviderAppSetup(method.setupFlow.providerAppSetup),
                  }),
              routeSegment: method.setupFlow.routeSegment,
              ...(method.setupFlow.setupPane === undefined
                ? {}
                : {
                    setupPane: cloneSetupPaneMetadata(method.setupFlow.setupPane),
                  }),
              ...(method.setupFlow.startForm === undefined
                ? {}
                : {
                    startForm: cloneSetupStartForm(method.setupFlow.startForm),
                  }),
            },
          }),
      secretFields: method.secretFields.map((field) => ({
        name: field.name,
        label: field.label,
        ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
        ...(field.description === undefined ? {} : { description: field.description }),
        optional: field.optional ?? false,
        inputType: field.inputType,
        slotKey: field.slotKey,
      })),
    };
  }

  if (method.kind === "device-authorization") {
    return {
      id: method.id,
      label: method.label,
      kind: "device-authorization",
      ...(method.connectionDetail === undefined
        ? {}
        : { connectionDetail: cloneConnectionMethodDetailMetadata(method.connectionDetail) }),
      ui: method.ui,
    };
  }

  return {
    id: method.id,
    label: method.label,
    kind: "redirect",
    ...(method.connectionDetail === undefined
      ? {}
      : { connectionDetail: cloneConnectionMethodDetailMetadata(method.connectionDetail) }),
    ui: {
      create: method.ui.create,
      ...(method.ui.reauthorize === undefined
        ? {}
        : {
            reauthorize: method.ui.reauthorize,
          }),
    },
  };
}

function cloneProviderAppSetup(
  setup: IntegrationFormConnectionMethodProviderAppSetup,
): IntegrationFormConnectionMethodProviderAppSetup {
  return {
    description: setup.description,
    ...(setup.installedNoticeTitle === undefined
      ? {}
      : { installedNoticeTitle: setup.installedNoticeTitle }),
    existingApp: {
      configFields: setup.existingApp.configFields.map((field) => ({
        configKey: field.configKey,
        label: field.label,
        name: field.name,
        required: field.required,
      })),
      connectLabel: setup.existingApp.connectLabel,
      description: setup.existingApp.description,
      installedDetection: {
        configFields: [...setup.existingApp.installedDetection.configFields],
        secretFields: [...setup.existingApp.installedDetection.secretFields],
      },
      saveErrorMessage: setup.existingApp.saveErrorMessage,
      secretFields: setup.existingApp.secretFields.map((field) => ({
        inputType: field.inputType,
        label: field.label,
        name: field.name,
        ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
        ...(field.rows === undefined ? {} : { rows: field.rows }),
        required: field.required,
        secretLabel: field.secretLabel,
      })),
      ...(setup.existingApp.startAction === undefined
        ? {}
        : {
            startAction: {
              expectedResultKind: setup.existingApp.startAction.expectedResultKind,
              ...(setup.existingApp.startAction.installedDetection === undefined
                ? {}
                : {
                    installedDetection: {
                      ...(setup.existingApp.startAction.installedDetection.configFields ===
                      undefined
                        ? {}
                        : {
                            configFields: [
                              ...setup.existingApp.startAction.installedDetection.configFields,
                            ],
                          }),
                      ...(setup.existingApp.startAction.installedDetection.externalSubject ===
                      undefined
                        ? {}
                        : {
                            externalSubject:
                              setup.existingApp.startAction.installedDetection.externalSubject,
                          }),
                    },
                  }),
              installedLabel: setup.existingApp.startAction.installedLabel,
              ...(setup.existingApp.startAction.installedOpensInNewWindow === undefined
                ? {}
                : {
                    installedOpensInNewWindow:
                      setup.existingApp.startAction.installedOpensInNewWindow,
                  }),
              ...(setup.existingApp.startAction.pendingLabel === undefined
                ? {}
                : { pendingLabel: setup.existingApp.startAction.pendingLabel }),
              routeSegment: setup.existingApp.startAction.routeSegment,
              startErrorMessage: setup.existingApp.startAction.startErrorMessage,
              unexpectedResultMessage: setup.existingApp.startAction.unexpectedResultMessage,
              windowTitle: setup.existingApp.startAction.windowTitle,
            },
          }),
      title: setup.existingApp.title,
    },
    manifest: {
      createErrorMessage: setup.manifest.createErrorMessage,
      description: setup.manifest.description,
      startAction: {
        expectedResultKind: setup.manifest.startAction.expectedResultKind,
        manifestBodyField: setup.manifest.startAction.manifestBodyField,
        unexpectedResultMessage: setup.manifest.startAction.unexpectedResultMessage,
      },
      title: setup.manifest.title,
    },
    title: setup.title,
    urls: {
      description: setup.urls.description,
      ...(setup.urls.setupCallback === undefined
        ? {}
        : {
            setupCallback: {
              label: setup.urls.setupCallback.label,
              path: setup.urls.setupCallback.path,
            },
          }),
      title: setup.urls.title,
      webhookCallback: {
        errorTitle: setup.urls.webhookCallback.errorTitle,
        label: setup.urls.webhookCallback.label,
        missingMessage: setup.urls.webhookCallback.missingMessage,
        missingTitle: setup.urls.webhookCallback.missingTitle,
      },
    },
  };
}

function cloneSetupPaneMetadata(
  metadata: IntegrationFormConnectionMethodSetupPaneMetadata,
): IntegrationFormConnectionMethodSetupPaneMetadata {
  return {
    kind: metadata.kind,
  };
}

function cloneSetupStartForm(
  startForm: IntegrationFormConnectionMethodSetupStartForm,
): IntegrationFormConnectionMethodSetupStartForm {
  return {
    submitLabel: startForm.submitLabel,
    fields: startForm.fields.map((field) => ({
      ...(field.actions === undefined
        ? {}
        : {
            actions: field.actions.map((action) => ({
              href: action.href,
              label: action.label,
              ...(action.opensInNewWindow === undefined
                ? {}
                : { opensInNewWindow: action.opensInNewWindow }),
            })),
          }),
      ...(field.description === undefined ? {} : { description: field.description }),
      inputType: field.inputType,
      label: field.label,
      name: field.name,
      ...(field.options === undefined
        ? {}
        : {
            options: field.options.map((option) => ({
              label: option.label,
              value: option.value,
            })),
          }),
      ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
      ...(field.required === undefined ? {} : { required: field.required }),
      ...(field.visibleWhen === undefined
        ? {}
        : {
            visibleWhen: {
              field: field.visibleWhen.field,
              value: field.visibleWhen.value,
            },
          }),
    })),
  };
}

function cloneFormConnectionMethodPostCreateMetadata(
  metadata: IntegrationFormConnectionMethodPostCreateMetadata,
): IntegrationFormConnectionMethodPostCreateMetadata {
  if (metadata.managedWebhookSource === undefined) {
    return {};
  }

  return {
    managedWebhookSource: {
      ...(metadata.managedWebhookSource.autoCreate === undefined
        ? {}
        : { autoCreate: metadata.managedWebhookSource.autoCreate }),
      failureNoticeTitle: metadata.managedWebhookSource.failureNoticeTitle,
      successNoticeTitle: metadata.managedWebhookSource.successNoticeTitle,
    },
  };
}

function cloneConnectionMethodDetailMetadata(
  metadata: IntegrationConnectionMethodDetailMetadata,
): IntegrationConnectionMethodDetailMetadata {
  if (metadata.installation === undefined) {
    return {};
  }

  return {
    installation: {
      ...(metadata.installation.actionLabel === undefined
        ? {}
        : { actionLabel: metadata.installation.actionLabel }),
      ...(metadata.installation.fields === undefined
        ? {}
        : {
            fields: metadata.installation.fields.map((field) => ({
              label: field.label,
              ...(field.required === undefined ? {} : { required: field.required }),
              source: cloneConnectionMethodDetailFieldSource(field.source),
            })),
          }),
      ...(metadata.installation.hideWebhookSourceSection === undefined
        ? {}
        : { hideWebhookSourceSection: metadata.installation.hideWebhookSourceSection }),
      ...(metadata.installation.includeWebhookCallbackUrl === undefined
        ? {}
        : { includeWebhookCallbackUrl: metadata.installation.includeWebhookCallbackUrl }),
      ...(metadata.installation.postInstallationSetupPath === undefined
        ? {}
        : { postInstallationSetupPath: metadata.installation.postInstallationSetupPath }),
    },
  };
}

function cloneConnectionMethodDetailFieldSource(
  source: IntegrationConnectionMethodDetailFieldSource,
): IntegrationConnectionMethodDetailFieldSource {
  if (source.kind === "connection-external-subject") {
    return { kind: source.kind };
  }

  if (source.kind === "first-of") {
    return {
      kind: source.kind,
      sources: source.sources.map(cloneConnectionMethodDetailFieldSourceLeaf),
    };
  }

  return cloneConnectionMethodDetailFieldSourceLeaf(source);
}

function cloneConnectionMethodDetailFieldSourceLeaf(
  source: IntegrationConnectionMethodDetailFieldSourceLeaf,
): IntegrationConnectionMethodDetailFieldSourceLeaf {
  if (source.kind === "connection-external-subject") {
    return { kind: source.kind };
  }

  return {
    kind: source.kind,
    field: source.field,
  };
}

function cloneSetupCompletionRequirement(
  requirement: IntegrationFormConnectionMethodSetupCompletionRequirement,
): ResolvedSetupCompletionRequirement {
  if (requirement.kind === "any-of") {
    return {
      kind: requirement.kind,
      anyOf: requirement.anyOf.map(cloneSetupCompletionRequirementLeaf),
    };
  }

  if (requirement.kind === "all-of") {
    return {
      kind: requirement.kind,
      allOf: requirement.allOf.map(cloneSetupCompletionRequirementLeaf),
    };
  }

  return cloneSetupCompletionRequirementLeaf(requirement);
}

function cloneSetupCompletionRequirementLeaf(
  requirement: IntegrationFormConnectionMethodSetupCompletionRequirementLeaf,
): IntegrationFormConnectionMethodSetupCompletionRequirementLeaf {
  if (requirement.kind === "connection-external-subject") {
    return {
      kind: requirement.kind,
    };
  }

  return {
    kind: requirement.kind,
    field: requirement.field,
  };
}

function cloneWebhookEventParameter(
  parameter: IntegrationWebhookEventParameterDefinition,
): ResolvedWebhookEventParameter {
  if (parameter.kind === "resource-select") {
    return {
      id: parameter.id,
      label: parameter.label,
      kind: parameter.kind,
      resourceKind: parameter.resourceKind,
      payloadPath: [...parameter.payloadPath],
      ...(parameter.negatedMatchRequiresExists === undefined
        ? {}
        : { negatedMatchRequiresExists: parameter.negatedMatchRequiresExists }),
      ...(parameter.prefix === undefined ? {} : { prefix: parameter.prefix }),
      ...(parameter.placeholder === undefined ? {} : { placeholder: parameter.placeholder }),
    };
  }

  if (parameter.kind === "enum-select") {
    return {
      id: parameter.id,
      label: parameter.label,
      kind: parameter.kind,
      payloadPath: [...parameter.payloadPath],
      matchMode: parameter.matchMode,
      options: parameter.options.map((option) => ({
        value: option.value,
        label: option.label,
      })),
      ...(parameter.negatedMatchRequiresExists === undefined
        ? {}
        : { negatedMatchRequiresExists: parameter.negatedMatchRequiresExists }),
      ...(parameter.prefix === undefined ? {} : { prefix: parameter.prefix }),
      ...(parameter.placeholder === undefined ? {} : { placeholder: parameter.placeholder }),
    };
  }

  return {
    id: parameter.id,
    label: parameter.label,
    kind: parameter.kind,
    payloadPath: [...parameter.payloadPath],
    ...(parameter.matchMode === undefined ? {} : { matchMode: parameter.matchMode }),
    ...(parameter.defaultValue === undefined ? {} : { defaultValue: parameter.defaultValue }),
    ...(parameter.defaultEnabled === undefined ? {} : { defaultEnabled: parameter.defaultEnabled }),
    ...(parameter.controlVariant === undefined ? {} : { controlVariant: parameter.controlVariant }),
    ...(parameter.negatedMatchRequiresExists === undefined
      ? {}
      : { negatedMatchRequiresExists: parameter.negatedMatchRequiresExists }),
    ...(parameter.prefix === undefined ? {} : { prefix: parameter.prefix }),
    ...(parameter.placeholder === undefined ? {} : { placeholder: parameter.placeholder }),
  };
}

function cloneWebhookEventParameterGroups(
  parameterGroups: readonly IntegrationWebhookEventParameterGroupDefinition[],
): ResolvedWebhookEventParameterGroup[] {
  return parameterGroups.map((parameterGroup) => ({
    id: parameterGroup.id,
    label: parameterGroup.label,
    kind: parameterGroup.kind,
    options: parameterGroup.options.map((option) => ({
      parameterId: option.parameterId,
      label: option.label,
    })),
  }));
}

function cloneWebhookEvents(
  events: readonly IntegrationWebhookEventDefinition[],
): ResolvedWebhookEvent[] {
  return events.map((eventDefinition) => ({
    eventType: eventDefinition.eventType,
    providerEventType: eventDefinition.providerEventType,
    displayName: eventDefinition.displayName,
    ...(eventDefinition.category === undefined ? {} : { category: eventDefinition.category }),
    ...(eventDefinition.requirements === undefined
      ? {}
      : {
          requirements: {
            anyOf: eventDefinition.requirements.anyOf.map((requirementSet) => ({
              ...(requirementSet.label === undefined ? {} : { label: requirementSet.label }),
              ...(requirementSet.event === undefined ? {} : { event: requirementSet.event }),
              ...(requirementSet.permissions === undefined
                ? {}
                : {
                    permissions: requirementSet.permissions.map((permission) => ({
                      permission: permission.permission,
                      ...(permission.access === undefined ? {} : { access: permission.access }),
                    })),
                  }),
            })),
          },
        }),
    ...(eventDefinition.payloadReferences === undefined
      ? {}
      : {
          payloadReferences: eventDefinition.payloadReferences.map((payloadReference) => ({
            path: [...payloadReference.path],
            description: payloadReference.description,
          })),
        }),
    ...(eventDefinition.conversationKeyOptions === undefined
      ? {}
      : {
          conversationKeyOptions: eventDefinition.conversationKeyOptions.map((option) => ({
            id: option.id,
            label: option.label,
            description: option.description,
            template: option.template,
          })),
        }),
    ...(eventDefinition.parameters === undefined
      ? {}
      : {
          parameters: eventDefinition.parameters.map((parameter) =>
            cloneWebhookEventParameter(parameter),
          ),
        }),
    ...(eventDefinition.parameterGroups === undefined
      ? {}
      : {
          parameterGroups: cloneWebhookEventParameterGroups(eventDefinition.parameterGroups),
        }),
  }));
}

export function resolveTargetMetadata(input: {
  familyId: string;
  variantId: string;
  displayNameOverride: string | null;
  descriptionOverride: string | null;
}): ResolvedIntegrationTargetMetadata {
  const definition = getTargetDefinition({
    familyId: input.familyId,
    variantId: input.variantId,
  });

  if (definition === undefined) {
    throw new Error(
      `Integration definition '${input.familyId}::${input.variantId}' was not found.`,
    );
  }

  if (definition.description === undefined || definition.description.trim().length === 0) {
    if (input.descriptionOverride !== null) {
      return buildResolvedIntegrationTargetMetadata({
        definition,
        displayName: input.displayNameOverride ?? definition.displayName,
        description: input.descriptionOverride,
      });
    }

    throw new Error(
      `Integration definition '${input.familyId}::${input.variantId}' must provide a non-empty description.`,
    );
  }

  return buildResolvedIntegrationTargetMetadata({
    definition,
    displayName: input.displayNameOverride ?? definition.displayName,
    description: input.descriptionOverride ?? definition.description,
  });
}

function buildResolvedIntegrationTargetMetadata(input: {
  definition: RegisteredIntegrationDefinition;
  displayName: string;
  description: string;
}): ResolvedIntegrationTargetMetadata {
  return {
    kind: input.definition.kind,
    displayName: input.displayName,
    description: input.description,
    logoKey: input.definition.logoKey,
    connectionMethods: input.definition.connectionMethods.map((method) =>
      resolveConnectionMethod(method),
    ),
    ...(input.definition.webhookSource === undefined
      ? {}
      : {
          webhookSource: {
            lifecycle: input.definition.webhookSource.lifecycle,
            requiresSourceSelection: true,
          },
        }),
    ...(input.definition.supportedWebhookEvents === undefined
      ? {}
      : {
          supportedWebhookEvents: cloneWebhookEvents(input.definition.supportedWebhookEvents),
        }),
  };
}

export function resolveTargetMetadataFromPersistedTarget(
  target: Pick<
    PersistedIntegrationTarget,
    "familyId" | "variantId" | "displayNameOverride" | "descriptionOverride"
  >,
): ResolvedIntegrationTargetMetadata {
  return resolveTargetMetadata({
    familyId: target.familyId,
    variantId: target.variantId,
    displayNameOverride: target.displayNameOverride,
    descriptionOverride: target.descriptionOverride,
  });
}
