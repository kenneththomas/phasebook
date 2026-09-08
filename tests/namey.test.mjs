import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchNames, NAMEY_API } from '../lib/namey.mjs';
import { createStore } from '../server/store.mjs';
import { createGeneration } from '../server/generation.mjs';
import { callGenerationTool } from '../server/generation-cli.mjs';

test('shared Namey request preserves hook options and validates responses', async () => {
  const names = await fetchNames(
    { count: 2, type: 'female', frequency: 'rare', withSurname: true },
    async (url, options) => {
      const parsed = new URL(url);
      assert.equal(parsed.origin + parsed.pathname, NAMEY_API);
      assert.equal(parsed.searchParams.get('count'), '2');
      assert.equal(parsed.searchParams.get('type'), 'female');
      assert.equal(parsed.searchParams.get('frequency'), 'rare');
      assert.equal(parsed.searchParams.get('with_surname'), 'true');
      assert.ok(options.signal);
      return new Response(JSON.stringify([' Alice Example ', 'Beth Example']));
    },
  );
  assert.deepEqual(names, ['Alice Example', 'Beth Example']);
  await assert.rejects(fetchNames({ count: 11 }), /1–10/);
  await assert.rejects(
    fetchNames({}, async () => new Response('[]')),
    /invalid name list/,
  );
  await assert.rejects(
    fetchNames({}, async () => new Response('{}', { status: 503 })),
    /503/,
  );
});

test('agents obtain recorded Namey suggestions and use them for canonical stubs', async (t) => {
  const store = createStore(':memory:');
  t.after(() => store.close());
  let calls = 0;
  const g = createGeneration(store, {
    nameProvider: async () => {
      calls++;
      return ['Namey Fixture'];
    },
  });
  const run = g.create({
    prompt: 'Add a profile',
    worldDate: '2013-03-06',
    allowNewProfiles: true,
  });
  const before = store.getState();
  const result = await g.inspect(run.id, 'names', { count: 1 });
  assert.deepEqual(store.getState(), before);
  assert.equal(result.names[0], 'Namey Fixture');
  assert.equal(g.get(run.id).nameSuggestions[0].source, NAMEY_API);
  g.propose(run.id, [
    {
      key: 'person',
      action: 'create',
      table: 'profiles',
      data: { state: 'stub', name: result.names[0] },
    },
  ]);
  const committed = g.commit(run.id);
  assert.equal(
    store.get('profiles', committed.operations[0].data.id).name,
    'Namey Fixture',
  );
  assert.equal(
    g.provenance('profiles', committed.operations[0].data.id)[0].nameSource,
    NAMEY_API,
  );
  const denied = g.create({ prompt: 'No new people', worldDate: '2013-03-06' });
  await assert.rejects(
    g.inspect(denied.id, 'names', {}),
    /Enable new profiles/,
  );
  assert.equal(calls, 1);
});

test('Namey failures do not change the world or generate fallback names', async (t) => {
  const store = createStore(':memory:');
  t.after(() => store.close());
  const g = createGeneration(store, {
    nameProvider: async () => {
      throw new Error('Namey unavailable');
    },
  });
  const run = g.create({
    prompt: 'Add a profile',
    worldDate: '2013-03-06',
    allowNewProfiles: true,
  });
  const before = store.getState();
  await assert.rejects(g.inspect(run.id, 'names', {}), /unavailable/);
  assert.equal(g.get(run.id).nameSuggestions, undefined);
  assert.deepEqual(store.getState(), before);
});

test('CLI names command dispatches the asynchronous agent tool', async () => {
  const result = await callGenerationTool(
    'names',
    'run',
    { count: 1 },
    {
      fetcher: async (url, options) => {
        assert.equal(url.pathname, '/api/generation/run/inspect');
        assert.deepEqual(JSON.parse(options.body), {
          name: 'names',
          arguments: { count: 1 },
        });
        return new Response(
          JSON.stringify({ names: ['Namey Fixture'], source: NAMEY_API }),
        );
      },
    },
  );
  assert.equal(result.names[0], 'Namey Fixture');
});

test('autonomous providers receive awaited Namey results before proposing', async (t) => {
  const store = createStore(':memory:');
  t.after(() => store.close());
  let step = 0;
  const g = createGeneration(store, {
    nameProvider: async () => ['Agent Namey Fixture'],
    provider: {
      name: 'fixture',
      async next(input) {
        if (step++ === 0)
          return {
            calls: [
              { name: 'inspect', arguments: { table: 'profiles', limit: 1 } },
              { name: 'names', arguments: { count: 1 } },
            ],
          };
        assert.equal(input.messages[1].result.names[0], 'Agent Namey Fixture');
        return {
          operations: [
            {
              key: 'person',
              action: 'create',
              table: 'profiles',
              data: { state: 'stub', name: input.messages[1].result.names[0] },
            },
          ],
        };
      },
    },
  });
  const run = g.create({
    prompt: 'Add a profile',
    worldDate: '2013-03-06',
    allowNewProfiles: true,
  });
  const result = await g.generate(run.id);
  assert.equal(result.status, 'proposed');
  assert.equal(result.nameSuggestions[0].name, 'Agent Namey Fixture');
});
