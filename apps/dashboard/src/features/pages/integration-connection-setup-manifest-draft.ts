import type {
  AnyIntegrationDefinition,
  IntegrationFormConnectionMethodSetupManifestDraft,
} from "@mistle/integrations-core";
import { listBrowserIntegrationDefinitions } from "@mistle/integrations-definitions/browser";

import type { IntegrationConnection } from "../integrations/integrations-service.js";
import type { IntegrationConnectionSetupRoute } from "./integration-connection-setup-state.js";

export type IntegrationSetupAppManifestDraftBuilder =
  IntegrationFormConnectionMethodSetupManifestDraft["build"];

export function resolveManifestDraftControlPlaneBaseUrl(input: {
  webhookCallbackUrl: string;
}): string {
  return new URL(input.webhookCallbackUrl).origin;
}

export function resolveIntegrationSetupAppManifestDraftBuilderOrThrow(input: {
  connection: IntegrationConnection;
  setupRoute: IntegrationConnectionSetupRoute;
}): IntegrationSetupAppManifestDraftBuilder {
  const definition = resolveIntegrationDefinitionByTargetKey(input.connection.targetKey);
  const method =
    definition.connectionMethods.find((candidate) => candidate.id === input.setupRoute.methodId) ??
    null;

  if (method === null) {
    throw new Error(
      `Integration setup flow '${input.setupRoute.methodId}/${input.setupRoute.routeSegment}' has no browser definition method for target '${input.connection.targetKey}'.`,
    );
  }

  if (method.kind !== "form" || method.setupFlow === undefined) {
    throw new Error(
      `Integration setup flow '${input.setupRoute.methodId}/${input.setupRoute.routeSegment}' is not a browser form setup flow for target '${input.connection.targetKey}'.`,
    );
  }

  if (method.setupFlow.routeSegment !== input.setupRoute.routeSegment) {
    throw new Error(
      `Integration setup route '${input.setupRoute.routeSegment}' does not match browser definition route '${method.setupFlow.routeSegment}' for target '${input.connection.targetKey}'.`,
    );
  }

  if (method.setupFlow.appManifestDraft === undefined) {
    throw new Error(
      `Integration setup flow '${input.setupRoute.methodId}/${input.setupRoute.routeSegment}' does not define an app manifest draft builder for target '${input.connection.targetKey}'.`,
    );
  }

  return method.setupFlow.appManifestDraft.build;
}

function resolveIntegrationDefinitionByTargetKey(targetKey: string): AnyIntegrationDefinition {
  const definitions = listBrowserIntegrationDefinitions();
  const definition =
    definitions.find((candidate) => candidate.variantId === targetKey) ??
    definitions.find((candidate) => candidate.familyId === targetKey) ??
    null;

  if (definition === null) {
    throw new Error(`Missing browser integration definition for target '${targetKey}'.`);
  }

  return definition;
}
