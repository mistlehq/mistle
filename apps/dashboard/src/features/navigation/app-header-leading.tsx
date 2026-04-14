import { AppBreadcrumbs } from "./app-breadcrumbs.js";
import { useAppHeaderLeadingContent } from "./route-meta.js";

export function AppHeaderLeading(): React.JSX.Element | null {
  const headerLeadingContent = useAppHeaderLeadingContent();

  if (headerLeadingContent !== null) {
    return <>{headerLeadingContent}</>;
  }

  return <AppBreadcrumbs />;
}
