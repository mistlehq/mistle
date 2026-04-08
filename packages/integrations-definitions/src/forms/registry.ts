import type {
  AnyIntegrationDefinition,
  IntegrationBrowserSafeConnectionMethodDefinition,
  IntegrationDefinitionsBundle,
  IntegrationFormDefinition,
  IntegrationKind,
} from "@mistle/integrations-core";

export type AgentRuntimeOption = {
  runtimeId: string;
  displayName: string;
};

export type IntegrationFormDefinitionRecord = {
  familyId: string;
  variantId: string;
  kind: IntegrationKind;
  targetConfigSchema: AnyIntegrationDefinition["targetConfigSchema"];
  bindingConfigSchema: AnyIntegrationDefinition["bindingConfigSchema"];
  bindingConfigForm?: IntegrationFormDefinition<
    Record<string, unknown>,
    Record<string, string>,
    Record<string, unknown>,
    Record<string, unknown>
  >;
  connectionMethods: readonly IntegrationBrowserSafeConnectionMethodDefinition[];
  agentRuntimeOptions?: readonly AgentRuntimeOption[] | undefined;
};

function createDefinitionKey(input: { familyId: string; variantId: string }): string {
  return `${input.familyId}::${input.variantId}`;
}

function toBrowserSafeConnectionMethod(
  method: AnyIntegrationDefinition["connectionMethods"][number],
): IntegrationBrowserSafeConnectionMethodDefinition {
  if (method.kind === "redirect") {
    return method;
  }

  return {
    ...method,
    secretFields: method.secretFields.map((field) => ({
      name: field.name,
      label: field.label,
      ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
      ...(field.description === undefined ? {} : { description: field.description }),
      inputType: field.inputType,
      slotKey: field.slotKey,
    })),
  };
}

function resolveAgentRuntimeOptions(input: {
  definition: AnyIntegrationDefinition;
  definitions: IntegrationDefinitionsBundle;
}): readonly AgentRuntimeOption[] | undefined {
  if (input.definition.kind !== "agent") {
    return undefined;
  }

  const allowedRuntimeIds = input.definition.allowedRuntimeIds;
  if (allowedRuntimeIds === undefined || allowedRuntimeIds.length === 0) {
    return undefined;
  }

  return input.definitions.agentRuntimeRegistry
    .listRuntimes()
    .filter((runtime) => allowedRuntimeIds.includes(runtime.runtimeId))
    .map((runtime) => ({
      runtimeId: runtime.runtimeId,
      displayName: runtime.displayName,
    }));
}

function toFormDefinitionRecord(input: {
  definition: AnyIntegrationDefinition;
  definitions: IntegrationDefinitionsBundle;
}): IntegrationFormDefinitionRecord {
  const agentRuntimeOptions = resolveAgentRuntimeOptions(input);

  return {
    familyId: input.definition.familyId,
    variantId: input.definition.variantId,
    kind: input.definition.kind,
    targetConfigSchema: input.definition.targetConfigSchema,
    bindingConfigSchema: input.definition.bindingConfigSchema,
    ...(input.definition.bindingConfigForm === undefined
      ? {}
      : { bindingConfigForm: input.definition.bindingConfigForm }),
    connectionMethods: input.definition.connectionMethods.map(toBrowserSafeConnectionMethod),
    ...(agentRuntimeOptions === undefined ? {} : { agentRuntimeOptions }),
  };
}

export function listIntegrationFormDefinitions(
  definitions: IntegrationDefinitionsBundle,
): readonly IntegrationFormDefinitionRecord[] {
  return definitions.integrationRegistry.listDefinitions().map((definition) =>
    toFormDefinitionRecord({
      definition,
      definitions,
    }),
  );
}

export function createIntegrationFormRegistry(definitions: IntegrationDefinitionsBundle): {
  getDefinition(input: {
    familyId: string;
    variantId: string;
  }): IntegrationFormDefinitionRecord | undefined;
} {
  const definitionsByKey = new Map<string, IntegrationFormDefinitionRecord>();

  for (const definition of listIntegrationFormDefinitions(definitions)) {
    definitionsByKey.set(
      createDefinitionKey({
        familyId: definition.familyId,
        variantId: definition.variantId,
      }),
      definition,
    );
  }

  return {
    getDefinition(input) {
      return definitionsByKey.get(createDefinitionKey(input));
    },
  };
}
