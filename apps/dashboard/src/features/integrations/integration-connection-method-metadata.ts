import type { IntegrationFormConnectionMethodProviderAppSetupExistingAppStartAction } from "@mistle/integrations-core";

import type {
  IntegrationConnectionMethod,
  IntegrationManagedWebhookSourcePostCreate,
} from "./integrations-service-shared.js";

export function resolveFormConnectionMethodManagedWebhookSourcePostCreate(
  method: IntegrationConnectionMethod | null | undefined,
): IntegrationManagedWebhookSourcePostCreate | null {
  if (method?.kind !== "form") {
    return null;
  }

  return method.postCreate?.managedWebhookSource ?? null;
}

export function resolveFormConnectionMethodProviderAppSetupStartAction(
  method: IntegrationConnectionMethod | null | undefined,
): IntegrationFormConnectionMethodProviderAppSetupExistingAppStartAction | null {
  if (method?.kind !== "form") {
    return null;
  }

  return method.setupFlow?.providerAppSetup?.existingApp.startAction ?? null;
}
