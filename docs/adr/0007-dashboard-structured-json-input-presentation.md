# Dashboard Structured JSON Input Presentation

Runtime user message text is the agent-facing source of truth. Structured JSON input presentation is a dashboard-only interpretation of that text for readability, and it must not change the text delivered to the agent or imply that different input was sent.

Runtime user messages may come from the session workbench composer, trigger delivery, association delivery, provider CLIs, or other runtime-supported submission paths. Some of those messages include whole provider payload objects, nested provider objects, or arbitrary surrounding instructions. Rewriting the persisted message would move a presentation concern into delivery paths and make the transcript less faithful to what the agent received.

The dashboard may recognize strict JSON object spans inside runtime user messages, then render those valid object spans inline in the authored order as formatted JSON. Provider prefixes and surrounding instructions remain ordinary text, and the dashboard must not infer provider-specific summaries from payload fields such as `text`, `body`, or `summary`. The chat bubble should not duplicate the raw message; that text remains the persisted transcript value and the presentation model's source of truth.

## Consequences

- Runtime submission paths continue to persist and send the exact user message text they produce.
- Chat presentation may format recognized structured JSON inputs, but only as a display affordance.
- Provider-specific payloads use the same JSON object presentation as any other rendered object.
- Recognizers must be deterministic and conservative; unrecognized or ambiguous input renders unchanged.
- Structured chat bubbles render formatted JSON objects inline instead of the raw compact object text.
