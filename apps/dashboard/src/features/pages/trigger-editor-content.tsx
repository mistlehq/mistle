import { Button, Notice } from "@mistle/ui";
import { useQuery } from "@tanstack/react-query";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { automationDetailQueryKey } from "../automations/automations-query-keys.js";
import { getAutomation } from "../automations/automations-service.js";
import { FormPageSection } from "../shared/form-page.js";
import { EditScheduledAutomationEditor } from "./scheduled-automation-editor-page.js";
import { EditWebhookAutomationEditor } from "./webhook-automation-editor-page.js";

function renderTriggerEditorError(input: {
  title: string;
  description: React.ReactNode;
  backPath: string;
  navigate: (to: string) => void | Promise<void>;
}): React.JSX.Element {
  return (
    <FormPageSection>
      <div className="flex flex-col gap-4 p-4">
        <Notice title={input.title} variant="alert">
          {input.description}
        </Notice>
        <div>
          <Button
            onClick={() => {
              void input.navigate(input.backPath);
            }}
            type="button"
            variant="outline"
          >
            Back to triggers
          </Button>
        </div>
      </div>
    </FormPageSection>
  );
}

export function TriggerEditorContent(input: {
  triggerId: string;
  navigate: (to: string) => void | Promise<void>;
  backPath: string;
  deleteSuccessPath: string;
  requiredSandboxProfileId?: string | undefined;
}): React.JSX.Element | null {
  const automationQuery = useQuery({
    queryKey: automationDetailQueryKey(input.triggerId),
    queryFn: async ({ signal }) =>
      getAutomation({
        automationId: input.triggerId,
        signal,
      }),
    retry: false,
  });

  if (automationQuery.isError) {
    return renderTriggerEditorError({
      title: "Could not load trigger",
      description: resolveApiErrorMessage({
        error: automationQuery.error,
        fallbackMessage: "Could not load trigger.",
      }),
      backPath: input.backPath,
      navigate: input.navigate,
    });
  }

  if (automationQuery.isPending || automationQuery.data === undefined) {
    return null;
  }

  if (
    input.requiredSandboxProfileId !== undefined &&
    automationQuery.data.target.sandboxProfileId !== input.requiredSandboxProfileId
  ) {
    return renderTriggerEditorError({
      title: "Trigger not found for this sandbox profile",
      description: "The selected trigger is not available for this sandbox profile.",
      backPath: input.backPath,
      navigate: input.navigate,
    });
  }

  if (automationQuery.data.kind === "schedule") {
    return (
      <EditScheduledAutomationEditor
        automationId={input.triggerId}
        backPath={input.backPath}
        deleteSuccessPath={input.deleteSuccessPath}
        navigate={input.navigate}
      />
    );
  }

  return (
    <EditWebhookAutomationEditor
      automationId={input.triggerId}
      backPath={input.backPath}
      deleteSuccessPath={input.deleteSuccessPath}
      navigate={input.navigate}
    />
  );
}
