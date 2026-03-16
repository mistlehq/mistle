import type { WebhookPayloadFilterPath, WebhookPayloadPathInput } from "./types.js";

export function path(input: WebhookPayloadPathInput): WebhookPayloadFilterPath {
  if (typeof input === "string") {
    if (input.length === 0) {
      throw new Error("Webhook payload filter path must not be empty.");
    }

    const segments = input.split(".");
    if (segments.some((segment) => segment.length === 0)) {
      throw new Error("Webhook payload filter path must not contain empty segments.");
    }

    return segments;
  }

  if (input.length === 0) {
    throw new Error("Webhook payload filter path must contain at least one segment.");
  }

  const segments: string[] = [];
  for (const segment of input) {
    if (segment.length === 0) {
      throw new Error("Webhook payload filter path must not contain empty segments.");
    }

    segments.push(segment);
  }

  return segments;
}
