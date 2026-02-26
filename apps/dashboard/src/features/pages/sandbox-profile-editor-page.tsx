import { useParams } from "react-router";

import { PagePlaceholder } from "./page-placeholder.js";

type SandboxProfileEditorPageProps = {
  mode: "create" | "edit";
};

export function SandboxProfileEditorPage(props: SandboxProfileEditorPageProps): React.JSX.Element {
  const params = useParams<{ profileId?: string }>();

  if (props.mode === "create") {
    return (
      <PagePlaceholder description="Create a new sandbox profile." title="Create sandbox profile" />
    );
  }

  const profileId = params["profileId"] ?? "profile";
  return (
    <PagePlaceholder
      description={`Edit sandbox profile configuration for ${profileId}.`}
      title="Edit sandbox profile"
    />
  );
}
