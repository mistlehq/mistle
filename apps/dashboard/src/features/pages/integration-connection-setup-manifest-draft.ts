import type {
  AnyIntegrationDefinition,
  IntegrationBrowserSafeFormConnectionMethodDefinition,
  IntegrationFormConnectionMethodSetupManifestDraft,
  IntegrationFormConnectionMethodSetupStartForm,
} from "@mistle/integrations-core";
import { listBrowserIntegrationDefinitions } from "@mistle/integrations-definitions/browser";

import type { IntegrationConnection } from "../integrations/integrations-service.js";
import type { IntegrationConnectionSetupRoute } from "./integration-connection-setup-state.js";

export type IntegrationSetupAppManifestDraftBuilder =
  IntegrationFormConnectionMethodSetupManifestDraft["build"];

export type IntegrationSetupStartForm = IntegrationFormConnectionMethodSetupStartForm;

type IntegrationSetupFormMethod = IntegrationBrowserSafeFormConnectionMethodDefinition & {
  setupFlow: NonNullable<IntegrationBrowserSafeFormConnectionMethodDefinition["setupFlow"]>;
};

const ManifestWebhookCallbackPathPrefix = "/p/integration/webhooks/";

export function resolveManifestDraftControlPlaneBaseUrl(input: {
  webhookCallbackUrl: string;
}): string {
  const callbackUrl = new URL(input.webhookCallbackUrl);
  const callbackPathIndex = callbackUrl.pathname.indexOf(ManifestWebhookCallbackPathPrefix);

  if (callbackPathIndex < 0) {
    throw new Error(
      `Webhook callback URL '${input.webhookCallbackUrl}' is not a manifest webhook callback URL.`,
    );
  }

  const basePath = callbackUrl.pathname.slice(0, callbackPathIndex);
  return `${callbackUrl.origin}${basePath}`;
}

export function resolveIntegrationSetupAppManifestDraftBuilderOrThrow(input: {
  connection: IntegrationConnection;
  setupRoute: IntegrationConnectionSetupRoute;
}): IntegrationSetupAppManifestDraftBuilder {
  const method = resolveIntegrationSetupFormMethodOrThrow(input);

  if (method.setupFlow.appManifestDraft === undefined) {
    throw new Error(
      `Integration setup flow '${input.setupRoute.methodId}/${input.setupRoute.routeSegment}' does not define an app manifest draft builder for target '${input.connection.targetKey}'.`,
    );
  }

  return method.setupFlow.appManifestDraft.build;
}

export function resolveIntegrationSetupStartFormOrThrow(input: {
  connection: IntegrationConnection;
  setupRoute: IntegrationConnectionSetupRoute;
}): IntegrationSetupStartForm {
  const method = resolveIntegrationSetupFormMethodOrThrow(input);

  if (method.setupFlow.startForm === undefined) {
    throw new Error(
      `Integration setup flow '${input.setupRoute.methodId}/${input.setupRoute.routeSegment}' does not define a setup start form for target '${input.connection.targetKey}'.`,
    );
  }

  return method.setupFlow.startForm;
}

function resolveIntegrationSetupFormMethodOrThrow(input: {
  connection: IntegrationConnection;
  setupRoute: IntegrationConnectionSetupRoute;
}): IntegrationSetupFormMethod {
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

  const setupFlow = method.setupFlow;

  if (setupFlow.routeSegment !== input.setupRoute.routeSegment) {
    throw new Error(
      `Integration setup route '${input.setupRoute.routeSegment}' does not match browser definition route '${setupFlow.routeSegment}' for target '${input.connection.targetKey}'.`,
    );
  }

  return { ...method, setupFlow };
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
