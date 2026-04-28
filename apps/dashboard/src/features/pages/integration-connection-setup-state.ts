import type { IntegrationConnectionMethod } from "../integrations/integration-connection-editor.js";
import type { IntegrationConnection } from "../integrations/integrations-service.js";

type IntegrationSetupCompletionRequirement = NonNullable<
  NonNullable<
    Extract<IntegrationConnectionMethod, { kind: "form" }>["setupFlow"]
  >["completionRequirements"]
>;

type IntegrationSetupCompletionRequirementLeaf = Extract<
  IntegrationSetupCompletionRequirement,
  { kind: "connection-external-subject" | "config-field" | "secret-field" }
>;

export type IncompleteIntegrationConnectionSetupFlow = {
  routeSegment: string;
};

export function resolveIncompleteIntegrationConnectionSetupFlow(input: {
  connection: IntegrationConnection;
  connectionMethods: readonly IntegrationConnectionMethod[] | undefined;
}): IncompleteIntegrationConnectionSetupFlow | null {
  if (input.connection.connectionMethodId === undefined) {
    return null;
  }

  const method =
    input.connectionMethods?.find(
      (candidate) => candidate.id === input.connection.connectionMethodId,
    ) ?? null;
  if (method?.kind !== "form" || method.createBehavior !== "draft-then-setup") {
    return null;
  }

  if (method.setupFlow === undefined) {
    throw new Error(
      `Draft-then-setup connection method '${method.id}' is missing setupFlow metadata.`,
    );
  }

  if (method.setupFlow.completionRequirements === undefined) {
    throw new Error(
      `Draft-then-setup connection method '${method.id}' is missing setup completion metadata.`,
    );
  }

  return isSetupCompletionRequirementMet({
    connection: input.connection,
    requirement: method.setupFlow.completionRequirements,
  })
    ? null
    : { routeSegment: method.setupFlow.routeSegment };
}

function isSetupCompletionRequirementMet(input: {
  connection: IntegrationConnection;
  requirement: IntegrationSetupCompletionRequirement;
}): boolean {
  if (input.requirement.kind === "all-of") {
    return input.requirement.allOf.every((requirement) =>
      isSetupCompletionRequirementLeafMet({
        connection: input.connection,
        requirement,
      }),
    );
  }

  if (input.requirement.kind === "any-of") {
    return input.requirement.anyOf.some((requirement) =>
      isSetupCompletionRequirementLeafMet({
        connection: input.connection,
        requirement,
      }),
    );
  }

  return isSetupCompletionRequirementLeafMet({
    connection: input.connection,
    requirement: input.requirement,
  });
}

function isSetupCompletionRequirementLeafMet(input: {
  connection: IntegrationConnection;
  requirement: IntegrationSetupCompletionRequirementLeaf;
}): boolean {
  if (input.requirement.kind === "connection-external-subject") {
    return input.connection.externalSubjectId !== undefined;
  }

  if (input.requirement.kind === "secret-field") {
    return input.connection.configuredSecretNames?.includes(input.requirement.field) ?? false;
  }

  const configValue = input.connection.config?.[input.requirement.field];
  return typeof configValue === "string" && configValue.length > 0;
}
