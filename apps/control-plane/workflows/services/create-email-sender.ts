import { SMTPEmailSender } from "@mistle/emails";

import type { ControlPlaneWorkerConfig } from "../../src/worker/types.js";

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
