// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  expectCliPty,
  expectTerminalPty,
  waitForChatReady,
  waitForEnabledButton,
  waitForPtySession,
  withSessionWorkbenchCliHarness,
} from "./helpers/session-workbench-cli-harness.js";

describe("SessionWorkbenchPage CLI mode integration", () => {
  afterEach(() => {
    cleanup();
  });

  describe("primary panel flow", () => {
    it("runs Codex CLI in the primary panel while keeping the side terminal available", async () => {
      await withSessionWorkbenchCliHarness(async ({ tunnelServer }) => {
        fireEvent.click(await waitForEnabledButton("CLI"));
        const cliPty = await waitForPtySession(tunnelServer, "cli");
        expectCliPty(cliPty);

        expect(screen.queryByPlaceholderText("Ask anything")).toBeNull();

        fireEvent.click(await waitForEnabledButton("Open terminal"));
        expectTerminalPty(await waitForPtySession(tunnelServer, "terminal"));

        fireEvent.click(screen.getByRole("button", { name: "CLI" }));
        await tunnelServer.waitForPtyClose(cliPty.streamId);
        await tunnelServer.waitForThreadResume("thread_cli_from_cli");

        await waitForChatReady();
        expect(screen.queryByTitle("Codex CLI")).toBeNull();
      });
    });

    it("starts a new CLI session when the connected chat thread is not materialized yet", async () => {
      await withSessionWorkbenchCliHarness(async ({ tunnelServer }) => {
        fireEvent.click(await waitForEnabledButton("CLI"));
        const cliPty = await waitForPtySession(tunnelServer, "cli");

        expectCliPty(cliPty);
        expect(screen.queryByText("Could not start Codex CLI")).toBeNull();
      });
    });

    it("fails CLI entry for an unmaterialized provider-backed thread instead of starting a new CLI thread", async () => {
      await withSessionWorkbenchCliHarness(
        {
          providerConversationId: "thread_provider_empty",
          providerThreadTurnCount: 0,
        },
        async () => {
          fireEvent.click(await waitForEnabledButton("CLI"));

          expect(await screen.findByText("Could not start Codex CLI")).toBeDefined();
          expect(
            screen.getByText(
              "The linked provider conversation 'thread_provider_empty' is not resumable for Codex CLI.",
            ),
          ).toBeDefined();
        },
      );
    });

    it("opens the CLI after the side terminal without PTY session collisions", async () => {
      await withSessionWorkbenchCliHarness(async ({ tunnelServer }) => {
        fireEvent.click(await waitForEnabledButton("Open terminal"));
        expectTerminalPty(await waitForPtySession(tunnelServer, "terminal"));

        fireEvent.click(await waitForEnabledButton("CLI"));
        expectCliPty(await waitForPtySession(tunnelServer, "cli"));

        expect(screen.getByRole("button", { name: "Terminal" }).getAttribute("aria-pressed")).toBe(
          "true",
        );
        expect(screen.queryByText("pty session already exists")).toBeNull();
      });
    });

    it("returns to chat even after the CLI PTY has already exited", async () => {
      await withSessionWorkbenchCliHarness(async ({ tunnelServer }) => {
        fireEvent.click(await waitForEnabledButton("CLI"));
        const cliPty = await waitForPtySession(tunnelServer, "cli");
        expectCliPty(cliPty);
        tunnelServer.emitPtyExit(cliPty.streamId);
        await tunnelServer.waitForThreadResume("thread_cli_from_cli");

        await waitForChatReady();
      });
    }, 15_000);

    it("shows a CLI entry failure alert in the chat view and leaves chat active", async () => {
      await withSessionWorkbenchCliHarness(async ({ controls }) => {
        controls.failNextCliOpen("codex executable missing");

        fireEvent.click(await waitForEnabledButton("CLI"));

        expect(await screen.findByText("Could not start Codex CLI")).toBeDefined();
        expect(screen.getByText("codex executable missing")).toBeDefined();
        expect(screen.getByPlaceholderText("Ask anything")).toBeDefined();
        expect(screen.queryByRole("button", { name: "Return to chat" })).toBeNull();
      });
    });

    it("preserves the active resumable thread when CLI launch fails before handoff completes", async () => {
      await withSessionWorkbenchCliHarness(async ({ controls, tunnelServer }) => {
        controls.failNextCliOpen("codex executable missing");

        fireEvent.click(await waitForEnabledButton("CLI"));

        expect(await screen.findByText("Could not start Codex CLI")).toBeDefined();
        await waitForChatReady();

        fireEvent.click(await waitForEnabledButton("CLI"));
        expectCliPty(await waitForPtySession(tunnelServer, "cli"));
        await tunnelServer.waitForThreadResume("thread_cli_test");
      });
    });

    it("shows a restore failure alert in chat without offering a retry action", async () => {
      await withSessionWorkbenchCliHarness(async ({ controls, tunnelServer }) => {
        fireEvent.click(await waitForEnabledButton("CLI"));
        const cliPty = await waitForPtySession(tunnelServer, "cli");
        expectCliPty(cliPty);
        controls.setConnectionTokenFailure(true);
        tunnelServer.emitPtyExit(cliPty.streamId);

        expect(await screen.findByText("Could not restore chat")).toBeDefined();
        expect(
          screen.getAllByText(
            "Minting sandbox connection token failed: Could not mint connection token.",
          ).length,
        ).toBeGreaterThan(0);
        expect(screen.getByPlaceholderText("Ask anything")).toBeDefined();
        expect(screen.queryByRole("button", { name: "Retry restoring chat" })).toBeNull();
      });
    }, 15_000);

    it("fails restore explicitly instead of hanging forever when reconnect never establishes an active thread", async () => {
      await withSessionWorkbenchCliHarness(async ({ tunnelServer }) => {
        fireEvent.click(await waitForEnabledButton("CLI"));
        const cliPty = await waitForPtySession(tunnelServer, "cli");
        expectCliPty(cliPty);
        tunnelServer.hangNextThreadList();
        fireEvent.click(screen.getByRole("button", { name: "CLI" }));

        await waitFor(
          () => {
            expect(screen.getByText("Could not restore chat")).toBeDefined();
            expect(screen.getByText("Timed out while restoring chat.")).toBeDefined();
          },
          { timeout: 35_000 },
        );
      });
    }, 45_000);
  });

  describe("restore policy", () => {
    it("restores non-provider sessions from the most recently updated available thread even when it is not loaded yet", async () => {
      await withSessionWorkbenchCliHarness(async ({ tunnelServer }) => {
        tunnelServer.omitLoadedThreadForNextCliOpen();

        fireEvent.click(await waitForEnabledButton("CLI"));
        const cliPty = await waitForPtySession(tunnelServer, "cli");
        expectCliPty(cliPty);
        fireEvent.click(screen.getByRole("button", { name: "CLI" }));

        await waitForChatReady();
      });
    }, 15_000);

    it("does not try to reconnect chat through the provisional empty thread after leaving CLI", async () => {
      await withSessionWorkbenchCliHarness(async ({ tunnelServer }) => {
        fireEvent.click(await waitForEnabledButton("CLI"));
        const cliPty = await waitForPtySession(tunnelServer, "cli");
        expectCliPty(cliPty);
        tunnelServer.hangResumeForThread("thread_cli_test");
        fireEvent.click(screen.getByRole("button", { name: "CLI" }));

        await tunnelServer.waitForThreadResume("thread_cli_from_cli");
        await waitForChatReady();
      });
    }, 15_000);
  });
});
