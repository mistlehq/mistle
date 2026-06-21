import type { IntegrationConnection } from "../integrations/integrations-service.js";
import { ProviderAppSetupPane } from "./integration-connection-provider-app-setup-pane.js";
import { ProviderConfigurationSetupPane } from "./integration-connection-provider-configuration-setup-pane.js";
import {
  resolveIntegrationSetupAppManifestDraftBuilderOrThrow,
  resolveIntegrationProviderAppSetupOrThrow,
  resolveIntegrationProviderConfigurationSetupOrThrow,
  resolveIntegrationSetupPaneOrThrow,
  resolveIntegrationSetupStartFormOrThrow,
} from "./integration-connection-setup-manifest-draft.js";
import type { IntegrationConnectionSetupRoute } from "./integration-connection-setup-state.js";

type IntegrationConnectionSetupPaneComponent = (input: {
  connection: IntegrationConnection;
  organizationName?: string | undefined;
  setupRoute: IntegrationConnectionSetupRoute;
}) => React.JSX.Element;

function renderProviderAppSetupPane(input: {
  connection: IntegrationConnection;
  organizationName?: string | undefined;
  setupRoute: IntegrationConnectionSetupRoute;
}): React.JSX.Element {
  return (
    <ProviderAppSetupPane
      connection={input.connection}
      manifestDraftBuilder={resolveIntegrationSetupAppManifestDraftBuilderOrThrow({
        connection: input.connection,
        setupRoute: input.setupRoute,
      })}
      methodId={input.setupRoute.methodId}
      organizationName={input.organizationName}
      routeSegment={input.setupRoute.routeSegment}
      setupStartForm={resolveIntegrationSetupStartFormOrThrow({
        connection: input.connection,
        setupRoute: input.setupRoute,
      })}
      providerAppSetup={resolveIntegrationProviderAppSetupOrThrow({
        connection: input.connection,
        setupRoute: input.setupRoute,
      })}
    />
  );
}

function renderProviderConfigurationSetupPane(input: {
  connection: IntegrationConnection;
  setupRoute: IntegrationConnectionSetupRoute;
}): React.JSX.Element {
  return (
    <ProviderConfigurationSetupPane
      connection={input.connection}
      methodId={input.setupRoute.methodId}
      providerConfigurationSetup={resolveIntegrationProviderConfigurationSetupOrThrow({
        connection: input.connection,
        setupRoute: input.setupRoute,
      })}
    />
  );
}

function resolveSetupPane(input: {
  connection: IntegrationConnection;
  setupRoute: IntegrationConnectionSetupRoute;
}): IntegrationConnectionSetupPaneComponent {
  const setupPane = resolveIntegrationSetupPaneOrThrow(input);
  if (setupPane.kind === "provider-app") {
    return renderProviderAppSetupPane;
  }

  if (setupPane.kind === "provider-configuration") {
    return renderProviderConfigurationSetupPane;
  }

  return handleUnsupportedIntegrationSetupPaneKind(setupPane);
}

function handleUnsupportedIntegrationSetupPaneKind(_setupPane: never): never {
  throw new Error("Unsupported integration setup pane kind.");
}

export function renderIntegrationConnectionSetupPane(input: {
  connection: IntegrationConnection;
  organizationName?: string | undefined;
  setupRoute: IntegrationConnectionSetupRoute;
}): React.JSX.Element {
  const SetupPane = resolveSetupPane({
    connection: input.connection,
    setupRoute: input.setupRoute,
  });

  return (
    <SetupPane
      connection={input.connection}
      key={input.connection.id}
      organizationName={input.organizationName}
      setupRoute={input.setupRoute}
    />
  );
}
