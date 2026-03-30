import { Section, Text } from "jsx-email";
import type { CSSProperties, ReactElement } from "react";

import { BrandedEmailShell } from "../shared/branded-email-shell.js";

export type EmailOTPTemplateProps = {
  bodyMessage: string;
  otp: string;
  expiresInSeconds: number;
  preview: string;
  title: string;
};

const paragraphStyle: CSSProperties = {
  color: "#374151",
  fontSize: "15px",
  lineHeight: "22px",
  margin: "0 0 16px",
  textAlign: "center",
};

const otpCodeStyle: CSSProperties = {
  color: "#111827",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: "30px",
  fontWeight: 700,
  letterSpacing: "0.2em",
  margin: "0",
  textAlign: "center",
};

const otpCodeContainerStyle: CSSProperties = {
  backgroundColor: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: "10px",
  margin: "12px 0 18px",
  padding: "16px",
};

const footerStyle: CSSProperties = {
  color: "#6b7280",
  fontSize: "13px",
  lineHeight: "20px",
  margin: 0,
  textAlign: "center",
};

function toDisplayMinutes(expiresInSeconds: number): number {
  return Math.max(1, Math.ceil(expiresInSeconds / 60));
}

export function EmailOTPTemplate({
  bodyMessage,
  otp,
  expiresInSeconds,
  preview,
  title,
}: EmailOTPTemplateProps): ReactElement {
  const expiryMinutes = toDisplayMinutes(expiresInSeconds);

  return (
    <BrandedEmailShell preview={preview} title={title}>
      <Text style={paragraphStyle}>{bodyMessage}</Text>
      <Section style={otpCodeContainerStyle}>
        <Text style={otpCodeStyle}>{otp}</Text>
      </Section>
      <Text style={paragraphStyle}>
        {`This code expires in ${expiryMinutes} minute${expiryMinutes === 1 ? "" : "s"}.`}
      </Text>
      <Text style={footerStyle}>If you did not request this code, you can ignore this email.</Text>
    </BrandedEmailShell>
  );
}
