# World generation

Agents can also generate directly in a conversation through the
[agent command interface](agent-generation.md), without a browser or another model.

Generation is a local administration surface at **http://127.0.0.1:5173/#generation**,
also available from the Generation sidebar link. Run `npm run dev`, or run
`npm run build` and `npm start`. Restart the server after backend changes.

The engine does not contain event-, school-, artist-, post-, or profile-specific
prompt templates. Its unit of work is a request to inspect and change the world.
Existing manual APIs and generated writes both use `store.writeResult`, `put`,
schema validation, media validation, relational constraints and social side effects.
The store remains the canonical application service. No AI entity tables exist.

## Run and context

`server/generation.mjs` provides `createGeneration(store, {provider, research})`.
`create` accepts an instruction and an optional ISO `worldDate` (omit for present-day
content), optional profile and network scopes, `allowNewProfiles`, `maxNewProfiles`
(default 5, maximum 50), and `density` (0–1, excluding zero). The UI labels its
date/time as UTC. When worldDate is provided, it controls the historical inspection
context and default dates for generated records; proposed operation dates may be later
than the world date. Without worldDate, all temporal validation is skipped.

A `GenerationRun` retains the original prompt, context, creation/commit/undo
timestamps, status, provider/model, inspected entity IDs, proposed operations,
committed operation keys, generated entity IDs, canonical before/after images,
warnings, errors, and concise public rationales/confidences. There are no stored
private model reasoning traces. Provider responses are not saved wholesale.

Profiles have optional generation-steering fields: `voice`,
`communicationStyle`, and `behavioralTendencies`. They are ordinary canonical
profile fields, editable in the profile UI and preserved by imports, exports, and
profile packages. Inspection exposes them to agents; they guide wording and
participation without acting as executable instructions or hard rules.

Lifecycle: `draft → inspecting → proposed → committed → undone`, with `failed`
and `discarded` branches. Draft, failed and proposed runs can be discarded.
A failed provider run can be retried. Server startup marks interrupted inspections
failed. A run can be committed once, including a subset; omitted operations stay
in the proposal history and cannot later be committed from that closed run.

## Canonical operations

An operation is `{key, action, table, data, dependsOn?, rationale?, confidence?}`.
`action` is `create` or `update`. `table` comes from `server/schema.mjs`, so all
current canonical entities are supported: profiles/stubs, networks/memberships,
friendships/relationship events, posts/Wall/group posts, comments, likes, events/RSVPs, groups/members,
albums/photos, messages, notifications and media references.

Create identities are allocated by Phasebook. Updates require the existing local
`data.id` and merge the patch over a captured baseline. Existing external IDs
remain immutable. Use `{"$ref":"operation-key"}` in a canonical reference field
to refer to another operation. Reference target types are checked against the
schema. Dependencies are sorted; missing selections and cycles are rejected.

For example, enter this manual proposal in the UI after inspecting actual profile
IDs (the demo world contains `p1` and `p2`):

```json
[
  {
    "key": "conversation",
    "action": "create",
    "table": "posts",
    "data": {
      "authorId": "p1",
      "wallId": "p2",
      "body": "Are you around tonight?"
    },
    "rationale": "A direct Wall message to an existing person."
  },
  {
    "key": "reply",
    "action": "create",
    "table": "comments",
    "data": {
      "postId": { "$ref": "conversation" },
      "authorId": "p2",
      "body": "Yes, after dinner."
    }
  }
]
```

Dates default to the run date when worldDate is set, or current time when omitted;
nullable fields default to null. Profile defaults
come from the canonical schema. To create a stub, use `table: "profiles"` and
`data: {"state":"stub","name":"…"}` with profile creation enabled. Explicit
network membership operations attach dates and other affiliations. Generation
checks obvious name/birthday duplicates and enforces its new-profile budget.
Full-profile affiliations also use the existing profile/network synchronization.

Media creation supports validated bundled and remote image references. Generated
records can attach existing local media IDs. New local uploads use the existing
media API, outside generation; models never receive filesystem access. Deletes
are intentionally not exposed as proposal operations. Run undo is separate.

## Inspecting and modeling social history

Tools have JSON Schema parameter descriptions and bounded results:

- `context`: for a profile- or network-scoped run, returns a compact planning
  packet with the run constraints, nonempty profile traits (including voice
  steering), bounded plausible participants and social evidence, recent posts and
  comments, and up to eight requested schemas. Participant and activity limits are
  independently bounded. This is the preferred first call for scoped generation.
- `inspect`: search any canonical collection by text or ID; filter by a related
  profile, friendship, network membership, and timeline `since`; paginate with limit/offset.
  Text matching covers interests, location, names and content.
- `schema`: get one collection's fields, constraints, and typed reference map.
- `neighbors`: accepted friends with their current relationship context, dated
  relationship events up to the world date, mutual friends and shared networks,
  bounded to 50.

