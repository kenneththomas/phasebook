import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createStore } from '../server/store.mjs';
import { createApp } from '../server/index.mjs';
import { callGenerationTool } from '../server/generation-cli.mjs';

test('agent tools inspect, preview, commit and undo without a browser or model', async (t) => {
  const store = createStore(':memory:');
  const server = createApp(store);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });
  const options = { baseURL: `http://127.0.0.1:${server.address().port}` };
  const call = (command, id, input) =>
    callGenerationTool(command, id, input, options);
  const before = store.getState();
  const run = await call('create', undefined, {
    prompt: 'A short conversation',
    worldDate: '2013-03-06T23:59:00Z',
  });
  assert.equal((await call('list')).runs[0].id, run.id);
  assert.equal(
    (await call('inspect', run.id, { table: 'profiles', id: 'p1' })).rows[0].id,
    'p1',
  );
  assert.ok((await call('schema', run.id, { table: 'posts' })).fields.authorId);
  assert.ok((await call('neighbors', run.id, { profileId: 'p1' })).rows.length);
  await call('propose', run.id, {
    operations: [
      {
        key: 'wall',
        action: 'create',
        table: 'posts',
        data: { authorId: 'p1', wallId: 'p2', body: 'See you soon — café?' },
      },
    ],
  });
  assert.deepEqual(store.getState(), before);
  const committed = await call('commit-selected', run.id, {
    selected: ['wall'],
  });
  assert.equal(committed.status, 'committed');
  assert.equal(committed.schemaVersion, undefined);
  const id = committed.operations[0].data.id;
  assert.equal(
    (await call('provenance', undefined, { table: 'posts', id }))[0]
      .generationRunId,
    run.id,
  );
  assert.equal((await call('undo', run.id)).status, 'undone');
  assert.deepEqual(store.getState(), before);
  const rejected = await call('create', undefined, {
    prompt: 'Discard this',
    worldDate: '2011-01-01',
  });
  assert.equal((await call('discard', rejected.id)).status, 'discarded');
});

test('agent CLI reads Unicode JSON from stdin and produces machine-readable errors', async (t) => {
  const store = createStore(':memory:'),
    server = createApp(store);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });
  const execute = (args, input = '') =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['server/generation-cli.mjs', ...args],
        {
          env: {
            ...process.env,
            PHASEBOOK_URL: `http://127.0.0.1:${server.address().port}`,
          },
          windowsHide: true,
        },
      );
      let stdout = '',
        stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(input);
    });
  const created = await execute(
    ['create'],
    JSON.stringify({ prompt: 'A café conversation', worldDate: '2011-01-01' }),
  );
  assert.equal(created.code, 0, created.stderr);
  assert.equal(JSON.parse(created.stdout).prompt, 'A café conversation');
  const invalid = await execute(['create'], '{invalid');
  assert.equal(invalid.code, 1);
  assert.ok(JSON.parse(invalid.stderr).error);
  const help = await execute(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /No browser/);
});

test('agent transport rejects remote hosts, empty selections and unknown commands', async () => {
  await assert.rejects(
    callGenerationTool('list', undefined, undefined, {
      baseURL: 'https://example.com',
    }),
    /loopback/,
  );
  await assert.rejects(
    callGenerationTool('commit-selected', 'run', {}),
    /nonempty/,
  );
  await assert.rejects(callGenerationTool('sql'), /Unknown command/);
  await assert.rejects(callGenerationTool('get', '../bad'), /valid run/);
  await assert.rejects(
    callGenerationTool('list', undefined, undefined, {
      fetcher: async () => new Response('{}', { status: 404 }),
    }),
    /Restart/,
  );
});
