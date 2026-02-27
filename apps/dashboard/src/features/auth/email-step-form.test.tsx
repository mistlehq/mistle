import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EmailStepForm } from "./email-step-form.js";

describe("EmailStepForm", () => {
  it("provides a programmatic label for the email input", () => {
    const markup = renderToStaticMarkup(
      <EmailStepForm
        email=""
        isSendingOtp={false}
        onEmailChange={() => {}}
        onSubmit={async () => {}}
      />,
    );

    expect(markup).toContain('for="email"');
    expect(markup).toContain(">Email address<");
    expect(markup).toContain('id="email"');
    expect(markup).toContain('name="email"');
    expect(markup).toContain('type="email"');
  });

  it("renders invited email as static text when email editing is disabled", () => {
    const markup = renderToStaticMarkup(
      <EmailStepForm
        email="invitee@example.com"
        isEmailEditable={false}
        isSendingOtp={false}
        onEmailChange={() => {}}
        onSubmit={async () => {}}
      />,
    );

    expect(markup).toContain('id="email"');
    expect(markup).toContain('role="note"');
    expect(markup).toContain(">invitee@example.com<");
    expect(markup).not.toContain('type="email"');
  });
});
