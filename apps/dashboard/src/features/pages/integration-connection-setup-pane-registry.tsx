import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { SlackConnectionMethodId } from "@mistle/integrations-definitions/browser";

import type { IntegrationConnection } from "../integrations/integrations-service.js";
import { GitHubAppSetupPane } from "./integration-connection-github-app-setup-pane.js";
import { ProviderAppSetupPane } from "./integration-connection-provider-app-setup-pane.js";
import {
  resolveIntegrationSetupAppManifestDraftBuilderOrThrow,
  resolveIntegrationSetupInstructionsOrThrow,
  resolveIntegrationSetupStartFormOrThrow,
} from "./integration-connection-setup-manifest-draft.js";
import type { IntegrationConnectionSetupRoute } from "./integration-connection-setup-state.js";

type IntegrationConnectionSetupPaneComponent = (input: {
  connection: IntegrationConnection;
  searchParams: URLSearchParams;
  setupRoute: IntegrationConnectionSetupRoute;
}) => React.JSX.Element;

function renderGitHubAppSetupPane(input: {
  connection: IntegrationConnection;
  searchParams: URLSearchParams;
  setupRoute: IntegrationConnectionSetupRoute;
}): React.JSX.Element {
  return (
    <GitHubAppSetupPane
      connection={input.connection}
      manifestDraftBuilder={resolveIntegrationSetupAppManifestDraftBuilderOrThrow({
        connection: input.connection,
        setupRoute: input.setupRoute,
      })}
      manifestCreationSucceeded={input.searchParams.get("githubAppManifest") === "created"}
    />
  );
}

function renderProviderAppSetupPane(input: {
  connection: IntegrationConnection;
  searchParams: URLSearchParams;
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
      setupInstructions={resolveIntegrationSetupInstructionsOrThrow({
        connection: input.connection,
        setupRoute: input.setupRoute,
      })}
    />
  );
}

type IntegrationConnectionSetupPaneKey =
  | "github-app-installation:github-app"
  | "slack-bot-token:slack-app";

const IntegrationConnectionSetupPaneByKey: Record<
  IntegrationConnectionSetupPaneKey,
  IntegrationConnectionSetupPaneComponent
> = {
  "github-app-installation:github-app": renderGitHubAppSetupPane,
  "slack-bot-token:slack-app": renderProviderAppSetupPane,
};

function resolveSetupPaneKey(
  input: IntegrationConnectionSetupRoute,
): IntegrationConnectionSetupPaneKey {
  if (
    input.methodId === IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION &&
    input.routeSegment === "github-app"
  ) {
    return "github-app-installation:github-app";
  }

  if (input.methodId === SlackConnectionMethodId && input.routeSegment === "slack-app") {
    return "slack-bot-token:slack-app";
  }

  throw new Error(`Unsupported integration setup flow '${input.methodId}/${input.routeSegment}'.`);
}

export function renderIntegrationConnectionSetupPane(input: {
  connection: IntegrationConnection;
  setupRoute: IntegrationConnectionSetupRoute;
  searchParams: URLSearchParams;
}): React.JSX.Element {
  const SetupPane = IntegrationConnectionSetupPaneByKey[resolveSetupPaneKey(input.setupRoute)];

  return (
    <SetupPane
      connection={input.connection}
      key={input.connection.id}
      searchParams={input.searchParams}
      setupRoute={input.setupRoute}
    />
  );
}
