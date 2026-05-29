import { PreviewMetadataLayout } from "../preview-support/preview-metadata.js";
import type { BuildWelcomeTemplateOptions } from "../src/templates/welcome/builder.js";
import {
  buildWelcomeEmailContent,
  WelcomeEmailSubject,
  WelcomeEmailTemplateName,
} from "../src/templates/welcome/content.js";

export const templateName = WelcomeEmailTemplateName;
const subject = WelcomeEmailSubject;

export const previewProps: BuildWelcomeTemplateOptions = {
  callUrl: "https://cal.example.com/jonathan/mistle",
};

export function Template(props: BuildWelcomeTemplateOptions) {
  const content = buildWelcomeEmailContent(props);

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
        <p>{content.greeting}</p>
        <p>{content.intro}</p>
        <p>{content.helpHeading}</p>
        <ul>
          {content.helpItems.map((item) => (
            <li key={item.kind === "call" ? item.callUrl : item.text}>
              {item.kind === "call" ? (
                <>
                  {item.text} <a href={item.callUrl}>{item.callUrl}</a>.
                </>
              ) : (
                item.text
              )}
            </li>
          ))}
        </ul>
        <p>{content.useCaseRequest}</p>
        <p>
          {content.signoff.valediction}
          <br />
          {content.signoff.name}
        </p>
      </div>
    </PreviewMetadataLayout>
  );
}
