import type { IntegrationConnectionMethod } from "../integrations/integrations-service-shared.js";

export function isSingleApiKeySecretMethod(method: IntegrationConnectionMethod | null): boolean {
  return (
    method?.kind === "form" &&
    method.secretFields.length === 1 &&
    method.secretFields[0]?.name === "apiKey"
  );
}

export function buildIntegrationConnectionEditPath(input: {
  connectionId: string;
  detailTargetKey: string;
  extraSearchParams?: Readonly<Record<string, string>>;
}): string {
  const returnPath = `/integrations/${input.detailTargetKey}?${new URLSearchParams({
    connectionId: input.connectionId,
  }).toString()}`;
  const searchParams = new URLSearchParams({
    returnTo: returnPath,
    ...(input.extraSearchParams ?? {}),
  });

  return `/integrations/${input.detailTargetKey}/${input.connectionId}/edit?${searchParams.toString()}`;
}
