import type { CSSProperties, ReactElement, ReactNode } from "react";

const pageStyle: CSSProperties = {
  backgroundColor: "#f3f4f6",
  minHeight: "100vh",
  padding: "24px",
};

const panelStyle: CSSProperties = {
  backgroundColor: "#ffffff",
  border: "1px solid #e5e7eb",
  borderRadius: "16px",
  margin: "0 auto 24px",
  maxWidth: "720px",
  padding: "20px 24px",
};

const eyebrowStyle: CSSProperties = {
  color: "#6b7280",
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.08em",
  margin: "0 0 12px",
  textTransform: "uppercase",
};

const rowStyle: CSSProperties = {
  margin: "0 0 12px",
};

const labelStyle: CSSProperties = {
  color: "#6b7280",
  display: "block",
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.04em",
  marginBottom: "4px",
  textTransform: "uppercase",
};

const valueStyle: CSSProperties = {
  color: "#111827",
  fontSize: "16px",
  lineHeight: "24px",
  margin: 0,
};

type PreviewMetadataLayoutProps = {
  templateName: string;
  subject: string;
  preview: string;
  children: ReactNode;
};

export function PreviewMetadataLayout(props: PreviewMetadataLayoutProps): ReactElement {
  return (
    <div style={pageStyle}>
      <div style={panelStyle}>
        <p style={eyebrowStyle}>Preview Only</p>
        <div style={rowStyle}>
          <span style={labelStyle}>Template</span>
          <p style={valueStyle}>{props.templateName}</p>
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Subject</span>
          <p style={valueStyle}>{props.subject}</p>
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Preview Text</span>
          <p style={valueStyle}>{props.preview}</p>
        </div>
      </div>
      {props.children}
    </div>
  );
}
