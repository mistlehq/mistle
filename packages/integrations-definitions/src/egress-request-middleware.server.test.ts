import type {
  AnyIntegrationDefinition,
  IntegrationEgressRequestMiddleware,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import {
  resolveDefinitionEgressRequestMiddleware,
  resolveIntegrationEgressRequestMiddleware,
} from "./server.js";
import { SlackRequestMiddlewareIds } from "./slack/variants/slack-default/egress-request-middleware.js";

const TestMiddleware: IntegrationEgressRequestMiddleware = {
  id: "test-middleware",
  handle(input) {
    return input.request;
  },
};

describe("egress request middleware registry", () => {
  it("resolves a registered middleware from a definition", () => {
    const definition: Pick<AnyIntegrationDefinition, "egressRequestMiddleware"> = {
      egressRequestMiddleware: [TestMiddleware],
    };

    expect(resolveDefinitionEgressRequestMiddleware(definition, "test-middleware")).toBe(
      TestMiddleware,
    );
  });

  it("returns undefined when a definition does not expose the requested middleware", () => {
    const definition: Pick<AnyIntegrationDefinition, "egressRequestMiddleware"> = {
      egressRequestMiddleware: [TestMiddleware],
    };

    expect(
      resolveDefinitionEgressRequestMiddleware(definition, "missing-middleware"),
    ).toBeUndefined();
    expect(resolveDefinitionEgressRequestMiddleware(undefined, "test-middleware")).toBeUndefined();
  });

  it("resolves request middleware from built-in provider definitions", () => {
    expect(
      resolveIntegrationEgressRequestMiddleware({
        familyId: "slack",
        variantId: "slack-default",
        middlewareId: SlackRequestMiddlewareIds.APPEND_SESSION_LINK_TO_TEXT,
      }),
    ).toMatchObject({
      id: SlackRequestMiddlewareIds.APPEND_SESSION_LINK_TO_TEXT,
    });
  });
});
