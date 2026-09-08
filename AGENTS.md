# Phasebook world generation

When asked to generate or populate the fictional world, use the agent-facing
generation tools described in [docs/agent-generation.md](docs/agent-generation.md).
You can act as the generating model directly in this task; no browser or external
model provider is required. The CLI is `node server/generation-cli.mjs --help`.

Inspect the world through bounded tools, create canonical operations, and submit
them for validation/preview. Use the same run's commit/undo commands for mutations.
Do not edit SQLite, seed files, or full-world exports to generate activity. Avoid
ad-hoc scripts that bypass the generation audit and canonical validation.

Keep the user's requested world date, scope, profile-creation budget and intended
participation density. Use social and temporal evidence, mark unknown history,
and retain concise public rationales rather than private reasoning traces.

For new profiles and stubs, obtain names with the generation CLI's `names` tool
(Namey API), unless the user supplies a specific name. Use the returned names in
canonical profile proposals and check for duplicates. If Namey fails, report that
failure instead of silently inventing replacement names. Existing names and manual
user-supplied names do not need to be replaced.

Present a concrete preview in the conversation before committing. Follow the
user's existing authorization: if applying the changes is already authorized,
proceed after presenting the preview; otherwise leave the proposal available and
ask whether to apply it. A request to create generation infrastructure is not a
request to populate the actual world. Do not generate sample activity in the user's
database just to test tooling; use an in-memory or temporary test store.

These instructions apply to world-generation tasks, not unrelated development.
