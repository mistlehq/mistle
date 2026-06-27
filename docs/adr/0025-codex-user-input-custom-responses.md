# Codex user input requests support custom responses

Codex-backed **User input requests** support a **User input request custom response** submitted through the composer while exactly one user input request is pending. The response resolves the pending request with `customResponse.text` rather than starting, steering, interrupting, or cancelling a turn; this keeps the request contract coherent while giving users a way to provide an unlisted answer or redirect the conversation without being trapped by structured controls.

This decision is Codex-scoped: other runtime adapters that project native input APIs into `tool/requestUserInput`, such as Claude Code and Pi, are not required to support `customResponse` in this first pass. They should either keep their existing structured-answer and cancellation behavior or add explicit adapter translation in a later decision.

The composer custom response targets the pending **User input request** when exactly one such request is pending. Other pending approval requests may still be visible, but they do not make the custom response target ambiguous because approvals remain resolved through their own approval controls.

Custom responses require non-empty trimmed composer text. An empty composer keeps the existing active-turn interrupt behavior instead of submitting an empty `customResponse`.

Custom responses are text-only. Attachments, skill mentions, blueprint comments, diff comments, and other composer context must not be attached to a `customResponse`; the composer should block submission rather than silently drop that context.

If submitting a custom response fails, the composer keeps the user's text, the **User input request** returns to pending with its response error, and the dashboard must not fall back to steering or create a transcript entry.

Designer `dashboard_control.request_user_input` custom responses use the same dynamic-tool response wrapper as structured answers and cancellation: the dashboard returns a successful tool response whose text content is JSON containing `customResponse.text`. Designer managed instructions should treat that JSON as the user's custom response to the pending decision.
