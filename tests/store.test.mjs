import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../server/store.mjs';

const emptyState = () => ({
  schemaVersion: 1,
  settings: { activeProfileId: 'p1' },
  profiles: [profile('p1'), profile('p2', 'Second Person')],
  friendships: [],
  posts: [post('post1')],
  comments: [],
  likes: [],
  messages: [],
  notifications: [],
  events: [],
  eventGuests: [],
  groups: [],
  groupMembers: [],
  photos: [],
});
const tempStore = async (seed = false) => {
  const dir = await mkdtemp(join(tmpdir(), 'phasebook-store-'));
  const filename = join(dir, 'phasebook.sqlite');
  const store = createStore(filename, { seed });
  if (!seed) store.importState(emptyState(), false);
  return { dir, filename, store };
};
const closeAndRemove = async ({ dir, store }) => {
  store.close();
  await rm(dir, { recursive: true, force: true });
};
const profile = (id, name = 'Test Person') => ({
  id,
  name,
  bio: 'A bio',
  city: 'Boston',
  hometown: 'Providence',
  education: 'College',
  work: 'Student',
  birthday: '1990-01-01',
  relationship: 'Single',
  interests: 'music, coffee',
  avatar: '/assets/avatar-1.jpg',
});
const post = (id, authorId = 'p1') => ({
  id,
  authorId,
  wallId: authorId,
  groupId: null,
  body: 'A test post',
  photoId: null,
  createdAt: '2010-03-18T10:00:00Z',
});

test('seed data has complete references', async () => {
  const state = JSON.parse(
    await readFile(new URL('../db/seed.json', import.meta.url), 'utf8'),
  );
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.profiles.length, 8);
  const ids = Object.fromEntries(
    ['profiles', 'posts', 'photos', 'groups', 'events'].map((t) => [
      t,
      new Set(state[t].map((r) => r.id)),
    ]),
  );
  for (const row of state.friendships) {
    assert.ok(ids.profiles.has(row.profileId));
    assert.ok(ids.profiles.has(row.friendId));
  }
  for (const row of state.posts) {
    assert.ok(ids.profiles.has(row.authorId));
    if (row.wallId) assert.ok(ids.profiles.has(row.wallId));
    if (row.groupId) assert.ok(ids.groups.has(row.groupId));
    if (row.photoId) assert.ok(ids.photos.has(row.photoId));
  }
  for (const row of state.comments) {
    assert.ok(ids.posts.has(row.postId));
    assert.ok(ids.profiles.has(row.authorId));
  }
  for (const row of state.likes) {
    assert.ok(ids.posts.has(row.postId));
    assert.ok(ids.profiles.has(row.profileId));
  }
  for (const row of state.eventGuests) {
    assert.ok(ids.events.has(row.eventId));
    assert.ok(ids.profiles.has(row.profileId));
  }
});

test('createStore default seeding loads the bundled seed file', async () => {
  const ctx = await tempStore(true);
  try {
    const state = ctx.store.getState();
    assert.equal(state.schemaVersion, 1);
    assert.equal(state.settings.activeProfileId, 'p1');
    assert.equal(state.profiles.length, 8);
    assert.equal(state.posts.length, 12);
  } finally {
    await closeAndRemove(ctx);
  }
});

test('store persists after reopening a sqlite file', async () => {
  const ctx = await tempStore(false);
  try {
    ctx.store.importState(
      { ...emptyState(), profiles: [profile('p1')], posts: [] },
      false,
    );
    ctx.store.put('profiles', profile('p2', 'Second Person'));
    ctx.store.close();
    const reopened = createStore(ctx.filename, { seed: false });
    assert.deepEqual(
      reopened.getState().profiles.map((p) => p.id),
      ['p1', 'p2'],
    );
    reopened.close();
  } finally {
    await rm(ctx.dir, { recursive: true, force: true });
  }
});

test('profile create, update, and active profile switch work', async () => {
  const ctx = await tempStore();
  try {
    ctx.store.put('profiles', profile('p9'));
    ctx.store.put('profiles', { ...profile('p9'), name: 'Renamed Person' });
    ctx.store.switchProfile('p9');
    assert.equal(ctx.store.getState().settings.activeProfileId, 'p9');
    assert.equal(
      ctx.store.getState().profiles.find((p) => p.id === 'p9').name,
      'Renamed Person',
    );
  } finally {
    await closeAndRemove(ctx);
  }
});

