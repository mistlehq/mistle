/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { describe, expect } from "vitest";

import { it } from "./test-context.js";

describe("tokenizer proxy integration", () => {
  it("returns healthy status on /__healthz", async ({ fixture }) => {
    const response = await fetch(`${fixture.baseUrl}/__healthz`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
  });

  it("returns not-implemented response for scaffolded egress route", async ({ fixture }) => {
    const response = await fetch(
      `${fixture.baseUrl}/tokenizer-proxy/egress/routes/route_123/v1/responses`,
      {
        method: "POST",
      },
    );
    const body = await response.json();

    expect(response.status).toBe(501);
    expect(body).toEqual({
      code: "NOT_IMPLEMENTED",
      message: "Tokenizer proxy egress route 'route_123' is not implemented.",
    });
  });
});
