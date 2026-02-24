import type { ReactElement } from "react";

import { render, toPlainText } from "@react-email/render";

export type EmailTemplate = {
  subject: string;
  html: string;
  text: string;
};

export const renderEmail = async (template: ReactElement): Promise<string> =>
  render(template, {
    pretty: true,
  });

export const renderEmailText = (html: string): string => toPlainText(html);
