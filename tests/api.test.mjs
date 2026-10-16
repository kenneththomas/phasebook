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

test('batch photo API saves one album and rolls back an invalid batch', async () => {
  const ctx = await start();
  try {
    const media = ctx.store.createMedia({
      sourceType: 'bundled',
      sourceLocation: '/assets/avatar-2.jpg',
    });
    const photo = {
      ownerId: 'p1',
      albumId: '',
      mediaId: media.id,
      caption: 'First',
      createdAt: '2010-03-18T10:00:00Z',
    };
    const send = (photos, albumName = 'Trip') =>
      request(ctx.base, '/api/photos/batch', {
        method: 'POST',
        body: JSON.stringify({ photos, albumName }),
      });
    const response = await send([photo, { ...photo, caption: 'Second' }]);
    assert.equal(response.status, 200);
    const { upserts } = await response.json();
    assert.equal(upserts.photos.length, 2);
    assert.equal(upserts.albums.length, 1);
    assert.equal(upserts.media.length, 1);
    assert.deepEqual(
      upserts.photos.map((p) => p.caption),
      ['First', 'Second'],
    );
    assert.ok(upserts.photos.every((p) => p.albumId === upserts.albums[0].id));
    const appended = await send([{ ...photo, albumId: upserts.albums[0].id }]);
    assert.equal(appended.status, 200);
    assert.equal(ctx.store.getState().albums.length, 1);
    const before = ctx.store.exportState();
    assert.equal(
      (await send([photo, { ...photo, mediaId: 'missing' }], 'Invalid batch'))
        .status,
      400,
    );
    assert.deepEqual(ctx.store.exportState(), before);
    assert.equal(
      (await send([{ ...photo, ownerId: 'p2', albumId: upserts.albums[0].id }]))
        .status,
      400,
    );
    assert.equal((await send([])).status, 400);
    assert.equal(
      (await send(Array.from({ length: 101 }, () => photo))).status,
      400,
    );
  } finally {
    await stop(ctx);
  }
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

test('HTTP API searches profiles, posts, and groups server-side', async () => {
  const ctx = await start();
  try {
    const response = await request(ctx.base, '/api/search?q=seed');
    assert.equal(response.status, 200);
    const results = await response.json();
    assert.deepEqual(results.profiles, []);
    assert.equal(results.posts[0].id, 'post1');
    assert.deepEqual(results.groups, []);

    const escaped = await request(ctx.base, '/api/search?q=%25');
    assert.equal(escaped.status, 200);
    assert.deepEqual(await escaped.json(), {
      profiles: [],
      posts: [],
      groups: [],
      networks: [],
    });
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
    const createdDelta = await created.json();
    assert.deepEqual(createdDelta.deletes, {});
    assert.equal(createdDelta.upserts.profiles[0].id, 'api-profile');
    assert.equal(createdDelta.upserts.media.length, 1);
    assert.equal(createdDelta.schemaVersion, undefined);
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

test('accepting a friend request returns the friendship story with the mutation', async () => {
  const ctx = await start();
  try {
    await request(ctx.base, '/api/records/friendships', {
      method: 'POST',
      body: JSON.stringify({
        id: 'api-friend-request',
        profileId: 'p1',
        friendId: 'p2',
        status: 'pending',
      }),
    });
    const accepted = await request(ctx.base, '/api/records/friendships', {
      method: 'POST',
      body: JSON.stringify({
        id: 'api-friend-request',
        profileId: 'p1',
        friendId: 'p2',
        status: 'accepted',
      }),
    });
    assert.equal(accepted.status, 200);
    const mutation = await accepted.json();
    assert.equal(mutation.upserts.posts.length, 2);
    assert.deepEqual(mutation.upserts.posts.map((post) => post.wallId).sort(), [
      'p1',
      'p2',
    ]);
    const story = mutation.upserts.posts[0];
    assert.equal(story.authorId, 'p2');
    assert.equal(story.wallId, 'p2');
    assert.equal(story.groupId, null);
    assert.equal(story.body, 'is now friends with API p1.');
    assert.equal(story.photoId, null);
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
