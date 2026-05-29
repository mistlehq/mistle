import { PreviewMetadataLayout } from "../preview-support/preview-metadata.js";
import type { BuildWelcomeTemplateOptions } from "../src/templates/welcome/builder.js";

export const templateName = "Welcome";
const subject = "Welcome to Mistle";

export const previewProps: BuildWelcomeTemplateOptions = {
  callUrl: "https://cal.example.com/jonathan/mistle",
};

export function Template(props: BuildWelcomeTemplateOptions) {
  const callUrl = props.callUrl?.trim();

  return (
    <PreviewMetadataLayout subject={subject} templateName={templateName}>
      <div
        style={{
          backgroundColor: "#ffffff",
          color: "#111827",
          fontFamily: "Arial, sans-serif",
          fontSize: "16px",
          lineHeight: "24px",
          margin: "0 auto",
          maxWidth: "720px",
          padding: "24px",
        }}
      >
        <p>Hey there,</p>
        <p>I'm Jonathan, one of the co-founders.</p>
        <p>Ways I can help:</p>
        <ul>
          <li>Have feedback or questions? Reply to this email.</li>
          <li>Support via Slack Connect. Reply to this email and I'd set it up.</li>
          {callUrl === undefined || callUrl.length === 0 ? null : (
            <li>
              Setup guidance/Use case exploration. Book a call: <a href={callUrl}>{callUrl}</a>.
            </li>
          )}
        </ul>
        <p>
          Also, I'd really appreciate it if you can share what use cases you're exploring Mistle
          for. Just reply to this email with a line or two.
        </p>
        <p>
          Cheers,
          <br />
          Jonathan
        </p>
      </div>
    </PreviewMetadataLayout>
  );
}
