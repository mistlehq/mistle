export const AutomationWebhooksBadRequestCodes = {
  INVALID_LIST_WEBHOOK_AUTOMATIONS_INPUT: "INVALID_LIST_WEBHOOK_AUTOMATIONS_INPUT",
  INVALID_PAGINATION_CURSOR: "INVALID_PAGINATION_CURSOR",
  INVALID_CONNECTION_REFERENCE: "INVALID_CONNECTION_REFERENCE",
  CONNECTION_TARGET_NOT_WEBHOOK_CAPABLE: "CONNECTION_TARGET_NOT_WEBHOOK_CAPABLE",
  INVALID_SANDBOX_PROFILE_REFERENCE: "INVALID_SANDBOX_PROFILE_REFERENCE",
} as const;

export type AutomationWebhooksBadRequestCode =
  (typeof AutomationWebhooksBadRequestCodes)[keyof typeof AutomationWebhooksBadRequestCodes];

export class AutomationWebhooksBadRequestError extends Error {
  code: AutomationWebhooksBadRequestCode;

  constructor(code: AutomationWebhooksBadRequestCode, message: string) {
    super(message);
    this.name = "AutomationWebhooksBadRequestError";
    this.code = code;
  }
}

export const AutomationWebhooksNotFoundCodes = {
  AUTOMATION_NOT_FOUND: "AUTOMATION_NOT_FOUND",
} as const;

export type AutomationWebhooksNotFoundCode =
  (typeof AutomationWebhooksNotFoundCodes)[keyof typeof AutomationWebhooksNotFoundCodes];

export class AutomationWebhooksNotFoundError extends Error {
  code: AutomationWebhooksNotFoundCode;

  constructor(code: AutomationWebhooksNotFoundCode, message: string) {
    super(message);
    this.name = "AutomationWebhooksNotFoundError";
    this.code = code;
  }
}
