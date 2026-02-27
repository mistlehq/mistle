import { describe, expect, it } from "vitest";

import type { EmailMessage } from "../sender/types.js";
import { InMemoryEmailSender } from "./in-memory-email-sender.js";

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
    cc: [
      {
        email: "cc@mistle.dev",
      },
    ],
    bcc: [
      {
        email: "bcc@mistle.dev",
      },
    ],
    subject: "Hello",
    html: "<p>Hello</p>",
    text: "Hello",
  };
}

describe("in-memory email sender", () => {
  it("captures messages and returns SMTP-like success metadata", async () => {
    const sender = new InMemoryEmailSender();
    const result = await sender.send(createMessage());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.messageId).toBe("in-memory-1");
    expect(result.accepted).toEqual(["to@mistle.dev", "cc@mistle.dev", "bcc@mistle.dev"]);
    expect(result.rejected).toEqual([]);
    expect(sender.sent).toHaveLength(1);
  });

  it("stores a cloned message snapshot", async () => {
    const sender = new InMemoryEmailSender();
    const message = createMessage();

    await sender.send(message);

    message.subject = "Changed";
    message.to[0].email = "changed@mistle.dev";

    const [firstSentMessage] = sender.sent;
    expect(firstSentMessage).toBeDefined();
    if (firstSentMessage === undefined) {
      return;
    }

    expect(firstSentMessage.subject).toBe("Hello");
    expect(firstSentMessage.to[0].email).toBe("to@mistle.dev");
  });

  it("can clear captured messages", async () => {
    const sender = new InMemoryEmailSender();

    await sender.send(createMessage());
    expect(sender.sent).toHaveLength(1);

    sender.clear();
    expect(sender.sent).toHaveLength(0);
  });
});
