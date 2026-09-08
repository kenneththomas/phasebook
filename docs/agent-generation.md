# Generate directly from an agent task

The agent in the conversation can supply the intelligence itself. It does not
need to open the browser, configure Ollama, or send the prompt to another model.
`server/generation-cli.mjs` exposes the existing generation service as shell tools.
The local Phasebook server must be running, using `npm run dev` or `npm start`.
Restart it after backend updates. Override the local address with `PHASEBOOK_URL`
when using another port. The CLI does not open the database or reset active runs.

Run `node server/generation-cli.mjs --help` for the exact command contract. Input
is a JSON object read from stdin or `--input <file>`. Output is JSON, with failures
on stderr and a nonzero exit code. Use JSON files for large proposals; never build
shell command strings by interpolating model-authored prose.

## Workflow

For new profiles/stubs, get names from Namey before writing the profile proposal:

```powershell
'{"count":5,"frequency":"all","withSurname":true}' | node server/generation-cli.mjs names RUN_ID
```

The run must allow new profiles. Requests return 1–10 names; optional `type` is
`male` or `female`. Omit it for any name type. The run records the returned names,
Namey source URL and retrieval timestamps. Use those names unless the user has
already supplied specific ones, and check existing profiles for duplicates.
If the API fails, report the failure rather than silently inventing names.
This uses the same request function as the profile editor's `useInventAName` hook.

1. **Create** a run with the instruction and effective ISO date. Include optional
   `networkId`, `profileId`, `allowNewProfiles`, `maxNewProfiles` and `density`.
2. **Inspect** profiles, networks, membership dates and prior content. **Neighbors**
   supplies friends, mutual friends and shared networks. **Schema** describes each
   canonical entity you intend to write. Paginate rather than loading the world.
3. Reason in this task about plausible, sparse participants and coherent activity.
   Respect known dates and profile budgets; qualify missing historical information.
4. **Propose** `{operations:[...]}`. References to newly proposed records use
   `{"$ref":"operation-key"}`. Validation and preview happen through the canonical
   store, including notification and affiliation side effects, then roll back.
5. Present the resulting concrete preview in the conversation, including operation
   counts, participants, sample content and any temporal uncertainty. Follow the
   user's existing authorization to apply it or leave it pending.
6. **Commit** the whole run, or **commit-selected** a dependency-complete selection.
   Both return the saved run receipt, including provenance, not the whole database.
   **Discard** rejects a proposal; **undo** reverses a committed run where safe.

## Examples (PowerShell)

Create a run; use the actual requested date and instruction:

```powershell
'{"prompt":"Make this person’s wall more active","worldDate":"2011-07-20T23:59:00Z","profileId":"p1","allowNewProfiles":false}' | node server/generation-cli.mjs create
```

Copy the returned run ID, then inspect relevant data:

```powershell
'{"table":"profiles","id":"p1"}' | node server/generation-cli.mjs inspect RUN_ID
'{"profileId":"p1"}' | node server/generation-cli.mjs neighbors RUN_ID
'{"table":"posts","profileId":"p1","since":"2011-06-01T00:00:00Z","limit":20}' | node server/generation-cli.mjs inspect RUN_ID
'{"table":"comments"}' | node server/generation-cli.mjs schema RUN_ID
```

Write the proposal as a JSON object containing `operations` to a temporary file,
then use:

```powershell
node server/generation-cli.mjs propose RUN_ID --input proposal.json
node server/generation-cli.mjs get RUN_ID
node server/generation-cli.mjs commit RUN_ID
# Or apply only a reviewed selection:
'{"selected":["post-key","comment-key"]}' | node server/generation-cli.mjs commit-selected RUN_ID
node server/generation-cli.mjs undo RUN_ID
```

The commit alternatives are mutually exclusive: a partial commit closes the run.
If a mutation request times out, use `get` to check its status before retrying.
To inspect an entity's origin, call `provenance` with `{table,id}`. `list` finds
recent runs, which are also visible in the Generation UI when the user opens it.

These are command-line tools callable through the agent's shell capability, not
an automatically registered MCP server. `AGENTS.md` makes this workflow discoverable
to future agents working in this repository. Other hosts can wrap the same command
or HTTP contracts without duplicating the world model.

See [generation architecture](generation.md) for operation schemas, temporal limits,
provenance, undo semantics and provider/research extension points.
