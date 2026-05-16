import { useNavigate, useParams } from "react-router";

import { useAppPageBreadcrumbs } from "../navigation/app-breadcrumbs.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import { PageFrame, resolvePageFrameText } from "../shared/page-frame.js";
import { TriggerEditorContent } from "./trigger-editor-content.js";

export function TriggerEditorPage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const breadcrumbs = useAppPageBreadcrumbs();
  const navigate = useNavigate();
  const params = useParams();
  const triggerId = params["triggerId"];
  const { title, description } = resolvePageFrameText(pageMeta, "Edit trigger");

  if (triggerId === undefined) {
    throw new Error("Trigger id is required.");
  }

  return (
    <PageFrame width="form" breadcrumbs={breadcrumbs} description={description} title={title}>
      <TriggerEditorContent
        triggerId={triggerId}
        backPath="/triggers"
        deleteSuccessPath="/triggers"
        navigate={navigate}
      />
    </PageFrame>
  );
}
