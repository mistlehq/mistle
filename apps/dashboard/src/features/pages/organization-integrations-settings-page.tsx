import { useAppPageMeta } from "../navigation/route-meta.js";
import { PageFrame, resolvePageFrameText } from "../shared/page-frame.js";
import { IntegrationsPage } from "./integrations-page.js";

export function OrganizationIntegrationsSettingsPage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const { title, description } = resolvePageFrameText(pageMeta, "Integrations");

  return (
    <PageFrame
      description={description}
      headerIcon={pageMeta.headerIcon ?? undefined}
      title={title}
    >
      <IntegrationsPage />
    </PageFrame>
  );
}