test('post, comment, like, and duplicate-like prevention work', async () => {
  const ctx = await tempStore();
  try {
    ctx.store.put('posts', post('post-new'));
    ctx.store.put('comments', {
      id: 'comment-new',
      postId: 'post-new',
      authorId: 'p2',
      body: 'Nice post',
      createdAt: '2010-03-18T10:01:00Z',
    });
    ctx.store.put('likes', {
      id: 'like-new',
      postId: 'post-new',
      profileId: 'p2',
    });
    assert.throws(() =>
      ctx.store.put('likes', {
        id: 'like-other-id',
        postId: 'post-new',
        profileId: 'p2',
      }),
    );
    assert.equal(
      ctx.store.getState().comments.some((c) => c.id === 'comment-new'),
      true,
    );
  } finally {
    await closeAndRemove(ctx);
  }
});

test('write atomically creates derived notifications for social actions', async () => {
  const ctx = await tempStore();
  try {
    ctx.store.write('comments', {
      id: 'notify-comment',
      postId: 'post1',
      authorId: 'p2',
      body: 'Hello',
      createdAt: '2010-03-18T10:01:00Z',
    });
    ctx.store.write('likes', {
      id: 'notify-like',
      postId: 'post1',
      profileId: 'p2',
    });
    const notifications = ctx.store
      .getState()
      .notifications.filter(
        (n) =>
          ['notify-comment', 'notify-like'].includes(n.postId) ||
          n.body.includes('post'),
      );
    assert.equal(notifications.length, 2);
    assert.deepEqual(
      notifications.map((n) => n.profileId),
      ['p1', 'p1'],
    );
    assert.ok(
      notifications.some(
        (n) => n.body === 'Second Person commented on your post.',
      ),
    );
    assert.ok(
      notifications.some((n) => n.body === 'Second Person liked your post.'),
    );
    const count = ctx.store.getState().notifications.length;
    ctx.store.write('comments', {
      id: 'notify-comment',
      postId: 'post1',
      authorId: 'p2',
      body: 'Edited',
      createdAt: '2010-03-18T10:02:00Z',
    });
    ctx.store.write('likes', {
      id: 'notify-like',
      postId: 'post1',
      profileId: 'p2',
    });
    assert.equal(ctx.store.getState().notifications.length, count);
  } finally {
    await closeAndRemove(ctx);
  }
});

test('failed write rolls back the record and derived notification', async () => {
  const ctx = await tempStore();
  try {
    assert.throws(
      () =>
        ctx.store.write('comments', {
          id: 'bad-comment',
          postId: 'missing-post',
          authorId: 'p2',
          body: 'Nope',
          createdAt: '2010-03-18T10:01:00Z',
        }),
      /FOREIGN KEY/i,
    );
    assert.equal(
      ctx.store.getState().comments.some((c) => c.id === 'bad-comment'),
      false,
    );
    assert.equal(ctx.store.getState().notifications.length, 0);
  } finally {
    await closeAndRemove(ctx);
  }
});

test('friend requests and acceptance create directional notifications', async () => {
  const ctx = await tempStore();
  try {
    ctx.store.write('friendships', {
      id: 'friend-request',
      profileId: 'p1',
      friendId: 'p2',
      status: 'pending',
    });
    let notifications = ctx.store.getState().notifications;
    assert.deepEqual(
      notifications.map((n) => [n.profileId, n.actorId, n.body]),
      [['p2', 'p1', 'Test Person sent you a friend request.']],
    );
    ctx.store.write('friendships', {
      id: 'friend-request',
      profileId: 'p1',
      friendId: 'p2',
      status: 'accepted',
    });
    notifications = ctx.store.getState().notifications;
    assert.deepEqual(
      notifications.map((n) => [n.profileId, n.actorId, n.body]),
      [
        ['p2', 'p1', 'Test Person sent you a friend request.'],
        ['p1', 'p2', 'Second Person accepted your friend request.'],
      ],
    );
  } finally {
    await closeAndRemove(ctx);
  }
});

test('markConversationRead only marks messages from the selected other profile', async () => {
  const ctx = await tempStore();
  try {
    ctx.store.put('messages', {
      id: 'inbound',
      senderId: 'p2',
      recipientId: 'p1',
      subject: 'Hi',
      body: 'One',
      createdAt: '2010-03-18T10:00:00Z',
      read: 0,
    });
    ctx.store.put('messages', {
      id: 'outbound',
      senderId: 'p1',
      recipientId: 'p2',
      subject: 'Hi',
      body: 'Two',
      createdAt: '2010-03-18T10:01:00Z',
      read: 0,
    });
    ctx.store.markConversationRead('p1', 'p2');
    const messages = Object.fromEntries(
      ctx.store.getState().messages.map((m) => [m.id, m.read]),
    );
    assert.equal(messages.inbound, 1);
    assert.equal(messages.outbound, 0);
  } finally {
    await closeAndRemove(ctx);
  }
});

