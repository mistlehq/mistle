# Improving Designer Capabilities

Designer eval failures should turn into either product capability work or Designer guidance work. Keep those paths separate so an instruction change does not hide a missing product feature.

## Improvement Mechanisms

### Product Capability

Use product capability work when Designer needs a real action or live state that Mistle does not expose yet.

Examples:

- call MCP tools for newly added Connected apps
- discover provider resources from a selected connection
- update provider-side configuration through an approved Mistle action
- create or update triggers from supported provider events
- save sandbox profile configuration that has no typed dashboard-control or MCP path yet

Do not try to solve these gaps with instructions. The expected Designer behavior is to disclose the missing capability and stop before overclaiming readiness.

### Managed Instructions

Use Designer managed instructions when the desired improvement changes the default operating behavior across many sessions.

Good instruction updates are generic and reusable:

- how to separate setup work from workflow behavior
- when to show a blueprint before product mutation
- how to ask one concrete decision at a time
- how to distinguish implementation agents from review agents
- how to disclose incomplete provider setup accurately

Avoid narrow case scripts in managed instructions. If the guidance only applies to one workflow family, prefer a discoverable reference or skill.

### Discoverable Reference Docs

Use a reference doc when Designer needs domain knowledge that should be searchable like a knowledge base, but should not become always-on behavior.

For AI software factories, the reference should be generic across issue systems. It can describe reusable concepts such as:

- issue readiness contracts
- workflow states and transition rules
- implementation and review agent roles
- feedback loops for improving coding and review quality
- workflow operating guides, dummy issues, or README-style rollout docs

Reference docs may include provider-specific sections when setup differs by system. For example, Linear and Jira can share the same factory concepts but need separate notes for labels, statuses, fields, issue types, workflows, boards, or JQL/Linear query conventions.

Reference docs should describe reusable domain concepts, configuration awareness, provider-specific mappings, completion criteria, and examples. Avoid session choreography such as exact question order, exact headings, or response templates unless the format is itself the domain artifact being referenced.

### Skills

Use a skill when Designer needs a repeatable procedure, not just passive knowledge.

An AI software factory skill could guide Designer through:

- identifying the issue system and repository system
- drafting the readiness contract
- mapping issue states and columns
- deciding whether implementation and review need separate sandbox profiles
- defining feedback loops and review gates
- producing a workflow operating guide or starter issue

Skills should stay generic by default and route into provider-specific references only when system setup details matter.

## Choosing Between A Doc And A Skill

Use a doc when the main need is lookup knowledge that Designer can cite or adapt.

Use a skill when the main need is a step-by-step process with decision points, checks, and outputs.

For AI software factory work, a good first iteration can be a generic discoverable reference doc. Promote it into a skill when eval results show Designer repeatedly misses the process order, asks poor questions, or fails to produce consistent outputs from the reference alone.

## Provider-Specific Guidance

Keep the generic process separate from provider setup details.

Generic factory guidance should say that an issue system needs readiness gates, states, escalation rules, and status updates.

Provider-specific references should explain how those ideas map into each system:

- Linear: labels, workflow statuses, teams/projects, issue templates, priority, and comments.
- Jira: issue types, custom fields, workflow statuses, board columns, transitions, JQL pickup lanes, and resolution rules.
- GitHub Issues: labels, milestones/projects, issue forms, assignees, and issue comments.

Designer should use the generic process first, then consult provider-specific references only after the user names the issue system or setup detail.

## Eval Follow-Through

When an eval fails, classify the fix before changing prompts:

1. If Designer could not perform a real action because no product path exists, file product capability work.
2. If Designer knew the capability but chose the wrong process, update managed instructions, a reference doc, or a skill.
3. If Designer lacked domain knowledge, add or improve a discoverable reference.
4. If Designer followed the process but missed provider-specific setup, add provider-specific reference material.
5. If the expected outcome was too vague, tighten the eval case before changing Designer behavior.
