// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type { RuntimeConversationNavigatorRow } from "./runtime-conversation-navigator-model.js";
import {
  RuntimeConversationNavigator,
  RuntimeConversationNavigatorSheet,
} from "./runtime-conversation-navigator.js";

const Rows = [
  {
    id: "conversation_active",
    title: "Active work",
    cwd: "/workspace/repo-a",
    cwdSectionLabel: "repo-a",
    lastActivityAt: Date.UTC(2026, 4, 18, 9),
    isActive: true,
    isOpening: false,
    isOriginal: true,
    isPinnedCurrent: false,
    pendingServerRequestCount: 1,
  },
  {
    id: "conversation_other",
    title: "Other work",
    cwd: "/workspace/repo-b",
    cwdSectionLabel: "repo-b",
    lastActivityAt: Date.UTC(2026, 4, 20, 6),
    isActive: false,
    isOpening: true,
    isOriginal: false,
    isPinnedCurrent: false,
    pendingServerRequestCount: 0,
  },
] satisfies readonly RuntimeConversationNavigatorRow[];

describe("RuntimeConversationNavigator", () => {
  it("renders conversation rows with compact status indicators", () => {
    render(
      <RuntimeConversationNavigator
        isConversationListLimited={false}
        isStartingConversation={false}
        onRefreshConversations={function onRefreshConversations() {}}
        onSelectConversation={function onSelectConversation() {}}
        onStartConversation={function onStartConversation() {}}
        rows={Rows}
      />,
    );

    const navigator = screen.getByRole("complementary", { name: "Conversations" });
    expect(within(navigator).getByRole("heading", { name: "Conversations" })).toBeTruthy();
    expect(within(navigator).getByRole("button", { name: "New conversation" })).toBeTruthy();
    expect(within(navigator).queryByText("Showing latest 20 only")).toBeNull();
    expect(within(navigator).getByRole("button", { name: "Refresh conversations" })).toBeTruthy();
    expect(within(navigator).getByRole("region", { name: "repo-a" })).toBeTruthy();
    expect(within(navigator).getByRole("region", { name: "repo-b" })).toBeTruthy();
    expect(within(navigator).getByRole("button", { name: /Active work/ })).toBeTruthy();
    expect(within(navigator).getByRole("button", { name: /original/ })).toBeTruthy();
    expect(within(navigator).getAllByTitle(/^Last activity /)).toHaveLength(2);
    expect(within(navigator).getByRole("status", { name: "Needs input" })).toBeTruthy();
    expect(within(navigator).getByRole("button", { name: /Other work/ })).toBeTruthy();
    expect(within(navigator).queryByLabelText("Opening conversation")).toBeNull();
    expect(within(navigator).queryByText("Active")).toBeNull();
    expect(within(navigator).queryByText("Loaded")).toBeNull();
    expect(within(navigator).queryByText("Current")).toBeNull();
  });

  it("renders pinned active placeholders as italic new conversations", () => {
    render(
      <RuntimeConversationNavigator
        isConversationListLimited={false}
        isStartingConversation={false}
        onRefreshConversations={function onRefreshConversations() {}}
        onSelectConversation={function onSelectConversation() {}}
        onStartConversation={function onStartConversation() {}}
        rows={[
          {
            id: "conversation_new",
            title: "New conversation",
            cwd: "/root",
            cwdSectionLabel: "root",
            lastActivityAt: null,
            isActive: true,
            isOpening: false,
            isOriginal: false,
            isPinnedCurrent: true,
            pendingServerRequestCount: 0,
          },
        ]}
      />,
    );

    const navigator = screen.getByRole("complementary", { name: "Conversations" });
    const title = within(navigator).getByText("New conversation");
    expect(title.className).toContain("italic");
    expect(within(navigator).queryByText("root")).toBeNull();
  });

  it("states when the conversation list is limited to the latest 20", () => {
    render(
      <RuntimeConversationNavigator
        isConversationListLimited
        isStartingConversation={false}
        onRefreshConversations={function onRefreshConversations() {}}
        onSelectConversation={function onSelectConversation() {}}
        onStartConversation={function onStartConversation() {}}
        rows={Rows}
      />,
    );

    const navigator = screen.getByRole("complementary", { name: "Conversations" });
    expect(within(navigator).getByText("Showing latest 20 only")).toBeTruthy();
  });

  it("renders the same conversation list inside the mobile sheet", () => {
    render(
      <RuntimeConversationNavigatorSheet
        isOpen
        navigator={{
          isConversationListLimited: false,
          isStartingConversation: false,
          onRefreshConversations: function onRefreshConversations() {},
          onSelectConversation: function onSelectConversation() {},
          onStartConversation: function onStartConversation() {},
          rows: Rows,
        }}
        onOpenChange={function onOpenChange() {}}
      />,
    );

    const sheet = screen.getByRole("dialog", { name: "Conversations" });
    expect(within(sheet).getAllByRole("heading", { name: "Conversations" }).length).toBeGreaterThan(
      0,
    );
    expect(within(sheet).getByRole("button", { name: /Active work/ })).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: /Other work/ })).toBeTruthy();
  });

  it("closes the mobile sheet after starting a conversation", () => {
    function SheetHarness(): React.JSX.Element {
      const [isOpen, setOpen] = useState(true);

      return (
        <RuntimeConversationNavigatorSheet
          isOpen={isOpen}
          navigator={{
            isConversationListLimited: false,
            isStartingConversation: false,
            onRefreshConversations: function onRefreshConversations() {},
            onSelectConversation: function onSelectConversation() {},
            onStartConversation: function onStartConversation() {},
            rows: Rows,
          }}
          onOpenChange={setOpen}
        />
      );
    }

    render(<SheetHarness />);

    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));

    expect(screen.queryByRole("dialog", { name: "Conversations" })).toBeNull();
  });

  it("closes the mobile sheet after selecting a conversation", () => {
    function SheetHarness(): React.JSX.Element {
      const [isOpen, setOpen] = useState(true);

      return (
        <RuntimeConversationNavigatorSheet
          isOpen={isOpen}
          navigator={{
            isConversationListLimited: false,
            isStartingConversation: false,
            onRefreshConversations: function onRefreshConversations() {},
            onSelectConversation: function onSelectConversation() {},
            onStartConversation: function onStartConversation() {},
            rows: Rows,
          }}
          onOpenChange={setOpen}
        />
      );
    }

    render(<SheetHarness />);

    fireEvent.click(screen.getByRole("button", { name: /Active work/ }));

    expect(screen.queryByRole("dialog", { name: "Conversations" })).toBeNull();
  });
});
