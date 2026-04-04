import { systemSleeper } from "@mistle/time";
import { FieldDescription } from "@mistle/ui";
import { useState } from "react";

export function useAutoSaveStoryValue(initialValue: string): {
  onSave: (nextValue: string) => Promise<void>;
  value: string;
} {
  const [value, setValue] = useState(initialValue);

  return {
    value,
    onSave: async (nextValue) => {
      await systemSleeper.sleep(900);

      if (nextValue.trim().toLowerCase() === "explode") {
        throw new Error("Could not update display name.");
      }

      setValue(nextValue);
    },
  };
}

export function validateAutoSaveDisplayName(nextValue: string): string | null {
  if (nextValue.trim().length === 0) {
    return "Display name is required.";
  }

  if (nextValue.trim().length < 3) {
    return "Display name must be at least 3 characters.";
  }

  return null;
}

export function AutoSaveStoryFrame(input: {
  children: React.ReactNode;
  instructions: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 rounded-xl border bg-white p-6">
      {input.children}
      <div className="flex flex-col gap-2 text-sm">
        <FieldDescription>{input.instructions}</FieldDescription>
      </div>
    </div>
  );
}
