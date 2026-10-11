import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../server/store.mjs';
import {
  exportProfilePackage,
  importProfilePackage,
} from '../server/profile-package.mjs';

test('photo feedback validates, roundtrips, unlikes and cascades without creating posts', (t) => {
  const source = createStore(':memory:');
  const target = createStore(':memory:', { seed: false });
  t.after(() => {
    source.close();
    target.close();
  });
  const photo = source.getState().photos.find((row) => row.ownerId !== 'p1');
  const postCount = source.getState().posts.length;
  const like = source.writeResult('photoLikes', {
    photoId: photo.id,
    profileId: 'p1',
  }).record;
  const comment = source.writeResult('photoComments', {
    photoId: photo.id,
    authorId: 'p1',
    body: 'Great shot!',
    createdAt: '2010-03-25T12:00:00Z',
  }).record;
  assert.equal(source.getState().posts.length, postCount);
  assert.throws(
    () => source.put('photoLikes', { photoId: photo.id, profileId: 'p1' }),
    /UNIQUE/,
  );
  assert.throws(
    () => source.put('photoLikes', { photoId: 'missing', profileId: 'p1' }),
    /FOREIGN KEY/,
  );
  assert.throws(
    () =>
      source.put('photoComments', {
        photoId: photo.id,
        authorId: 'missing',
        body: 'Hi',
        createdAt: '2010-03-25T12:00:00Z',
      }),
    /FOREIGN KEY/,
  );
  assert.throws(
    () =>
      source.put('photoComments', {
        photoId: photo.id,
        authorId: 'p1',
        body: '  ',
      }),
    /empty/,
  );
  const exported = source.exportState();
  target.importState(exported);
  assert.equal(target.get('photoComments', comment.id).body, 'Great shot!');
  assert.equal(target.get('photoLikes', like.id).profileId, 'p1');
  delete exported.photoLikes;
  delete exported.photoComments;
  target.importState(exported);
  assert.equal(target.getState().photoLikes.length, 0);
  importProfilePackage(
    target,
    exportProfilePackage(source, 'p1').buffer,
    'merge',
  );
  assert.equal(target.getState().photoLikes.length, 1);
  assert.equal(target.getState().photoComments.length, 1);
  source.remove('photoLikes', like.id);
  assert.equal(source.getState().photoLikes.length, 0);
  source.put('photoLikes', { photoId: photo.id, profileId: 'p1' });
  source.remove('photos', photo.id);
  assert.equal(source.getState().photoLikes.length, 0);
  assert.equal(source.getState().photoComments.length, 0);
});

test('existing databases add photo feedback tables and preserve reactions across restart', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'phasebook-photo-feedback-'));
  const filename = join(dir, 'world.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const initial = createStore(filename);
  const photo = initial.getState().photos[0];
  const caption = photo.caption;
  initial.db.exec(
    'DROP TABLE photoLikes; DROP TABLE photoComments; PRAGMA user_version=8;',
  );
  initial.close();
  const upgraded = createStore(filename);
  assert.equal(
    upgraded.db.prepare('PRAGMA user_version').get().user_version,
    9,
  );
  assert.equal(upgraded.get('photos', photo.id).caption, caption);
  const like = upgraded.put('photoLikes', {
    photoId: photo.id,
    profileId: 'p1',
  });
  upgraded.close();
  const reopened = createStore(filename);
  try {
    assert.equal(reopened.get('photoLikes', like.id).photoId, photo.id);
  } finally {
    reopened.close();
  }
});
