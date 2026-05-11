import type { IntegrationConnection } from "../integrations/integrations-service.js";
import { ProviderAppSetupPane } from "./integration-connection-provider-app-setup-pane.js";
import {
  resolveIntegrationSetupAppManifestDraftBuilderOrThrow,
  resolveIntegrationProviderAppSetupOrThrow,
  resolveIntegrationSetupPaneOrThrow,
  resolveIntegrationSetupStartFormOrThrow,
} from "./integration-connection-setup-manifest-draft.js";
import type { IntegrationConnectionSetupRoute } from "./integration-connection-setup-state.js";

type IntegrationConnectionSetupPaneComponent = (input: {
  connection: IntegrationConnection;
  setupRoute: IntegrationConnectionSetupRoute;
}) => React.JSX.Element;

function renderProviderAppSetupPane(input: {
  connection: IntegrationConnection;
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

function resolveSetupPane(input: {
  connection: IntegrationConnection;
  setupRoute: IntegrationConnectionSetupRoute;
}): IntegrationConnectionSetupPaneComponent {
  const setupPane = resolveIntegrationSetupPaneOrThrow(input);
  if (setupPane.kind === "provider-app") {
    return renderProviderAppSetupPane;
  }

  return handleUnsupportedIntegrationSetupPaneKind(setupPane.kind);
}

function handleUnsupportedIntegrationSetupPaneKind(_kind: never): never {
  throw new Error("Unsupported integration setup pane kind.");
}

export function renderIntegrationConnectionSetupPane(input: {
  connection: IntegrationConnection;
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
      setupRoute={input.setupRoute}
    />
  );
}
