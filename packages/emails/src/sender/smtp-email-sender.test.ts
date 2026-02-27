import { describe, expect, it } from "vitest";

import { SMTPEmailSender, type SMTPTransport } from "./smtp-email-sender.js";
import type { EmailMessage } from "./types.js";

function createMessage(): EmailMessage {
  return {
    from: {
      email: "from@mistle.dev",
      name: "Mistle",
    },
    to: [
      {
        email: "to@mistle.dev",
      },
    ],
    subject: "Welcome",
    html: "<p>Welcome</p>",
    text: "Welcome",
  };
}

describe("smtp email sender", () => {
  it("maps transport success responses", async () => {
    const transport: SMTPTransport = {
      sendMail: async () => ({
        messageId: "smtp-123",
        accepted: ["to@mistle.dev", { address: "other@mistle.dev" }],
        rejected: [{ address: "bad@mistle.dev" }],
        response: "250 2.0.0 queued",
      }),
    };

    const sender = new SMTPEmailSender(transport);
    const result = await sender.send(createMessage());

    expect(result).toEqual({
      ok: true,
      messageId: "smtp-123",
      accepted: ["to@mistle.dev", "other@mistle.dev"],
      rejected: ["bad@mistle.dev"],
      response: "250 2.0.0 queued",
    });
  });

  it("maps retryable transport errors", async () => {
    const transport: SMTPTransport = {
      sendMail: async () => {
        const error = new Error("connection timeout");
        Object.assign(error, { code: "ETIMEDOUT" });
        throw error;
      },
    };

    const sender = new SMTPEmailSender(transport);
    const result = await sender.send(createMessage());

    expect(result).toEqual({
      ok: false,
      message: "connection timeout",
      retryable: true,
      code: "ETIMEDOUT",
    });
  });

  it("maps non-retryable transport errors", async () => {
    const transport: SMTPTransport = {
      sendMail: async () => {
        const error = new Error("invalid login");
        Object.assign(error, { code: "EAUTH" });
        throw error;
      },
    };

    const sender = new SMTPEmailSender(transport);
    const result = await sender.send(createMessage());

    expect(result).toEqual({
      ok: false,
      message: "invalid login",
      retryable: false,
      code: "EAUTH",
    });
  });
});
