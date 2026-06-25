import type { PiExtensionUIRequest } from "@mistle/integrations-definitions/agent-runtimes/pi/client";
import { describe, expect, it } from "vitest";

import {
  mapPiExtensionUIRequestsToServerRequests,
  resolvePiExtensionUIResponse,
  shouldExposePiExtensionUIRequest,
} from "./pi-extension-ui-requests.js";

describe("Pi extension UI request presentation", () => {
  it("maps Pi confirm requests to approval-style server requests", () => {
    expect(
      mapPiExtensionUIRequestsToServerRequests([
        {
          type: "extension_ui_request",
          id: "ui_confirm_1",
          method: "confirm",
          title: "Run command?",
          message: "Allow bash command?",
        },
      ]),
    ).toEqual([
      {
        requestId: "ui_confirm_1",
        method: "pi/extensionUi/confirm",
        kind: "pi-extension-ui-confirm",
        title: "Run command?",
        message: "Allow bash command?",
        availableDecisions: ["confirm", "cancel"],
        status: "pending",
        responseErrorMessage: null,
      },
    ]);
  });

  it("maps Pi select requests to user input requests", () => {
    expect(
      mapPiExtensionUIRequestsToServerRequests([
        {
          type: "extension_ui_request",
          id: "ui_select_1",
          method: "select",
          title: "Choose model",
          options: ["GPT-5", "Claude"],
        },
      ]),
    ).toEqual([
      {
        requestId: "ui_select_1",
        method: "tool/requestUserInput",
        kind: "tool-user-input",
        questions: [
          {
            id: "ui_select_1",
            header: "Pi",
            question: "Choose model",
            options: [
              {
                label: "GPT-5",
                isOther: false,
              },
              {
                label: "Claude",
                isOther: false,
              },
            ],
          },
        ],
        status: "pending",
        responseErrorMessage: null,
      },
    ]);
  });

  it("maps Pi editor requests to prefilled multiline user input requests", () => {
    expect(
      mapPiExtensionUIRequestsToServerRequests([
        {
          type: "extension_ui_request",
          id: "ui_editor_1",
          method: "editor",
          title: "Edit instructions",
          prefill: "Keep this text",
        },
      ]),
    ).toEqual([
      {
        requestId: "ui_editor_1",
        method: "tool/requestUserInput",
        kind: "tool-user-input",
        questions: [
          {
            id: "ui_editor_1",
            header: "Pi",
            question: "Edit instructions",
            options: [
              {
                label: "Response",
                defaultValue: "Keep this text",
                inputKind: "textarea",
                isOther: true,
              },
            ],
          },
        ],
        status: "pending",
        responseErrorMessage: null,
      },
    ]);
  });

  it("does not expose fire-and-forget Pi extension UI requests as answerable server requests", () => {
    const requests = [
      {
        type: "extension_ui_request",
        id: "ui_notify_1",
        method: "notify",
        message: "Saved",
      },
      {
        type: "extension_ui_request",
        id: "ui_status_1",
        method: "setStatus",
        statusKey: "command",
        statusText: "Running",
      },
      {
        type: "extension_ui_request",
        id: "ui_widget_1",
        method: "setWidget",
        widgetKey: "context",
        widgetLines: ["Line one"],
      },
      {
        type: "extension_ui_request",
        id: "ui_title_1",
        method: "setTitle",
        title: "Session title",
      },
      {
        type: "extension_ui_request",
        id: "ui_editor_text_1",
        method: "set_editor_text",
        text: "Replace editor text",
      },
    ] satisfies readonly PiExtensionUIRequest[];

    expect(requests.filter(shouldExposePiExtensionUIRequest)).toEqual([]);
  });

  it("resolves confirm and user-input responses for Pi RPC", () => {
    expect(
      resolvePiExtensionUIResponse({
        request: {
          type: "extension_ui_request",
          id: "ui_confirm_1",
          method: "confirm",
          title: "Run command?",
          message: "Allow bash command?",
        },
        result: {
          decision: "confirm",
        },
      }),
    ).toEqual({
      requestId: "ui_confirm_1",
      confirmed: true,
    });

    expect(
      resolvePiExtensionUIResponse({
        request: {
          type: "extension_ui_request",
          id: "ui_input_1",
          method: "input",
          title: "Branch name",
        },
        result: {
          answers: [
            {
              id: "ui_input_1",
              value: "feature/pi-permissions",
            },
          ],
        },
      }),
    ).toEqual({
      requestId: "ui_input_1",
      value: "feature/pi-permissions",
    });

    expect(
      resolvePiExtensionUIResponse({
        request: {
          type: "extension_ui_request",
          id: "ui_editor_1",
          method: "editor",
          title: "Edit instructions",
        },
        result: {
          decision: "cancel",
        },
      }),
    ).toEqual({
      requestId: "ui_editor_1",
      cancelled: true,
    });
  });

  it("rejects user-input responses for a different Pi request id", () => {
    expect(() =>
      resolvePiExtensionUIResponse({
        request: {
          type: "extension_ui_request",
          id: "ui_input_1",
          method: "input",
          title: "Branch name",
        },
        result: {
          answers: [
            {
              id: "another_request",
              value: "feature/pi-permissions",
            },
          ],
        },
      }),
    ).toThrow("invalid answer");
  });
});
