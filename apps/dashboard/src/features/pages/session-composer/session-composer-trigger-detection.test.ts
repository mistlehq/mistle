import type { ComposerCapability } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { detectActiveComposerTrigger } from "./session-composer-trigger-detection.js";

const ComposerCommandCapabilityFixture: ComposerCapability = {
  kind: "composerCommand",
  trigger: "/",
  source: "runtimeCommand",
  commands: [
    {
      id: "codex.review",
      name: "review",
      availability: {
        duringActiveTurn: "disabled",
      },
      submitAs: "typedRuntimeCommand",
    },
    {
      id: "codex.explain",
      name: "explain",
      submitAs: "runtimeCommand",
    },
  ],
};

const ContextMentionCapabilityFixture: ComposerCapability = {
  kind: "contextMention",
  trigger: "@",
  source: "workspacePath",
  insertAs: "relativePathText",
  submitAs: "inlineText",
};

function detect(input: {
  composerCapabilities?: readonly ComposerCapability[];
  composerText: string;
  selectionStart?: number;
  selectionEnd?: number;
}) {
  const selectionStart = input.selectionStart ?? input.composerText.length;

  return detectActiveComposerTrigger({
    composerCapabilities: input.composerCapabilities ?? [ComposerCommandCapabilityFixture],
    composerText: input.composerText,
    selectionStart,
    selectionEnd: input.selectionEnd ?? selectionStart,
  });
}

describe("detectActiveComposerTrigger", () => {
  it("returns no trigger when the runtime does not declare composer commands", () => {
    expect(
      detect({
        composerCapabilities: [],
        composerText: "/review",
      }),
    ).toBeNull();

    expect(
      detect({
        composerCapabilities: [ContextMentionCapabilityFixture],
        composerText: "/review",
      }),
    ).toBeNull();
  });

  it("detects a slash command query at the start of the composer", () => {
    expect(
      detect({
        composerText: "/rev",
      }),
    ).toEqual({
      capabilityKind: "composerCommand",
      trigger: "/",
      query: "rev",
      range: {
        start: 0,
        end: 4,
      },
    });
  });

  it("detects an empty slash command query", () => {
    expect(
      detect({
        composerText: "/",
      }),
    ).toEqual({
      capabilityKind: "composerCommand",
      trigger: "/",
      query: "",
      range: {
        start: 0,
        end: 1,
      },
    });
  });

  it("uses the cursor position for the query and the full command token for replacement", () => {
    expect(
      detect({
        composerText: "/review",
        selectionStart: 3,
      }),
    ).toEqual({
      capabilityKind: "composerCommand",
      trigger: "/",
      query: "re",
      range: {
        start: 0,
        end: 7,
      },
    });
  });

  it("keeps slash detection active only before command arguments", () => {
    expect(
      detect({
        composerText: "/review ",
      }),
    ).toBeNull();

    expect(
      detect({
        composerText: "/review check this",
      }),
    ).toBeNull();

    expect(
      detect({
        composerText: "/review check this",
        selectionStart: 4,
      }),
    ).toEqual({
      capabilityKind: "composerCommand",
      trigger: "/",
      query: "rev",
      range: {
        start: 0,
        end: 7,
      },
    });
  });

  it("does not treat slash text outside the whole-composer start as a command trigger", () => {
    expect(
      detect({
        composerText: "look at /review",
      }),
    ).toBeNull();

    expect(
      detect({
        composerText: " /review",
      }),
    ).toBeNull();

    expect(
      detect({
        composerText: "first line\n/review",
      }),
    ).toBeNull();
  });

  it("does not hijack slash-looking paths or urls", () => {
    expect(
      detect({
        composerText: "/tmp/file",
      }),
    ).toBeNull();

    expect(
      detect({
        composerText: "http://localhost:3000/path",
      }),
    ).toBeNull();
  });

  it("detects context mention queries inline", () => {
    expect(
      detect({
        composerCapabilities: [ComposerCommandCapabilityFixture, ContextMentionCapabilityFixture],
        composerText: "@src",
      }),
    ).toEqual({
      capabilityKind: "contextMention",
      trigger: "@",
      query: "src",
      range: {
        start: 0,
        end: 4,
      },
    });

    expect(
      detect({
        composerCapabilities: [ContextMentionCapabilityFixture],
        composerText: "review @packages/db please",
        selectionStart: 19,
      }),
    ).toEqual({
      capabilityKind: "contextMention",
      trigger: "@",
      query: "packages/db",
      range: {
        start: 7,
        end: 19,
      },
    });
  });

  it("detects context mention arguments inside slash commands", () => {
    expect(
      detect({
        composerCapabilities: [ComposerCommandCapabilityFixture, ContextMentionCapabilityFixture],
        composerText: "/review @src",
      }),
    ).toEqual({
      capabilityKind: "contextMention",
      trigger: "@",
      query: "src",
      range: {
        start: 8,
        end: 12,
      },
    });
  });

  it("does not keep completed context mention tokens active after whitespace", () => {
    expect(
      detect({
        composerCapabilities: [ContextMentionCapabilityFixture],
        composerText: "@src ",
      }),
    ).toBeNull();

    expect(
      detect({
        composerCapabilities: [ContextMentionCapabilityFixture],
        composerText: "review @src please",
        selectionStart: 12,
      }),
    ).toBeNull();
  });

  it("does not detect unsupported trigger families", () => {
    expect(
      detect({
        composerText: "@src",
      }),
    ).toBeNull();

    expect(
      detect({
        composerCapabilities: [ComposerCommandCapabilityFixture, ContextMentionCapabilityFixture],
        composerText: "$grill-with-docs",
      }),
    ).toBeNull();
  });

  it("does not detect malformed slash command tokens", () => {
    expect(
      detect({
        composerText: "/Review",
      }),
    ).toBeNull();

    expect(
      detect({
        composerText: "/review_command",
      }),
    ).toBeNull();
  });

  it("returns no trigger for range selections or out-of-bounds cursors", () => {
    expect(
      detect({
        composerText: "/review",
        selectionStart: 1,
        selectionEnd: 3,
      }),
    ).toBeNull();

    expect(
      detect({
        composerText: "/review",
        selectionStart: 8,
      }),
    ).toBeNull();
  });
});
