import type { IntegrationConnection } from "../integrations/integrations-service.js";
import { GitHubAppSetupPane } from "./integration-connection-github-app-setup-page.js";
import { SlackAppSetupPane } from "./integration-connection-slack-app-setup-page.js";

type IntegrationConnectionSetupPaneComponent = (input: {
  connection: IntegrationConnection;
  searchParams: URLSearchParams;
}) => React.JSX.Element;

function renderGitHubAppSetupPane(input: {
  connection: IntegrationConnection;
  searchParams: URLSearchParams;
}): React.JSX.Element {
  return (
    <GitHubAppSetupPane
      connection={input.connection}
      manifestCreationSucceeded={input.searchParams.get("githubAppManifest") === "created"}
    />
  );
}

const IntegrationConnectionSetupPaneByRouteSegment: Record<
  string,
  IntegrationConnectionSetupPaneComponent
> = {
  "github-app": renderGitHubAppSetupPane,
  "slack-app": SlackAppSetupPane,
};

export function renderIntegrationConnectionSetupPane(input: {
  connection: IntegrationConnection;
  routeSegment: string;
  searchParams: URLSearchParams;
}): React.JSX.Element {
  const SetupPane = IntegrationConnectionSetupPaneByRouteSegment[input.routeSegment];
  if (SetupPane === undefined) {
    throw new Error(`Unsupported integration setup route segment '${input.routeSegment}'.`);
  }

  return (
    <SetupPane
      connection={input.connection}
      key={input.connection.id}
      searchParams={input.searchParams}
    />
  );
}
