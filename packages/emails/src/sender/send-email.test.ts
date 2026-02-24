import { describe, expect, it } from "vitest";

import { EmailTemplateIds } from "../templates/template-ids.js";
import { InMemoryEmailSender } from "../testing/in-memory-email-sender.js";
import { sendEmail } from "./send-email.js";

describe("send-email", () => {
  it("renders a registered template and sends it through the provided sender", async () => {
    const sender = new InMemoryEmailSender();

    const result = await sendEmail({
      sender,
      from: {
        email: "from@mistle.dev",
        name: "Mistle",
      },
      to: [
        {
          email: "to@mistle.dev",
        },
      ],
      templateId: EmailTemplateIds.OTP,
      templateInput: {
        otp: "123456",
        type: "sign-in",
        expiresInSeconds: 300,
      },
    });

    expect(result.ok).toBe(true);
    expect(sender.sent).toHaveLength(1);

    const [sentMessage] = sender.sent;
    expect(sentMessage).toBeDefined();
    if (sentMessage === undefined) {
      return;
    }

    expect(sentMessage.subject).toBe("Your sign-in code");
    expect(sentMessage.html).toContain("123456");
    expect(sentMessage.text).toContain("123456");
  });
});