test('state import and export round trip exactly', async () => {
  const source = await tempStore();
  const target = await tempStore(false);
  try {
    const exported = source.store.getState();
    assert.deepEqual(target.store.importState(exported, false), exported);
  } finally {
    await closeAndRemove(source);
    await closeAndRemove(target);
  }
});

test('bad imports reject and leave the existing state unchanged', async () => {
  const ctx = await tempStore();
  try {
    const before = ctx.store.getState();
    const duplicate = structuredClone(before);
    duplicate.profiles.push({ ...duplicate.profiles[0] });
    const missing = structuredClone(before);
    missing.posts[0].authorId = 'missing-profile';
    const wrongSchema = { ...before, schemaVersion: 99 };
    assert.throws(
      () => ctx.store.importState(duplicate, false),
      /Duplicate id/,
    );
    assert.throws(
      () => ctx.store.importState(missing, false),
      /missing record|FOREIGN KEY/i,
    );
    assert.throws(
      () => ctx.store.importState(wrongSchema, false),
      /schemaVersion/,
    );
    assert.deepEqual(ctx.store.getState(), before);
  } finally {
    await closeAndRemove(ctx);
  }
});

test('deleting a post cascades its comments and likes', async () => {
  const ctx = await tempStore();
  try {
    ctx.store.put('comments', {
      id: 'cascade-comment',
      postId: 'post1',
      authorId: 'p2',
      body: 'Temporary',
      createdAt: '2010-03-18T10:01:00Z',
    });
    ctx.store.put('likes', {
      id: 'cascade-like',
      postId: 'post1',
      profileId: 'p2',
    });
    ctx.store.remove('posts', 'post1');
    const state = ctx.store.getState();
    assert.equal(
      state.posts.some((p) => p.id === 'post1'),
      false,
    );
    assert.equal(
      state.comments.some((c) => c.id === 'cascade-comment'),
      false,
    );
    assert.equal(
      state.likes.some((l) => l.id === 'cascade-like'),
      false,
    );
  } finally {
    await closeAndRemove(ctx);
  }
});

test('successful imports create an exact backup and invalid imports do not', async () => {
  const ctx = await tempStore();
  try {
    const before = ctx.store.getState();
    const replacement = structuredClone(before);
    replacement.profiles[0].name = 'Imported Name';
    ctx.store.importState(replacement, true);
    const filesAfterValid = (await readdir(ctx.dir)).filter(
      (name) => name.startsWith('backup-') && name.endsWith('.json'),
    );
    assert.equal(filesAfterValid.length, 1);
    assert.deepEqual(
      JSON.parse(await readFile(join(ctx.dir, filesAfterValid[0]), 'utf8')),
      JSON.parse(JSON.stringify(before)),
    );
    const invalid = structuredClone(replacement);
    invalid.schemaVersion = 2;
    assert.throws(() => ctx.store.importState(invalid, true), /schemaVersion/);
    const filesAfterInvalid = (await readdir(ctx.dir)).filter(
      (name) => name.startsWith('backup-') && name.endsWith('.json'),
    );
    assert.deepEqual(filesAfterInvalid, filesAfterValid);
  } finally {
    await closeAndRemove(ctx);
  }
});

test('image validation accepts bundled assets and rejects missing or remote images', async () => {
  const ctx = await tempStore();
  try {
    ctx.store.put('profiles', {
      ...profile('p10'),
      avatar: '/assets/avatar-2.jpg',
    });
    assert.throws(
      () =>
        ctx.store.put('profiles', {
          ...profile('p11'),
          avatar: '/assets/no-such-avatar.jpg',
        }),
      /Bundled image does not exist/,
    );
    assert.throws(
      () =>
        ctx.store.put('profiles', {
          ...profile('p12'),
          avatar: 'https://example.com/avatar.jpg',
        }),
      /Images must be bundled/,
    );
    assert.throws(
      () =>
        ctx.store.put('photos', {
          id: 'remote-photo',
          ownerId: 'p1',
          album: 'x',
          caption: 'x',
          src: 'https://example.com/photo.jpg',
          createdAt: '2010-03-18T10:00:00Z',
        }),
      /Images must be bundled/,
    );
  } finally {
    await closeAndRemove(ctx);
  }
});
