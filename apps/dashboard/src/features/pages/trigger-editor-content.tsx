import { Button, Notice } from "@mistle/ui";
import { useQuery } from "@tanstack/react-query";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { FormPageSection } from "../shared/form-page.js";
import { triggerDetailQueryKey } from "../triggers/triggers-query-keys.js";
import { getTrigger } from "../triggers/triggers-service.js";
import { EditScheduledTriggerEditor } from "./scheduled-trigger-editor-page.js";
import { EditWebhookTriggerEditor } from "./webhook-trigger-editor-page.js";

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
  const triggerQuery = useQuery({
    queryKey: triggerDetailQueryKey(input.triggerId),
    queryFn: async ({ signal }) =>
      getTrigger({
        triggerId: input.triggerId,
        signal,
      }),
    retry: false,
  });

  if (triggerQuery.isError) {
    return renderTriggerEditorError({
      title: "Could not load trigger",
      description: resolveApiErrorMessage({
        error: triggerQuery.error,
        fallbackMessage: "Could not load trigger.",
      }),
      backPath: input.backPath,
      navigate: input.navigate,
    });
  }

  if (triggerQuery.isPending || triggerQuery.data === undefined) {
    return null;
  }

  if (
    input.requiredSandboxProfileId !== undefined &&
    triggerQuery.data.target.sandboxProfileId !== input.requiredSandboxProfileId
  ) {
    return renderTriggerEditorError({
      title: "Trigger not found for this sandbox profile",
      description: "The selected trigger is not available for this sandbox profile.",
      backPath: input.backPath,
      navigate: input.navigate,
    });
  }

  if (triggerQuery.data.kind === "schedule") {
    return (
      <EditScheduledTriggerEditor
        triggerId={input.triggerId}
        backPath={input.backPath}
        deleteSuccessPath={input.deleteSuccessPath}
        navigate={input.navigate}
      />
    );
  }

  return (
    <EditWebhookTriggerEditor
      triggerId={input.triggerId}
      backPath={input.backPath}
      deleteSuccessPath={input.deleteSuccessPath}
      navigate={input.navigate}
    />
  );
}
