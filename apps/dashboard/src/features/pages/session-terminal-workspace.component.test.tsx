// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { DockviewApi } from "dockview";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  SessionTerminalWorkspaceView,
  type SessionTerminalWorkspaceHandle,
} from "./session-terminal-workspace.js";

describe("SessionTerminalWorkspaceView", () => {
  afterEach(() => {
    cleanup();
  });

  beforeAll(() => {
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class ResizeObserver {
        disconnect(): void {}
        observe(): void {}
        unobserve(): void {}
      },
      writable: true,
    });
  });

  it("does not create an initial terminal panel on mount while hidden", async () => {
    let resolveApi: ((api: DockviewApi) => void) | null = null;
    const readyApiPromise = new Promise<DockviewApi>((resolve) => {
      resolveApi = resolve;
    });

    render(
      <SessionTerminalWorkspaceView
        cwd="/root"
        isVisible={false}
        onApiReady={(api) => {
          resolveApi?.(api);
        }}
        onWorkspaceEmpty={() => {}}
        renderTerminalPanel={({ panelId }) => <div>{`panel:${panelId}`}</div>}
      />,
    );

    const readyApi = await readyApiPromise;

    await waitFor(() => {
      expect(readyApi.totalPanels).toBe(0);
    });
    expect(screen.queryByText("panel:terminal")).toBeNull();
  });

  it("creates the first terminal panel when explicitly ensured", async () => {
    const workspaceRef = { current: null as SessionTerminalWorkspaceHandle | null };
    let resolveApi: ((api: DockviewApi) => void) | null = null;
    const readyApiPromise = new Promise<DockviewApi>((resolve) => {
      resolveApi = resolve;
    });

    render(
      <SessionTerminalWorkspaceView
        cwd="/root/acme/repo-1"
        isVisible={false}
        onApiReady={(api) => {
          resolveApi?.(api);
        }}
        onWorkspaceEmpty={() => {}}
        ref={(value) => {
          workspaceRef.current = value;
        }}
        renderTerminalPanel={({ cwd, panelId }) => <div>{`panel:${panelId}:${cwd}`}</div>}
      />,
    );

    const readyApi = await readyApiPromise;
    workspaceRef.current?.ensureTerminalWorkspace();

    await waitFor(() => {
      expect(readyApi.totalPanels).toBe(1);
    });
    expect(await screen.findByText("panel:terminal:/root/acme/repo-1")).toBeDefined();
  });

  it("creates the first terminal panel with the latest cwd when the workspace becomes visible", async () => {
    let resolveApi: ((api: DockviewApi) => void) | null = null;
    const readyApiPromise = new Promise<DockviewApi>((resolve) => {
      resolveApi = resolve;
    });

    const view = render(
      <SessionTerminalWorkspaceView
        cwd="/root/acme/repo-1"
        isVisible={false}
        onApiReady={(api) => {
          resolveApi?.(api);
        }}
        onWorkspaceEmpty={() => {}}
        renderTerminalPanel={({ cwd, panelId }) => <div>{`panel:${panelId}:${cwd}`}</div>}
      />,
    );

    const readyApi = await readyApiPromise;
    await waitFor(() => {
      expect(readyApi.totalPanels).toBe(0);
    });

    view.rerender(
      <SessionTerminalWorkspaceView
        cwd="/root/acme/repo-2"
        isVisible
        onApiReady={() => {}}
        onWorkspaceEmpty={() => {}}
        renderTerminalPanel={({ cwd, panelId }) => <div>{`panel:${panelId}:${cwd}`}</div>}
      />,
    );

    await waitFor(() => {
      expect(readyApi.totalPanels).toBe(1);
    });
    expect(await screen.findByText("panel:terminal:/root/acme/repo-2")).toBeDefined();
  });
});
