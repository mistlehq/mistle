import { useAppPageMeta } from "../navigation/route-meta.js";
import { PageFrame } from "../shared/page-frame.js";
import { IntegrationsPage } from "./integrations-page.js";

export function OrganizationIntegrationsSettingsPage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const title = pageMeta.title ?? "Integrations";
  const description =
    pageMeta.supportingText === null || pageMeta.supportingText.trim().length === 0
      ? undefined
      : pageMeta.supportingText;

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
