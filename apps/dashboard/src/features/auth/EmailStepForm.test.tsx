import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EmailStepForm } from "./EmailStepForm.js";

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
});
