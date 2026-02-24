import { describe, expect } from "vitest";

import { EmailTemplateIds, SMTPEmailSender, sendEmail } from "../src/index.js";
import { EmailSendError } from "../src/sender/send-email.js";
import { it } from "./test-context.js";

describe("smtp-email-sender integration", () => {
  it("sends an OTP email via SMTP and Mailpit receives it", async ({ mailpitService }) => {
    const sender = SMTPEmailSender.fromTransportOptions({
      host: mailpitService.smtpHost,
      port: mailpitService.smtpPort,
      secure: false,
    });

    const sendResult = await sendEmail({
      sender,
      from: {
        email: "no-reply@mistle.dev",
        name: "Mistle",
      },
      to: [
        {
          email: "user@mistle.dev",
        },
      ],
      templateId: EmailTemplateIds.OTP,
      templateInput: {
        otp: "123456",
        type: "sign-in",
        expiresInSeconds: 300,
      },
    });

    expect(sendResult.messageId).not.toBe("");
    expect(sendResult.rejected).toEqual([]);
    expect(sendResult.accepted).toContain("user@mistle.dev");

    const received = await mailpitService.waitForMessage({
      timeoutMs: 10_000,
      description: "otp subject: Your sign-in code",
      matcher: ({ message }) => message.Subject === "Your sign-in code",
    });

    expect(received.Subject).toBe("Your sign-in code");
    expect(received.To.map((address) => address.Address)).toContain("user@mistle.dev");
  });

  it("throws EmailSendError when SMTP is unreachable", async () => {
    const sender = SMTPEmailSender.fromTransportOptions({
      host: "127.0.0.1",
      port: 1,
      secure: false,
      connectionTimeout: 500,
      greetingTimeout: 500,
      socketTimeout: 500,
    });

    await expect(
      sendEmail({
        sender,
        from: {
          email: "no-reply@mistle.dev",
        },
        to: [
          {
            email: "user@mistle.dev",
          },
        ],
        templateId: EmailTemplateIds.OTP,
        templateInput: {
          otp: "654321",
          type: "sign-in",
          expiresInSeconds: 300,
        },
      }),
    ).rejects.toBeInstanceOf(EmailSendError);
  });
});
