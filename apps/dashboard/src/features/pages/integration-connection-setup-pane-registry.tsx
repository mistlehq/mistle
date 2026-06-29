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

function renderProviderAppSetupPane(input: {
  connection: IntegrationConnection;
  navigate: (nextHref: string) => void | Promise<void>;
  organizationName?: string | undefined;
  searchParams?: URLSearchParams | undefined;
  setupRoute: IntegrationConnectionSetupRoute;
}): React.JSX.Element {
  return (
    <ProviderAppSetupPane
      connection={input.connection}
      key={input.connection.id}
      manifestDraftBuilder={resolveIntegrationSetupAppManifestDraftBuilderOrThrow({
        connection: input.connection,
        setupRoute: input.setupRoute,
      })}
      methodId={input.setupRoute.methodId}
      navigate={input.navigate}
      organizationName={input.organizationName}
      searchParams={input.searchParams}
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
      key={input.connection.id}
      methodId={input.setupRoute.methodId}
      providerConfigurationSetup={resolveIntegrationProviderConfigurationSetupOrThrow({
        connection: input.connection,
        setupRoute: input.setupRoute,
      })}
      routeSegment={input.setupRoute.routeSegment}
    />
  );
}

function handleUnsupportedIntegrationSetupPaneKind(_setupPane: never): never {
  throw new Error("Unsupported integration setup pane kind.");
}

export function renderIntegrationConnectionSetupPane(input: {
  connection: IntegrationConnection;
  navigate: (nextHref: string) => void | Promise<void>;
  organizationName?: string | undefined;
  searchParams?: URLSearchParams | undefined;
  setupRoute: IntegrationConnectionSetupRoute;
}): React.JSX.Element {
  const setupPane = resolveIntegrationSetupPaneOrThrow({
    connection: input.connection,
    setupRoute: input.setupRoute,
  });

  if (setupPane.kind === "provider-app") {
    return renderProviderAppSetupPane(input);
  }

  if (setupPane.kind === "provider-configuration") {
    return renderProviderConfigurationSetupPane({
      connection: input.connection,
      setupRoute: input.setupRoute,
    });
  }

  return handleUnsupportedIntegrationSetupPaneKind(setupPane);
}
