import { useParams } from "react-router";

import { useAppPageBreadcrumbs } from "../navigation/app-breadcrumbs.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import { PageFrame, resolvePageFrameText } from "../shared/page-frame.js";
import { IntegrationsPage, type EmbeddedIntegrationsRoute } from "./integrations-page.js";

function resolveOrganizationIntegrationsSettingsPageFrame(input: {
  defaultDescription: string | undefined;
  defaultHeaderIcon: React.ReactNode | undefined;
  defaultTitle: string;
  embeddedRoute: EmbeddedIntegrationsRoute | undefined;
  routeBreadcrumbs: React.ReactNode | null;
  routeDetailTargetKey: string | null;
}): {
  breadcrumbs: React.ReactNode | null;
  description: string | undefined;
  headerIcon: React.ReactNode | undefined;
  title: string;
} {
  const detailTargetKey = input.embeddedRoute?.detailTargetKey ?? input.routeDetailTargetKey;
  const shouldRenderPageHeader = detailTargetKey === null;
  if (input.embeddedRoute !== undefined) {
    return {
      breadcrumbs: null,
      description: undefined,
      headerIcon: undefined,
      title: shouldRenderPageHeader ? "Integrations" : "",
    };
  }

  return {
    breadcrumbs: input.routeBreadcrumbs,
    description: shouldRenderPageHeader ? input.defaultDescription : undefined,
    headerIcon: shouldRenderPageHeader ? input.defaultHeaderIcon : undefined,
    title: shouldRenderPageHeader ? input.defaultTitle : "",
  };
}

export function OrganizationIntegrationsSettingsPage(input?: {
  embeddedRoute?: EmbeddedIntegrationsRoute;
}): React.JSX.Element {
  const params = useParams();
  const pageMeta = useAppPageMeta();
  const breadcrumbs = useAppPageBreadcrumbs();
  const { title, description } = resolvePageFrameText(pageMeta, "Integrations");
  const pageFrame = resolveOrganizationIntegrationsSettingsPageFrame({
    defaultDescription: description,
    defaultHeaderIcon: pageMeta.headerIcon ?? undefined,
    defaultTitle: title,
    embeddedRoute: input?.embeddedRoute,
    routeBreadcrumbs: breadcrumbs,
    routeDetailTargetKey: params["targetKey"] ?? null,
  });

  return (
    <PageFrame
      breadcrumbs={pageFrame.breadcrumbs}
      description={pageFrame.description}
      headerIcon={pageFrame.headerIcon}
      width="normal"
      title={pageFrame.title}
    >
      <IntegrationsPage
        {...(input?.embeddedRoute === undefined ? {} : { embeddedRoute: input.embeddedRoute })}
      />
    </PageFrame>
  );
}
