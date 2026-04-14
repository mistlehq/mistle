import { AppBreadcrumbs } from "./app-breadcrumbs.js";
import type { AppHeaderLeadingModel } from "./route-meta.js";

export function AppHeaderLeading(input: {
  model: AppHeaderLeadingModel;
}): React.JSX.Element | null {
  if (input.model.kind === "custom") {
    return <>{input.model.content}</>;
  }

  if (input.model.kind === "breadcrumbs") {
    return <AppBreadcrumbs />;
  }

  return null;
}
