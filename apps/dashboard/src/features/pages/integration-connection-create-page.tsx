import { Button, Notice } from "@mistle/ui";
import { useQuery } from "@tanstack/react-query";
import { type NavigateOptions, useNavigate, useParams, useSearchParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { buildIntegrationCards } from "../integrations/directory-model.js";
import { IntegrationConnectionEditorPage } from "../integrations/integration-connection-editor.js";
import { listIntegrationDirectory } from "../integrations/integrations-service.js";
import { useAppPageBreadcrumbs } from "../navigation/app-breadcrumbs.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import { FormPageSection } from "../shared/form-page.js";
import { PageFrame, resolvePageFrameText } from "../shared/page-frame.js";
import type { OpenIntegrationConnectionEditorInput } from "./integration-connection-editor-state-types.js";
import { resolveDraftThenSetupConnectionPath } from "./integration-connection-post-create-navigation.js";
import {
  appendIntegrationConnectionReturnParams,
  resolveIntegrationConnectionReturnPath,
} from "./integration-connection-return-path.js";
import { buildOpenCreateIntegrationConnectionInput } from "./integrations-page-view-model.js";
import {
  resolveManagedWebhookSourcePostCreate,
  useIntegrationConnectionEditorState,
} from "./use-integration-connection-editor-state.js";
import { SETTINGS_INTEGRATIONS_QUERY_KEY } from "./use-integrations-directory-state.js";

export type EmbeddedIntegrationConnectionCreateRoute = {
  targetKey: string;
  returnPath?: string;
  navigate: (nextHref: string, options?: NavigateOptions) => void | Promise<void>;
};

export function IntegrationConnectionCreatePage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const breadcrumbs = useAppPageBreadcrumbs();
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const { title, description } = resolvePageFrameText(pageMeta, "Add Connection");
  const targetKey = params["targetKey"];
  const returnPath = resolveIntegrationConnectionReturnPath(searchParams.get("returnTo"));

  if (targetKey === undefined) {
    throw new Error("Integration target key is required.");
  }

  return (
    <IntegrationConnectionCreatePageContent
      breadcrumbs={breadcrumbs}
      description={description}
      headerIcon={pageMeta.headerIcon ?? undefined}
      navigate={(nextHref, options) => navigate(nextHref, options)}
      returnPath={returnPath ?? undefined}
      targetKey={targetKey}
      title={title}
    />
  );
}

export function EmbeddedIntegrationConnectionCreatePage(input: {
  embeddedRoute: EmbeddedIntegrationConnectionCreateRoute;
}): React.JSX.Element {
  return (
    <IntegrationConnectionCreatePageContent
      breadcrumbs={null}
      navigate={input.embeddedRoute.navigate}
      returnPath={input.embeddedRoute.returnPath}
      targetKey={input.embeddedRoute.targetKey}
      title="Add connection"
    />
  );
}

function IntegrationConnectionCreatePageContent(input: {
  breadcrumbs: React.ReactNode | null;
  description?: string | undefined;
  headerIcon?: React.ReactNode | undefined;
  navigate: (nextHref: string, options?: NavigateOptions) => void | Promise<void>;
  returnPath?: string | undefined;
  targetKey: string;
  title: string;
}): React.JSX.Element {
  const { breadcrumbs, description, headerIcon, navigate, returnPath, targetKey, title } = input;

  const integrationsQuery = useQuery({
    queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
    queryFn: async ({ signal }) => listIntegrationDirectory({ signal }),
    retry: false,
  });

  if (integrationsQuery.isError) {
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
            <Notice title="Could not load form" variant="alert">
              {resolveApiErrorMessage({
                error: integrationsQuery.error,
                fallbackMessage: "Could not load integrations.",
              })}
            </Notice>
            <div>
              <Button
                onClick={() => {
                  void navigate(returnPath ?? "/integrations");
                }}
                type="button"
                variant="outline"
              >
                Back to integrations
              </Button>
            </div>
          </div>
        </FormPageSection>
      </PageFrame>
    );
  }

  if (integrationsQuery.isPending || integrationsQuery.data === undefined) {
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

  const card = buildIntegrationCards(integrationsQuery.data).find(
    (candidate) => candidate.target.targetKey === targetKey,
  );
  if (card === undefined) {
    throw new Error(`Integration target '${targetKey}' was not found.`);
  }

  return (
    <PageFrame
      width="form"
      breadcrumbs={breadcrumbs}
      description={description}
      headerIcon={headerIcon}
      title={title}
    >
      <LoadedIntegrationConnectionCreatePage
        key={targetKey}
        initialEditorInput={buildOpenCreateIntegrationConnectionInput(card)}
        navigate={navigate}
        {...(returnPath === undefined ? {} : { returnPath })}
      />
    </PageFrame>
  );
}

function LoadedIntegrationConnectionCreatePage(input: {
  initialEditorInput: OpenIntegrationConnectionEditorInput;
  navigate: (nextHref: string, options?: NavigateOptions) => void | Promise<void>;
  returnPath?: string;
}): React.JSX.Element {
  const connectionState = useIntegrationConnectionEditorState({
    initialEditorInput: input.initialEditorInput,
    onClose: () => input.navigate(input.returnPath ?? "/integrations"),
    onSubmitSuccess: async ({ connectionId, editor, managedWebhookSetup, methodId }) => {
      const draftSetupPath = resolveDraftThenSetupConnectionPath({
        connectionId,
        editor,
        methodId,
      });
      if (draftSetupPath !== null) {
        await input.navigate(draftSetupPath);
        return;
      }

      if (input.returnPath !== undefined && connectionId !== null) {
        await input.navigate(
          appendIntegrationConnectionReturnParams({
            returnPath: input.returnPath,
            params: {
              createdConnectionId: connectionId,
            },
          }),
        );
        return;
      }

      if (
        connectionId !== null &&
        resolveManagedWebhookSourcePostCreate({ editor, methodId }) !== null &&
        managedWebhookSetup !== undefined
      ) {
        const detailSearchParams = new URLSearchParams({
          connectionId,
        });

        await input.navigate(`/integrations/${editor.targetKey}?${detailSearchParams.toString()}`, {
          state: {
            managedWebhookSetup,
          },
        });
        return;
      }

      await input.navigate(input.returnPath ?? `/integrations/${editor.targetKey}`);
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
      methodId={connectionState.methodId}
      changedSecretNames={connectionState.changedSecretNames}
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
