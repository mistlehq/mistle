export type IntegrationWebhookSourceActionsRefreshTriggerCapabilities = (
  input: { body: Readonly<Record<string, unknown>>; connectionId: string },
  options?: { onSuccess?: () => void },
) => void;
