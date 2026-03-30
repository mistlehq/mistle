import { Body, Container, Head, Html, Preview, Section, Text } from "jsx-email";
import type { CSSProperties, ReactElement, ReactNode } from "react";

const MistleLogoUrl = "https://mistle.dev/mistle-logo-email.png";

const bodyStyle: CSSProperties = {
  backgroundColor: "#f6f7fb",
  fontFamily: "Helvetica, Arial, sans-serif",
  margin: 0,
  padding: "32px 0",
};

const containerStyle: CSSProperties = {
  backgroundColor: "#ffffff",
  borderRadius: "16px",
  margin: "0 auto",
  maxWidth: "520px",
  overflow: "hidden",
};

const topAccentStyle: CSSProperties = {
  backgroundColor: "#111827",
  height: "8px",
};

const contentStyle: CSSProperties = {
  padding: "28px",
  textAlign: "center",
};

const brandRowStyle: CSSProperties = {
  marginBottom: "22px",
  textAlign: "center",
};

const brandLogoStyle: CSSProperties = {
  display: "block",
  height: "42px",
  margin: "0 auto",
  maxWidth: "100%",
  width: "180px",
};

const headingStyle: CSSProperties = {
  color: "#111827",
  fontSize: "24px",
  fontWeight: 700,
  lineHeight: "32px",
  margin: "0 0 18px",
  textAlign: "center",
};

const footerStyle: CSSProperties = {
  borderTop: "1px solid #e5e7eb",
  color: "#6b7280",
  fontSize: "13px",
  lineHeight: "20px",
  marginTop: "24px",
  paddingTop: "18px",
  textAlign: "center",
};

const footerLinkStyle: CSSProperties = {
  color: "#111827",
  textDecoration: "none",
};

type BrandedEmailShellProps = {
  preview: string;
  title: string;
  children: ReactNode;
};

export function BrandedEmailShell(props: BrandedEmailShellProps): ReactElement {
  return (
    <Html>
      <Head />
      <Preview>{props.preview}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Section style={topAccentStyle} />
          <Section style={contentStyle}>
            <Section style={brandRowStyle}>
              <img alt="Mistle logo" src={MistleLogoUrl} style={brandLogoStyle} />
            </Section>
            <Text style={headingStyle}>{props.title}</Text>
            {props.children}
            <Text style={footerStyle}>
              This email was sent by Mistle. Learn more at{" "}
              <a href="https://mistle.dev" style={footerLinkStyle}>
                mistle.dev
              </a>
              .
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
