// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useLoadedWebhookAutomationEditorState } from "./use-webhook-automation-editor-state.js";

describe("useLoadedWebhookAutomationEditorState", () => {
  it("renders in create mode with loaded prerequisites", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Number.POSITIVE_INFINITY,
        },
      },
    });

    const { result } = renderHook(
      () =>
        useLoadedWebhookAutomationEditorState({
          mode: "create",
          automationId: undefined,
          navigate: async () => {},
          initialValues: {
            name: "",
            sandboxProfileId: "",
            enabled: true,
            instructions: "",
            conversationKeyTemplate: "",
            triggerIds: [],
            triggerParameterValues: {},
          },
          templateParseError: null,
          preservedInputTemplate: null,
          connectionOptions: [],
          sandboxProfileOptions: [],
          directoryData: {
            connections: [],
            targets: [],
          },
        }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      },
    );

    expect(result.current.values).toEqual({
      name: "",
      sandboxProfileId: "",
      enabled: true,
      instructions: "",
      conversationKeyTemplate: "",
      triggerIds: [],
      triggerParameterValues: {},
    });
    expect(result.current.templateParseError).toBeNull();
    expect(result.current.formError).toBeNull();
  });
});
