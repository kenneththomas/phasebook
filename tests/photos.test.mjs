import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../server/store.mjs';
import { photoAction } from '../server/photos.mjs';
import { photoTables } from '../server/schema.mjs';
import {
  exportProfilePackage,
  importProfilePackage,
  validateProfilePackage,
  createArchive,
  unzip,
} from '../server/profile-package.mjs';
import {
  writeWorldPackage,
  importWorldPackage,
} from '../server/world-package.mjs';
import { createApp } from '../server/index.mjs';

const date = '2026-09-26T12:00:00.000Z';
function setup(t) {
  const s = createStore(':memory:');
  t.after(() => s.close());
  return s;
}
function publish(s, count = 2) {
  const mediaId = s.getState().photos[0].mediaId;
  const before = new Set(s.getState().photos.map((p) => p.id));
  photoAction(s, 'publish', {
    ownerId: 'p1',
    name: 'Photo test album',
    description: 'A trip',
    location: 'Boston',
    share: true,
    photos: Array.from({ length: count }, (_, i) => ({
      mediaId,
      caption: `Photo ${i + 1}`,
    })),
  });
  return s.getState().photos.filter((p) => !before.has(p.id));
}
function activity(s, photo) {
  const like = s.write('photoLikes', { photoId: photo.id, profileId: 'p2' });
  const comment = s.write('photoComments', {
    photoId: photo.id,
    authorId: 'p2',
    body: 'Keep this memory',
    createdAt: date,
  });
  const tag = s.write('photoTags', {
    photoId: photo.id,
    profileId: 'p2',
    actorId: 'p1',
    x: 3500,
    y: 4000,
    createdAt: date,
  });
  return { like, comment, tag };
}

test('batch publishing makes one album story and rolls back invalid batches completely', (t) => {
  const s = setup(t),
    postCount = s.getState().posts.length;
  const photos = publish(s);
  assert.equal(s.getState().posts.length, postCount + 1);
  assert.deepEqual(
    s.getState().postPhotos.map((p) => p.photoId),
    photos.map((p) => p.id),
  );
  assert.equal(
    s.get('albums', photos[0].albumId).coverMediaId,
    photos[0].mediaId,
  );
  const before = s.getState();
  assert.throws(() =>
    photoAction(s, 'publish', {
      ownerId: 'p1',
      name: 'Bad batch',
      photos: [{ mediaId: photos[0].mediaId }, { mediaId: 'missing' }],
      share: true,
    }),
  );
  assert.deepEqual(s.getState(), before);
  assert.throws(
    () =>
      photoAction(s, 'publish', {
        ownerId: 'p2',
        albumId: photos[0].albumId,
        photos: [{ mediaId: photos[0].mediaId }],
      }),
    /uploader/,
  );
});

test('moving, reordering and using a profile picture preserve all photo and post activity', (t) => {
  const s = setup(t),
    [photo, second] = publish(s),
    records = activity(s, photo);
  const post = s.getState().posts.find((p) => p.photoId === photo.id);
  const oldComment = s.write('comments', {
    postId: post.id,
    authorId: 'p2',
    body: 'Post discussion',
    createdAt: date,
  });
  const oldLike = s.write('likes', { postId: post.id, profileId: 'p2' });
  photoAction(s, 'reorder', {
    albumId: photo.albumId,
    ids: [second.id, photo.id],
  });
  assert.equal(s.get('photos', photo.id).position, 2);
  const album = s.put('albums', {
    ownerId: 'p1',
    name: 'Destination',
    coverMediaId: null,
    createdAt: date,
  });
  photoAction(s, 'move', { photoId: photo.id, albumId: album.id });
  photoAction(s, 'profile-picture', { photoId: photo.id, profileId: 'p1' });
  assert.equal(s.get('photos', photo.id).externalId, photo.externalId);
  assert.equal(s.get('photos', photo.id).albumId, album.id);
  assert.deepEqual({ ...s.get('photoLikes', records.like.id) }, records.like);
  assert.deepEqual(
    { ...s.get('photoComments', records.comment.id) },
    records.comment,
  );
  assert.deepEqual({ ...s.get('photoTags', records.tag.id) }, records.tag);
  assert.deepEqual({ ...s.get('comments', oldComment.id) }, oldComment);
  assert.deepEqual({ ...s.get('likes', oldLike.id) }, oldLike);
  assert.equal(s.get('profiles', 'p1').avatarMediaId, photo.mediaId);
  assert.ok(s.getState().profilePictures.some((p) => p.photoId === photo.id));
  assert.equal(s.get('albums', photo.albumId).coverMediaId, null);
  const before = s.getState();
  assert.throws(
    () =>
      photoAction(s, 'reorder', {
        albumId: album.id,
        ids: [photo.id, photo.id],
      }),
    /changed/,
  );
  assert.deepEqual(s.getState(), before);
});

test('photo activity validates references and uniqueness and notifications link to photos', (t) => {
  const s = setup(t),
    [photo] = publish(s),
    records = activity(s, photo);
  assert.equal(
    s.getState().notifications.filter((n) => n.photoId === photo.id).length,
    3,
  );
  assert.throws(
    () => s.write('photoLikes', { photoId: photo.id, profileId: 'p2' }),
    /UNIQUE/,
  );
  assert.throws(
    () =>
      s.write('photoTags', {
        ...records.tag,
        id: 'another',
        externalId: 'another',
      }),
    /UNIQUE/,
  );
  assert.throws(
    () => s.write('photoTags', { ...records.tag, x: 10001 }),
    /coordinates/,
  );
  const before = s.getState();
  assert.throws(() =>
    s.write('photoComments', {
      photoId: 'missing',
      authorId: 'p2',
      body: 'Invalid',
      createdAt: date,
    }),
  );
  assert.deepEqual(s.getState(), before);
});

