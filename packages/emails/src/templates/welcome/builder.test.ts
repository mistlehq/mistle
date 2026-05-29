import { describe, expect, it } from "vitest";

import { buildWelcomeTemplate } from "./builder.js";

describe("welcome email", () => {
  it("builds a plain welcome email with the support call link", async () => {
    const callUrl = "https://cal.example.com/jonathan/mistle";
    const template = await buildWelcomeTemplate({
      callUrl,
    });

    expect(template.subject).toBe("Welcome to Mistle");
    expect(template.metadata).toEqual({
      subject: "Welcome to Mistle",
      templateName: "Welcome",
    });
    expect(template.text).toContain(callUrl);
    expect(template.html).toContain(callUrl);
  });

  it("omits the booking line when no support call link is configured", async () => {
    const template = await buildWelcomeTemplate({});

    expect(template.text).not.toContain("Book a call");
    expect(template.html).not.toContain("Book a call");
  });
});
