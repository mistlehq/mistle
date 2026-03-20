import { Alert, AlertDescription, AlertTitle, Button, Card, CardContent } from "@mistle/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { DeleteWebhookAutomationDialog } from "../automations/delete-webhook-automation-dialog.js";
import {
  resolveWebhookAutomationEditInitialValues,
  useLoadedWebhookAutomationEditorState,
} from "../automations/use-webhook-automation-editor-state.js";
import { useWebhookAutomationPrerequisites } from "../automations/use-webhook-automation-prerequisites.js";
import { toWebhookAutomationFormValues } from "../automations/webhook-automation-form-helpers.js";
import { WebhookAutomationForm } from "../automations/webhook-automation-form.js";
import { webhookAutomationDetailQueryKey } from "../automations/webhook-automations-query-keys.js";
import { getWebhookAutomation } from "../automations/webhook-automations-service.js";

type WebhookAutomationEditorPageProps = {
  mode: "create" | "edit";
};

export function WebhookAutomationEditorPage(
  input: WebhookAutomationEditorPageProps,
): React.JSX.Element {
  const navigate = useNavigate();
  const params = useParams();
  if (input.mode === "create") {
    return <CreateWebhookAutomationEditor navigate={navigate} />;
  }

  const automationId = params["automationId"];
  if (automationId === undefined) {
    throw new Error("Automation id is required.");
  }

  return <EditWebhookAutomationEditor automationId={automationId} navigate={navigate} />;
}

function renderWebhookAutomationEditorError(input: {
  title: string;
  description: string;
  onBack: () => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <Alert variant="destructive">
        <AlertTitle>{input.title}</AlertTitle>
        <AlertDescription>{input.description}</AlertDescription>
      </Alert>
      <div>
        <Button onClick={input.onBack} type="button" variant="outline">
          Back to automations
        </Button>
      </div>
    </div>
  );
}

function renderWebhookAutomationEditorLoading(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="pt-4">Loading automation…</CardContent>
      </Card>
    </div>
  );
}

function CreateWebhookAutomationEditor(input: {
  navigate: (to: string) => void | Promise<void>;
}): React.JSX.Element {
  const prerequisites = useWebhookAutomationPrerequisites();

  if (prerequisites.errorMessage !== null) {
    return renderWebhookAutomationEditorError({
      title: "Could not load form",
      description: prerequisites.errorMessage,
      onBack: () => {
        void input.navigate("/automations");
      },
    });
  }

  if (prerequisites.isPending || prerequisites.integrationDirectoryQuery.data === undefined) {
    return renderWebhookAutomationEditorLoading();
  }

  return (
    <LoadedWebhookAutomationEditor
      key="create"
      mode="create"
      automationId={undefined}
      navigate={input.navigate}
      initialValues={toWebhookAutomationFormValues(null)}
      connectionOptions={prerequisites.connectionOptions}
      sandboxProfileOptions={prerequisites.sandboxProfileOptions}
      directoryData={prerequisites.integrationDirectoryQuery.data}
    />
  );
}

function EditWebhookAutomationEditor(input: {
  automationId: string;
  navigate: (to: string) => void | Promise<void>;
}): React.JSX.Element {
  const automationQuery = useQuery({
    queryKey: webhookAutomationDetailQueryKey(input.automationId),
    queryFn: async ({ signal }) =>
      getWebhookAutomation({
        automationId: input.automationId,
        signal,
      }),
    retry: false,
  });
  const prerequisites = useWebhookAutomationPrerequisites(
    automationQuery.data === undefined
      ? undefined
      : {
          preservedConnectionId: automationQuery.data.integrationConnectionId,
        },
  );

  if (prerequisites.errorMessage !== null || automationQuery.isError) {
    return renderWebhookAutomationEditorError({
      title: "Could not load automation",
      description: resolveApiErrorMessage({
        error: automationQuery.error,
        fallbackMessage: prerequisites.errorMessage ?? "Could not load automation.",
      }),
      onBack: () => {
        void input.navigate("/automations");
      },
    });
  }

  if (
    prerequisites.isPending ||
    automationQuery.isPending ||
    automationQuery.data === undefined ||
    prerequisites.integrationDirectoryQuery.data === undefined
  ) {
    return renderWebhookAutomationEditorLoading();
  }

  return (
    <LoadedWebhookAutomationEditor
      key={input.automationId}
      mode="edit"
      automationId={input.automationId}
      navigate={input.navigate}
      initialValues={resolveWebhookAutomationEditInitialValues({
        automation: automationQuery.data,
        directoryData: prerequisites.integrationDirectoryQuery.data,
      })}
      preservedConnectionId={automationQuery.data.integrationConnectionId}
      connectionOptions={prerequisites.connectionOptions}
      sandboxProfileOptions={prerequisites.sandboxProfileOptions}
      directoryData={prerequisites.integrationDirectoryQuery.data}
    />
  );
}

function LoadedWebhookAutomationEditor(input: {
  mode: "create" | "edit";
  automationId: string | undefined;
  navigate: (to: string) => void | Promise<void>;
  initialValues: ReturnType<typeof toWebhookAutomationFormValues>;
  connectionOptions: ReturnType<typeof useWebhookAutomationPrerequisites>["connectionOptions"];
  sandboxProfileOptions: ReturnType<
    typeof useWebhookAutomationPrerequisites
  >["sandboxProfileOptions"];
  directoryData: NonNullable<
    ReturnType<typeof useWebhookAutomationPrerequisites>["integrationDirectoryQuery"]["data"]
  >;
  preservedConnectionId?: string;
}): React.JSX.Element {
  const state = useLoadedWebhookAutomationEditorState(input);

  return (
    <div className="flex flex-col gap-4">
      <WebhookAutomationForm
        connectionOptions={state.connectionOptions}
        fieldErrors={state.fieldErrors}
        formError={state.formError}
        isDeleting={state.isDeleting}
        isSaving={state.isSaving}
        mode={input.mode}
        onDelete={state.onRequestDelete}
        onSubmit={state.onSubmit}
        onValueChange={state.onValueChange}
        sandboxProfileOptions={state.sandboxProfileOptions}
        webhookEventOptions={state.webhookEventOptions}
        values={state.values}
      />

      {input.mode === "edit" ? (
        <DeleteWebhookAutomationDialog
          automationName={state.values.name}
          errorMessage={state.deleteError}
          isOpen={state.isDeleteDialogOpen}
          isPending={state.isDeleting}
          onConfirm={state.onConfirmDelete}
          onOpenChange={state.onDeleteDialogOpenChange}
        />
      ) : null}
    </div>
  );
}
