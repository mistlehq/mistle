import { Button, Notice } from "@mistle/ui";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useNavigate, useParams } from "react-router";

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
import { useAppPageBreadcrumbs } from "../navigation/app-breadcrumbs.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import { FormPageSection } from "../shared/form-page.js";
import { PageFrame, resolvePageFrameText } from "../shared/page-frame.js";

type WebhookAutomationEditorPageProps = {
  mode: "create" | "edit";
};

export function WebhookAutomationEditorPage(
  input: WebhookAutomationEditorPageProps,
): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const breadcrumbs = useAppPageBreadcrumbs();
  const navigate = useNavigate();
  const params = useParams();
  const fallbackTitle = input.mode === "create" ? "Create automation" : "Edit automation";
  const { title, description } = resolvePageFrameText(pageMeta, fallbackTitle);
  if (input.mode === "create") {
    return (
      <PageFrame width="form" breadcrumbs={breadcrumbs} description={description} title={title}>
        <CreateWebhookAutomationEditor navigate={navigate} />
      </PageFrame>
    );
  }

  const automationId = params["automationId"];
  if (automationId === undefined) {
    throw new Error("Automation id is required.");
  }

  return (
    <PageFrame width="form" breadcrumbs={breadcrumbs} description={description} title={title}>
      <EditWebhookAutomationEditor automationId={automationId} navigate={navigate} />
    </PageFrame>
  );
}

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
              Back to automations
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
        void input.navigate("/automations");
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
      title: "Could not load automation",
      description: resolveApiErrorMessage({
        error,
        fallbackMessage: "Could not load automation.",
      }),
      onBack: () => {
        void input.navigate(input.backPath ?? "/automations");
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
