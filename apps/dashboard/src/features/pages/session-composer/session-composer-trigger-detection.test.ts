import type { ComposerCapability } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import {
  detectActiveComposerTrigger,
  listSkillMentions,
  readLeadingSlashCommandName,
} from "./session-composer-trigger-detection.js";

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

const SkillMentionCapabilityFixture: ComposerCapability = {
  kind: "skillMention",
  trigger: "$",
  source: "runtimeSkill",
  submitAs: "inlineText",
  skills: [
    {
      name: "grill-with-docs",
      description: "Stress test a plan against docs",
      sourcePath: "/root/.codex/skills/grill-with-docs/SKILL.md",
    },
  ],
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

  it("detects slash command queries away from the composer start", () => {
    expect(
      detect({
        composerText: "look at /review",
      }),
    ).toEqual({
      capabilityKind: "composerCommand",
      trigger: "/",
      query: "review",
      range: {
        start: 8,
        end: 15,
      },
    });

    expect(
      detect({
        composerText: " /review",
      }),
    ).toEqual({
      capabilityKind: "composerCommand",
      trigger: "/",
      query: "review",
      range: {
        start: 1,
        end: 8,
      },
    });

    expect(
      detect({
        composerText: "first line\n/review",
      }),
    ).toEqual({
      capabilityKind: "composerCommand",
      trigger: "/",
      query: "review",
      range: {
        start: 11,
        end: 18,
      },
    });
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

  it("detects runtime skill mention queries", () => {
    expect(
      detect({
        composerCapabilities: [SkillMentionCapabilityFixture],
        composerText: "Use $grill",
      }),
    ).toEqual({
      capabilityKind: "skillMention",
      trigger: "$",
      query: "grill",
      range: {
        start: 4,
        end: 10,
      },
    });
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

describe("readLeadingSlashCommandName", () => {
  it("reads slash command names only from the literal composer start", () => {
    expect(readLeadingSlashCommandName("/review")).toBe("review");
    expect(readLeadingSlashCommandName("/review check auth")).toBe("review");
    expect(readLeadingSlashCommandName(" /review")).toBeNull();
    expect(readLeadingSlashCommandName("\n/review")).toBeNull();
    expect(readLeadingSlashCommandName("Use /review")).toBeNull();
  });
});

describe("listSkillMentions", () => {
  it("collapses duplicate runtime skill entries for the same source path", () => {
    expect(
      listSkillMentions([
        {
          kind: "skillMention",
          trigger: "$",
          source: "runtimeSkill",
          submitAs: "inlineText",
          skills: [
            {
              name: "grill-with-docs",
              description: "Stress test a plan against docs",
              sourcePath: "/root/.codex/skills/grill-with-docs/SKILL.md",
            },
            {
              name: "grill-with-docs",
              description: "Stress test a plan against docs",
              sourcePath: "/root/.codex/skills/grill-with-docs/SKILL.md",
            },
          ],
        },
      ]),
    ).toEqual([
      {
        name: "grill-with-docs",
        description: "Stress test a plan against docs",
        sourcePath: "/root/.codex/skills/grill-with-docs/SKILL.md",
      },
    ]);
  });

  it("keeps duplicate skill names that resolve to different source paths", () => {
    expect(
      listSkillMentions([
        {
          kind: "skillMention",
          trigger: "$",
          source: "runtimeSkill",
          submitAs: "inlineText",
          skills: [
            {
              name: "grill-with-docs",
              description: "Root skill",
              sourcePath: "/root/.codex/skills/grill-with-docs/SKILL.md",
            },
            {
              name: "grill-with-docs",
              description: "Repo skill",
              sourcePath: "/workspace/.agents/skills/grill-with-docs/SKILL.md",
            },
            {
              name: "write-a-skill",
              sourcePath: "/root/.codex/skills/write-a-skill/SKILL.md",
            },
          ],
        },
      ]),
    ).toEqual([
      {
        name: "grill-with-docs",
        description: "Root skill",
        sourcePath: "/root/.codex/skills/grill-with-docs/SKILL.md",
      },
      {
        name: "grill-with-docs",
        description: "Repo skill",
        sourcePath: "/workspace/.agents/skills/grill-with-docs/SKILL.md",
      },
      {
        name: "write-a-skill",
        sourcePath: "/root/.codex/skills/write-a-skill/SKILL.md",
      },
    ]);
  });
});
