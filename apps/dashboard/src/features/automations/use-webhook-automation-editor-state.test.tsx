// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useWebhookAutomationEditorState } from "./use-webhook-automation-editor-state.js";
import {
  WEBHOOK_AUTOMATION_INTEGRATION_DIRECTORY_QUERY_KEY,
  WEBHOOK_AUTOMATION_SANDBOX_PROFILES_QUERY_KEY,
} from "./use-webhook-automation-prerequisites.js";

describe("useWebhookAutomationEditorState", () => {
  it("renders in create mode when prerequisites are already loaded", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Number.POSITIVE_INFINITY,
        },
      },
    });
    queryClient.setQueryData(WEBHOOK_AUTOMATION_INTEGRATION_DIRECTORY_QUERY_KEY, {
      connections: [],
      targets: [],
    });
    queryClient.setQueryData(WEBHOOK_AUTOMATION_SANDBOX_PROFILES_QUERY_KEY, []);

    const { result } = renderHook(
      () =>
        useWebhookAutomationEditorState({
          mode: "create",
          automationId: undefined,
          navigate: async () => {},
        }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      },
    );

    expect(result.current.pageError).toBeNull();
    expect(result.current.values).toEqual({
      name: "",
      sandboxProfileId: "",
      enabled: true,
      inputTemplate: "",
      conversationKeyTemplate: "",
      triggerIds: [],
      triggerParameterValues: {},
    });
  });
});
