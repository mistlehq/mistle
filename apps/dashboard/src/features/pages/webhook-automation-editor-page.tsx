import { Button, Notice } from "@mistle/ui";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import type { AutomationCreateSuccessPath } from "../automations/automation-editor-navigation.js";
import { AutomationTypeDisplayField } from "../automations/automation-type-field.js";
import { webhookAutomationDetailQueryKey } from "../automations/automations-query-keys.js";
import { DeleteWebhookAutomationDialog } from "../automations/delete-webhook-automation-dialog.js";
import {
  resolveWebhookAutomationEditInitialValues,
  useLoadedWebhookAutomationEditorState,
} from "../automations/use-webhook-automation-editor-state.js";
import { useWebhookAutomationPrerequisites } from "../automations/use-webhook-automation-prerequisites.js";
import { toWebhookAutomationFormValues } from "../automations/webhook-automation-form-helpers.js";
import { WebhookAutomationForm } from "../automations/webhook-automation-form.js";
import { getWebhookAutomation } from "../automations/webhook-automations-service.js";
import { FormPageSection } from "../shared/form-page.js";

function renderWebhookAutomationEditorError(input: {
  title: string;
  description: string;
  onBack: () => void;
}): React.JSX.Element {
  return (
    <>
      <FormPageSection>
        <div className="flex flex-col gap-4 p-4">
          <Notice title={input.title} variant="alert">
            {input.description}
          </Notice>
          <div>
            <Button onClick={input.onBack} type="button" variant="outline">
              Back to triggers
            </Button>
          </div>
        </div>
      </FormPageSection>
    </>
  );
}

export function CreateWebhookAutomationEditor(input: {
  navigate: (to: string) => void | Promise<void>;
  automationTypeField?: ReactNode;
  initialSandboxProfileId?: string | undefined;
  createSuccessPath?: AutomationCreateSuccessPath;
}): React.JSX.Element | null {
  const prerequisites = useWebhookAutomationPrerequisites();

  if (prerequisites.errorMessage !== null) {
    return renderWebhookAutomationEditorError({
      title: "Could not load form",
      description: prerequisites.errorMessage,
      onBack: () => {
        void input.navigate("/triggers");
      },
    });
  }

  if (prerequisites.isPending || prerequisites.directoryData === undefined) {
    return null;
  }

  return (
    <LoadedWebhookAutomationEditor
      key="create"
      mode="create"
      automationId={undefined}
      automationTypeField={input.automationTypeField}
      navigate={input.navigate}
      {...(input.createSuccessPath === undefined
        ? {}
        : { createSuccessPath: input.createSuccessPath })}
      initialValues={{
        ...toWebhookAutomationFormValues(null),
        sandboxProfileId: input.initialSandboxProfileId ?? "",
      }}
      connectionOptions={prerequisites.connectionOptions}
      sandboxProfileOptions={prerequisites.sandboxProfileOptions}
      directoryData={prerequisites.directoryData}
    />
  );
}

export function EditWebhookAutomationEditor(input: {
  automationId: string;
  navigate: (to: string) => void | Promise<void>;
  backPath?: string | undefined;
  deleteSuccessPath?: string | undefined;
}): React.JSX.Element | null {
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
          preservedWebhookSourceId: automationQuery.data.integrationWebhookSourceId,
        },
  );

  if (prerequisites.errorMessage !== null || automationQuery.isError) {
    return renderWebhookAutomationEditorError({
      title: "Could not load trigger",
      description: resolveApiErrorMessage({
        error: automationQuery.error,
        fallbackMessage: prerequisites.errorMessage ?? "Could not load trigger.",
      }),
      onBack: () => {
        void input.navigate(input.backPath ?? "/triggers");
      },
    });
  }

  if (
    prerequisites.isPending ||
    automationQuery.isPending ||
    automationQuery.data === undefined ||
    prerequisites.directoryData === undefined
  ) {
    return null;
  }

  let initialValues: ReturnType<typeof toWebhookAutomationFormValues>;
  try {
    initialValues = resolveWebhookAutomationEditInitialValues({
      automation: automationQuery.data,
      directoryData: prerequisites.directoryData,
    });
  } catch (error) {
    return renderWebhookAutomationEditorError({
      title: "Could not load trigger",
      description: resolveApiErrorMessage({
        error,
        fallbackMessage: "Could not load trigger.",
      }),
      onBack: () => {
        void input.navigate(input.backPath ?? "/triggers");
      },
    });
  }

  return (
    <LoadedWebhookAutomationEditor
      key={input.automationId}
      mode="edit"
      automationId={input.automationId}
      automationTypeField={<AutomationTypeDisplayField value="trigger" />}
      navigate={input.navigate}
      {...(input.deleteSuccessPath === undefined
        ? {}
        : { deleteSuccessPath: input.deleteSuccessPath })}
      initialValues={initialValues}
      preservedWebhookSourceId={automationQuery.data.integrationWebhookSourceId}
      connectionOptions={prerequisites.connectionOptions}
      sandboxProfileOptions={prerequisites.sandboxProfileOptions}
      directoryData={prerequisites.directoryData}
      initialSandboxProfileVersion={automationQuery.data.target.sandboxProfileVersion}
    />
  );
}

function LoadedWebhookAutomationEditor(input: {
  mode: "create" | "edit";
  automationId: string | undefined;
  automationTypeField?: ReactNode;
  navigate: (to: string) => void | Promise<void>;
  createSuccessPath?: AutomationCreateSuccessPath;
  deleteSuccessPath?: string;
  initialValues: ReturnType<typeof toWebhookAutomationFormValues>;
  connectionOptions: ReturnType<typeof useWebhookAutomationPrerequisites>["connectionOptions"];
  sandboxProfileOptions: ReturnType<
    typeof useWebhookAutomationPrerequisites
  >["sandboxProfileOptions"];
  directoryData: NonNullable<ReturnType<typeof useWebhookAutomationPrerequisites>["directoryData"]>;
  preservedWebhookSourceId?: string;
  initialSandboxProfileVersion?: number;
}): React.JSX.Element {
  const state = useLoadedWebhookAutomationEditorState(input);

  return (
    <>
      <WebhookAutomationForm
        connectionOptions={state.connectionOptions}
        fieldErrors={state.fieldErrors}
        formError={state.formError}
        validationSummaryError={state.validationSummaryError}
        isDeleting={state.isDeleting}
        isSaving={state.isSaving}
        automationTypeField={input.automationTypeField}
        mode={input.mode}
        onDelete={state.onRequestDelete}
        onSubmit={state.onSubmit}
        onValueChange={state.onValueChange}
        primaryRepositoryOptions={state.primaryRepositoryOptions}
        sandboxProfileOptions={state.sandboxProfileOptions}
        sandboxProfileStatusMessage={state.sandboxProfileStatusMessage}
        triggerPickerDisabledState={state.triggerPickerDisabledState}
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
  );
}
