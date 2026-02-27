import { Body, Container, Head, Html, Preview, Section, Text } from "jsx-email";
import type { CSSProperties, ReactElement } from "react";

export type EmailOTPTemplateProps = {
  otp: string;
  expiresInSeconds: number;
  title: string;
};

const bodyStyle: CSSProperties = {
  backgroundColor: "#f6f7fb",
  fontFamily: "Helvetica, Arial, sans-serif",
  margin: 0,
  padding: "32px 0",
};

const containerStyle: CSSProperties = {
  backgroundColor: "#ffffff",
  borderRadius: "12px",
  margin: "0 auto",
  maxWidth: "520px",
  padding: "28px",
};

const headingStyle: CSSProperties = {
  color: "#111827",
  fontSize: "24px",
  fontWeight: 700,
  margin: "0 0 18px",
};

const paragraphStyle: CSSProperties = {
  color: "#374151",
  fontSize: "15px",
  lineHeight: "22px",
  margin: "0 0 16px",
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
  marginTop: "20px",
};

function toDisplayMinutes(expiresInSeconds: number): number {
  return Math.max(1, Math.ceil(expiresInSeconds / 60));
}

export function EmailOTPTemplate({
  otp,
  expiresInSeconds,
  title,
}: EmailOTPTemplateProps): ReactElement {
  const expiryMinutes = toDisplayMinutes(expiresInSeconds);

  return (
    <Html>
      <Head />
      <Preview>{title}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Text style={headingStyle}>{title}</Text>
          <Text style={paragraphStyle}>Use this one-time passcode to continue:</Text>
          <Section style={otpCodeContainerStyle}>
            <Text style={otpCodeStyle}>{otp}</Text>
          </Section>
          <Text style={paragraphStyle}>
            {`This code expires in ${expiryMinutes} minute${expiryMinutes === 1 ? "" : "s"}.`}
          </Text>
          <Text style={footerStyle}>
            If you did not request this code, you can safely ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
