import { z } from "zod";

export const OpenAiReasoningEfforts = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  XHIGH: "xhigh",
} as const;

export type OpenAiReasoningEffort =
  (typeof OpenAiReasoningEfforts)[keyof typeof OpenAiReasoningEfforts];

export const OpenAiReasoningEffortLabelByValue: Record<OpenAiReasoningEffort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
};

export const OpenAiConnectionMethodIds = {
  API_KEY: "api-key",
  CHATGPT_DEVICE_CODE: "chatgpt-device-code",
} as const;

export type OpenAiConnectionMethodId =
  (typeof OpenAiConnectionMethodIds)[keyof typeof OpenAiConnectionMethodIds];

const OpenAiConnectionMethodIdValues = [
  OpenAiConnectionMethodIds.API_KEY,
  OpenAiConnectionMethodIds.CHATGPT_DEVICE_CODE,
] as const;

const OpenAiConnectionMethodIdSchema = z.enum(OpenAiConnectionMethodIdValues);

export function isOpenAiConnectionMethodId(value: string): value is OpenAiConnectionMethodId {
  return OpenAiConnectionMethodIdSchema.safeParse(value).success;
}
