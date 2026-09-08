import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/store.mjs';
import {
  createGeneration,
  membershipAt,
  openrouterProvider,
  ollamaProvider,
} from '../server/generation.mjs';
import { createApp } from '../server/index.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const input = {
  prompt: 'Make this world more active.',
  worldDate: '2013-03-06T23:59:00Z',
};
const post = (key = 'post') => ({
  key,
  action: 'create',
  table: 'posts',
  data: { authorId: 'p1', wallId: 'p2', body: 'See you tonight.' },
  rationale: 'A message between existing people.',
});
function setup(t, options) {
  const store = createStore(':memory:');
  t.after(() => store.close());
  const generation = createGeneration(store, options);
  return { store, generation, run: generation.create(input) };
}
test('preview rolls back; commit records canonical data, side effects, provenance and undo', (t) => {
  const { store, generation: g, run } = setup(t),
    before = store.getState();
  const proposed = g.propose(run.id, [
    post(),
    {
      key: 'comment',
      action: 'create',
      table: 'comments',
      data: {
        postId: { $ref: 'post' },
        authorId: 'p2',
        body: 'Looking forward to it.',
      },
    },
  ]);
  assert.equal(proposed.status, 'proposed');
  assert.deepEqual(store.getState(), before);
  assert.equal(proposed.previewChanges.length, 4);
  const committed = g.commit(run.id);
  assert.equal(committed.status, 'committed');
  assert.equal(committed.changes.length, 4);
  const created = store.get('posts', committed.operations[0].data.id);
  assert.equal(created.createdAt, '2013-03-06T23:59:00.000Z');
  assert.ok(created.externalId);
  assert.equal(committed.generatedEntityIds.length, 4);
  assert.equal(g.provenance('posts', created.id)[0].generationRunId, run.id);
  assert.ok(
    committed.changes
      .filter((c) => c.table === 'notifications')
      .every((c) => c.after.createdAt === created.createdAt),
  );
  assert.throws(() => g.commit(run.id), /proposed/);
  assert.equal(g.undo(run.id).status, 'undone');
  assert.deepEqual(store.getState(), before);
});
test('selected commits require dependencies; reject closes a run', (t) => {
  const { store, generation: g, run } = setup(t),
    before = store.getState();
  g.propose(run.id, [
    post(),
    {
      key: 'like',
      action: 'create',
      table: 'likes',
      data: { postId: { $ref: 'post' }, profileId: 'p2' },
    },
  ]);
  assert.throws(() => g.commit(run.id, ['like']), /dependency/);
  assert.deepEqual(store.getState(), before);
  const result = g.commit(run.id, ['post']);
  assert.deepEqual(result.committedOperations, ['post']);
  const draft = g.create(input);
  assert.equal(g.discard(draft.id).status, 'discarded');
  assert.throws(() => g.propose(draft.id, []), /closed/);
});
test('invalid schemas, missing references, cycles and duplicate edges never mutate the world', (t) => {
  const { store, generation: g, run } = setup(t),
    before = store.getState();
  for (const operations of [
    [post(), { ...post('bad'), data: { authorId: 'missing', body: 'x' } }],
    [{ ...post(), data: { ...post().data, extra: true } }],
    [{ ...post(), dependsOn: ['post'] }],
    [
      post(),
      {
        key: 'a',
        action: 'create',
        table: 'likes',
        data: { profileId: 'p1', postId: { $ref: 'post' } },
      },
      {
        key: 'b',
        action: 'create',
        table: 'likes',
        data: { profileId: 'p1', postId: { $ref: 'post' } },
      },
    ],
    [
      {
        key: 'f',
        action: 'create',
        table: 'friendships',
        data: { profileId: 'p1', friendId: 'p1', status: 'accepted' },
      },
    ],
  ]) {
    assert.throws(() => g.propose(run.id, operations));
    assert.deepEqual(store.getState(), before);
  }
  assert.equal(g.get(run.id).status, 'draft');
});
test('stub budgets and duplicate protection use canonical profiles', (t) => {
  const { store, generation: g, run } = setup(t);
  const stub = {
    key: 'person',
    action: 'create',
    table: 'profiles',
    data: { name: 'A New Person', state: 'stub', birthday: '1993-02-03' },
  };
  assert.throws(() => g.propose(run.id, [stub]), /budget/);
  const allowed = g.create({
    ...input,
    allowNewProfiles: true,
    maxNewProfiles: 1,
  });
  g.propose(allowed.id, [
    stub,
    {
      key: 'wall',
      action: 'create',
      table: 'posts',
      data: { authorId: { $ref: 'person' }, body: 'Hello!' },
    },
  ]);
  const result = g.commit(allowed.id),
    profile = store.get('profiles', result.operations[0].data.id);
  assert.equal(profile.state, 'stub');
  assert.equal(profile.bio, '');
  assert.ok(store.getState().posts.some((p) => p.authorId === profile.id));
  const duplicate = g.create({ ...input, allowNewProfiles: true });
  assert.throws(() => g.propose(duplicate.id, [stub]), /duplicate profile/);
  store.hydrateProfile(profile.externalId, {
    name: profile.name,
    bio: 'Enriched',
  });
  assert.throws(() => g.undo(allowed.id), /edited/);
});
test('undo blocks later inbound references and preserves all data', (t) => {
  const { store, generation: g, run } = setup(t);
  g.propose(run.id, [post()]);
  const result = g.commit(run.id);
  store.write('comments', {
    postId: result.operations[0].data.id,
    authorId: 'p3',
    body: 'A later manual comment',
    createdAt: input.worldDate,
  });
  const before = store.getState();
  assert.throws(() => g.undo(run.id), /later records/);
  assert.deepEqual(store.getState(), before);
});
test('updates detect stale previews and undo restores preimages', (t) => {
  const { store, generation: g, run } = setup(t);
  const original = store.get('profiles', 'p1');
  g.propose(run.id, [
    {
      key: 'edit',
      action: 'update',
      table: 'profiles',
      data: { id: 'p1', bio: 'Generated bio' },
    },
  ]);
  store.write('profiles', { ...original, bio: 'Manual edit' });
  assert.throws(() => g.commit(run.id), /conflicts/);
  g.propose(run.id, [
    {
      key: 'edit',
      action: 'update',
      table: 'profiles',
      data: { id: 'p1', bio: 'Generated bio' },
    },
  ]);
  const before = store.getState();
  g.commit(run.id);
  g.undo(run.id);
  assert.deepEqual(store.getState(), before);
});
test('commit failure rolls back all operations and preserves proposed status', (t) => {
  const { store, generation: g, run } = setup(t);
  g.propose(run.id, [post('first'), post('second')]);
  const before = store.getState();
  let count = 0;
  const write = store.writeResult;
  store.writeResult = (...args) => {
    if (++count === 2) throw new Error('injected failure');
    return write(...args);
  };
  assert.throws(() => g.commit(run.id), /injected/);
  assert.deepEqual(store.getState(), before);
  assert.equal(g.get(run.id).status, 'proposed');
});
test('temporal inspection, membership and content validation', (t) => {
  const { store, generation: g, run } = setup(t);
  const network = store.put('networks', {
    name: 'Temporal School',
    type: 'college',
  });
  store.put('networkMemberships', {
    profileId: 'p1',
    networkId: network.id,
    metadata: '{"startYear":"2010","endYear":"2014"}',
  });
  store.put('networkMemberships', {
    profileId: 'p2',
    networkId: network.id,
    metadata: '{"startYear":"2015","endYear":"2018"}',
  });
  assert.deepEqual(
    g
      .inspect(run.id, 'inspect', { table: 'profiles', networkId: network.id })
      .rows.map((r) => r.id),
    ['p1'],
  );
  assert.equal(
    membershipAt({ metadata: '{"classYear":"2018"}' }, input.worldDate),
    true,
  );
  const future = store.write('posts', {
    authorId: 'p1',
    wallId: null,
    groupId: null,
    photoId: null,
    body: 'Future activity',
    createdAt: '2014-01-01',
  });
  assert.equal(
    g.inspect(run.id, 'inspect', { table: 'posts', id: future.id }).rows.length,
    0,
  );
  assert.throws(
    () =>
      g.propose(run.id, [
        { ...post(), data: { ...post().data, createdAt: '2014-01-01' } },
      ]),
    /world date/,
  );
  assert.throws(
    () =>
      g.propose(run.id, [
        {
          key: 'like',
          action: 'create',
          table: 'likes',
          data: { profileId: 'p1', postId: future.id },
        },
      ]),
    /future/,
  );
  assert.ok(g.inspect(run.id, 'neighbors', { profileId: 'p1' }).rows.length);
  assert.ok(g.inspect(run.id, 'schema', { table: 'events' }).fields.startsAt);
});
test('media reference validation and generic events/groups support', (t) => {
  const { store, generation: g, run } = setup(t);
  const operations = [
    {
      key: 'image',
      action: 'create',
      table: 'media',
      data: {
        sourceType: 'remote',
        sourceLocation: 'https://example.com/image.jpg',
      },
    },
    {
      key: 'avatar',
      action: 'update',
      table: 'profiles',
      data: { id: 'p1', avatarMediaId: { $ref: 'image' } },
    },
    {
      key: 'event',
      action: 'create',
      table: 'events',
      data: {
        creatorId: 'p1',
        title: 'An evening',
        description: 'Gathering',
        location: 'Campus',
      },
    },
    {
      key: 'rsvp',
      action: 'create',
      table: 'eventGuests',
      data: { profileId: 'p1', eventId: { $ref: 'event' }, status: 'maybe' },
    },
    {
      key: 'group',
      action: 'create',
      table: 'groups',
      data: {
        creatorId: 'p1',
        name: 'Music club',
        description: 'Music',
        category: 'Student',
      },
    },
  ];
  const before = store.getState();
  g.propose(run.id, operations);
  g.commit(run.id);
  g.undo(run.id);
  assert.deepEqual(store.getState(), before);
  const invalid = g.create(input);
  assert.throws(
    () =>
      g.propose(invalid.id, [
        {
          ...operations[0],
          data: { sourceType: 'remote', sourceLocation: 'javascript:alert(1)' },
        },
      ]),
    /HTTP/,
  );
});
test('export retains audit provenance; imported history cannot execute inverse mutations', (t) => {
  const { store, generation: g, run } = setup(t);
  g.propose(run.id, [post()]);
  g.commit(run.id);
  const exported = store.exportState();
  assert.equal(exported.generationHistory[0].id, run.id);
  const other = createStore(':memory:');
  t.after(() => other.close());
  other.importState(exported, false);
  const imported = createGeneration(other);
  assert.equal(imported.get(run.id).status, 'archived');
  assert.throws(() => imported.undo(run.id), /local run/);
  assert.equal(
    other.get('posts', g.get(run.id).operations[0].data.id).body,
    post().data.body,
  );
});
test('agent iteratively inspects and proposes without committing or retaining thinking', async (t) => {
  let step = 0;
  const {
    store,
    generation: g,
    run,
  } = setup(t, {
    provider: {
      name: 'test',
      model: 'fixture',
      async next(context) {
        assert.ok(context.tools.length);
        return step++ === 0
          ? {
              calls: [
                { name: 'inspect', arguments: { table: 'profiles', limit: 2 } },
              ],
            }
          : { operations: [post()], thinking: 'never persisted' };
      },
    },
  });
  const before = store.getState(),
    result = await g.generate(run.id);
  assert.equal(result.status, 'proposed');
  assert.equal(result.inspected.length, 1);
  assert.equal(result.provider.model, 'fixture');
  assert.deepEqual(store.getState(), before);
  assert.ok(!JSON.stringify(result).includes('never persisted'));
});
test('model failure preserves world data', async (t) => {
  const {
    store,
    generation: g,
    run,
  } = setup(t, {
    provider: {
      name: 'broken',
      async next() {
        throw new Error('Unavailable');
      },
    },
  });
  const before = store.getState();
  await assert.rejects(g.generate(run.id), /Unavailable/);
  assert.equal(g.get(run.id).status, 'failed');
  assert.deepEqual(store.getState(), before);
});
test('agent cannot exceed its tool budget or execute arbitrary tools', async (t) => {
  const {
    store,
    generation: g,
    run,
  } = setup(t, {
    provider: {
      name: 'loop',
      async next() {
        return {
          calls: [
            { name: 'inspect', arguments: { table: 'profiles', limit: 1 } },
          ],
        };
      },
    },
  });
  const before = store.getState();
  await assert.rejects(g.generate(run.id), /budget exhausted/);
  assert.equal(g.get(run.id).inspected.length, 12);
  assert.deepEqual(store.getState(), before);
  assert.throws(
    () => g.inspect(run.id, 'sql', { table: 'profiles' }),
    /Unknown world tool/,
  );
  assert.throws(
    () => g.inspect(run.id, 'inspect', { table: 'profiles', limit: 100 }),
    /limit/,
  );
  assert.throws(() => g.create({ ...input, worldDate: '2013-02-30' }), /date/);
});
test('runs persist across restart and interrupted provider runs become failed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'phasebook-generation-')),
    filename = join(dir, 'world.sqlite');
  let store = createStore(filename);
  try {
    let g = createGeneration(store);
    const run = g.create(input);
    g.propose(run.id, [post()]);
    const interrupted = g.create(input);
    interrupted.status = 'inspecting';
    store.db
      .prepare('UPDATE generationRuns SET payload=? WHERE id=?')
      .run(JSON.stringify(interrupted), interrupted.id);
    const world = store.getState();
    store.close();
    store = createStore(filename);
    g = createGeneration(store);
    assert.equal(g.get(run.id).status, 'proposed');
    assert.equal(g.get(interrupted.id).status, 'failed');
    assert.deepEqual(store.getState(), world);
    g.commit(run.id);
    g.undo(run.id);
    assert.deepEqual(store.getState(), world);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('generation cannot resurrect a run after a concurrent world replacement', async (t) => {
  let resume;
  const {
    store,
    generation: g,
    run,
  } = setup(t, {
    provider: {
      name: 'delayed',
      next: () =>
        new Promise((resolve) => {
          resume = resolve;
        }),
    },
  });
  const promise = g.generate(run.id),
    world = store.getState();
  store.importState(world, false);
  resume({ calls: [{ name: 'inspect', arguments: { table: 'profiles' } }] });
  await assert.rejects(promise, /not found/);
  assert.deepEqual(g.list(), []);
  assert.deepEqual(store.getState(), world);
});
test('Ollama adapter uses JSON chat output and discards separate thinking', async () => {
  const provider = ollamaProvider({
    model: 'local-model',
    fetcher: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.stream, false);
      assert.equal(body.format, 'json');
      return new Response(
        JSON.stringify({
          message: { content: '{"operations":[]}', thinking: 'private' },
        }),
      );
    },
  });
  assert.deepEqual(await provider.next({ guidance: 'test' }), {
    operations: [],
  });
});
test('OpenRouter adapter sends the compatible JSON chat request', async () => {
  const provider = openrouterProvider({
    apiKey: 'secret',
    model: 'provider/model',
    referer: 'https://phasebook.test',
    title: 'Phasebook',
    fetcher: async (_url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer secret');
      assert.equal(options.headers['HTTP-Referer'], 'https://phasebook.test');
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'provider/model');
      assert.deepEqual(body.response_format, { type: 'json_object' });
      assert.equal(body.messages[1].content, JSON.stringify({ guidance: 'test' }));
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"operations":[]}' } }] }),
      );
    },
  });
  assert.deepEqual(await provider.next({ guidance: 'test' }), {
    operations: [],
  });
});
test('HTTP generation lifecycle is available through the local API', async (t) => {
  const { store } = setup(t),
    server = createApp(store);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/generation`;
  const send = async (path, value) => {
    const response = await fetch(url + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  };
  const run = await send('', input);
  await send(`/${run.id}/propose`, { operations: [post()] });
  const committed = await send(`/${run.id}/commit`, {});
  assert.ok(committed.posts.some((p) => p.body === post().data.body));
  await send(`/${run.id}/undo`, {});
  assert.equal(
    (await (await fetch(url + '/' + run.id)).json()).status,
    'undone',
  );
});