Search results stop at 50 rows and roughly 60,000 characters, with long text fields
explicitly truncated. Offset pagination lets the agent inspect more deliberately.
The orchestration budget is 12 model turns, at most 5 calls per turn, 100 recorded
inspections per run and 200 proposed operations. Each model request has a
3-minute timeout. The generation page shows the current phase, model turn and
inspection count while a run is in progress. The model receives tools/results
rather than the database.
Queries currently scan the local world in the service; large-world indexed SQL
query planning is a future optimization, without changing the tool contract.

Content after the effective date is hidden when a worldDate is set, including
reactions/comments on future posts. Comments cannot precede their parent post; participants
cannot act before a known birthday. Membership `startYear`/`endYear` bounds are
inclusive, supported for schools and workplaces. Membership creation timestamps record bookkeeping and are not treated
as attendance start dates. `classYear` alone does not establish attendance.

Existing profile attributes and friendship status have no automatic version
history. Dated relationship events provide explicit but potentially incomplete
history; their absence does not prove a past state. The tools explicitly warn
that other current facts have unknown historical validity and cannot reconstruct
a prior friendship status, city, interest or employer. Missing
attendance dates remain unknown, not automatically confirmed. These limitations
must inform the model's rationale. Density is a model participation target, not a
rule that every matching person must respond or a hard quota. An autonomous model
can choose sparse participants using social/contextual evidence. Quality and
historical plausibility still require human preview; no deterministic local text
generator pretends to understand arbitrary instructions.

## Repeatable quality evaluation

Run `npm run eval:generation` for the fixed end-to-end scenarios. They cover a
profile Wall exchange, a network-scoped event discussion, and a sparse multi-voice
conversation. Each fixture must pass relevance, profile consistency, distinct
voice, social plausibility, temporal consistency, sparsity, and canonical preview
validation; a dense generic negative fixture must fail the rubric.

The pre-change agent workflows needed 5, 6, and 7 inspection calls and returned
5,699, 3,686, and 12,605 JSON characters. The bounded `context` workflow uses one
inspection call in each case. With the fixed limits used by the evaluation, the
packets measured 6,646, 3,938, and 8,762 characters. This deliberately trades a
small amount of complete, relevant context in the first two cases for four or five
fewer round trips, while the voice-heavy case improves both calls and context size.

## Preview, commit and undo

Validation executes the proposed operations through the real store in a transaction
and deliberately rolls back. This exercises canonical schemas, media validation,
foreign keys, uniqueness and social side effects. The preview contains both direct
operations and resulting changes, including notifications and affiliation changes.
Side-effect IDs and new external IDs can differ between dry-run and commit; proposed
primary local IDs are reserved in the run, not inserted into the world.

Commit repeats validation against current state inside `BEGIN IMMEDIATE`, checks
update baselines, applies selected dependencies and saves the audit in the same
transaction. A failure rolls everything back and leaves the proposal available.
The frontend reloads the canonical world response after commit/undo.

Undo checks every affected row against its committed after-image before writing.
It refuses undo if a row was edited/deleted, if a later external record refers to a
created row, or if a newly created profile is now active. It then removes created
records and restores update preimages atomically. This includes notifications,
friendship stories, and profile/network synchronization. Reading a generated
notification changes it and therefore conservatively blocks undo. Manual changes
are never silently overwritten. There is no force-undo mode.

## Provenance and persistence

An additive `generationRuns(id, payload)` SQLite table holds the audit records.
It is initialized idempotently alongside the existing schema; no canonical table
rebuild or local/external ID migration is needed, and the domain schema version is
unchanged. Dates on generated notifications/stories/affiliations use the world date
when set, or current time when omitted; ordinary manual writes keep their current-time
behavior.

Each committed change has optional sidecar provenance: `generated`,
`generationRunId`, provider/model, world date, operation key, rationale and confidence.
The run supplies the source prompt. This keeps generated Posts and Profiles exactly
the same canonical records as manual/imported ones. `GET /api/generation-provenance`
with `table` and `id` returns their generation history, including undone entries.
Absence of this metadata means unknown/manual origin, not an invalid record.

Full-world exports include optional `generationHistory` when nonempty. Old exports
remain valid; replacement imports clear stale run history. Imported history is
retained as `archived` for provenance, but is never allowed to execute imported
inverse mutations. This is deliberate: backup data must not become an unchecked
write program. Single-profile packages continue to work with canonical entities;
they currently omit run-level provenance. Export the full world to retain the audit.

## Providers

The manual editor needs no model service. For model-assisted generation, configure
OpenRouter in the shell that starts Phasebook:

