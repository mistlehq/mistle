import { Button, Notice } from "@mistle/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { buildIntegrationCards } from "../integrations/directory-model.js";
import { IntegrationConnectionEditorPage } from "../integrations/integration-connection-editor.js";
import { listIntegrationDirectory } from "../integrations/integrations-service.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import { FormPageSection } from "../shared/form-page.js";
import { FormPageFrame, resolvePageFrameText } from "../shared/page-frame.js";
import type { OpenIntegrationConnectionEditorInput } from "./integration-connection-editor-state-types.js";
import { resolveIntegrationConnectionReturnPath } from "./integration-connection-return-path.js";
import { buildOpenUpdateIntegrationConnectionInput } from "./integrations-page-view-model.js";
import { useIntegrationConnectionEditorState } from "./use-integration-connection-editor-state.js";
import { SETTINGS_INTEGRATIONS_QUERY_KEY } from "./use-integrations-directory-state.js";

export function IntegrationConnectionEditPage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const { title, description } = resolvePageFrameText(pageMeta, "Edit Connection");
  const targetKey = params["targetKey"];
  const connectionId = params["connectionId"];
  const returnPath = resolveIntegrationConnectionReturnPath(searchParams.get("returnTo"));

  if (targetKey === undefined) {
    throw new Error("Integration target key is required.");
  }

  if (connectionId === undefined) {
    throw new Error("Integration connection id is required.");
  }

  const integrationsQuery = useQuery({
    queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
    queryFn: async ({ signal }) => listIntegrationDirectory({ signal }),
    retry: false,
  });

  if (integrationsQuery.isError) {
    return (
      <FormPageFrame
        description={description}
        headerIcon={pageMeta.headerIcon ?? undefined}
        title={title}
      >
        <FormPageSection>
          <div className="flex flex-col gap-4 p-4">
            <Notice title="Could not load form" variant="alert">
              {resolveApiErrorMessage({
                error: integrationsQuery.error,
                fallbackMessage: "Could not load integrations.",
              })}
            </Notice>
            <div>
              <Button
                onClick={() => {
                  void navigate(returnPath ?? `/integrations/${targetKey}`);
                }}
                type="button"
                variant="outline"
              >
                Back to integration
              </Button>
            </div>
          </div>
        </FormPageSection>
      </FormPageFrame>
    );
  }

  if (integrationsQuery.isPending || integrationsQuery.data === undefined) {
    return (
      <FormPageFrame
        description={description}
        headerIcon={pageMeta.headerIcon ?? undefined}
        title={title}
      >
        {null}
      </FormPageFrame>
    );
  }

  const card = buildIntegrationCards(integrationsQuery.data).find(
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

  return (
    <FormPageFrame
      description={description}
      headerIcon={pageMeta.headerIcon ?? undefined}
      title={title}
    >
      <LoadedIntegrationConnectionEditPage
        key={connection.id}
        initialEditorInput={buildOpenUpdateIntegrationConnectionInput({
          card,
          connection,
        })}
        {...(returnPath === null ? {} : { returnPath })}
      />
    </FormPageFrame>
  );
}

function LoadedIntegrationConnectionEditPage(input: {
  initialEditorInput: OpenIntegrationConnectionEditorInput;
  returnPath?: string;
}): React.JSX.Element {
  const navigate = useNavigate();
  const connectionState = useIntegrationConnectionEditorState({
    initialEditorInput: input.initialEditorInput,
    onClose: () =>
      navigate(input.returnPath ?? `/integrations/${input.initialEditorInput.targetKey}`),
    onSubmitSuccess: async ({ editor }) => {
      await navigate(input.returnPath ?? `/integrations/${editor.targetKey}`);
    },
    queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
  });

  return (
    <IntegrationConnectionEditorPage
      configForm={connectionState.configForm}
      configValue={connectionState.configValue}
      closeDisabled={connectionState.closeDisabled}
      connectError={connectionState.error}
      connectionDisplayNamePlaceholder={connectionState.connectionDisplayNamePlaceholder}
      connectionDisplayNameValue={connectionState.connectionDisplayNameValue}
      deviceAuthorizationPending={connectionState.deviceAuthorizationPending}
      editor={connectionState.editor}
      hasChanges={connectionState.hasChanges}
      isConnectionDisplayNameChanged={connectionState.isConnectionDisplayNameChanged}
      isSecretChanged={connectionState.isSecretChanged}
      methodId={connectionState.methodId}
      onClose={connectionState.closeEditor}
      onConfigChange={connectionState.onConfigChange}
      onConnectionDisplayNameChange={connectionState.onConnectionDisplayNameChange}
      onMethodChange={connectionState.onMethodChange}
      onSecretChange={connectionState.onSecretChange}
      onSubmit={connectionState.submitEditor}
      pending={connectionState.pending}
      secrets={connectionState.secrets}
    />
  );
}
