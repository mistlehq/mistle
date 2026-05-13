import { PageFrame } from "../shared/page-frame.js";
import { NewSessionForm, shouldClearSelectedProfile } from "./new-session-form.js";

export { shouldClearSelectedProfile };

export function NewSessionPage(input?: { initialSelectedProfileId?: string }): React.JSX.Element {
  return (
    <PageFrame width="form" title="Start new session">
      <div className="mx-auto my-auto w-full max-w-3xl">
        <NewSessionForm
          {...(input?.initialSelectedProfileId === undefined
            ? {}
            : { initialSelectedProfileId: input.initialSelectedProfileId })}
        />
      </div>
    </PageFrame>
  );
}
