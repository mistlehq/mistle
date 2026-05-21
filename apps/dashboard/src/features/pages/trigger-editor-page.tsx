import { useCallback } from "react";
import { useNavigate, useParams } from "react-router";

import { useAppPageBreadcrumbs } from "../navigation/app-breadcrumbs.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import { PageFrame, resolvePageFrameText } from "../shared/page-frame.js";
import { TriggerEditorContent } from "./trigger-editor-content.js";
import type { TriggerEditorFrameRenderer } from "./trigger-editor-frame.js";

export function TriggerEditorPage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const breadcrumbs = useAppPageBreadcrumbs();
  const navigate = useNavigate();
  const params = useParams();
  const triggerId = params["triggerId"];
  const { title, description } = resolvePageFrameText(pageMeta, "Edit trigger");
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
        <PageFrame width="form" breadcrumbs={breadcrumbs} description={description} title={title}>
          {input.children}
        </PageFrame>
      );
    },
    [breadcrumbs, description, title],
  );

  if (triggerId === undefined) {
    throw new Error("Trigger id is required.");
  }

  return (
    <TriggerEditorContent
      triggerId={triggerId}
      backPath="/triggers"
      deleteSuccessPath="/triggers"
      navigate={navigate}
      renderFrame={renderFrame}
    />
  );
}
