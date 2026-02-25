import { MailpitClient } from "mailpit-api";
import { describe, expect, test } from "vitest";

import { startMailpit } from "../src/index.js";
import { it } from "./test-context.js";

async function sendMessage(input: {
  client: MailpitClient;
  subject: string;
  recipient: string;
}): Promise<void> {
  await input.client.sendMessage({
    From: {
      Email: "no-reply@mistle.dev",
      Name: "Mistle",
    },
    To: [
      {
        Email: input.recipient,
      },
    ],
    Subject: input.subject,
    Text: `${input.subject} body`,
  });
}

describe("mailpit service integration", () => {
  it("lists messages and waits for a matcher hit", async ({ mailpitService }) => {
    const client = new MailpitClient(mailpitService.httpBaseUrl);

    expect(await mailpitService.listMessages()).toEqual([]);

    await sendMessage({
      client,
      subject: "first subject",
      recipient: "first@mistle.dev",
    });
    await sendMessage({
      client,
      subject: "second subject",
      recipient: "second@mistle.dev",
    });

    const matched = await mailpitService.waitForMessage({
      timeoutMs: 10_000,
      description: "subject: second subject",
      matcher: ({ messages, message, index }) =>
        message.Subject === "second subject" &&
        messages[index]?.ID === message.ID &&
        messages.some((item) => item.Subject === "first subject"),
    });

    expect(matched.Subject).toBe("second subject");
    const matchedSummary = await mailpitService.getMessageSummary(matched.ID);
    expect(matchedSummary.Subject).toBe("second subject");

    const messages = await mailpitService.listMessages();
    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.Subject)).toEqual(
      expect.arrayContaining(["first subject", "second subject"]),
    );
  });

  it("throws a timeout error with description when no message matches", async ({
    mailpitService,
  }) => {
    await expect(
      mailpitService.waitForMessage({
        timeoutMs: 150,
        description: "subject: never-arrives",
        matcher: ({ message }) => message.Subject === "never-arrives",
      }),
    ).rejects.toThrowError(
      "Timed out waiting for Mailpit message (subject: never-arrives) within 150ms.",
    );
  });

  test("throws when stopping the same service twice", async () => {
    const mailpitService = await startMailpit();
    await mailpitService.stop();

    await expect(mailpitService.stop()).rejects.toThrowError(
      "Mailpit container was already stopped.",
    );
  });
});
