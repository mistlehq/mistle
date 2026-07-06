# GitHub Enterprise Server

Provider family ID: `github`
Integration target key: `github-enterprise-server`
Variant ID: `github-enterprise-server`
Binding kind: `git`
Description: Enable webhooks, repository access, and optional GitHub CLI in sandbox.

Setup methods:

- `api-key` (form): API key
- `github-app-installation` (form): GitHub App installation

Resource kinds:

- `repository`: repositories (multi)
- `branch`: branches (multi)
- `user`: users (multi)
- `org`: organizations (multi)
- `team`: teams (multi)
- `bot`: GitHub App bots (multi)

Binding tools:

- `github-cli`: GitHub CLI (default)

Trigger events:

- `github.issues.opened`: Issue opened
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.repository.full_name}}`, `{{payload.issue.number}}`, `{{payload.issue.title}}`, `{{payload.issue.body}}`, `{{payload.sender.login}}`
- `github.issues.closed`: Issue closed
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.repository.full_name}}`, `{{payload.issue.number}}`, `{{payload.issue.title}}`, `{{payload.issue.body}}`, `{{payload.sender.login}}`
- `github.issues.reopened`: Issue reopened
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.repository.full_name}}`, `{{payload.issue.number}}`, `{{payload.issue.title}}`, `{{payload.issue.body}}`, `{{payload.sender.login}}`
- `github.issue_comment.created`: Issue comment created
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.repository.full_name}}`, `{{payload.issue.number}}`, `{{payload.issue.title}}`, `{{payload.issue.pull_request}}`, `{{payload.comment.body}}`, `{{payload.sender.login}}`
- `github.pull_request.opened`: Pull request opened
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.repository.full_name}}`, `{{payload.pull_request.number}}`, `{{payload.pull_request.body}}`, `{{payload.pull_request.base.ref}}`, `{{payload.pull_request.head.ref}}`, `{{payload.sender.login}}`
- `github.pull_request.closed`: Pull request closed
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.repository.full_name}}`, `{{payload.pull_request.number}}`, `{{payload.pull_request.body}}`, `{{payload.pull_request.base.ref}}`, `{{payload.pull_request.head.ref}}`, `{{payload.sender.login}}`
- `github.pull_request.reopened`: Pull request reopened
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.repository.full_name}}`, `{{payload.pull_request.number}}`, `{{payload.pull_request.body}}`, `{{payload.pull_request.base.ref}}`, `{{payload.pull_request.head.ref}}`, `{{payload.sender.login}}`
- `github.pull_request.synchronize`: Pull request updated
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.repository.full_name}}`, `{{payload.pull_request.number}}`, `{{payload.pull_request.body}}`, `{{payload.pull_request.base.ref}}`, `{{payload.pull_request.head.ref}}`, `{{payload.sender.login}}`
- `github.pull_request.ready_for_review`: Pull request ready for review
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.repository.full_name}}`, `{{payload.pull_request.number}}`, `{{payload.pull_request.body}}`, `{{payload.pull_request.base.ref}}`, `{{payload.pull_request.head.ref}}`, `{{payload.sender.login}}`
- `github.pull_request.review_requested`: Pull request review requested
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.repository.full_name}}`, `{{payload.pull_request.number}}`, `{{payload.pull_request.body}}`, `{{payload.pull_request.base.ref}}`, `{{payload.pull_request.head.ref}}`, `{{payload.sender.login}}`, `{{payload.requested_reviewer.login}}`, `{{payload.requested_team.slug}}`
- `github.pull_request.review_request_removed`: Pull request review request removed
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.repository.full_name}}`, `{{payload.pull_request.number}}`, `{{payload.pull_request.body}}`, `{{payload.pull_request.base.ref}}`, `{{payload.pull_request.head.ref}}`, `{{payload.sender.login}}`, `{{payload.requested_reviewer.login}}`, `{{payload.requested_team.slug}}`
- `github.pull_request_review.submitted`: Pull request review submitted
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.repository.full_name}}`, `{{payload.pull_request.number}}`, `{{payload.pull_request.base.ref}}`, `{{payload.review.body}}`, `{{payload.sender.login}}`
- `github.pull_request_review_comment.created`: Pull request review comment created
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.repository.full_name}}`, `{{payload.pull_request.number}}`, `{{payload.pull_request.base.ref}}`, `{{payload.comment.body}}`, `{{payload.sender.login}}`
- `github.push.pushed`: New push to branch
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.repository.full_name}}`, `{{payload.ref}}`
- `github.check_suite.completed`: CI completed
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.repository.full_name}}`
- `github.release.created`: Release created
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.repository.full_name}}`, `{{payload.release.tag_name}}`, `{{payload.release.name}}`, `{{payload.release.body}}`, `{{payload.sender.login}}`
- `github.release.published`: Release published
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.repository.full_name}}`, `{{payload.release.tag_name}}`, `{{payload.release.name}}`, `{{payload.release.body}}`, `{{payload.sender.login}}`
- `github.release.released`: Release released
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.repository.full_name}}`, `{{payload.release.tag_name}}`, `{{payload.release.name}}`, `{{payload.release.body}}`, `{{payload.sender.login}}`
- `github.release.prereleased`: Pre-release published
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.repository.full_name}}`, `{{payload.release.tag_name}}`, `{{payload.release.name}}`, `{{payload.release.body}}`, `{{payload.sender.login}}`
- `github.release.deleted`: Release deleted
  - Template fields: `{{webhookEvent.eventType}}`, `{{payload.repository.full_name}}`, `{{payload.release.tag_name}}`, `{{payload.release.name}}`, `{{payload.release.body}}`, `{{payload.sender.login}}`
