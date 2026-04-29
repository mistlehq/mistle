import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { SlackConnectionMethodId } from "@mistle/integrations-definitions/browser";

import type { IntegrationConnection } from "../integrations/integrations-service.js";
import { GitHubAppSetupPane } from "./integration-connection-github-app-setup-pane.js";
import { resolveIntegrationSetupAppManifestDraftBuilderOrThrow } from "./integration-connection-setup-manifest-draft.js";
import type { IntegrationConnectionSetupRoute } from "./integration-connection-setup-state.js";
import { SlackAppSetupPane } from "./integration-connection-slack-app-setup-pane.js";

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

function renderSlackAppSetupPane(input: {
  connection: IntegrationConnection;
  searchParams: URLSearchParams;
  setupRoute: IntegrationConnectionSetupRoute;
}): React.JSX.Element {
  return (
    <SlackAppSetupPane
      connection={input.connection}
      manifestDraftBuilder={resolveIntegrationSetupAppManifestDraftBuilderOrThrow({
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
  "slack-bot-token:slack-app": renderSlackAppSetupPane,
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
