import { useParams } from "react-router";

import { useAppPageMeta } from "../navigation/route-meta.js";
import { PageFrame, resolvePageFrameText } from "../shared/page-frame.js";
import { IntegrationsPage } from "./integrations-page.js";

export function OrganizationIntegrationsSettingsPage(): React.JSX.Element {
  const params = useParams();
  const pageMeta = useAppPageMeta();
  const { title, description } = resolvePageFrameText(pageMeta, "Integrations");
  const detailTargetKey = params["targetKey"] ?? null;
  const shouldRenderPageHeader = detailTargetKey === null;

  return (
    <PageFrame
      description={shouldRenderPageHeader ? description : undefined}
      headerIcon={shouldRenderPageHeader ? (pageMeta.headerIcon ?? undefined) : undefined}
      maxWidthClassName="max-w-5xl"
      title={shouldRenderPageHeader ? title : ""}
    >
      <IntegrationsPage />
    </PageFrame>
  );
}
