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
import { renderIntegrationConnectionSetupPane } from "./integration-connection-setup-pane-registry.js";
import { resolveIntegrationConnectionSetupRouteStateOrThrow } from "./integration-connection-setup-state.js";
import { SETTINGS_INTEGRATIONS_QUERY_KEY } from "./use-integrations-directory-state.js";

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

  const directoryQuery = useQuery({
    queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
    queryFn: async ({ signal }) => listIntegrationDirectory({ signal }),
    retry: false,
  });

  if (directoryQuery.isError) {
    return (
      <PageFrame
        width="form"
        breadcrumbs={breadcrumbs}
        description={description}
        headerIcon={pageMeta.headerIcon ?? undefined}
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
        headerIcon={pageMeta.headerIcon ?? undefined}
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
  if (setupRouteState.kind === "complete") {
    return (
      <Navigate
        replace
        to={`/integrations/${encodeURIComponent(targetKey)}?connectionId=${encodeURIComponent(
          connectionId,
        )}`}
      />
    );
  }
  return (
    <PageFrame
      width="form"
      breadcrumbs={breadcrumbs}
      description={description}
      headerIcon={pageMeta.headerIcon ?? undefined}
      title={title}
    >
      {renderIntegrationConnectionSetupPane({
        connection,
        setupRoute: setupRouteState.setupRoute,
      })}
    </PageFrame>
  );
}
