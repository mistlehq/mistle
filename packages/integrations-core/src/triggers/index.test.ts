import { describe, expect, it } from "vitest";

import { IntegrationTriggerRulesError, TriggerRulesErrorCodes } from "../errors/index.js";
import { evaluateTriggerFilter, parseTriggerRules } from "./index.js";

describe("trigger rules", () => {
  it("parses valid trigger rules", () => {
    const rules = parseTriggerRules([
      {
        id: "rule_github_issue_comment",
        sourceBindingId: "bind_github_git",
        eventType: "github.issue_comment.created",
        filter: {
          op: "contains",
          path: "comment.body",
          value: "@mistle",
        },
        action: {
          type: "deliver-input",
          inputTemplate: "{{comment.body}}",
          conversationKeyTemplate: "github:issue:{{issue.number}}",
        },
        enabled: true,
      },
    ]);

    expect(rules).toHaveLength(1);
    expect(rules[0]?.action.type).toBe("deliver-input");
  });

  it("evaluates nested trigger filters", () => {
    const payload = {
      repository: {
        fullName: "acme/backend",
      },
      comment: {
        body: "Please handle this @mistle",
      },
      issue: {
        number: 42,
      },
    };

    const matches = evaluateTriggerFilter({
      filter: {
        op: "all",
        filters: [
          {
            op: "eq",
            path: "repository.fullName",
            value: "acme/backend",
          },
          {
            op: "contains",
            path: "comment.body",
            value: "@mistle",
          },
          {
            op: "in",
            path: "issue.number",
            values: [41, 42],
          },
          {
            op: "not",
            filter: {
              op: "startsWith",
              path: "comment.body",
              value: "ignore",
            },
          },
        ],
      },
      payload,
    });

    expect(matches).toBe(true);
  });

  it("treats non-ASCII letters as part of a token for containsToken", () => {
    expect(
      evaluateTriggerFilter({
        filter: {
          op: "containsToken",
          path: "comment.body",
          value: "@mistle",
        },
        payload: {
          comment: {
            body: "@mistle, please help",
          },
        },
      }),
    ).toBe(true);

    expect(
      evaluateTriggerFilter({
        filter: {
          op: "containsToken",
          path: "comment.body",
          value: "@mistle",
        },
        payload: {
          comment: {
            body: "@mistleé please help",
          },
        },
      }),
    ).toBe(false);

    expect(
      evaluateTriggerFilter({
        filter: {
          op: "containsToken",
          path: "comment.body",
          value: "@mistle",
        },
        payload: {
          comment: {
            body: "@mistle前 please help",
          },
        },
      }),
    ).toBe(false);
  });

  it("supports missing-path semantics with not + exists", () => {
    const matches = evaluateTriggerFilter({
      filter: {
        op: "not",
        filter: {
          op: "exists",
          path: "pullRequest.number",
        },
      },
      payload: {
        comment: {
          id: "abc123",
        },
      },
    });

    expect(matches).toBe(true);
  });

  it("fails trigger parsing for invalid event types", () => {
    expect(() =>
      parseTriggerRules([
        {
          id: "invalid_rule",
          sourceBindingId: "bind_github_git",
          eventType: "github",
          filter: {
            op: "exists",
            path: "comment.id",
          },
          action: {
            type: "deliver-input",
            inputTemplate: "{{comment.body}}",
            conversationKeyTemplate: "github:issue:{{issue.number}}",
          },
          enabled: true,
        },
      ]),
    ).toThrow(IntegrationTriggerRulesError);

    let caughtError: unknown;
    try {
      parseTriggerRules([
        {
          id: "invalid_rule",
          sourceBindingId: "bind_github_git",
          eventType: "github",
          filter: {
            op: "exists",
            path: "comment.id",
          },
          action: {
            type: "deliver-input",
            inputTemplate: "{{comment.body}}",
            conversationKeyTemplate: "github:issue:{{issue.number}}",
          },
          enabled: true,
        },
      ]);
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(IntegrationTriggerRulesError);
    expect(caughtError).toMatchObject({
      code: TriggerRulesErrorCodes.INVALID_TRIGGER_RULES,
    });
  });
});
