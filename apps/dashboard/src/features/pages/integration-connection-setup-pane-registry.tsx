import type { IntegrationConnection } from "../integrations/integrations-service.js";
import { GitHubAppSetupPane } from "./integration-connection-github-app-setup-page.js";
import { SlackAppSetupPane } from "./integration-connection-slack-app-setup-page.js";

type IntegrationConnectionSetupPaneComponent = (input: {
  connection: IntegrationConnection;
}) => React.JSX.Element;

const IntegrationConnectionSetupPaneByRouteSegment: Record<
  string,
  IntegrationConnectionSetupPaneComponent
> = {
  "github-app": GitHubAppSetupPane,
  "slack-app": SlackAppSetupPane,
};

export function renderIntegrationConnectionSetupPane(input: {
  connection: IntegrationConnection;
  routeSegment: string;
}): React.JSX.Element {
  const SetupPane = IntegrationConnectionSetupPaneByRouteSegment[input.routeSegment];
  if (SetupPane === undefined) {
    throw new Error(`Unsupported integration setup route segment '${input.routeSegment}'.`);
  }

  return <SetupPane connection={input.connection} key={input.connection.id} />;
}
