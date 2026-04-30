import { useParams } from "react-router";

import { useAppPageBreadcrumbs } from "../navigation/app-breadcrumbs.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import { PageFrame, resolvePageFrameText } from "../shared/page-frame.js";
import { IntegrationsPage } from "./integrations-page.js";

export function OrganizationIntegrationsSettingsPage(): React.JSX.Element {
  const params = useParams();
  const pageMeta = useAppPageMeta();
  const breadcrumbs = useAppPageBreadcrumbs();
  const { title, description } = resolvePageFrameText(pageMeta, "Integrations");
  const detailTargetKey = params["targetKey"] ?? null;
  const shouldRenderPageHeader = detailTargetKey === null;

  return (
    <PageFrame
      breadcrumbs={breadcrumbs}
      description={shouldRenderPageHeader ? description : undefined}
      headerIcon={shouldRenderPageHeader ? (pageMeta.headerIcon ?? undefined) : undefined}
      width="normal"
      title={shouldRenderPageHeader ? title : ""}
    >
      <IntegrationsPage />
    </PageFrame>
  );
}
