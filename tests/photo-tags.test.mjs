import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/store.mjs';
import {
  exportProfilePackage,
  importProfilePackage,
} from '../server/profile-package.mjs';

test('photo tags validate references, reject duplicates, survive exports and cascade on deletion', (t) => {
  const source = createStore(':memory:');
  const target = createStore(':memory:', { seed: false });
  t.after(() => {
    source.close();
    target.close();
  });
  const photo = source.getState().photos.find((row) => row.ownerId !== 'p1');
  const tag = source.put('photoTags', { photoId: photo.id, profileId: 'p1' });
  assert.throws(
    () => source.put('photoTags', { photoId: photo.id, profileId: 'p1' }),
    /UNIQUE/,
  );
  assert.throws(
    () => source.put('photoTags', { photoId: photo.id, profileId: 'missing' }),
    /FOREIGN KEY/,
  );
  const exported = source.exportState();
  target.importState(exported);
  assert.equal(target.getState().photoTags.length, 1);
  assert.equal(target.get('photoTags', tag.id).photoId, photo.id);
  const older = structuredClone(exported);
  delete older.photoTags;
  target.importState(older);
  assert.equal(target.getState().photoTags.length, 0);
  const pkg = exportProfilePackage(source, 'p1');
  importProfilePackage(target, pkg.buffer, 'merge');
  assert.equal(target.getState().photoTags.length, 1);
  source.remove('photos', photo.id);
  assert.equal(source.getState().photoTags.length, 0);
  const otherPhoto = source.getState().photos[0];
  const removable = source.put('photoTags', {
    photoId: otherPhoto.id,
    profileId: 'p2',
  });
  source.remove('photoTags', removable.id);
  assert.equal(source.getState().photoTags.length, 0);
});
