# Dashboard-Only Trigger Input Presentation

Rendered trigger input is the agent-facing source of truth. Trigger input presentation is a dashboard-only interpretation of that text for readability, and it must not change the text delivered to the agent or imply that different input was sent.

The trigger input template is intentionally flexible Liquid authored by the user. Users may choose to render whole provider payload objects, nested provider objects, or arbitrary surrounding instructions. Rewriting the rendered input after template evaluation would move a presentation concern into trigger execution and make the transcript less faithful to what the agent received.

The dashboard may recognize strict JSON object spans inside rendered trigger input, then render those valid object spans inline in the authored order as formatted JSON. Provider prefixes and surrounding instructions remain ordinary text, and the dashboard must not infer provider-specific summaries from payload fields such as `text`, `body`, or `summary`. The chat bubble should not duplicate the raw rendered trigger input; that text remains the persisted transcript value and the presentation model's source of truth.

## Consequences

- Trigger preparation and delivery continue to persist and send the exact rendered input produced by the trigger template.
- Chat presentation may format recognized structured trigger inputs, but only as a display affordance.
- Provider-specific payloads use the same JSON object presentation as any other rendered object.
- Recognizers must be deterministic and conservative; unrecognized or ambiguous input renders unchanged.
- Structured chat bubbles render formatted JSON objects inline instead of the raw compact object text.