test('deletion requires confirmation and active ownership; moves survive old album deletion', (t) => {
  const s = setup(t),
    [photo, second] = publish(s);
  activity(s, photo);
  activity(s, second);
  const destination = s.put('albums', {
    ownerId: 'p1',
    name: 'Keep',
    coverMediaId: null,
    createdAt: date,
  });
  photoAction(s, 'move', { photoId: photo.id, albumId: destination.id });
  assert.throws(
    () => photoAction(s, 'delete-album', { id: photo.albumId }),
    /confirm/,
  );
  s.switchProfile('p2');
  assert.throws(
    () => photoAction(s, 'delete-album', { id: photo.albumId, confirm: true }),
    /owner/,
  );
  s.switchProfile('p1');
  photoAction(s, 'delete-album', { id: photo.albumId, confirm: true });
  assert.ok(s.get('photos', photo.id));
  assert.equal(
    s.getState().photoComments.filter((c) => c.photoId === photo.id).length,
    1,
  );
  assert.equal(s.get('photos', second.id), undefined);
  assert.equal(
    s.getState().photoComments.filter((c) => c.photoId === second.id).length,
    0,
  );
  assert.ok(s.getState().posts.some((p) => p.photoId === photo.id));
});

test('photo records and their activity survive profile and world packages', async (t) => {
  const s = setup(t),
    [photo] = publish(s);
  activity(s, photo);
  const pkg = exportProfilePackage(s, 'p1');
  const parsed = validateProfilePackage(pkg.buffer);
  assert.equal(parsed.data.entities.photoComments.length, 1);
  const target = setup(t);
  importProfilePackage(target, pkg.buffer, 'new');
  assert.equal(
    target.getState().photoComments.filter((c) => c.body === 'Keep this memory')
      .length,
    1,
  );
  const dir = mkdtempSync(join(tmpdir(), 'phasebook-photo-package-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'photos.phasebook');
  await writeWorldPackage(s, path);
  await importWorldPackage(target, path, dir);
  assert.deepEqual(target.getState().photoTags, s.getState().photoTags);
  assert.deepEqual(target.getState().photoComments, s.getState().photoComments);
  assert.deepEqual(target.getState().postPhotos, s.getState().postPhotos);
});

test('older world and profile exports remain compatible', (t) => {
  const s = setup(t),
    old = s.exportState();
  for (const table of photoTables) delete old[table];
  for (const a of old.albums) {
    delete a.description;
    delete a.location;
  }
  for (const p of old.photos) delete p.position;
  for (const n of old.notifications) delete n.photoId;
  s.importState(old, false);
  assert.deepEqual(s.getState().photoTags, []);
  const pkg = exportProfilePackage(s, 'p1'),
    files = unzip(pkg.buffer),
    data = JSON.parse(files.get('data.json'));
  for (const table of photoTables) delete data.entities[table];
  for (const a of data.entities.albums) {
    delete a.description;
    delete a.location;
  }
  for (const p of data.entities.photos) delete p.position;
  files.set('data.json', Buffer.from(JSON.stringify(data)));
  assert.doesNotThrow(() => validateProfilePackage(createArchive([...files])));
});

test('v9 migration preserves original photos and post discussions and creates a backup', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'phasebook-photo-migration-')),
    path = join(dir, 'world.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let s = createStore(path);
  const original = s.getState();
  for (const table of [...photoTables].reverse())
    s.db.exec(`DROP TABLE ${table}`);
  s.db.exec(
    'ALTER TABLE albums DROP COLUMN description; ALTER TABLE albums DROP COLUMN location; ALTER TABLE photos DROP COLUMN position; ALTER TABLE notifications DROP COLUMN photoId; PRAGMA user_version=9;',
  );
  s.close();
  s = createStore(path);
  assert.deepEqual(s.getState().photos, original.photos);
  assert.deepEqual(s.getState().comments, original.comments);
  assert.deepEqual(s.getState().likes, original.likes);
  assert.equal(s.db.prepare('PRAGMA user_version').get().user_version, 11);
  assert.ok(readdirSync(dir).some((f) => f.startsWith('migration-v9-')));
  s.close();
});

test('photo HTTP publishing and moving return canonical state and validation failures roll back', async (t) => {
  const s = setup(t),
    server = createApp(s);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/photos/`;
  const mediaId = s.getState().photos[0].mediaId;
  const response = await fetch(base + 'publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ownerId: 'p1',
      name: 'HTTP album',
      photos: [{ id: 'http-photo', mediaId }],
    }),
  });
  assert.equal(response.status, 200);
  assert.ok((await response.json()).photos.some((p) => p.id === 'http-photo'));
  const before = s.getState();
  const bad = await fetch(base + 'move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photoId: 'http-photo', albumId: 'missing' }),
  });
  assert.equal(bad.status, 400);
  assert.deepEqual(s.getState(), before);
});
