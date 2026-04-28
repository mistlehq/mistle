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

export type IntegrationConnectionSetupRoute = {
  methodId: string;
  routeSegment: string;
};

export function resolveIncompleteIntegrationConnectionSetupFlow(input: {
  connection: IntegrationConnection;
  connectionMethods: readonly IntegrationConnectionMethod[] | undefined;
}): IntegrationConnectionSetupRoute | null {
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
    : {
        methodId: method.id,
        routeSegment: method.setupFlow.routeSegment,
      };
}

export function resolveIntegrationConnectionSetupRouteOrThrow(input: {
  connection: IntegrationConnection;
  connectionMethods: readonly IntegrationConnectionMethod[] | undefined;
  routeSegment: string;
}): IntegrationConnectionSetupRoute {
  const connectionMethodId = input.connection.connectionMethodId;
  if (connectionMethodId === undefined) {
    throw new Error(
      `Integration connection '${input.connection.id}' is missing connection method metadata.`,
    );
  }

  const method =
    input.connectionMethods?.find((candidate) => candidate.id === connectionMethodId) ?? null;
  if (method?.kind !== "form" || method.createBehavior !== "draft-then-setup") {
    throw new Error(
      `Integration connection '${input.connection.id}' does not use a draft setup method.`,
    );
  }

  if (method.setupFlow === undefined) {
    throw new Error(
      `Draft-then-setup connection method '${method.id}' is missing setupFlow metadata.`,
    );
  }

  if (method.setupFlow.routeSegment !== input.routeSegment) {
    throw new Error(
      `Integration setup route segment '${input.routeSegment}' does not match connection method '${method.id}'.`,
    );
  }

  return {
    methodId: method.id,
    routeSegment: method.setupFlow.routeSegment,
  };
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
