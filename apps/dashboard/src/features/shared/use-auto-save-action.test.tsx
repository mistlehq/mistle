// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import { useAutoSaveAction } from "./use-auto-save-action.js";

describe("useAutoSaveAction", () => {
  it("runs save and afterSave with the submitted value", async () => {
    const queryClient = createTestQueryClient();
    const savedValues: string[] = [];
    const sideEffects: string[] = [];

    const { result } = renderHook(
      () =>
        useAutoSaveAction({
          save: async (value: string) => {
            savedValues.push(value);
          },
          afterSave: async (value: string) => {
            sideEffects.push(`after:${value}`);
          },
        }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      },
    );

    await act(async () => {
      await result.current.run("updated name");
    });

    expect(savedValues).toEqual(["updated name"]);
    expect(sideEffects).toEqual(["after:updated name"]);
    expect(result.current.isSaving).toBe(false);
  });

  it("surfaces save errors and does not run success side effects", async () => {
    const queryClient = createTestQueryClient();
    const sideEffects: string[] = [];

    const { result } = renderHook(
      () =>
        useAutoSaveAction({
          save: async () => {
            throw new Error("save failed");
          },
          afterSave: async (value: string) => {
            sideEffects.push(value);
          },
        }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      },
    );

    await expect(
      act(async () => {
        await result.current.run("updated name");
      }),
    ).rejects.toThrow("save failed");
    expect(sideEffects).toEqual([]);
    expect(result.current.isSaving).toBe(false);
  });

  it("reports saving state while the mutation is in flight", async () => {
    const queryClient = createTestQueryClient();
    let resolveSave: (() => void) | null = null;

    const { result } = renderHook(
      () =>
        useAutoSaveAction({
          save: async () =>
            await new Promise<void>((resolve) => {
              resolveSave = resolve;
            }),
        }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      },
    );

    act(() => {
      void result.current.run("updated name");
    });

    await waitFor(() => {
      expect(result.current.isSaving).toBe(true);
    });

    await act(async () => {
      resolveSave?.();
    });
    await waitFor(() => {
      expect(result.current.isSaving).toBe(false);
    });
  });
});
