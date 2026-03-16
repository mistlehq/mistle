import nodemailer from "nodemailer";
import type NodemailerSMTPTransport from "nodemailer/lib/smtp-transport/index.js";

import type {
  EmailMessage,
  EmailSender,
  SendEmailFailureResult,
  SendEmailResult,
} from "./types.js";

type SMTPTransportSendInput = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text?: string | undefined;
  cc?: string[] | undefined;
  bcc?: string[] | undefined;
  replyTo?: string | undefined;
};

type SMTPTransportSendResult = {
  messageId?: unknown;
  accepted?: unknown;
  rejected?: unknown;
  response?: unknown;
};

export type SMTPTransport = {
  sendMail: (input: SMTPTransportSendInput) => Promise<SMTPTransportSendResult>;
};

export type SMTPTransportOptions = NodemailerSMTPTransport.Options;

const RETRYABLE_SMTP_ERROR_CODES = new Set<string>([
  "EAI_AGAIN",
  "ECONNECTION",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ESOCKET",
  "ETIMEDOUT",
]);

function toSmtpAddress(address: { email: string; name?: string }): string {
  if (address.name === undefined) {
    return address.email;
  }

  return `${address.name} <${address.email}>`;
}

function readSmtpRecipientAddress(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  for (const [key, entryValue] of Object.entries(value)) {
    if (key === "address" && typeof entryValue === "string") {
      return entryValue;
    }
  }

  return null;
}

function normalizeRecipientList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("SMTP transport returned invalid recipient list.");
  }

  const normalized: string[] = [];

  for (const recipient of value) {
    if (typeof recipient === "string") {
      normalized.push(recipient);
      continue;
    }

    const recipientAddress = readSmtpRecipientAddress(recipient);
    if (recipientAddress !== null) {
      normalized.push(recipientAddress);
    }
  }

  return normalized;
}

type ParsedSMTPTransportResult = {
  messageId: string;
  accepted: string[];
  rejected: string[];
  response: string;
};

function parseSMTPTransportResult(result: SMTPTransportSendResult): ParsedSMTPTransportResult {
  if (typeof result.messageId !== "string") {
    throw new Error("SMTP transport result is missing messageId.");
  }

  if (typeof result.response !== "string") {
    throw new Error("SMTP transport result is missing response.");
  }

  return {
    messageId: result.messageId,
    accepted: normalizeRecipientList(result.accepted),
    rejected: normalizeRecipientList(result.rejected),
    response: result.response,
  };
}

function readSmtpErrorDetail(value: unknown, key: "code" | "message"): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (entryKey === key && typeof entryValue === "string") {
      return entryValue;
    }
  }

  return undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  const errorMessage = readSmtpErrorDetail(error, "message");
  if (errorMessage !== undefined) {
    return errorMessage;
  }

  return "Failed to send email via SMTP.";
}

function getErrorCode(error: unknown): string | undefined {
  return readSmtpErrorDetail(error, "code");
}

function isRetryableSmtpCode(code: string | undefined): boolean {
  if (code === undefined) {
    return false;
  }

  return RETRYABLE_SMTP_ERROR_CODES.has(code);
}

/**
 * Nodemailer-backed SMTP sender.
 * Use this in runtime code; tests should generally use InMemoryEmailSender.
 */
export class SMTPEmailSender implements EmailSender {
  constructor(private readonly transport: SMTPTransport) {}

  static fromTransportOptions(options: SMTPTransportOptions): SMTPEmailSender {
    return new SMTPEmailSender(nodemailer.createTransport(options));
  }

  async send(message: EmailMessage): Promise<SendEmailResult> {
    try {
      const smtpMessage: SMTPTransportSendInput = {
        from: toSmtpAddress(message.from),
        to: message.to.map((address) => toSmtpAddress(address)),
        subject: message.subject,
        html: message.html,
      };

      if (message.cc !== undefined) {
        smtpMessage.cc = message.cc.map((address) => toSmtpAddress(address));
      }

      if (message.bcc !== undefined) {
        smtpMessage.bcc = message.bcc.map((address) => toSmtpAddress(address));
      }

      if (message.replyTo !== undefined) {
        smtpMessage.replyTo = toSmtpAddress(message.replyTo);
      }

      if (message.text !== undefined) {
        smtpMessage.text = message.text;
      }

      const info = await this.transport.sendMail(smtpMessage);

      const parsedResult = parseSMTPTransportResult(info);

      return {
        ok: true,
        messageId: parsedResult.messageId,
        accepted: parsedResult.accepted,
        rejected: parsedResult.rejected,
        response: parsedResult.response,
      };
    } catch (error) {
      const code = getErrorCode(error);
      const failure: SendEmailFailureResult = {
        ok: false,
        message: getErrorMessage(error),
        retryable: isRetryableSmtpCode(code),
      };

      if (code !== undefined) {
        failure.code = code;
      }

      return failure;
    }
  }
}
