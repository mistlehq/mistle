import type { EmailTemplateId } from "../templates/template-ids.js";
import type {
  EmailAddress,
  EmailMessage,
  EmailSender,
  SendEmailFailureResult,
  SendEmailSuccessResult,
} from "./types.js";

import {
  buildRegisteredEmailTemplate,
  type EmailTemplateInputById,
} from "../templates/registry.js";

export type SendEmailInput<TTemplateId extends EmailTemplateId> = {
  sender: EmailSender;
  from: EmailAddress;
  to: readonly [EmailAddress, ...EmailAddress[]];
  cc?: readonly EmailAddress[];
  bcc?: readonly EmailAddress[];
  replyTo?: EmailAddress;
  templateId: TTemplateId;
  templateInput: EmailTemplateInputById[TTemplateId];
};

export class EmailSendError extends Error {
  readonly retryable: boolean;
  readonly code?: string;

  constructor(result: SendEmailFailureResult) {
    super(result.message);
    this.name = "EmailSendError";
    this.retryable = result.retryable;

    if (result.code !== undefined) {
      this.code = result.code;
    }
  }
}

/**
 * Renders a registered email template and sends it through the provided sender.
 * Throws EmailSendError when the sender reports a failure result.
 */
export async function sendEmail<TTemplateId extends EmailTemplateId>(
  input: SendEmailInput<TTemplateId>,
): Promise<SendEmailSuccessResult> {
  const template = await buildRegisteredEmailTemplate(input.templateId, input.templateInput);
  const message: EmailMessage = {
    from: input.from,
    to: input.to,
    subject: template.subject,
    html: template.html,
    text: template.text,
  };

  if (input.cc !== undefined) {
    message.cc = input.cc;
  }

  if (input.bcc !== undefined) {
    message.bcc = input.bcc;
  }

  if (input.replyTo !== undefined) {
    message.replyTo = input.replyTo;
  }

  const result = await input.sender.send(message);

  if (!result.ok) {
    throw new EmailSendError(result);
  }

  return result;
}
