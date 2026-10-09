---
name: plan-mode
description: Conventions for writing and tracking implementation plans — plans live in docs/plans/ as <yyyymmdd>-<name>-<status>.md, move through planning → accepted → implementing → done with the file renamed at each step, and track every sub-phase with status and start/end timestamps. Use whenever entering plan mode, writing or updating a plan, advancing a plan's or phase's status, or renaming a plan file.
---

# Plan Mode

Conventions for authoring and tracking implementation plans. These apply whenever a plan is being
created or maintained (e.g. the Claude Code plan-mode workflow).

## Plan Location

- Finalized plans are written to the project's **`docs/plans/`** directory — committed and versioned
  alongside the code they describe. This is the durable plan artifact.
- This is distinct from any transient scratch file the harness uses while planning (e.g.
  `~/.claude/plans/<random>.md`). The scratch file is working state; `docs/plans/` is the plan of
  record. Once a plan is finalized, persist it to `docs/plans/`.

## Filename Format

```
<date>-<name>-<status>.md
```

- **`<date>`** — creation date in `yyyymmdd` format (e.g. `20260803`).
- **`<name>`** — short kebab-case slug describing the plan (e.g. `selfcontained-compose`).
- **`<status>`** — the plan lifecycle status (see below).

Example: `docs/plans/20260803-selfcontained-compose-planning.md`

The `<status>` suffix is kept **in sync with the plan's actual status** — the file is **renamed** as
the plan advances through its lifecycle.

## Plan Lifecycle Status

The `<status>` in the filename reflects where the plan is in its lifecycle:

| Status         | Meaning                                                                    |
| -------------- | -------------------------------------------------------------------------- |
| `planning`     | We are still working on the plan itself.                                   |
| `accepted`     | The plan is created and fully verified — ready to implement.               |
| `implementing` | Implementation is in progress — some sub-phases done, some not yet.        |
| `done`         | The plan is fully implemented.                                             |

Advance the status (and rename the file) as work progresses:
`planning` → `accepted` → `implementing` → `done`.

## Sub-Phase Tracking

Every plan is broken into sub-phases. Each sub-phase must record:

- an implementation **start timestamp** and **end timestamp**;
- a **sub-phase status**, one of: `todo` · `in progress` · `done` · `skipped`.

Use this template for each sub-phase in the plan body:

```markdown
### Phase A — <title>
- **Status:** todo | in progress | done | skipped
- **Started:** <yyyy-mm-dd hh:mm>   (empty until work begins)
- **Ended:** <yyyy-mm-dd hh:mm>     (empty until complete)

<phase description / steps>
```

## Update Discipline

- When a sub-phase **starts** → set its status to `in progress` and fill in the **start** timestamp.
- When a sub-phase **finishes** → set its status to `done` (or `skipped`) and fill in the **end**
  timestamp.
- When the first sub-phase begins, bump the plan status to `implementing` (and rename the file).
- When **all** sub-phases are resolved (`done`/`skipped`), bump the plan status to `done` (and rename
  the file).
- Always keep the filename `<status>` suffix in sync with the plan status recorded in the file body.

## Execution

Every plan written for execution carries an execution table (step → agent → model/effort → wave →
write set → reads). Approved plans are executed via the `plan-execution` skill:
independent sub-tasks run in parallel waves on subagents with the cheapest sufficient model,
reasoning effort and context.
