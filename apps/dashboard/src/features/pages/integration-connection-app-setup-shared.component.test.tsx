// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import {
  getSetupFieldState,
  useExistingAppSetupAutoSave,
} from "./integration-connection-app-setup-shared.js";

type TestFieldKey = "clientId" | "clientSecret";

const TestFieldKeys = ["clientId", "clientSecret"] satisfies readonly TestFieldKey[];

function ExistingAppSetupAutoSaveHarness(input: {
  shouldThrow?: boolean;
  validateClientSecret?: boolean;
}): React.JSX.Element {
  const [savedField, setSavedField] = useState("none");
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(
    "Previous action failed.",
  );
  const autoSave = useExistingAppSetupAutoSave<TestFieldKey, { savedField: TestFieldKey }>({
    clearActionError: () => {
      setActionErrorMessage(null);
    },
    createInitialDraft: () => ({
      clientId: "initial-client-id",
      clientSecret: "initial-client-secret",
    }),
    fieldKeys: TestFieldKeys,
    normalizeValue: (value) => value.trim(),
    onFieldSaved: (result) => {
      setSavedField(result.savedField);
    },
    resolveSavedFieldKeys: (fieldKey) =>
      fieldKey === "clientSecret" ? TestFieldKeys : ["clientId"],
    resolveSaveErrorMessage: (error) => {
      if (error instanceof Error) {
        return error.message;
      }

      return "Could not save test field.";
    },
    saveField: async ({ fieldKey }) => {
      if (input.shouldThrow === true) {
        throw new Error("Test save failed.");
      }

      return { savedField: fieldKey };
    },
    validateField: ({ draft, fieldKey }) => {
      if (
        input.validateClientSecret === true &&
        fieldKey === "clientSecret" &&
        draft.clientSecret.trim().length === 0
      ) {
        return "Client secret is required.";
      }

      return null;
    },
  });

  const clientIdState = getSetupFieldState(autoSave.fieldStates, "clientId");
  const clientSecretState = getSetupFieldState(autoSave.fieldStates, "clientSecret");

  return (
    <div>
      <label htmlFor="client-id">Client ID</label>
      <input
        id="client-id"
        onBlur={() => {
          void autoSave.persistField("clientId");
        }}
        onChange={(event) => {
          autoSave.updateFieldDraft("clientId", event.currentTarget.value);
        }}
        value={autoSave.draft.clientId}
      />
      <label htmlFor="client-secret">Client secret</label>
      <input
        id="client-secret"
        onBlur={() => {
          void autoSave.persistField("clientSecret");
        }}
        onChange={(event) => {
          autoSave.updateFieldDraft("clientSecret", event.currentTarget.value);
        }}
        value={autoSave.draft.clientSecret}
      />
      <div data-testid="client-id-status">{clientIdState.status}</div>
      <div data-testid="client-secret-status">{clientSecretState.status}</div>
      <div data-testid="client-id-error">{clientIdState.errorMessage}</div>
      <div data-testid="client-secret-error">{clientSecretState.errorMessage}</div>
      <div data-testid="saved-client-id">{autoSave.savedDraft.clientId}</div>
      <div data-testid="saved-client-secret">{autoSave.savedDraft.clientSecret}</div>
      <div data-testid="saved-field">{savedField}</div>
      <div data-testid="action-error">{actionErrorMessage}</div>
    </div>
  );
}

describe("useExistingAppSetupAutoSave", () => {
  it("persists a changed field and normalizes the saved draft", async () => {
    render(<ExistingAppSetupAutoSaveHarness />);

    fireEvent.change(screen.getByLabelText("Client ID"), {
      target: { value: " updated-client-id " },
    });
    fireEvent.blur(screen.getByLabelText("Client ID"));

    expect(screen.getByTestId("action-error").textContent).toBe("");
    await waitFor(() => {
      expect(screen.getByTestId("client-id-status").textContent).toBe("saved");
    });
    expect(screen.getByTestId("saved-client-id").textContent).toBe("updated-client-id");
    expect(screen.getByLabelText("Client ID")).toHaveProperty("value", "updated-client-id");
    expect(screen.getByTestId("saved-field").textContent).toBe("clientId");
  });

  it("updates grouped saved fields after saving a secret field", async () => {
    render(<ExistingAppSetupAutoSaveHarness />);

    fireEvent.change(screen.getByLabelText("Client ID"), {
      target: { value: " grouped-client-id " },
    });
    fireEvent.change(screen.getByLabelText("Client secret"), {
      target: { value: " grouped-secret " },
    });
    fireEvent.blur(screen.getByLabelText("Client secret"));

    await waitFor(() => {
      expect(screen.getByTestId("client-secret-status").textContent).toBe("saved");
    });
    expect(screen.getByTestId("saved-client-id").textContent).toBe("grouped-client-id");
    expect(screen.getByTestId("saved-client-secret").textContent).toBe("grouped-secret");
  });

  it("surfaces validation errors without saving", async () => {
    render(<ExistingAppSetupAutoSaveHarness validateClientSecret />);

    fireEvent.change(screen.getByLabelText("Client secret"), {
      target: { value: " " },
    });
    fireEvent.blur(screen.getByLabelText("Client secret"));

    await waitFor(() => {
      expect(screen.getByTestId("client-secret-error").textContent).toBe(
        "Client secret is required.",
      );
    });
    expect(screen.getByTestId("saved-field").textContent).toBe("none");
    expect(screen.getByTestId("saved-client-secret").textContent).toBe("initial-client-secret");
  });

  it("surfaces save errors on the edited field", async () => {
    render(<ExistingAppSetupAutoSaveHarness shouldThrow />);

    fireEvent.change(screen.getByLabelText("Client ID"), {
      target: { value: " updated-client-id " },
    });
    fireEvent.blur(screen.getByLabelText("Client ID"));

    await waitFor(() => {
      expect(screen.getByTestId("client-id-error").textContent).toBe("Test save failed.");
    });
    expect(screen.getByTestId("saved-client-id").textContent).toBe("initial-client-id");
  });
});
