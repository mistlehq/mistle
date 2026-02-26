import { PagePlaceholder } from "./page-placeholder.js";

type SandboxProfileEditorPageProps = {
  mode: "create" | "edit";
};

export function SandboxProfileEditorPage(props: SandboxProfileEditorPageProps): React.JSX.Element {
  const title = props.mode === "create" ? "Create sandbox profile" : "Edit sandbox profile";
  return (
    <PagePlaceholder
      description="Editor surface is intentionally deferred until the sandbox profile API contract is finalized."
      title={title}
    />
  );
}
