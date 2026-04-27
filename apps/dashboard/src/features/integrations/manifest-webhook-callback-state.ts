import { useQuery } from "@tanstack/react-query";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { listIntegrationWebhookSources } from "./integrations-service.js";
import type { IntegrationWebhookSource } from "./integrations-service.js";

export type ManifestWebhookCallbackState =
  | {
      kind: "loading";
    }
  | {
      kind: "error";
      message: string;
    }
  | {
      kind: "ready";
      value: string;
    }
  | {
      kind: "missing";
    };

export function resolveManifestWebhookCallbackState(input: {
  error: unknown;
  isError: boolean;
  isPending: boolean;
  webhookSources: readonly IntegrationWebhookSource[] | undefined;
}): ManifestWebhookCallbackState {
  const webhookCallbackUrl = input.webhookSources?.[0]?.callbackUrl;

  return input.isPending
    ? { kind: "loading" }
    : input.isError
      ? {
          kind: "error",
          message: resolveApiErrorMessage({
            error: input.error,
            fallbackMessage: "Could not load integration webhook sources.",
          }),
        }
      : webhookCallbackUrl === undefined
        ? { kind: "missing" }
        : { kind: "ready", value: webhookCallbackUrl };
}

export function useManifestWebhookCallbackState(input: {
  connectionId: string;
  enabled: boolean;
}): ManifestWebhookCallbackState {
  const webhookSourcesQuery = useQuery({
    enabled: input.enabled,
    queryKey: ["integration-webhook-sources", input.connectionId],
    queryFn: async ({ signal }) =>
      listIntegrationWebhookSources({
        connectionId: input.connectionId,
        signal,
      }),
    retry: false,
  });

  return resolveManifestWebhookCallbackState({
    error: webhookSourcesQuery.error,
    isError: webhookSourcesQuery.isError,
    isPending: webhookSourcesQuery.isPending,
    webhookSources: webhookSourcesQuery.data,
  });
}
