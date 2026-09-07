import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, tables } from '../server/store.mjs';
import { schema as legacySchema } from '../server/legacy-schema.mjs';
import { createApp } from '../server/index.mjs';

const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHioAAAAASUVORK5CYII=';
const fixture = () =>
  JSON.parse(readFileSync(new URL('../db/seed.json', import.meta.url), 'utf8'));
function temp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'phasebook-portable-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function memory(t) {
  const s = createStore(':memory:');
  t.after(() => s.close());
  return s;
}
function legacyDB(filename, value) {
  const db = new DatabaseSync(filename);
  for (const [table, fields] of Object.entries(legacySchema)) {
    db.exec(
      `CREATE TABLE ${table} (id TEXT PRIMARY KEY NOT NULL, ${Object.entries(
        fields,
      )
        .map(([k, v]) => `${k} ${v}`)
        .join(',')})`,
    );
    const keys = ['id', ...Object.keys(fields)];
    for (const row of value[table])
      db.prepare(
        `INSERT INTO ${table} VALUES (${keys.map(() => '?').join(',')})`,
      ).run(...keys.map((k) => row[k]));
  }
  db.exec(
    'CREATE TABLE settings (id INTEGER PRIMARY KEY, activeProfileId TEXT NOT NULL); PRAGMA user_version=1;',
  );
  db.prepare('INSERT INTO settings VALUES (1,?)').run(
    value.settings.activeProfileId,
  );
  db.close();
}
test('every portable table has stable independent identities and rejects duplicates', (t) => {
  const s = memory(t);
  for (const table of tables)
    for (const row of s.getState()[table]) {
      assert.match(row.externalId, /^[0-9a-f-]{36}$/);
      assert.notEqual(row.externalId, row.id);
      assert.equal(s.resolveExternal(table, row.externalId).id, row.id);
      assert.throws(
        () => s.put(table, { ...row, id: 'duplicate' }),
        /Duplicate external id/,
      );
    }
  const row = s.getState().profiles[0];
  assert.equal(
    s.put('profiles', { ...row, name: 'Updated' }).externalId,
    row.externalId,
  );
  assert.throws(
    () => s.put('profiles', { ...row, externalId: 'replacement' }),
    /identity cannot/,
  );
  const state = s.getState();
  state.profiles[1].externalId = state.profiles[0].externalId;
  assert.throws(() => s.importState(state), /Duplicate external id/);
  assert.equal(s.get('profiles', row.id).name, 'Updated');
});
test('unresolved references create stubs and hydrate without changing relationships', (t) => {
  const s = memory(t);
  const alice = s.get('profiles', 'p1');
  const post = s.putExternal('posts', {
    externalId: 'post_portable',
    authorId: 'usr_bob',
    wallId: alice.externalId,
    groupId: null,
    photoId: null,
    body: 'Hello Alice',
    createdAt: '2026-09-07T12:00:00Z',
  });
  const bob = s.resolveExternal('profiles', 'usr_bob');
  assert.equal(bob.state, 'stub');
  assert.equal(post.authorId, bob.id);
  assert.equal(s.ensureProfileStub('usr_bob', 'Other hint').id, bob.id);
  s.put('friendships', {
    id: 'friend_stub',
    profileId: alice.id,
    friendId: bob.id,
    status: 'accepted',
  });
  s.switchProfile(bob.id);
  const full = s.hydrateProfile('usr_bob', { name: 'Bob', city: 'Boston' });
  assert.equal(full.id, bob.id);
  assert.equal(full.state, 'full');
  assert.equal(s.get('posts', post.id).authorId, bob.id);
  assert.equal(s.get('friendships', 'friend_stub').friendId, bob.id);
  assert.equal(s.getState().settings.activeProfileId, bob.id);
  assert.equal(s.db.prepare('PRAGMA foreign_key_check').all().length, 0);
  assert.throws(
    () => s.put('profiles', { ...full, state: 'stub' }),
    /downgraded/,
  );
  assert.throws(
    () => s.hydrateProfile('usr_bob', { id: 'wrong', name: 'Wrong' }),
    /identity mismatch/,
  );
});
test('full creation hydrates matching stub and failed portable writes roll back stubs', (t) => {
  const s = memory(t);
  const stub = s.ensureProfileStub('usr_missing', 'Name hint');
  const full = s.put('profiles', {
    id: 'new-local-id',
    externalId: stub.externalId,
    name: 'Full Name',
  });
  assert.equal(full.id, stub.id);
  assert.equal(s.get('profiles', 'new-local-id'), undefined);
  assert.throws(
    () =>
      s.putExternal('posts', {
        externalId: 'bad_post',
        authorId: 'unresolved_author',
        wallId: null,
        groupId: 'missing_group',
        photoId: null,
        body: 'Bad',
        createdAt: '2026-09-07',
      }),
    /Unresolved groups/,
  );
  assert.equal(s.resolveExternal('profiles', 'unresolved_author'), undefined);
});
test('local, remote, and bundled media share references; unsafe media is rejected', (t) => {
  const s = memory(t);
  const local = s.createMedia({
    sourceType: 'local',
    dataUrl: png,
    originalFilename: '../../avatar.png',
  });
  assert.match(local.sourceLocation, /^[0-9a-f-]{36}\.png$/);
  assert.equal(
    readFileSync(s.mediaFile(local.id).path).toString('base64'),
    png.split(',')[1],
  );
  const remote = s.createMedia({
    sourceType: 'remote',
    sourceLocation: 'https://example.com/image.png?size=large',
  });
  const bundled = s.createMedia({
    sourceType: 'bundled',
    sourceLocation: '/assets/avatar-1.jpg',
  });
  for (const media of [local, remote, bundled]) {
    s.put('profiles', { ...s.get('profiles', 'p1'), avatarMediaId: media.id });
    assert.equal(s.get('profiles', 'p1').avatarMediaId, media.id);
    assert.throws(() => s.remove('media', media.id), /FOREIGN KEY/);
  }
  assert.equal(readdirSync(s.mediaDir).length, 1); // remote was never fetched
  for (const url of [
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:image/png;base64,abc',
    'https://user:password@example.com/a.png',
  ])
    assert.throws(
      () => s.createMedia({ sourceType: 'remote', sourceLocation: url }),
      /HTTP or HTTPS/,
    );
  assert.throws(
    () =>
      s.createMedia({
        sourceType: 'local',
        dataUrl: 'data:image/png;base64,YWJj',
      }),
    /bytes/,
  );
  assert.throws(
    () => s.put('media', { ...local, sourceLocation: '../outside.png' }),
    /managed media path/,
  );
  assert.throws(
    () =>
      s.createMedia({
        sourceType: 'bundled',
        sourceLocation: '/assets/missing.png',
      }),
    /does not exist/,
  );
  assert.equal(Object.hasOwn(s.get('profiles', 'p1'), 'avatar'), false);
  assert.equal(JSON.stringify(s.getState()).includes('base64,'), false);
});
test('file uploads survive restart and export/import into an independent directory', (t) => {
  const dir = temp(t),
    filename = join(dir, 'world.sqlite');
  let s = createStore(filename);
  const media = s.createMedia({ sourceType: 'local', dataUrl: png });
  s.put('profiles', { ...s.get('profiles', 'p1'), avatarMediaId: media.id });
  s.close();
  s = createStore(filename);
  const exportValue = s.exportState();
  assert.equal(exportValue.mediaFiles[media.externalId], png);
  assert.equal(s.get('profiles', 'p1').avatarMediaId, media.id);
  s.close();
  const target = createStore(join(dir, 'other', 'world.sqlite'));
  try {
    target.importState(exportValue, false);
    const imported = target.resolveExternal('media', media.externalId);
    assert.notEqual(imported.sourceLocation, media.sourceLocation);
    assert.equal(
      readFileSync(target.mediaFile(imported.id).path).toString('base64'),
      png.split(',')[1],
    );
    assert.equal(target.get('profiles', 'p1').avatarMediaId, imported.id);
    const before = target.getState(),
      filesBefore = readdirSync(target.mediaDir);
    const bad = structuredClone(exportValue);
    bad.posts[0].authorId = 'missing';
    assert.throws(() => target.importState(bad), /missing record/);
    assert.deepEqual(target.getState(), before);
    assert.deepEqual(readdirSync(target.mediaDir), filesBefore);
  } finally {
    target.close();
  }
});
test('v1 SQLite migration preserves IDs, relationships and uploads and runs once', (t) => {
  const dir = temp(t),
    filename = join(dir, 'world.sqlite'),
    legacy = fixture();
  legacy.profiles[0].avatar = png;
  legacyDB(filename, legacy);
  let s = createStore(filename);
  const state = s.getState();
  assert.equal(state.schemaVersion, 2);
  assert.equal(state.profiles[0].id, legacy.profiles[0].id);
  assert.equal(state.posts[0].authorId, legacy.posts[0].authorId);
  assert.equal(state.groups[0].creatorId, null);
  assert.ok(state.albums.length);
  assert.equal(
    s.get('media', state.profiles[0].avatarMediaId).sourceType,
    'local',
  );
  for (const p of state.photos) assert.ok(s.get('albums', p.albumId));
  assert.equal(s.db.prepare('PRAGMA foreign_key_check').all().length, 0);
  assert.equal(
    s.db
      .prepare('PRAGMA table_info(profiles)')
      .all()
      .some((c) => c.name === 'avatar'),
    false,
  );
  s.close();
  s = createStore(filename);
  assert.deepEqual(s.getState(), state);
  s.close();
  const backups = readdirSync(dir).filter((f) => f.startsWith('migration-v1-'));
  assert.equal(backups.length, 1);
  const backup = new DatabaseSync(join(dir, backups[0]));
  assert.equal(
    backup
      .prepare('SELECT avatar FROM profiles WHERE id=?')
      .get(legacy.profiles[0].id).avatar,
    png,
  );
  backup.close();
});
test('failed legacy migration leaves original schema and data intact', (t) => {
  const dir = temp(t),
    filename = join(dir, 'bad.sqlite'),
    legacy = fixture();
  legacy.profiles[0].avatar = png;
  legacy.profiles[1].avatar = '/assets/missing.png';
  legacyDB(filename, legacy);
  assert.throws(() => createStore(filename), /original database is unchanged/);
  const db = new DatabaseSync(filename);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
  assert.equal(
    db
      .prepare('SELECT avatar FROM profiles WHERE id=?')
      .get(legacy.profiles[0].id).avatar,
    png,
  );
  db.close();
  assert.deepEqual(readdirSync(join(dir, 'media')), []);
});
test('photo writes create owner-scoped albums atomically', (t) => {
  const s = memory(t);
  const media = s.createMedia({
    sourceType: 'remote',
    sourceLocation: 'https://example.com/test.png',
  });
  const input = {
    ownerId: 'p1',
    mediaId: media.id,
    caption: 'New photo',
    createdAt: '2026-09-07T12:00:00Z',
    albumId: '',
  };
  const first = s.writePhoto(input, 'New album');
  const second = s.writePhoto(input, 'New album');
  const otherOwner = s.writePhoto({ ...input, ownerId: 'p2' }, 'New album');
  assert.equal(first.albumId, second.albumId);
  assert.notEqual(first.albumId, otherOwner.albumId);
  assert.equal(s.get('albums', first.albumId).ownerId, 'p1');
  const albumsBefore = s.getState().albums;
  assert.throws(
    () => s.writePhoto({ ...input, mediaId: 'missing' }, 'Rolled back album'),
    /missing record/,
  );
  assert.deepEqual(s.getState().albums, albumsBefore);
});

test('HTTP media serving and stub hydration work through public endpoints', async (t) => {
  const s = memory(t),
    server = createApp(s).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = async (path, value) => {
      const r = await fetch(base + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(value),
      });
      assert.ok(r.ok, await r.clone().text());
      return r.json();
    };
    const media = await post('/api/media', {
      sourceType: 'local',
      dataUrl: png,
    });
    const image = await fetch(base + '/api/media/' + media.id);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.equal(
      Buffer.from(await image.arrayBuffer()).toString('base64'),
      png.split(',')[1],
    );
    const stub = await post('/api/profiles/resolve', {
      externalId: 'http_bob',
      name: 'Bob',
    });
    const full = await post('/api/profiles/hydrate', {
      externalId: 'http_bob',
      profile: { name: 'Bob Complete', avatarMediaId: media.id },
    });
    assert.equal(full.id, stub.id);
    assert.equal(full.state, 'full');
    const exported = await (await fetch(base + '/api/export')).json();
    assert.equal(exported.mediaFiles[media.externalId], png);
    assert.equal(
      Object.hasOwn(
        await (await fetch(base + '/api/state')).json(),
        'mediaFiles',
      ),
      false,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