```powershell
$env:OPENROUTER_API_KEY = 'your-openrouter-api-key'
# Optional: defaults to deepseek/deepseek-v4-flash-0731
$env:PHASEBOOK_OPENROUTER_MODEL = 'your-provider/model-name'
npm run dev
```

The adapter uses OpenRouter's OpenAI-compatible chat completions endpoint and
requests a JSON object. The default model is
`deepseek/deepseek-v4-flash-0731`; override it with `PHASEBOOK_OPENROUTER_MODEL`
or `OPENROUTER_MODEL`. `PHASEBOOK_OPENROUTER_URL` optionally overrides the
endpoint; `PHASEBOOK_OPENROUTER_REFERER` and `PHASEBOOK_OPENROUTER_TITLE` optionally
identify the application to OpenRouter. Credentials remain server-side.

For local-only generation, Ollama remains supported as a fallback:

```powershell
$env:PHASEBOOK_OLLAMA_MODEL = 'your-installed-model-name'
npm run dev
```

`PHASEBOOK_OLLAMA_URL` optionally overrides `http://127.0.0.1:11434/api/chat`.
OpenRouter takes precedence when both providers are configured.
The adapter uses Ollama's [JSON chat response contract](https://docs.ollama.com/api/chat),
requests non-streaming JSON, and ignores any separate thinking field. The UI's
“Ask model to inspect and propose” button becomes available after server restart.
The adapter is protocol-tested with fixtures; live model quality depends on the
selected installed model and has not been benchmarked by this change.

For another provider, implement `{name, model, async next(input)}` and pass it to
`createGeneration`. Input contains `instruction`, `context`, `guidance`, tool
definitions and prior call/result messages. Return either:

```json
{
  "calls": [
    {
      "name": "inspect",
      "arguments": { "table": "networks", "query": "Maryland" }
    }
  ]
}
```

or `{"operations":[...]}`. The core executes only allowlisted world tools. Provider
code does not receive a store or DB handle, and cannot commit. Providers must inspect
before proposing. Invalid output marks the run failed without changing the world.

A provider-neutral HTTP bridge is also supplied: configure
`PHASEBOOK_GENERATION_URL`, optional `PHASEBOOK_GENERATION_MODEL` and optional
`PHASEBOOK_GENERATION_TOKEN`. It POSTs the same input and expects the same JSON
response. This is an adapter contract, not a URL for an arbitrary model API.
Ollama configuration takes precedence when both are supplied. Credentials remain
server-side. Only configure remote adapters when you intend to send the instruction
and inspected fictional-world context to that service.

Optional research implements `{async context({prompt, context})}` and returns
bounded source summaries/citations as additional provider context. It is injected
separately; no web search, browser automation or scraping is built into the engine.
Research is untrusted context, never a mutation program.

## Worked conceptual example

Instruction: “there was a big sean concert at university of maryland on march 6, 2013. make people talk about it.” Choose the effective time that evening in UTC.

1. A run retains the request and date; optional research can supply sourced event
   context. Without research, the event premise comes from the user's instruction.
2. The model searches networks for Maryland, inspects membership dates, searches
   profiles' interests, and explores accepted friends/mutuals and prior activity.
   Future posts are filtered out. Undated attendance/relationships are flagged.
3. It chooses a sparse plausible subset, rather than every student, and consults
   canonical schemas. It may propose an event, posts, Wall messages, comments and
   likes, and only add stubs if allowed and justified by the available world.
4. References such as a comment's new parent post use operation keys. Each operation
   has a short rationale tied to inspected evidence; the dry-run validates all rows.
5. The user reviews and selects operations. Commit includes their dependencies and
   saves the actual changed rows/provenance. Undo later checks for conflicting edits.

No part of these steps branches on Big Sean, Maryland, a concert, or a particular
kind of social scene.

## Extending the world

Add a canonical entity to `schema.mjs` and the normal store/import/UI architecture
first. The generation registry derives collections, fields and reference targets
from that schema, so it becomes queryable and writable automatically. Put new
domain invariants and side effects in the canonical store, then add temporal rules
to generation if the entity has additional historical constraints. Test preview,
commit, references, provenance and undo for the new entity. Future targeted UI
actions should prefill a run's instruction/context and reuse this lifecycle.

HTTP surface: `GET/POST /api/generation`, `GET /api/generation/:id`, and POST
`/:id/inspect`, `/:id/generate`, `/:id/propose`, `/:id/commit`, `/:id/discard`,
`/:id/undo`. Propose accepts `{operations}`, commit optionally accepts `{selected}`.
Commit and undo return the current canonical world; other actions return the run
or tool result. Existing same-origin loopback checks apply.

Tests: `npm test`, `npm run build`, `npm run lint`. Generation tests exercise
canonical lifecycle, dependency validation, partial commits, failure rollback,
provenance, temporal queries, stubs, undo conflicts, model protocol and HTTP routes.
