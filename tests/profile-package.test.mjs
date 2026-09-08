import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createStore } from '../server/store.mjs';
import { createApp } from '../server/index.mjs';
import {
  createArchive,
  exportProfilePackage,
  importProfilePackage,
  previewProfilePackage,
  unzip,
  validateProfilePackage,
} from '../server/profile-package.mjs';

const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHioAAAAASUVORK5CYII=';
const json = (files, name) => JSON.parse(files.get(name).toString('utf8'));
const memory = (t, seed = true) => {
  const store = createStore(':memory:', { seed });
  t.after(() => store.close());
  return store;
};
const emptyProfile = (externalId, name = 'Portable Person') => ({
  externalId,
  name,
  bio: '',
  city: '',
  hometown: '',
  education: '',
  work: '',
  birthday: '',
  relationship: '',
  interests: '',
  avatarMediaId: null,
});

test('profile-only package contains portable JSON without local ids', (t) => {
  const source = memory(t, false);
  const root = source.hydrateProfile(
    'profile_only',
    emptyProfile('profile_only'),
  );
  const exported = exportProfilePackage(
    source,
    root.id,
    new Date('2026-09-08T12:00:00Z'),
  );
  assert.equal(exported.filename, 'Portable-Person.phasebook');
  const files = unzip(exported.buffer),
    manifest = json(files, 'manifest.json');
  const data = json(files, 'data.json');
  assert.deepEqual([...files.keys()], ['manifest.json', 'data.json']);
  assert.equal(manifest.format, 'phasebook-package');
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.rootProfileExternalId, 'profile_only');
  assert.equal(data.rootProfile.id, undefined);
  assert.equal(JSON.stringify(data).includes('base64'), false);
  assert.ok(Object.values(data.entities).every((rows) => rows.length === 0));
});

