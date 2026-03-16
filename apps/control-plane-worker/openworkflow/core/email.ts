import { SMTPEmailSender } from "@mistle/emails";

import type { ControlPlaneWorkerConfig } from "./config.js";

export function createEmailSender(config: ControlPlaneWorkerConfig): SMTPEmailSender {
  return SMTPEmailSender.fromTransportOptions({
    host: config.email.smtpHost,
    port: config.email.smtpPort,
    secure: config.email.smtpSecure,
    auth: {
      user: config.email.smtpUsername,
      pass: config.email.smtpPassword,
    },
  });
}

export type ControlPlaneWorkerEmailDelivery = {
  emailSender: SMTPEmailSender;
  from: {
    email: string;
    name: string;
  };
};
