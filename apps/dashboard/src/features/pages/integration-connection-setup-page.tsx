import { Button, Notice } from "@mistle/ui";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useNavigate, useParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { buildIntegrationCards } from "../integrations/directory-model.js";
import { listIntegrationDirectory } from "../integrations/integrations-service.js";
import { useAppPageBreadcrumbs } from "../navigation/app-breadcrumbs.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import { FormPageSection } from "../shared/form-page.js";
import { PageFrame, resolvePageFrameText } from "../shared/page-frame.js";
import { useOrganizationSummary } from "../shell/use-organization-summary.js";
import { renderIntegrationConnectionSetupPane } from "./integration-connection-setup-pane-registry.js";
import { resolveIntegrationConnectionSetupRouteStateOrThrow } from "./integration-connection-setup-state.js";
import { SETTINGS_INTEGRATIONS_QUERY_KEY } from "./use-integrations-directory-state.js";

export type EmbeddedIntegrationConnectionSetupRoute = {
  targetKey: string;
  connectionId: string;
  searchParams: URLSearchParams;
  setupRouteSegment: string;
  navigate: (nextHref: string) => void | Promise<void>;
};

export function IntegrationConnectionSetupPage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const breadcrumbs = useAppPageBreadcrumbs();
  const navigate = useNavigate();
  const params = useParams();
  const { title, description } = resolvePageFrameText(pageMeta, "Setup integration");
  const targetKey = params["targetKey"];
  const connectionId = params["connectionId"];
  const setupRouteSegment = params["setupRouteSegment"];

  if (targetKey === undefined) {
    throw new Error("Integration target key is required.");
  }

  if (connectionId === undefined) {
    throw new Error("Integration connection id is required.");
  }

  if (setupRouteSegment === undefined) {
    throw new Error("Integration setup route segment is required.");
  }

  return (
    <IntegrationConnectionSetupPageContent
      breadcrumbs={breadcrumbs}
      connectionId={connectionId}
      description={description}
      headerIcon={pageMeta.headerIcon ?? undefined}
      navigate={(nextHref) => navigate(nextHref)}
      redirectWhenComplete
      setupRouteSegment={setupRouteSegment}
      targetKey={targetKey}
      title={title}
    />
  );
}

export function EmbeddedIntegrationConnectionSetupPage(input: {
  embeddedRoute: EmbeddedIntegrationConnectionSetupRoute;
}): React.JSX.Element {
  return (
    <IntegrationConnectionSetupPageContent
      breadcrumbs={null}
      connectionId={input.embeddedRoute.connectionId}
      navigate={input.embeddedRoute.navigate}
      redirectWhenComplete={false}
      searchParams={input.embeddedRoute.searchParams}
      setupRouteSegment={input.embeddedRoute.setupRouteSegment}
      targetKey={input.embeddedRoute.targetKey}
      title="Set up integration"
    />
  );
}

type IntegrationConnectionSetupPageContentBaseInput = {
  breadcrumbs: React.ReactNode | null;
  connectionId: string;
  description?: string | undefined;
  headerIcon?: React.ReactNode | undefined;
  navigate: (nextHref: string) => void | Promise<void>;
  redirectWhenComplete: boolean;
  searchParams?: URLSearchParams | undefined;
  setupRouteSegment: string;
  targetKey: string;
  title: string;
};

function IntegrationConnectionSetupPageContent(
  input: IntegrationConnectionSetupPageContentBaseInput,
): React.JSX.Element {
  const {
    breadcrumbs,
    connectionId,
    description,
    headerIcon,
    navigate,
    redirectWhenComplete,
    searchParams,
    setupRouteSegment,
    targetKey,
    title,
  } = input;

  const directoryQuery = useQuery({
    queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
    queryFn: async ({ signal }) => listIntegrationDirectory({ signal }),
    retry: false,
  });
  const organizationSummary = useOrganizationSummary();

  if (directoryQuery.isError) {
    return (
      <PageFrame
        width="form"
        breadcrumbs={breadcrumbs}
        description={description}
        headerIcon={headerIcon}
        title={title}
      >
        <FormPageSection>
          <div className="flex flex-col gap-4 p-4">
            <Notice title="Could not load setup" variant="alert">
              {resolveApiErrorMessage({
                error: directoryQuery.error,
                fallbackMessage: "Could not load integrations.",
              })}
            </Notice>
            <div>
              <Button
                onClick={() => {
                  void navigate(`/integrations/${targetKey}`);
                }}
                type="button"
                variant="outline"
              >
                Back to integration
              </Button>
            </div>
          </div>
        </FormPageSection>
      </PageFrame>
    );
  }

  if (directoryQuery.isPending || directoryQuery.data === undefined) {
    return (
      <PageFrame
        width="form"
        breadcrumbs={breadcrumbs}
        description={description}
        headerIcon={headerIcon}
        title={title}
      >
        {null}
      </PageFrame>
    );
  }

  const card = buildIntegrationCards(directoryQuery.data).find(
    (candidate) => candidate.target.targetKey === targetKey,
  );
  if (card === undefined) {
    throw new Error(`Integration target '${targetKey}' was not found.`);
  }

  const connection = card.connections.find((candidate) => candidate.id === connectionId);
  if (connection === undefined) {
    throw new Error(
      `Integration connection '${connectionId}' was not found for target '${targetKey}'.`,
    );
  }
  const setupRouteState = resolveIntegrationConnectionSetupRouteStateOrThrow({
    connection,
    connectionMethods: card.target.connectionMethods,
    routeSegment: setupRouteSegment,
  });
  if (setupRouteState.kind === "complete" && redirectWhenComplete) {
    return (
      <Navigate
        replace
        to={`/integrations/${encodeURIComponent(targetKey)}?connectionId=${encodeURIComponent(
          connectionId,
        )}`}
      />
    );
  }

  if (setupRouteState.kind === "complete") {
    return (
      <PageFrame
        width="form"
        breadcrumbs={breadcrumbs}
        description={description}
        headerIcon={headerIcon}
        title={title}
      >
        <FormPageSection>
          <div className="flex flex-col gap-4 p-4">
            <Notice title="Integration setup complete">
              Designer can now verify this connection through MCP and continue with resource
              selection, profile binding, or trigger recommendations.
            </Notice>
            <div>
              <Button
                onClick={() => {
                  void navigate(
                    `/integrations/${encodeURIComponent(targetKey)}?connectionId=${encodeURIComponent(
                      connectionId,
                    )}`,
                  );
                }}
                type="button"
                variant="outline"
              >
                View connection
              </Button>
            </div>
          </div>
        </FormPageSection>
      </PageFrame>
    );
  }

  const setupRoute = setupRouteState.setupRoute;
  const organizationName = organizationSummary.query.data?.name;
  return (
    <PageFrame
      width="form"
      breadcrumbs={breadcrumbs}
      description={description}
      headerIcon={headerIcon}
      title={title}
    >
      {renderIntegrationConnectionSetupPane({
        connection,
        organizationName,
        searchParams,
        setupRoute,
      })}
    </PageFrame>
  );
}
