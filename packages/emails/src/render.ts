import { render, renderPlainText } from "jsx-email";
import type { ReactElement } from "react";

export type EmailTemplateMetadata = {
  templateName: string;
  subject: string;
  preview: string;
};

export type EmailTemplate = {
  metadata: EmailTemplateMetadata;
  subject: string;
  html: string;
  text: string;
};

export const renderEmail = async (template: ReactElement): Promise<string> =>
  render(template, {
    pretty: true,
  });

export const renderEmailText = async (template: ReactElement): Promise<string> =>
  renderPlainText(template);
