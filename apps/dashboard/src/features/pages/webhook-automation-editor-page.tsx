import { Alert, AlertDescription, AlertTitle, Button, Card, CardContent } from "@mistle/ui";
import { useNavigate, useParams } from "react-router";

import { DeleteWebhookAutomationDialog } from "../automations/delete-webhook-automation-dialog.js";
import { useWebhookAutomationEditorState } from "../automations/use-webhook-automation-editor-state.js";
import { WebhookAutomationForm } from "../automations/webhook-automation-form.js";

type WebhookAutomationEditorPageProps = {
  mode: "create" | "edit";
};

export function WebhookAutomationEditorPage(
  input: WebhookAutomationEditorPageProps,
): React.JSX.Element {
  const navigate = useNavigate();
  const params = useParams();
  const automationId = input.mode === "edit" ? params["automationId"] : undefined;
  const state = useWebhookAutomationEditorState({
    mode: input.mode,
    automationId,
    navigate,
  });

  if (state.pageError !== null && !state.isLoadingInitialData) {
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="destructive">
          <AlertTitle>
            {input.mode === "edit" ? "Could not load automation" : "Could not load form"}
          </AlertTitle>
          <AlertDescription>{state.pageError}</AlertDescription>
        </Alert>
        <div>
          <Button
            onClick={() => {
              void navigate("/automations");
            }}
            type="button"
            variant="outline"
          >
            Back to automations
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {state.isLoadingInitialData ? (
        <Card>
          <CardContent className="pt-4">Loading automation…</CardContent>
        </Card>
      ) : null}

      {state.isLoadingInitialData ? null : (
        <>
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
        </>
      )}
    </div>
  );
}
