import { useParams } from "react-router";

import { PagePlaceholder } from "./page-placeholder.js";

export function IntegrationsCallbackResultPage(): React.JSX.Element {
  const params = useParams<{ targetKey?: string }>();
  const targetKey = params["targetKey"] ?? "integration";

  return (
    <PagePlaceholder
      description={`Review integration callback results for ${targetKey}.`}
      title="Integration callback result"
    />
  );
}
