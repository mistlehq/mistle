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
