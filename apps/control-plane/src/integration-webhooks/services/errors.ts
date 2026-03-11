export const IntegrationWebhooksBadRequestCodes = {
  INVALID_WEBHOOK_REQUEST: "INVALID_WEBHOOK_REQUEST",
} as const;

export type IntegrationWebhooksBadRequestCode =
  (typeof IntegrationWebhooksBadRequestCodes)[keyof typeof IntegrationWebhooksBadRequestCodes];

export class IntegrationWebhooksBadRequestError extends Error {
  code: IntegrationWebhooksBadRequestCode;

  constructor(code: IntegrationWebhooksBadRequestCode, message: string) {
    super(message);
    this.name = "IntegrationWebhooksBadRequestError";
    this.code = code;
  }
}

export const IntegrationWebhooksNotFoundCodes = {
  TARGET_NOT_FOUND: "TARGET_NOT_FOUND",
  CONNECTION_NOT_FOUND: "CONNECTION_NOT_FOUND",
} as const;

export type IntegrationWebhooksNotFoundCode =
  (typeof IntegrationWebhooksNotFoundCodes)[keyof typeof IntegrationWebhooksNotFoundCodes];

export class IntegrationWebhooksNotFoundError extends Error {
  code: IntegrationWebhooksNotFoundCode;

  constructor(code: IntegrationWebhooksNotFoundCode, message: string) {
    super(message);
    this.name = "IntegrationWebhooksNotFoundError";
    this.code = code;
  }
}
