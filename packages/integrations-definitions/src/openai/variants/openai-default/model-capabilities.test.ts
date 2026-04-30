import { describe, expect, it } from "vitest";

import {
  OpenAiReasoningEffortLabelByValue,
  isOpenAiConnectionMethodId,
} from "./model-capabilities.js";

describe("OpenAI model capabilities", () => {
  it("identifies supported connection method ids", () => {
    expect(isOpenAiConnectionMethodId("api-key")).toBe(true);
    expect(isOpenAiConnectionMethodId("chatgpt-device-code")).toBe(true);
    expect(isOpenAiConnectionMethodId("unsupported")).toBe(false);
  });

  it("exposes reasoning effort labels for current model-list driven UI", () => {
    expect(OpenAiReasoningEffortLabelByValue).toEqual({
      low: "Low",
      medium: "Medium",
      high: "High",
      xhigh: "Extra High",
    });
  });
});
