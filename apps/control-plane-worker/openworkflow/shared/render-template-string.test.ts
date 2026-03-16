import { describe, expect, it } from "vitest";

import { renderTemplateString } from "./render-template-string.js";

describe("renderTemplateString", () => {
  it("renders scalar placeholders from object paths", () => {
    const rendered = renderTemplateString({
      template: "Event {{action}} on issue #{{issue.number}}",
      context: {
        action: "created",
        issue: {
          number: 42,
        },
      },
    });

    expect(rendered).toBe("Event created on issue #42");
  });

  it("renders placeholders from array paths", () => {
    const rendered = renderTemplateString({
      template: "First label: {{issue.labels[0].name}}",
      context: {
        issue: {
          labels: [
            {
              name: "bug",
            },
          ],
        },
      },
    });

    expect(rendered).toBe("First label: bug");
  });

  it("renders object values as JSON", () => {
    const rendered = renderTemplateString({
      template: "Payload={{payload}}",
      context: {
        payload: {
          id: 1,
          ok: true,
        },
      },
    });

    expect(rendered).toBe('Payload={"id":1,"ok":true}');
  });

  it("throws when a placeholder path is missing", () => {
    expect(() =>
      renderTemplateString({
        template: "{{comment.body}}",
        context: {},
      }),
    ).toThrowError("undefined variable: comment");
  });

  it("throws when a placeholder expression is empty", () => {
    expect(() =>
      renderTemplateString({
        template: "{{  }}",
        context: {
          value: "x",
        },
      }),
    ).toThrowError('invalid value expression: ""');
  });
});
