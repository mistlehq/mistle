export type IntegrationWebhookEventsSyncFlowRefresh = (
  input: { body: Readonly<Record<string, unknown>>; connectionId: string },
  options?: { onSuccess?: () => void },
) => void;
