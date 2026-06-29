import { PlusIcon } from "@phosphor-icons/react";

import { RoutedButtonLink } from "../shared/routed-button-link.js";

export function OrganizationApiKeysCreateActionLink(): React.JSX.Element {
  return (
    <RoutedButtonLink to="/settings/organization/api-keys/new">
      <PlusIcon aria-hidden className="size-4" />
      Create API key
    </RoutedButtonLink>
  );
}
