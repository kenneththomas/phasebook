import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const help = `Phasebook agent generation tools

node server/generation-cli.mjs <command> [run-id] [--input file.json]

JSON input comes from --input or stdin. Commands without a body do not read stdin.
  list                     List recent runs
  create                   Create a run: {prompt, worldDate?, ...options}
  get <run-id>              Read the proposal and audit
  context <run-id>          Compact scope, voices, social evidence, activity and schemas
  inspect <run-id>          Query: {table, query?, profileId?, networkId?, since?, limit?, offset?}
  schema <run-id>           Canonical fields: {table}
  neighbors <run-id>        Social context: {profileId, limit?}
  names <run-id>            Namey profile names: {count?, type?, frequency?, withSurname?}
  propose <run-id>          Validate and preview: {operations: [...]}
  commit <run-id>           Apply all reviewed operations
  commit-selected <run-id>  Apply dependency-complete selection: {selected: [operationKeys]}
  discard <run-id>          Discard the proposal
  undo <run-id>             Conflict-checked reversal
  provenance               Inspect origin: {table, id}

Start Phasebook with npm run dev or npm start first. No browser or model adapter
is required: the calling agent supplies the operations itself.
PHASEBOOK_URL defaults to http://127.0.0.1:5173 (loopback only).
Results are JSON on stdout; errors are JSON on stderr with a nonzero exit code.
Fast path for a scoped run: create → context → propose → preview in the
conversation → commit. Use inspect/neighbors/schema only when context leaves a gap.
`;

export async function callGenerationTool(
  command,
  runId,
  input,
  {
    baseURL = process.env.PHASEBOOK_URL || 'http://127.0.0.1:5173',
    fetcher = fetch,
  } = {},
) {
  const base = new URL(baseURL);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) ||
    base.username ||
    base.password
  )
    throw new Error(
      'PHASEBOOK_URL must be a loopback HTTP(S) address without credentials.',
    );
  let path,
    method = 'GET',
    body;
  const runPath = () => {
    if (typeof runId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(runId))
      throw new Error('Provide a valid run ID.');
    return `/api/generation/${encodeURIComponent(runId)}`;
  };
  switch (command) {
    case 'list':
      path = '/api/generation';
      break;
    case 'create':
      path = '/api/generation';
      method = 'POST';
      body = input;
      break;
    case 'get':
      path = runPath();
      break;
    case 'inspect':
    case 'context':
    case 'schema':
    case 'neighbors':
    case 'names':
      path = `${runPath()}/inspect`;
      method = 'POST';
      body = { name: command, arguments: input };
      break;
    case 'propose':
    case 'commit-selected':
      if (
        command === 'commit-selected' &&
        (!Array.isArray(input?.selected) || !input.selected.length)
      )
        throw new Error('Provide a nonempty selected array.');
      path = `${runPath()}/${command === 'commit-selected' ? 'commit' : command}`;
      method = 'POST';
      body = input;
      break;
    case 'commit':
    case 'discard':
    case 'undo':
      path = `${runPath()}/${command}`;
      method = 'POST';
      body = {};
      break;
    case 'provenance':
      if (typeof input?.table !== 'string' || typeof input?.id !== 'string')
        throw new Error('Provide table and id.');
      path =
        '/api/generation-provenance?' + new URLSearchParams(input).toString();
      break;
    default:
      throw new Error('Unknown command. Use --help.');
  }
  let response;
  try {
    response = await fetcher(new URL(path, base), {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(180000),
    });
  } catch (error) {
    throw new Error(
      'Cannot reach Phasebook, or the request timed out. Start the local server. If a commit/undo response was lost, inspect the run before retrying.',
      { cause: error },
    );
  }
  if (response.status === 404)
    throw new Error(
      'Generation endpoint or run not found. Restart Phasebook after updating its backend and check the run ID.',
    );
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      result.error || `Phasebook returned HTTP ${response.status}.`,
    );
  // Commit/undo APIs return the entire world for the browser. Agents need only
  // the run receipt, avoiding an accidental database dump into model context.
  if (['commit', 'commit-selected', 'undo'].includes(command)) {
    return callGenerationTool('get', runId, undefined, { baseURL, fetcher });
  }
  return result;
}

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes('--help')) {
    process.stdout.write(help);
    return;
  }
  const command = args.shift();
  const hasRun = [
    'get',
    'inspect',
    'context',
    'schema',
    'neighbors',
    'names',
    'propose',
    'commit',
    'commit-selected',
    'discard',
    'undo',
  ].includes(command);
  const runId = hasRun ? args.shift() : undefined;
  const needsInput = [
    'create',
    'inspect',
    'context',
    'schema',
    'neighbors',
    'names',
    'propose',
    'commit-selected',
    'provenance',
  ].includes(command);
  let input;
  if (needsInput) {
    let raw;
    if (args.length === 2 && args[0] === '--input')
      raw = await readFile(args[1], 'utf8');
    else if (!args.length) {
      if (process.stdin.isTTY)
        throw new Error('Provide JSON through stdin or --input file.json.');
      const chunks = [];
      let size = 0;
      for await (const chunk of process.stdin) {
        size += chunk.length;
        if (size > 1_000_000) throw new Error('Tool input exceeds 1 MB.');
        chunks.push(chunk);
      }
      raw = Buffer.concat(chunks).toString('utf8');
    } else throw new Error('Unexpected arguments. Use --help.');
    if (Buffer.byteLength(raw) > 1_000_000)
      throw new Error('Tool input exceeds 1 MB.');
    input = JSON.parse(raw);
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('Tool input must be a JSON object.');
  } else if (args.length) throw new Error('Unexpected arguments. Use --help.');
  process.stdout.write(
    JSON.stringify(await callGenerationTool(command, runId, input), null, 2) +
      '\n',
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(JSON.stringify({ error: error.message }) + '\n');
    process.exitCode = 1;
  });
}
