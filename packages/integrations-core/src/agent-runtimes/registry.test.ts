import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  DefinitionRegistryErrorCodes,
  IntegrationDefinitionRegistryError,
} from "../errors/index.js";
import { AgentRuntimeRegistry } from "./registry.js";
import type { AgentRuntimeDefinition } from "./types.js";

const RuntimeConfigSchema = z.object({});

function createRuntime(
  input: Partial<AgentRuntimeDefinition<typeof RuntimeConfigSchema>> = {},
): AgentRuntimeDefinition<typeof RuntimeConfigSchema> {
  return {
    runtimeId: "codex",
    displayName: "Codex",
    logoKey: "openai",
    configSchema: RuntimeConfigSchema,
    compileRuntime: () => ({
      runtimeClients: [],
      agentRuntimes: [],
    }),
    ...input,
  };
}

function parseRuntimeDefinition(input: string): AgentRuntimeDefinition<typeof RuntimeConfigSchema> {
  return {
    logoKey: "openai",
    ...JSON.parse(input),
    configSchema: RuntimeConfigSchema,
    compileRuntime: () => ({
      runtimeClients: [],
      agentRuntimes: [],
    }),
  };
}

describe("agent runtime registry", () => {
  it("registers and resolves runtimes by runtimeId", () => {
    const registry = new AgentRuntimeRegistry();

    registry.register(createRuntime());

    expect(registry.getRuntime({ runtimeId: "codex" })?.displayName).toBe("Codex");
  });

  it("rejects duplicate runtime ids", () => {
    const registry = new AgentRuntimeRegistry();
    const runtime = createRuntime();

    registry.register(runtime);

    expect(() => registry.register(runtime)).toThrow(IntegrationDefinitionRegistryError);
    expect(() => registry.register(runtime)).toThrow(
      expect.objectContaining({
        code: DefinitionRegistryErrorCodes.DUPLICATE_DEFINITION,
      }),
    );
  });

  it("allows runtimes without optional server entrypoints", () => {
    const registry = new AgentRuntimeRegistry();

    registry.register(createRuntime());

    expect(registry.getRuntime({ runtimeId: "codex" })?.runtimeId).toBe("codex");
  });

  it("accepts valid composer command capabilities", () => {
    const registry = new AgentRuntimeRegistry();

    registry.register(
      createRuntime({
        composerCapabilities: [
          {
            kind: "composerCommand",
            trigger: "/",
            source: "runtimeCommand",
            commands: [
              {
                id: "codex.review",
                name: "review",
                submitAs: "inlineText",
              },
              {
                id: "codex.grill-with-docs",
                name: "grill-with-docs",
                submitAs: "runtimeCommand",
              },
            ],
          },
        ],
      }),
    );

    expect(registry.getRuntime({ runtimeId: "codex" })?.composerCapabilities).toHaveLength(1);
  });

  it("accepts valid context and skill mention capabilities", () => {
    const registry = new AgentRuntimeRegistry();

    registry.register(
      createRuntime({
        composerCapabilities: [
          {
            kind: "contextMention",
            trigger: "@",
            source: "workspacePath",
            insertAs: "relativePathText",
            submitAs: "inlineText",
          },
          {
            kind: "skillMention",
            trigger: "$",
            source: "runtimeSkill",
            submitAs: "inlineText",
          },
        ],
      }),
    );

    expect(registry.getRuntime({ runtimeId: "codex" })?.composerCapabilities).toHaveLength(2);
  });

  it("rejects non-array composer capabilities", () => {
    const registry = new AgentRuntimeRegistry();

    expect(() =>
      registry.register(
        parseRuntimeDefinition(`{
          "runtimeId": "codex",
          "displayName": "Codex",
          "composerCapabilities": {}
        }`),
      ),
    ).toThrow(
      expect.objectContaining({
        code: DefinitionRegistryErrorCodes.INVALID_DEFINITION,
      }),
    );
  });

  it("rejects malformed context mention capabilities", () => {
    const registry = new AgentRuntimeRegistry();

    expect(() =>
      registry.register(
        parseRuntimeDefinition(`{
          "runtimeId": "codex",
          "displayName": "Codex",
          "composerCapabilities": [
            {
              "kind": "contextMention",
              "trigger": "@",
              "source": "workspacePath",
              "insertAs": "relativePathText",
              "submitAs": "runtimeCommand"
            }
          ]
        }`),
      ),
    ).toThrow(
      expect.objectContaining({
        code: DefinitionRegistryErrorCodes.INVALID_DEFINITION,
      }),
    );
  });

  it("rejects malformed skill mention capabilities", () => {
    const registry = new AgentRuntimeRegistry();

    expect(() =>
      registry.register(
        parseRuntimeDefinition(`{
          "runtimeId": "codex",
          "displayName": "Codex",
          "composerCapabilities": [
            {
              "kind": "skillMention",
              "trigger": "$",
              "source": "workspacePath",
              "submitAs": "inlineText"
            }
          ]
        }`),
      ),
    ).toThrow(
      expect.objectContaining({
        code: DefinitionRegistryErrorCodes.INVALID_DEFINITION,
      }),
    );
  });

  it("rejects unknown composer capability kinds", () => {
    const registry = new AgentRuntimeRegistry();

    expect(() =>
      registry.register(
        parseRuntimeDefinition(`{
          "runtimeId": "codex",
          "displayName": "Codex",
          "composerCapabilities": [
            {
              "kind": "runtimeMacro",
              "trigger": "/",
              "source": "runtimeCommand",
              "commands": [
                {
                  "id": "codex.review",
                  "name": "review",
                  "submitAs": "inlineText"
                }
              ]
            }
          ]
        }`),
      ),
    ).toThrow(
      expect.objectContaining({
        code: DefinitionRegistryErrorCodes.INVALID_DEFINITION,
      }),
    );
  });

  it("rejects empty composer command lists", () => {
    const registry = new AgentRuntimeRegistry();

    expect(() =>
      registry.register(
        createRuntime({
          composerCapabilities: [
            {
              kind: "composerCommand",
              trigger: "/",
              source: "runtimeCommand",
              commands: [],
            },
          ],
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: DefinitionRegistryErrorCodes.INVALID_DEFINITION,
      }),
    );
  });

  it("rejects malformed composer command submit behavior", () => {
    const registry = new AgentRuntimeRegistry();

    expect(() =>
      registry.register(
        parseRuntimeDefinition(`{
          "runtimeId": "codex",
          "displayName": "Codex",
          "composerCapabilities": [
            {
              "kind": "composerCommand",
              "trigger": "/",
              "source": "runtimeCommand",
              "commands": [
                {
                  "id": "codex.review",
                  "name": "review",
                  "submitAs": "promptParts"
                }
              ]
            }
          ]
        }`),
      ),
    ).toThrow(
      expect.objectContaining({
        code: DefinitionRegistryErrorCodes.INVALID_DEFINITION,
      }),
    );
  });

  it("rejects malformed composer command names", () => {
    const registry = new AgentRuntimeRegistry();

    const invalidNames = [
      "",
      "Review",
      "review command",
      "review_command",
      "review/name",
      "-review",
      "review-",
    ];

    for (const [nameIndex, name] of invalidNames.entries()) {
      expect(() =>
        registry.register(
          createRuntime({
            runtimeId: `codex-${String(nameIndex)}`,
            composerCapabilities: [
              {
                kind: "composerCommand",
                trigger: "/",
                source: "runtimeCommand",
                commands: [
                  {
                    id: "codex.review",
                    name,
                    submitAs: "inlineText",
                  },
                ],
              },
            ],
          }),
        ),
      ).toThrow(IntegrationDefinitionRegistryError);
    }
  });

  it("rejects duplicate composer command ids", () => {
    const registry = new AgentRuntimeRegistry();

    expect(() =>
      registry.register(
        createRuntime({
          composerCapabilities: [
            {
              kind: "composerCommand",
              trigger: "/",
              source: "runtimeCommand",
              commands: [
                {
                  id: "codex.review",
                  name: "review",
                  submitAs: "inlineText",
                },
                {
                  id: "codex.review",
                  name: "review-diff",
                  submitAs: "inlineText",
                },
              ],
            },
          ],
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: DefinitionRegistryErrorCodes.INVALID_DEFINITION,
      }),
    );
  });

  it("rejects duplicate composer command ids across command capabilities", () => {
    const registry = new AgentRuntimeRegistry();

    expect(() =>
      registry.register(
        createRuntime({
          composerCapabilities: [
            {
              kind: "composerCommand",
              trigger: "/",
              source: "runtimeCommand",
              commands: [
                {
                  id: "codex.review",
                  name: "review",
                  submitAs: "inlineText",
                },
              ],
            },
            {
              kind: "composerCommand",
              trigger: "/",
              source: "runtimeCommand",
              commands: [
                {
                  id: "codex.review",
                  name: "review-diff",
                  submitAs: "inlineText",
                },
              ],
            },
          ],
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: DefinitionRegistryErrorCodes.INVALID_DEFINITION,
      }),
    );
  });

  it("rejects duplicate composer command names", () => {
    const registry = new AgentRuntimeRegistry();

    expect(() =>
      registry.register(
        createRuntime({
          composerCapabilities: [
            {
              kind: "composerCommand",
              trigger: "/",
              source: "runtimeCommand",
              commands: [
                {
                  id: "codex.review",
                  name: "review",
                  submitAs: "inlineText",
                },
                {
                  id: "codex.other-review",
                  name: "review",
                  submitAs: "inlineText",
                },
              ],
            },
          ],
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: DefinitionRegistryErrorCodes.INVALID_DEFINITION,
      }),
    );
  });

  it("rejects duplicate composer command names across command capabilities", () => {
    const registry = new AgentRuntimeRegistry();

    expect(() =>
      registry.register(
        createRuntime({
          composerCapabilities: [
            {
              kind: "composerCommand",
              trigger: "/",
              source: "runtimeCommand",
              commands: [
                {
                  id: "codex.review",
                  name: "review",
                  submitAs: "inlineText",
                },
              ],
            },
            {
              kind: "composerCommand",
              trigger: "/",
              source: "runtimeCommand",
              commands: [
                {
                  id: "codex.other-review",
                  name: "review",
                  submitAs: "inlineText",
                },
              ],
            },
          ],
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: DefinitionRegistryErrorCodes.INVALID_DEFINITION,
      }),
    );
  });
});
