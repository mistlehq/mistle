// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SessionComposerFixtureProps } from "../session-agents/codex/fixtures/session-fixtures.js";
import { SessionConversationBottomPanel } from "./session-conversation-pane.js";

describe("SessionConversationBottomPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the session status message above the composer", () => {
    render(
      <SessionConversationBottomPanel
        chatEntries={[]}
        composerViewModel={{
          ...SessionComposerFixtureProps,
          statusMessage: {
            message:
              "Model GPT-5.3 Codex Spark cannot inspect images. Images will only be sent as file path references.",
            variant: "default",
          },
        }}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={function onRespondToServerRequest() {}}
        serverRequestPanelEntries={[]}
      />,
    );

    expect(
      screen.getByText(
        "Model GPT-5.3 Codex Spark cannot inspect images. Images will only be sent as file path references.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });
});
