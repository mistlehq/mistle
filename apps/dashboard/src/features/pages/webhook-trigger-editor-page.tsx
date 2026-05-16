import { Button, Notice } from "@mistle/ui";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { FormPageSection } from "../shared/form-page.js";
import { DeleteTriggerDialog } from "../triggers/delete-trigger-dialog.js";
import type { TriggerCreateSuccessPath } from "../triggers/trigger-editor-navigation.js";
import { TriggerTypeDisplayField } from "../triggers/trigger-type-field.js";
import { webhookTriggerDetailQueryKey } from "../triggers/triggers-query-keys.js";
import {
  resolveWebhookTriggerEditInitialValues,
  useLoadedWebhookTriggerEditorState,
} from "../triggers/use-webhook-trigger-editor-state.js";
import { useWebhookTriggerPrerequisites } from "../triggers/use-webhook-trigger-prerequisites.js";
import { toWebhookTriggerFormValues } from "../triggers/webhook-trigger-form-helpers.js";
import { WebhookTriggerForm } from "../triggers/webhook-trigger-form.js";
import { getWebhookTrigger } from "../triggers/webhook-triggers-service.js";

function renderWebhookTriggerEditorError(input: {
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

export function CreateWebhookTriggerEditor(input: {
  navigate: (to: string) => void | Promise<void>;
  triggerTypeField?: ReactNode;
  initialSandboxProfileId?: string | undefined;
  createSuccessPath?: TriggerCreateSuccessPath;
}): React.JSX.Element | null {
  const prerequisites = useWebhookTriggerPrerequisites();

  if (prerequisites.errorMessage !== null) {
    return renderWebhookTriggerEditorError({
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
    <LoadedWebhookTriggerEditor
      key="create"
      mode="create"
      triggerId={undefined}
      triggerTypeField={input.triggerTypeField}
      navigate={input.navigate}
      {...(input.createSuccessPath === undefined
        ? {}
        : { createSuccessPath: input.createSuccessPath })}
      initialValues={{
        ...toWebhookTriggerFormValues(null),
        sandboxProfileId: input.initialSandboxProfileId ?? "",
      }}
      connectionOptions={prerequisites.connectionOptions}
      sandboxProfileOptions={prerequisites.sandboxProfileOptions}
      directoryData={prerequisites.directoryData}
    />
  );
}

export function EditWebhookTriggerEditor(input: {
  triggerId: string;
  navigate: (to: string) => void | Promise<void>;
  backPath?: string | undefined;
  deleteSuccessPath?: string | undefined;
}): React.JSX.Element | null {
  const triggerQuery = useQuery({
    queryKey: webhookTriggerDetailQueryKey(input.triggerId),
    queryFn: async ({ signal }) =>
      getWebhookTrigger({
        triggerId: input.triggerId,
        signal,
      }),
    retry: false,
  });
  const prerequisites = useWebhookTriggerPrerequisites(
    triggerQuery.data === undefined
      ? undefined
      : {
          preservedWebhookSourceId: triggerQuery.data.integrationWebhookSourceId,
        },
  );

  if (prerequisites.errorMessage !== null || triggerQuery.isError) {
    return renderWebhookTriggerEditorError({
      title: "Could not load trigger",
      description: resolveApiErrorMessage({
        error: triggerQuery.error,
        fallbackMessage: prerequisites.errorMessage ?? "Could not load trigger.",
      }),
      onBack: () => {
        void input.navigate(input.backPath ?? "/triggers");
      },
    });
  }

  if (
    prerequisites.isPending ||
    triggerQuery.isPending ||
    triggerQuery.data === undefined ||
    prerequisites.directoryData === undefined
  ) {
    return null;
  }

  let initialValues: ReturnType<typeof toWebhookTriggerFormValues>;
  try {
    initialValues = resolveWebhookTriggerEditInitialValues({
      trigger: triggerQuery.data,
      directoryData: prerequisites.directoryData,
    });
  } catch (error) {
    return renderWebhookTriggerEditorError({
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
    <LoadedWebhookTriggerEditor
      key={input.triggerId}
      mode="edit"
      triggerId={input.triggerId}
      triggerTypeField={<TriggerTypeDisplayField value="trigger" />}
      navigate={input.navigate}
      {...(input.deleteSuccessPath === undefined
        ? {}
        : { deleteSuccessPath: input.deleteSuccessPath })}
      initialValues={initialValues}
      preservedWebhookSourceId={triggerQuery.data.integrationWebhookSourceId}
      connectionOptions={prerequisites.connectionOptions}
      sandboxProfileOptions={prerequisites.sandboxProfileOptions}
      directoryData={prerequisites.directoryData}
      initialSandboxProfileVersion={triggerQuery.data.target.sandboxProfileVersion}
    />
  );
}

function LoadedWebhookTriggerEditor(input: {
  mode: "create" | "edit";
  triggerId: string | undefined;
  triggerTypeField?: ReactNode;
  navigate: (to: string) => void | Promise<void>;
  createSuccessPath?: TriggerCreateSuccessPath;
  deleteSuccessPath?: string;
  initialValues: ReturnType<typeof toWebhookTriggerFormValues>;
  connectionOptions: ReturnType<typeof useWebhookTriggerPrerequisites>["connectionOptions"];
  sandboxProfileOptions: ReturnType<typeof useWebhookTriggerPrerequisites>["sandboxProfileOptions"];
  directoryData: NonNullable<ReturnType<typeof useWebhookTriggerPrerequisites>["directoryData"]>;
  preservedWebhookSourceId?: string;
  initialSandboxProfileVersion?: number;
}): React.JSX.Element {
  const state = useLoadedWebhookTriggerEditorState(input);

  return (
    <>
      <WebhookTriggerForm
        connectionOptions={state.connectionOptions}
        fieldErrors={state.fieldErrors}
        formError={state.formError}
        validationSummaryError={state.validationSummaryError}
        isDeleting={state.isDeleting}
        isSaving={state.isSaving}
        triggerTypeField={input.triggerTypeField}
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
        <DeleteTriggerDialog
          triggerName={state.values.name}
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
