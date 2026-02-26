import { useParams } from "react-router";

import { PagePlaceholder } from "./page-placeholder.js";

export function ProvidersCallbackResultPage(): React.JSX.Element {
  const params = useParams<{ providerId?: string }>();
  const providerId = params["providerId"] ?? "provider";

  return (
    <PagePlaceholder
      description={`Review provider callback results for ${providerId}.`}
      title="Provider callback result"
    />
  );
}
