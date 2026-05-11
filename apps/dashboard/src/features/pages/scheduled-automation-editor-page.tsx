import { Button, Notice } from "@mistle/ui";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useNavigate, useParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import type { AutomationCreateSuccessPath } from "../automations/automation-editor-navigation.js";
import { AutomationTypeDisplayField } from "../automations/automation-type-field.js";
import { DeleteWebhookAutomationDialog } from "../automations/delete-webhook-automation-dialog.js";
import { toScheduledAutomationFormValues } from "../automations/scheduled-automation-form-helpers.js";
import { ScheduledAutomationForm } from "../automations/scheduled-automation-form.js";
import { scheduledAutomationDetailQueryKey } from "../automations/scheduled-automations-query-keys.js";
import { getScheduledAutomation } from "../automations/scheduled-automations-service.js";
import { useLoadedScheduledAutomationEditorState } from "../automations/use-scheduled-automation-editor-state.js";
import { useScheduledAutomationPrerequisites } from "../automations/use-scheduled-automation-prerequisites.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import { FormPageSection } from "../shared/form-page.js";
import { PageFrame, resolvePageFrameText } from "../shared/page-frame.js";

type ScheduledAutomationEditorPageProps = {
  mode: "create" | "edit";
};

export function ScheduledAutomationEditorPage(
  input: ScheduledAutomationEditorPageProps,
): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const navigate = useNavigate();
  const params = useParams();
  const fallbackTitle =
    input.mode === "create" ? "Create scheduled automation" : "Edit scheduled automation";
  const { title, description } = resolvePageFrameText(pageMeta, fallbackTitle);

  if (input.mode === "create") {
    return (
      <PageFrame description={description} title={title} width="form">
        <CreateScheduledAutomationEditor navigate={navigate} />
      </PageFrame>
    );
  }

  const automationId = params["automationId"];
  if (automationId === undefined) {
    throw new Error("Automation id is required.");
  }

  return (
    <PageFrame description={description} title={title} width="form">
      <EditScheduledAutomationEditor automationId={automationId} navigate={navigate} />
    </PageFrame>
  );
}

function renderScheduledAutomationEditorError(input: {
  title: string;
  description: string;
  onBack: () => void;
}): React.JSX.Element {
  return (
    <FormPageSection>
      <div className="flex flex-col gap-4 p-4">
        <Notice title={input.title} variant="alert">
          {input.description}
        </Notice>
        <div>
          <Button onClick={input.onBack} type="button" variant="outline">
            Back to automations
          </Button>
        </div>
      </div>
    </FormPageSection>
  );
}

export function CreateScheduledAutomationEditor(input: {
  navigate: (to: string) => void | Promise<void>;
  automationTypeField?: ReactNode;
  initialSandboxProfileId?: string | undefined;
  createSuccessPath?: AutomationCreateSuccessPath;
}): React.JSX.Element | null {
  const prerequisites = useScheduledAutomationPrerequisites();

  if (prerequisites.errorMessage !== null) {
    return renderScheduledAutomationEditorError({
      title: "Could not load form",
      description: prerequisites.errorMessage,
      onBack: () => {
        void input.navigate("/automations");
      },
    });
  }

  if (prerequisites.isPending) {
    return null;
  }

  return (
    <LoadedScheduledAutomationEditor
      key="create"
      mode="create"
      automationId={undefined}
      automationTypeField={input.automationTypeField}
      navigate={input.navigate}
      {...(input.createSuccessPath === undefined
        ? {}
        : { createSuccessPath: input.createSuccessPath })}
      initialValues={{
        ...toScheduledAutomationFormValues(null),
        sandboxProfileId: input.initialSandboxProfileId ?? "",
      }}
      sandboxProfileOptions={prerequisites.sandboxProfileOptions}
    />
  );
}

export function EditScheduledAutomationEditor(input: {
  automationId: string;
  navigate: (to: string) => void | Promise<void>;
  backPath?: string | undefined;
  deleteSuccessPath?: string | undefined;
}): React.JSX.Element | null {
  const automationQuery = useQuery({
    queryKey: scheduledAutomationDetailQueryKey(input.automationId),
    queryFn: async ({ signal }) =>
      getScheduledAutomation({
        automationId: input.automationId,
        signal,
      }),
    retry: false,
  });
  const prerequisites = useScheduledAutomationPrerequisites();

  if (prerequisites.errorMessage !== null || automationQuery.isError) {
    return renderScheduledAutomationEditorError({
      title: "Could not load automation",
      description: resolveApiErrorMessage({
        error: automationQuery.error,
        fallbackMessage: prerequisites.errorMessage ?? "Could not load automation.",
      }),
      onBack: () => {
        void input.navigate(input.backPath ?? "/automations");
      },
    });
  }

  if (prerequisites.isPending || automationQuery.isPending || automationQuery.data === undefined) {
    return null;
  }

  return (
    <LoadedScheduledAutomationEditor
      key={input.automationId}
      mode="edit"
      automationId={input.automationId}
      automationTypeField={<AutomationTypeDisplayField value="scheduled" />}
      navigate={input.navigate}
      {...(input.deleteSuccessPath === undefined
        ? {}
        : { deleteSuccessPath: input.deleteSuccessPath })}
      initialValues={toScheduledAutomationFormValues(automationQuery.data)}
      sandboxProfileOptions={prerequisites.sandboxProfileOptions}
      initialSandboxProfileVersion={automationQuery.data.target.sandboxProfileVersion}
    />
  );
}

function LoadedScheduledAutomationEditor(input: {
  mode: "create" | "edit";
  automationId: string | undefined;
  automationTypeField?: ReactNode;
  navigate: (to: string) => void | Promise<void>;
  createSuccessPath?: AutomationCreateSuccessPath;
  deleteSuccessPath?: string;
  initialValues: ReturnType<typeof toScheduledAutomationFormValues>;
  sandboxProfileOptions: ReturnType<
    typeof useScheduledAutomationPrerequisites
  >["sandboxProfileOptions"];
  initialSandboxProfileVersion?: number;
}): React.JSX.Element {
  const state = useLoadedScheduledAutomationEditorState(input);

  return (
    <>
      <ScheduledAutomationForm
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
