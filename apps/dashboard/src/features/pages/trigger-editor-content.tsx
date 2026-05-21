import { Button, Notice } from "@mistle/ui";
import { useQuery } from "@tanstack/react-query";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { isUnavailableResourceError } from "../api/http-api-error.js";
import { FormPageSection } from "../shared/form-page.js";
import { UnavailableResourceState } from "../shared/unavailable-resource-state.js";
import { triggerDetailQueryKey } from "../triggers/triggers-query-keys.js";
import { getTrigger } from "../triggers/triggers-service.js";
import { EditScheduledTriggerEditor } from "./scheduled-trigger-editor-page.js";
import {
  renderTriggerEditorFrameContent,
  type TriggerEditorFrameRenderer,
} from "./trigger-editor-frame.js";
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
  renderFrame?: TriggerEditorFrameRenderer;
}): React.JSX.Element | null {
  const renderUnavailableResource = (): React.JSX.Element | null =>
    renderTriggerEditorFrameContent({
      content: <UnavailableResourceState />,
      renderFrame: input.renderFrame,
      state: "unavailable",
    });

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
    if (isUnavailableResourceError(triggerQuery.error)) {
      return renderUnavailableResource();
    }

    return renderTriggerEditorFrameContent({
      content: renderTriggerEditorError({
        title: "Could not load trigger",
        description: resolveApiErrorMessage({
          error: triggerQuery.error,
          fallbackMessage: "Could not load trigger.",
        }),
        backPath: input.backPath,
        navigate: input.navigate,
      }),
      renderFrame: input.renderFrame,
      state: "editor",
    });
  }

  if (triggerQuery.isPending || triggerQuery.data === undefined) {
    return renderTriggerEditorFrameContent({
      content: null,
      renderFrame: input.renderFrame,
      state: "editor",
    });
  }

  if (
    input.requiredSandboxProfileId !== undefined &&
    triggerQuery.data.target.sandboxProfileId !== input.requiredSandboxProfileId
  ) {
    return renderUnavailableResource();
  }

  if (triggerQuery.data.kind === "schedule") {
    return (
      <EditScheduledTriggerEditor
        triggerId={input.triggerId}
        backPath={input.backPath}
        deleteSuccessPath={input.deleteSuccessPath}
        navigate={input.navigate}
        {...(input.renderFrame === undefined ? {} : { renderFrame: input.renderFrame })}
      />
    );
  }

  return (
    <EditWebhookTriggerEditor
      triggerId={input.triggerId}
      backPath={input.backPath}
      deleteSuccessPath={input.deleteSuccessPath}
      navigate={input.navigate}
      {...(input.renderFrame === undefined ? {} : { renderFrame: input.renderFrame })}
    />
  );
}