test('local and bundled images are carried while remote images remain references', (t) => {
  const source = memory(t, false);
  const local = source.createMedia({
    sourceType: 'local',
    dataUrl: png,
    originalFilename: '../../face.png',
  });
  const remote = source.createMedia({
    sourceType: 'remote',
    sourceLocation: 'https://example.com/remote.png',
  });
  const root = source.hydrateProfile('media_root', {
    ...emptyProfile('media_root'),
    avatarMediaId: local.id,
  });
  const album = source.put('albums', {
    ownerId: root.id,
    name: 'Remote',
    coverMediaId: remote.id,
    createdAt: '2026-09-08T12:00:00Z',
  });
  source.put('photos', {
    ownerId: root.id,
    albumId: album.id,
    caption: 'Remote photo',
    mediaId: remote.id,
    createdAt: '2026-09-08T12:00:00Z',
  });
  const exported = exportProfilePackage(source, root.id),
    parsed = validateProfilePackage(exported.buffer);
  assert.equal(parsed.manifest.mediaCount, 1);
  const localRow = parsed.data.entities.media.find(
    (m) => m.externalId === local.externalId,
  );
  const remoteRow = parsed.data.entities.media.find(
    (m) => m.externalId === remote.externalId,
  );
  assert.match(localRow.sourceLocation, /^media\//);
  assert.equal(
    parsed.files.get(localRow.sourceLocation).toString('base64'),
    png.split(',')[1],
  );
  assert.equal(remoteRow.sourceType, 'remote');
  assert.equal(remoteRow.sourceLocation, 'https://example.com/remote.png');
});

test('import creates stubs, reuses references, and preserves wall/friend edges', (t) => {
  const source = memory(t, false);
  const alice = source.hydrateProfile(
    'alice_ext',
    emptyProfile('alice_ext', 'Alice'),
  );
  const bob = source.hydrateProfile('bob_ext', emptyProfile('bob_ext', 'Bob'));
  source.put('posts', {
    externalId: 'alice_post',
    authorId: alice.id,
    wallId: bob.id,
    groupId: null,
    photoId: null,
    body: 'On Bob’s wall',
    createdAt: '2026-09-08T12:00:00Z',
  });
  source.put('friendships', {
    externalId: 'alice_friend',
    profileId: alice.id,
    friendId: bob.id,
    status: 'accepted',
  });
  const pkg = exportProfilePackage(source, alice.id),
    target = memory(t, false);
  const preview = previewProfilePackage(target, pkg.buffer);
  assert.equal(preview.profile.status, 'new');
  assert.equal(preview.newStubs, 1);
  importProfilePackage(target, pkg.buffer, 'merge');
  const importedAlice = target.resolveExternal('profiles', 'alice_ext');
  const importedBob = target.resolveExternal('profiles', 'bob_ext');
  assert.equal(importedAlice.state, 'full');
  assert.equal(importedBob.state, 'stub');
  assert.equal(
    target.resolveExternal('posts', 'alice_post').wallId,
    importedBob.id,
  );
  assert.equal(
    target.resolveExternal('friendships', 'alice_friend').friendId,
    importedBob.id,
  );

  const existingTarget = memory(t, false);
  const existingBob = existingTarget.hydrateProfile(
    'bob_ext',
    emptyProfile('bob_ext', 'Robert'),
  );
  importProfilePackage(existingTarget, pkg.buffer, 'merge');
  assert.equal(
    existingTarget.resolveExternal('profiles', 'bob_ext').id,
    existingBob.id,
  );
  assert.equal(
    existingTarget.resolveExternal('profiles', 'bob_ext').name,
    'Robert',
  );
});

test('matching root stub hydrates in place and full root requires a conflict choice', (t) => {
  const source = memory(t, false);
  const root = source.hydrateProfile('root_conflict', {
    ...emptyProfile('root_conflict', 'Imported Name'),
    city: 'Boston',
  });
  const pkg = exportProfilePackage(source, root.id);
  const stubTarget = memory(t, false),
    stub = stubTarget.ensureProfileStub('root_conflict', 'Hint');
  assert.equal(
    previewProfilePackage(stubTarget, pkg.buffer).profile.status,
    'stub',
  );
  importProfilePackage(stubTarget, pkg.buffer, 'merge');
  assert.equal(
    stubTarget.resolveExternal('profiles', 'root_conflict').id,
    stub.id,
  );
  assert.equal(
    stubTarget.resolveExternal('profiles', 'root_conflict').city,
    'Boston',
  );

  const fullTarget = memory(t, false);
  const original = fullTarget.hydrateProfile(
    'root_conflict',
    emptyProfile('root_conflict', 'Local Name'),
  );
  assert.equal(
    previewProfilePackage(fullTarget, pkg.buffer).profile.status,
    'conflict',
  );
  assert.throws(
    () => importProfilePackage(fullTarget, pkg.buffer, 'cancel'),
    /Choose merge/,
  );
  assert.equal(
    fullTarget.resolveExternal('profiles', 'root_conflict').name,
    'Local Name',
  );
  importProfilePackage(fullTarget, pkg.buffer, 'merge');
  assert.equal(
    fullTarget.resolveExternal('profiles', 'root_conflict').id,
    original.id,
  );
  assert.equal(
    fullTarget.resolveExternal('profiles', 'root_conflict').name,
    'Imported Name',
  );
});

test('import as new remaps root and every internal portable identity', (t) => {
  const source = memory(t, false);
  const root = source.hydrateProfile(
    'duplicate_root',
    emptyProfile('duplicate_root', 'Duplicate'),
  );
  source.put('posts', {
    externalId: 'duplicate_post',
    authorId: root.id,
    wallId: root.id,
    groupId: null,
    photoId: null,
    body: 'Mine',
    createdAt: '2026-09-08T12:00:00Z',
  });
  const pkg = exportProfilePackage(source, root.id),
    target = memory(t, false);
  target.hydrateProfile(
    'duplicate_root',
    emptyProfile('duplicate_root', 'Original'),
  );
  const result = importProfilePackage(target, pkg.buffer, 'new');
  assert.notEqual(result.rootProfileExternalId, 'duplicate_root');
  const imported = target.resolveExternal(
    'profiles',
    result.rootProfileExternalId,
  );
  const posts = target
    .getState()
    .posts.filter((p) => p.authorId === imported.id);
  assert.equal(posts.length, 1);
  assert.notEqual(posts[0].externalId, 'duplicate_post');
  assert.equal(posts[0].wallId, imported.id);
});

test('media survives import and semantic data survives a round trip', (t) => {
  const source = memory(t, false);
  const media = source.createMedia({
    sourceType: 'local',
    dataUrl: png,
    originalFilename: 'avatar.png',
  });
  const root = source.hydrateProfile('roundtrip_root', {
    ...emptyProfile('roundtrip_root'),
    avatarMediaId: media.id,
  });
  const first = exportProfilePackage(source, root.id),
    target = memory(t, false);
  importProfilePackage(target, first.buffer, 'merge');
  const importedMedia = target.resolveExternal('media', media.externalId);
  assert.equal(
    readFileSync(target.mediaFile(importedMedia.id).path).toString('base64'),
    png.split(',')[1],
  );
  const second = exportProfilePackage(
    target,
    target.resolveExternal('profiles', 'roundtrip_root').id,
  );
  const normalize = (data) => {
    const copy = structuredClone(data);
    for (const row of copy.entities.media)
      if (row.sourceType === 'local') row.sourceLocation = '<packaged-media>';
    return copy;
  };
  assert.deepEqual(
    normalize(validateProfilePackage(second.buffer).data),
    normalize(validateProfilePackage(first.buffer).data),
  );
});

test('ambiguous media external-id collisions are remapped without overwriting', (t) => {
  const source = memory(t, false);
  const media = source.createMedia({
    externalId: 'shared_media_identity',
    sourceType: 'remote',
    sourceLocation: 'https://example.com/incoming.png',
  });
  const root = source.hydrateProfile('media_collision_root', {
    ...emptyProfile('media_collision_root'),
    avatarMediaId: media.id,
  });
  const pkg = exportProfilePackage(source, root.id),
    target = memory(t, false);
  const localMedia = target.createMedia({
    externalId: 'shared_media_identity',
    sourceType: 'remote',
    sourceLocation: 'https://example.com/local.png',
  });
  importProfilePackage(target, pkg.buffer, 'merge');
  assert.equal(
    target.resolveExternal('media', 'shared_media_identity').sourceLocation,
    'https://example.com/local.png',
  );
  const importedRoot = target.resolveExternal(
    'profiles',
    'media_collision_root',
  );
  assert.notEqual(importedRoot.avatarMediaId, localMedia.id);
  assert.equal(
    target.get('media', importedRoot.avatarMediaId).sourceLocation,
    'https://example.com/incoming.png',
  );
});

test('unsafe/missing media is rejected and a mid-import media failure rolls back', (t) => {
  const source = memory(t, false);
  const media = source.createMedia({ sourceType: 'local', dataUrl: png });
  const root = source.hydrateProfile('rollback_root', {
    ...emptyProfile('rollback_root'),
    avatarMediaId: media.id,
  });
  const valid = exportProfilePackage(source, root.id),
    files = unzip(valid.buffer);
  const manifest = files.get('manifest.json'),
    dataBytes = files.get('data.json');
  const data = JSON.parse(dataBytes.toString('utf8')),
    mediaPath = data.entities.media[0].sourceLocation;
  assert.throws(
    () =>
      validateProfilePackage(
        createArchive([
          ['manifest.json', manifest],
          ['data.json', dataBytes],
          ['../evil.png', files.get(mediaPath)],
        ]),
      ),
    /Unsafe/,
  );
  assert.throws(
    () =>
      validateProfilePackage(
        createArchive([
          ['manifest.json', manifest],
          ['data.json', dataBytes],
        ]),
      ),
    /missing or unsafe/,
  );

  const broken = createArchive([
    ['manifest.json', manifest],
    ['data.json', dataBytes],
    [mediaPath, Buffer.from('not a png')],
  ]);
  const target = memory(t, false),
    beforeFiles = readdirSync(target.mediaDir);
  assert.throws(() => validateProfilePackage(broken), /image|PNG|JPEG|WebP/i);
  const hydrate = target.hydrateProfile;
  target.hydrateProfile = () => {
    throw new Error('injected mid-import failure');
  };
  assert.throws(
    () => importProfilePackage(target, valid.buffer, 'merge'),
    /injected mid-import failure/,
  );
  target.hydrateProfile = hydrate;
  assert.equal(target.getState().profiles.length, 0);
  assert.deepEqual(readdirSync(target.mediaDir), beforeFiles);
});

test('HTTP workflow moves a realistic profile between two existing worlds', async (t) => {
  const source = memory(t),
    target = memory(t);
  const sourceServer = createApp(source).listen(0, '127.0.0.1');
  const targetServer = createApp(target).listen(0, '127.0.0.1');
  t.after(
    () =>
      new Promise((resolve) =>
        sourceServer.close(() => targetServer.close(resolve)),
      ),
  );
  await Promise.all(
    [sourceServer, targetServer].map(
      (server) => new Promise((resolve) => server.once('listening', resolve)),
    ),
  );
  const sourceBase = `http://127.0.0.1:${sourceServer.address().port}`;
  const targetBase = `http://127.0.0.1:${targetServer.address().port}`;
  const root = source.getState().profiles[0];
  const response = await fetch(
    sourceBase + '/api/profile-packages/' + encodeURIComponent(root.id),
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /\.phasebook"$/);
  const archive = Buffer.from(await response.arrayBuffer());
  const preview = await fetch(targetBase + '/api/profile-packages/preview', {
    method: 'POST',
    body: archive,
  });
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).profile.status, 'new');
  const imported = await fetch(
    targetBase + '/api/profile-packages/import?strategy=merge',
    { method: 'POST', body: archive },
  );
  assert.equal(imported.status, 200, await imported.clone().text());
  const result = await imported.json();
  const importedRoot = target.resolveExternal('profiles', root.externalId);
  assert.equal(result.rootProfileId, importedRoot.id);
  assert.ok(
    target.getState().posts.some((post) => post.authorId === importedRoot.id),
  );
  const avatar = target.get('media', importedRoot.avatarMediaId);
  const image = await fetch(targetBase + '/api/media/' + avatar.id);
  assert.equal(image.status, 200);
  assert.ok((await image.arrayBuffer()).byteLength > 0);
});
