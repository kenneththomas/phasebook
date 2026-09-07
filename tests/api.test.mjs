import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../server/store.mjs';
import { createApp } from '../server/index.mjs';

const start = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'phasebook-api-'));
  const store = createStore(join(dir, 'phasebook.sqlite'), { seed: false });
  const profile = (id) => ({
    id,
    name: `API ${id}`,
    bio: 'Bio',
    city: 'Boston',
    hometown: 'Boston',
    education: 'College',
    work: 'Work',
    birthday: '1990-01-01',
    relationship: 'Single',
    interests: 'music',
    avatar: '/assets/avatar-1.jpg',
  });
  store.importState(
    {
      schemaVersion: 1,
      settings: { activeProfileId: 'p1' },
      profiles: [profile('p1'), profile('p2')],
      friendships: [],
      posts: [
        {
          id: 'post1',
          authorId: 'p1',
          wallId: 'p1',
          groupId: null,
          body: 'Seed post',
          photoId: null,
          createdAt: '2010-03-18T10:00:00Z',
        },
      ],
      comments: [],
      likes: [],
      messages: [],
      notifications: [],
      events: [],
      eventGuests: [],
      groups: [],
      groupMembers: [],
      photos: [],
    },
    false,
  );
  const server = createApp(store).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  return { dir, store, server, base };
};
const stop = async ({ dir, store, server }) => {
  await new Promise((resolve) => server.close(resolve));
  store.close();
  await rm(dir, { recursive: true, force: true });
};
const request = (base, path, options = {}) =>
  fetch(base + path, {
    ...options,
    headers: { 'content-type': 'application/json', ...options.headers },
  });

test('HTTP API exposes state and export with expected headers', async () => {
  const ctx = await start();
  try {
    const state = await request(ctx.base, '/api/state');
    assert.equal(state.status, 200);
    assert.equal((await state.json()).schemaVersion, 2);
    const exported = await request(ctx.base, '/api/export');
    assert.equal(exported.status, 200);
    assert.match(
      exported.headers.get('content-disposition'),
      /phasebook\.json/,
    );
  } finally {
    await stop(ctx);
  }
});

test('HTTP API supports record mutation and profile switching', async () => {
  const ctx = await start();
  try {
    const record = {
      id: 'api-profile',
      name: 'API Person',
      bio: 'Bio',
      city: 'Boston',
      hometown: 'Boston',
      education: 'College',
      work: 'Work',
      birthday: '1990-01-01',
      relationship: 'Single',
      interests: 'music',
      avatar: '/assets/avatar-1.jpg',
    };
    const created = await request(ctx.base, '/api/records/profiles', {
      method: 'POST',
      body: JSON.stringify(record),
    });
    assert.equal(created.status, 200);
    assert.ok(
      (await created.json()).profiles.some((p) => p.id === 'api-profile'),
    );
    const switched = await request(ctx.base, '/api/switch', {
      method: 'POST',
      body: JSON.stringify({ profileId: 'api-profile' }),
    });
    assert.equal(switched.status, 200);
    assert.equal(
      (await switched.json()).settings.activeProfileId,
      'api-profile',
    );
    const deleted = await request(
      ctx.base,
      '/api/records/profiles/api-profile',
      { method: 'DELETE' },
    );
    assert.equal(deleted.status, 400);
  } finally {
    await stop(ctx);
  }
});

test('HTTP API imports valid JSON and rejects invalid imports without changing state', async () => {
  const ctx = await start();
  try {
    const initial = ctx.store.getState();
    const valid = await request(ctx.base, '/api/import', {
      method: 'POST',
      body: JSON.stringify(initial),
    });
    assert.equal(valid.status, 200);
    const invalid = { ...initial, schemaVersion: 99 };
    const response = await request(ctx.base, '/api/import', {
      method: 'POST',
      body: JSON.stringify(invalid),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /schemaVersion/);
    assert.deepEqual(ctx.store.getState(), initial);
  } finally {
    await stop(ctx);
  }
});

test('HTTP API enforces local origin and reports unknown routes', async () => {
  const ctx = await start();
  try {
    const forbidden = await request(ctx.base, '/api/state', {
      headers: { origin: 'https://evil.example' },
    });
    assert.equal(forbidden.status, 403);
    const unknown = await request(ctx.base, '/api/nope');
    assert.equal(unknown.status, 404);
    const malformed = await fetch(ctx.base + '/api/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    assert.equal(malformed.status, 400);
  } finally {
    await stop(ctx);
  }
});
