import { json, jsonParseLinter } from "@codemirror/lang-json";
import { linter } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";

import { createCodeMirrorTheme } from "../shared/code-mirror-theme.js";

const ManifestJsonEditorTheme = createCodeMirrorTheme({
  root: {
    color: "var(--foreground)",
  },
  rules: {
    ".cm-gutters": {
      backgroundColor: "transparent",
      borderRightColor: "var(--border)",
      color: "var(--muted-foreground)",
    },
    ".cm-activeLine, .cm-activeLineGutter": {
      backgroundColor: "color-mix(in oklch, var(--accent) 45%, transparent)",
    },
    ".cm-diagnostic": {
      fontFamily: "var(--font-sans)",
    },
  },
});

export type ManifestJsonValidation =
  | {
      status: "valid";
    }
  | {
      message: string;
      status: "invalid";
    };

function resolveJsonParseErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Manifest must be valid JSON.";
}

export function parseManifestJsonObject(value: string): Record<string, unknown> {
  const parsedManifest: unknown = JSON.parse(value);
  if (
    typeof parsedManifest !== "object" ||
    parsedManifest === null ||
    Array.isArray(parsedManifest)
  ) {
    throw new Error("Manifest must be a JSON object.");
  }

  return Object.fromEntries(Object.entries(parsedManifest));
}

export function validateManifestJsonObject(value: string): ManifestJsonValidation {
  try {
    parseManifestJsonObject(value);
    return { status: "valid" };
  } catch (error) {
    return {
      message: resolveJsonParseErrorMessage(error),
      status: "invalid",
    };
  }
}

export function formatManifestJson(value: string): string {
  return JSON.stringify(parseManifestJsonObject(value), null, 2);
}

export function createManifestJsonDraft(manifest: Record<string, unknown>): string {
  return JSON.stringify(manifest, null, 2);
}

function createManifestFormatOnBlurExtension(
  onChange: (value: string) => void,
): ReturnType<typeof EditorView.domEventHandlers> {
  return EditorView.domEventHandlers({
    blur: (_event, view) => {
      const currentValue = view.state.doc.toString();
      const validation = validateManifestJsonObject(currentValue);
      if (validation.status === "invalid") {
        return;
      }

      const formattedValue = formatManifestJson(currentValue);
      if (formattedValue !== currentValue) {
        onChange(formattedValue);
      }
    },
  });
}

export function ManifestJsonEditor(input: {
  id: string;
  value: string;
  validation: ManifestJsonValidation;
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-md border">
        <CodeMirror
          basicSetup={{
            foldGutter: false,
            highlightActiveLine: false,
            highlightActiveLineGutter: false,
            lineNumbers: false,
          }}
          className="text-sm"
          extensions={[
            json(),
            linter(jsonParseLinter()),
            createManifestFormatOnBlurExtension(input.onChange),
            ManifestJsonEditorTheme,
          ]}
          id={input.id}
          onChange={input.onChange}
          theme="none"
          value={input.value}
        />
      </div>
      {input.validation.status === "invalid" ? (
        <p className="text-destructive text-sm">{input.validation.message}</p>
      ) : null}
    </div>
  );
}
