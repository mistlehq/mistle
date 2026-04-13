import { Button, Notice } from "@mistle/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { buildIntegrationCards } from "../integrations/directory-model.js";
import { IntegrationConnectionEditorPage } from "../integrations/integration-connection-dialog.js";
import { listIntegrationDirectory } from "../integrations/integrations-service.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import { FormPageSection } from "../shared/form-page.js";
import { FormPageFrame, resolvePageFrameText } from "../shared/page-frame.js";
import type { OpenIntegrationConnectionDialogInput } from "./integration-connection-dialog-state-types.js";
import { buildOpenCreateIntegrationConnectionInput } from "./integrations-page-view-model.js";
import { useIntegrationConnectionDialogState } from "./use-integration-connection-dialog-state.js";
import { SETTINGS_INTEGRATIONS_QUERY_KEY } from "./use-integrations-directory-state.js";

export function IntegrationConnectionCreatePage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const navigate = useNavigate();
  const params = useParams();
  const { title, description } = resolvePageFrameText(pageMeta, "Add Connection");
  const targetKey = params["targetKey"];

  if (targetKey === undefined) {
    throw new Error("Integration target key is required.");
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
                  void navigate("/integrations");
                }}
                type="button"
                variant="outline"
              >
                Back to integrations
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
        <FormPageSection>
          <div className="p-4">Loading integration…</div>
        </FormPageSection>
      </FormPageFrame>
    );
  }

  const card = buildIntegrationCards(integrationsQuery.data).find(
    (candidate) => candidate.target.targetKey === targetKey,
  );
  if (card === undefined) {
    throw new Error(`Integration target '${targetKey}' was not found.`);
  }

  return (
    <FormPageFrame
      description={description}
      headerIcon={pageMeta.headerIcon ?? undefined}
      title={title}
    >
      <LoadedIntegrationConnectionCreatePage
        key={targetKey}
        openInput={buildOpenCreateIntegrationConnectionInput(card)}
      />
    </FormPageFrame>
  );
}

function LoadedIntegrationConnectionCreatePage(input: {
  openInput: OpenIntegrationConnectionDialogInput;
}): React.JSX.Element {
  const navigate = useNavigate();
  const connectionState = useIntegrationConnectionDialogState({
    initialOpenInput: input.openInput,
    onClose: () => navigate("/integrations"),
    onSubmitSuccess: async ({ dialog }) => {
      await navigate(`/integrations/${dialog.targetKey}`);
    },
    queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
  });

  return (
    <IntegrationConnectionEditorPage
      configForm={connectionState.configForm}
      configValue={connectionState.configValue}
      connectError={connectionState.error}
      connectionDisplayNamePlaceholder={connectionState.connectionDisplayNamePlaceholder}
      connectionDisplayNameValue={connectionState.connectionDisplayNameValue}
      deviceAuthorizationPending={connectionState.deviceAuthorizationPending}
      dialog={connectionState.dialog}
      hasChanges={connectionState.hasChanges}
      isConnectionDisplayNameChanged={connectionState.isConnectionDisplayNameChanged}
      isSecretChanged={connectionState.isSecretChanged}
      methodId={connectionState.methodId}
      onClose={connectionState.closeDialog}
      onConfigChange={connectionState.onConfigChange}
      onConnectionDisplayNameChange={connectionState.onConnectionDisplayNameChange}
      onMethodChange={connectionState.onMethodChange}
      onSecretChange={connectionState.onSecretChange}
      onSubmit={connectionState.submitDialog}
      pending={connectionState.pending}
      secrets={connectionState.secrets}
    />
  );
}
