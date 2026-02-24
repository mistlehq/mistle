export type EmailAddress = {
  email: string;
  name?: string;
};

type NonEmptyArray<T> = readonly [T, ...T[]];

export type EmailMessage = {
  from: EmailAddress;
  to: NonEmptyArray<EmailAddress>;
  subject: string;
  html: string;
  text?: string;
  cc?: readonly EmailAddress[];
  bcc?: readonly EmailAddress[];
  replyTo?: EmailAddress;
};

export type SendEmailSuccessResult = {
  ok: true;
  messageId: string;
  accepted: readonly string[];
  rejected: readonly string[];
  response: string;
};

export type SendEmailFailureResult = {
  ok: false;
  message: string;
  retryable: boolean;
  code?: string;
};

export type SendEmailResult = SendEmailSuccessResult | SendEmailFailureResult;

export type EmailSender = {
  send: (message: EmailMessage) => Promise<SendEmailResult>;
};
