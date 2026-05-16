import { Button, Notice } from "@mistle/ui";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { FormPageSection } from "../shared/form-page.js";
import { DeleteTriggerDialog } from "../triggers/delete-trigger-dialog.js";
import { toScheduledTriggerFormValues } from "../triggers/scheduled-trigger-form-helpers.js";
import { ScheduledTriggerForm } from "../triggers/scheduled-trigger-form.js";
import { getScheduledTrigger } from "../triggers/scheduled-triggers-service.js";
import type { TriggerCreateSuccessPath } from "../triggers/trigger-editor-navigation.js";
import { TriggerTypeDisplayField } from "../triggers/trigger-type-field.js";
import { scheduledTriggerDetailQueryKey } from "../triggers/triggers-query-keys.js";
import { useLoadedScheduledTriggerEditorState } from "../triggers/use-scheduled-trigger-editor-state.js";
import { useTriggerSandboxProfileOptions } from "../triggers/use-trigger-sandbox-profile-options.js";

function renderScheduledTriggerEditorError(input: {
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
            Back to triggers
          </Button>
        </div>
      </div>
    </FormPageSection>
  );
}

export function CreateScheduledTriggerEditor(input: {
  navigate: (to: string) => void | Promise<void>;
  triggerTypeField?: ReactNode;
  initialSandboxProfileId?: string | undefined;
  createSuccessPath?: TriggerCreateSuccessPath;
}): React.JSX.Element | null {
  const prerequisites = useTriggerSandboxProfileOptions();

  if (prerequisites.errorMessage !== null) {
    return renderScheduledTriggerEditorError({
      title: "Could not load form",
      description: prerequisites.errorMessage,
      onBack: () => {
        void input.navigate("/triggers");
      },
    });
  }

  if (prerequisites.isPending) {
    return null;
  }

  return (
    <LoadedScheduledTriggerEditor
      key="create"
      mode="create"
      triggerId={undefined}
      triggerTypeField={input.triggerTypeField}
      navigate={input.navigate}
      {...(input.createSuccessPath === undefined
        ? {}
        : { createSuccessPath: input.createSuccessPath })}
      initialValues={{
        ...toScheduledTriggerFormValues(null),
        sandboxProfileId: input.initialSandboxProfileId ?? "",
      }}
      sandboxProfileOptions={prerequisites.sandboxProfileOptions}
    />
  );
}

export function EditScheduledTriggerEditor(input: {
  triggerId: string;
  navigate: (to: string) => void | Promise<void>;
  backPath?: string | undefined;
  deleteSuccessPath?: string | undefined;
}): React.JSX.Element | null {
  const triggerQuery = useQuery({
    queryKey: scheduledTriggerDetailQueryKey(input.triggerId),
    queryFn: async ({ signal }) =>
      getScheduledTrigger({
        triggerId: input.triggerId,
        signal,
      }),
    retry: false,
  });
  const prerequisites = useTriggerSandboxProfileOptions();

  if (prerequisites.errorMessage !== null || triggerQuery.isError) {
    return renderScheduledTriggerEditorError({
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

  if (prerequisites.isPending || triggerQuery.isPending || triggerQuery.data === undefined) {
    return null;
  }

  return (
    <LoadedScheduledTriggerEditor
      key={input.triggerId}
      mode="edit"
      triggerId={input.triggerId}
      triggerTypeField={<TriggerTypeDisplayField value="scheduled" />}
      navigate={input.navigate}
      {...(input.deleteSuccessPath === undefined
        ? {}
        : { deleteSuccessPath: input.deleteSuccessPath })}
      initialValues={toScheduledTriggerFormValues(triggerQuery.data)}
      sandboxProfileOptions={prerequisites.sandboxProfileOptions}
      initialSandboxProfileVersion={triggerQuery.data.target.sandboxProfileVersion}
    />
  );
}

function LoadedScheduledTriggerEditor(input: {
  mode: "create" | "edit";
  triggerId: string | undefined;
  triggerTypeField?: ReactNode;
  navigate: (to: string) => void | Promise<void>;
  createSuccessPath?: TriggerCreateSuccessPath;
  deleteSuccessPath?: string;
  initialValues: ReturnType<typeof toScheduledTriggerFormValues>;
  sandboxProfileOptions: ReturnType<
    typeof useTriggerSandboxProfileOptions
  >["sandboxProfileOptions"];
  initialSandboxProfileVersion?: number;
}): React.JSX.Element {
  const state = useLoadedScheduledTriggerEditorState(input);

  return (
    <>
      <ScheduledTriggerForm
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
