import { Button, Notice } from "@mistle/ui";
import { CaretLeftIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { useNavigate, useParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { isUnavailableResourceError } from "../api/http-api-error.js";
import { useAppPageBreadcrumbs } from "../navigation/app-breadcrumbs.js";
import { FormPageSection } from "../shared/form-page.js";
import { PageFrame } from "../shared/page-frame.js";
import { UnavailableResourceState } from "../shared/unavailable-resource-state.js";
import { TriggerActivitySection } from "../triggers/trigger-activity-section.js";
import { createTriggerDetailPath } from "../triggers/trigger-editor-navigation.js";
import { triggerDetailQueryKey } from "../triggers/triggers-query-keys.js";
import { getTrigger } from "../triggers/triggers-service.js";
import {
  renderTriggerEditorFrameContent,
  type TriggerEditorFrameRenderer,
} from "./trigger-editor-frame.js";

function TriggerActivityBackButton(input: { onBack: () => void }): React.JSX.Element {
  return (
    <Button onClick={input.onBack} type="button" variant="outline">
      <CaretLeftIcon aria-hidden className="size-4" />
      Back
    </Button>
  );
}

function renderTriggerActivityError(input: {
  title: string;
  description: React.ReactNode;
  onBack: () => void;
}): React.JSX.Element {
  return (
    <FormPageSection>
      <div className="flex flex-col gap-4 p-4">
        <Notice title={input.title} variant="alert">
          {input.description}
        </Notice>
        <div>
          <TriggerActivityBackButton onBack={input.onBack} />
        </div>
      </div>
    </FormPageSection>
  );
}

export function TriggerActivityContent(input: {
  triggerId: string;
  backPath: string;
  navigate: (to: string) => void | Promise<void>;
  requiredSandboxProfileId?: string | undefined;
  renderFrame?: TriggerEditorFrameRenderer;
}): React.JSX.Element | null {
  const onBack = (): void => {
    void input.navigate(input.backPath);
  };
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
      return renderTriggerEditorFrameContent({
        content: <UnavailableResourceState />,
        renderFrame: input.renderFrame,
        state: "unavailable",
      });
    }

    return renderTriggerEditorFrameContent({
      content: renderTriggerActivityError({
        title: "Could not load trigger activity",
        description: resolveApiErrorMessage({
          error: triggerQuery.error,
          fallbackMessage: "Could not load trigger activity.",
        }),
        onBack,
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
    return renderTriggerEditorFrameContent({
      content: <UnavailableResourceState />,
      renderFrame: input.renderFrame,
      state: "unavailable",
    });
  }

  const content = (
    <TriggerActivitySection
      triggerId={input.triggerId}
      actions={<TriggerActivityBackButton onBack={onBack} />}
    />
  );

  if (input.renderFrame !== undefined) {
    return renderTriggerEditorFrameContent({
      content,
      renderFrame: input.renderFrame,
      state: "editor",
    });
  }

  return content;
}

export function TriggerActivityPage(): React.JSX.Element {
  const breadcrumbs = useAppPageBreadcrumbs();
  const navigate = useNavigate();
  const params = useParams();
  const triggerId = params["triggerId"];
  const renderFrame = useCallback<TriggerEditorFrameRenderer>(
    (input) => {
      if (input.state === "unavailable") {
        return (
          <PageFrame width="normal" breadcrumbs={breadcrumbs}>
            {input.children}
          </PageFrame>
        );
      }

      return (
        <PageFrame width="form" breadcrumbs={breadcrumbs}>
          {input.children}
        </PageFrame>
      );
    },
    [breadcrumbs],
  );

  if (triggerId === undefined) {
    throw new Error("Trigger id is required.");
  }

  return (
    <TriggerActivityContent
      triggerId={triggerId}
      backPath={createTriggerDetailPath(triggerId)}
      navigate={navigate}
      renderFrame={renderFrame}
    />
  );
}
