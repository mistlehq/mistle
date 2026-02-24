import type { EmailAddress, EmailMessage, EmailSender, SendEmailResult } from "../sender/types.js";

function cloneAddress(address: EmailAddress): EmailAddress {
  if (address.name === undefined) {
    return {
      email: address.email,
    };
  }

  return {
    email: address.email,
    name: address.name,
  };
}

function cloneOptionalAddresses(
  addresses: readonly EmailAddress[] | undefined,
): readonly EmailAddress[] | undefined {
  if (addresses === undefined) {
    return undefined;
  }

  return addresses.map((address) => cloneAddress(address));
}

function cloneRequiredAddresses(addresses: EmailMessage["to"]): EmailMessage["to"] {
  const [first, ...rest] = addresses;

  return [cloneAddress(first), ...rest.map((address) => cloneAddress(address))];
}

function cloneEmailMessage(message: EmailMessage): EmailMessage {
  const cloned: EmailMessage = {
    ...message,
    from: cloneAddress(message.from),
    to: cloneRequiredAddresses(message.to),
  };

  const clonedCc = cloneOptionalAddresses(message.cc);
  if (clonedCc !== undefined) {
    cloned.cc = clonedCc;
  }

  const clonedBcc = cloneOptionalAddresses(message.bcc);
  if (clonedBcc !== undefined) {
    cloned.bcc = clonedBcc;
  }

  if (message.replyTo !== undefined) {
    cloned.replyTo = cloneAddress(message.replyTo);
  }

  return cloned;
}

function collectRecipientEmails(message: EmailMessage): string[] {
  const recipients = [...message.to];

  if (message.cc !== undefined) {
    recipients.push(...message.cc);
  }

  if (message.bcc !== undefined) {
    recipients.push(...message.bcc);
  }

  return recipients.map((recipient) => recipient.email);
}

/**
 * In-memory sender used by tests.
 * Captures outbound messages so tests can assert on delivered content without external services.
 */
export class InMemoryEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<SendEmailResult> {
    const clonedMessage = cloneEmailMessage(message);
    this.sent.push(clonedMessage);

    return {
      ok: true,
      messageId: `in-memory-${this.sent.length}`,
      accepted: collectRecipientEmails(clonedMessage),
      rejected: [],
      response: "250 OK (in-memory)",
    };
  }

  clear(): void {
    this.sent.length = 0;
  }
}
