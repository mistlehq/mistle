import { describe, expect, it } from "vitest";

import { presentTriggerInput } from "./trigger-input-presentation.js";

describe("trigger input presentation", () => {
  it("formats provider-labeled JSON inline without provider-specific extraction", () => {
    const originalText =
      'Provider payload.event: {"type":"message.created","channel":"channel_123","text":"Run the requested task","eventId":"evt_123"}';

    expect(presentTriggerInput(originalText)).toEqual({
      inlineSegments: [
        { kind: "text", text: "Provider payload.event:" },
        {
          kind: "json",
          text: JSON.stringify(
            {
              type: "message.created",
              channel: "channel_123",
              text: "Run the requested task",
              eventId: "evt_123",
            },
            null,
            2,
          ),
        },
      ],
    });
  });

  it("formats valid raw JSON objects as inline JSON", () => {
    const originalText =
      '{"event":"session.bootstrap","payload":{"requestId":"req_123"},"metadata":{"source":"trigger"}}';

    expect(presentTriggerInput(originalText)).toEqual({
      inlineSegments: [
        {
          kind: "json",
          text: JSON.stringify(
            {
              event: "session.bootstrap",
              payload: { requestId: "req_123" },
              metadata: { source: "trigger" },
            },
            null,
            2,
          ),
        },
      ],
    });
  });

  it("preserves unsafe numeric lexemes when formatting JSON", () => {
    const originalText = '{"installation":{"id":1234567890123456789}}';

    expect(presentTriggerInput(originalText)).toEqual({
      inlineSegments: [
        {
          kind: "json",
          text: ["{", '  "installation": {', '    "id": 1234567890123456789', "  }", "}"].join(
            "\n",
          ),
        },
      ],
    });
  });

  it("formats every valid JSON object span in authored order", () => {
    const originalText = 'First {"a":1} second {"b":2}';

    expect(presentTriggerInput(originalText)).toEqual({
      inlineSegments: [
        { kind: "text", text: "First" },
        { kind: "json", text: ["{", '  "a": 1', "}"].join("\n") },
        { kind: "text", text: "second" },
        { kind: "json", text: ["{", '  "b": 2', "}"].join("\n") },
      ],
    });
  });

  it("preserves authored prose order around embedded JSON objects", () => {
    const originalText =
      'Please investigate this issue here {"issue":{"key":"MST-123","summary":"Fails to sync"}} and then fix it';

    expect(presentTriggerInput(originalText)).toEqual({
      inlineSegments: [
        { kind: "text", text: "Please investigate this issue here" },
        {
          kind: "json",
          text: JSON.stringify(
            {
              issue: {
                key: "MST-123",
                summary: "Fails to sync",
              },
            },
            null,
            2,
          ),
        },
        { kind: "text", text: "and then fix it" },
      ],
    });
  });

  it("preserves authored whitespace in text around embedded JSON objects", () => {
    const originalText = [
      "Please handle:",
      "- verify the event",
      "",
      'Provider payload.event: {"type":"message","text":"deploy this"}',
      "",
      "Respond in the original thread.",
    ].join("\n");

    expect(presentTriggerInput(originalText)).toEqual({
      inlineSegments: [
        { kind: "text", text: "Please handle:\n- verify the event\n\nProvider payload.event:" },
        {
          kind: "json",
          text: JSON.stringify({ type: "message", text: "deploy this" }, null, 2),
        },
        { kind: "text", text: "Respond in the original thread." },
      ],
    });
  });

  it("continues scanning after non-JSON braces before a valid JSON object", () => {
    const originalText = 'Use {repo} context. Provider payload.event: {"type":"message"}';

    expect(presentTriggerInput(originalText)).toEqual({
      inlineSegments: [
        { kind: "text", text: "Use {repo} context. Provider payload.event:" },
        { kind: "json", text: JSON.stringify({ type: "message" }, null, 2) },
      ],
    });
  });

  it("formats JSON objects from otherwise unrecognized text", () => {
    const originalText = 'Provider payload: {"text":"run","metadata":{"requestId":"req_123"}}';

    expect(presentTriggerInput(originalText)).toEqual({
      inlineSegments: [
        { kind: "text", text: "Provider payload:" },
        {
          kind: "json",
          text: JSON.stringify(
            {
              text: "run",
              metadata: { requestId: "req_123" },
            },
            null,
            2,
          ),
        },
      ],
    });
  });

  it("does not extract obvious message fields into summaries", () => {
    const originalText = 'payload.event: {"text":"run this"}';

    expect(presentTriggerInput(originalText)).toEqual({
      inlineSegments: [
        { kind: "text", text: "payload.event:" },
        { kind: "json", text: JSON.stringify({ text: "run this" }, null, 2) },
      ],
    });
  });

  it("renders unchanged for JSON objects inside Markdown code fences", () => {
    const originalText = [
      "Please use this:",
      "```json",
      '{"text":"keep this as code"}',
      "```",
      "Thanks.",
    ].join("\n");

    expect(presentTriggerInput(originalText)).toBeNull();
  });

  it("renders unchanged for JSON inside longer Markdown code fences", () => {
    const originalText = [
      "Please use this literal example:",
      "````",
      "```json",
      '{"text":"keep this nested example as code"}',
      "```",
      "````",
    ].join("\n");

    expect(presentTriggerInput(originalText)).toBeNull();
  });

  it("renders unchanged when an inner info-string fence line is inside a Markdown code fence", () => {
    const originalText = ["```text", "```json", '{"text":"still in outer fence"}', "```"].join(
      "\n",
    );

    expect(presentTriggerInput(originalText)).toBeNull();
  });

  it("renders unchanged for malformed JSON", () => {
    expect(presentTriggerInput('Provider payload.event: {"text":"missing close"')).toBeNull();
  });

  it("does not recover nested JSON from malformed outer JSON", () => {
    expect(presentTriggerInput('Provider payload.event: {"outer":{"inner":"x"}')).toBeNull();
  });

  it("renders unchanged for provider-labeled JSON arrays", () => {
    expect(presentTriggerInput('Provider payload.event: [{"text":"array"}]')).toBeNull();
  });

  it("renders unchanged for raw JSON arrays", () => {
    expect(presentTriggerInput('[{"text":"array"}]')).toBeNull();
  });
});
