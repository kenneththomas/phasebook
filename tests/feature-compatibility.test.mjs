import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../server/store.mjs';
import { friendshipDefaults, schema } from '../server/schema.mjs';
import { createGeneration } from '../server/generation.mjs';
import { createApp } from '../server/index.mjs';
import {
  createArchive,
  exportProfilePackage,
  importProfilePackage,
  unzip,
} from '../server/profile-package.mjs';

const voiceFields = ['voice', 'communicationStyle', 'behavioralTendencies'];
const tagFields = ['actorId', 'x', 'y', 'createdAt'];
const date = '2010-03-25T12:00:00Z';

for (const layout of [
  'shared7',
  'local8',
  'local9',
  'local10',
  'remote8',
  'remote9',
])
  test(`feature migration preserves ${layout} records, unknown tags, and restart`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'phasebook-feature-upgrade-'));
    const path = join(dir, 'world.sqlite');
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    let store = createStore(path);
    const photo = store.getState().photos[0];
    const hasTags = layout.startsWith('remote') || layout === 'local10';
    if (hasTags)
      store.put('photoTags', {
        id: 'old-tag',
        externalId: 'old_tag',
        photoId: photo.id,
        profileId: 'p2',
        actorId: 'p1',
        x: 2500,
        y: 4000,
        createdAt: date,
      });
    const hasFeedback = ['local10', 'remote9'].includes(layout);
    if (hasFeedback) {
      store.put('photoLikes', {
        id: 'old-like',
        externalId: 'old_like',
        photoId: photo.id,
        profileId: 'p2',
      });
      store.put('photoComments', {
        id: 'old-comment',
        externalId: 'old_comment',
        photoId: photo.id,
        authorId: 'p2',
        body: 'Retain this discussion',
        createdAt: date,
      });
    }
    if (layout !== 'local10') {
      for (const table of ['postPhotos', 'profilePictures'])
        store.db.exec(`DROP TABLE ${table}`);
      for (const field of ['description', 'location'])
        store.db.exec(`ALTER TABLE albums DROP COLUMN ${field}`);
      store.db.exec(
        'ALTER TABLE photos DROP COLUMN position; ALTER TABLE notifications DROP COLUMN photoId',
      );
    }
    if (!hasFeedback)
      for (const table of ['photoLikes', 'photoComments'])
        store.db.exec(`DROP TABLE ${table}`);
    if (!hasTags) store.db.exec('DROP TABLE photoTags');
    if (layout.startsWith('remote'))
      for (const field of tagFields)
        store.db.exec(`ALTER TABLE photoTags DROP COLUMN ${field}`);
    if (!['local9', 'local10'].includes(layout))
      for (const field of voiceFields)
        store.db.exec(`ALTER TABLE profiles DROP COLUMN ${field}`);
    if (layout.startsWith('remote') || layout === 'shared7') {
      store.db.exec('DROP TABLE relationshipEvents');
      for (const field of Object.keys(friendshipDefaults))
        store.db.exec(`ALTER TABLE friendships DROP COLUMN ${field}`);
    }
    if (layout === 'local10') {
      // Reproduce the stricter tag columns of the old local v10 schema.
      store.db.exec(
        'CREATE TABLE old_tags (id TEXT PRIMARY KEY NOT NULL, externalId TEXT NOT NULL UNIQUE, ' +
          Object.entries(schema.photoTags)
            .map(
              ([field, sql]) =>
                field +
                ' ' +
                (tagFields.includes(field)
                  ? sql
                      .replace('INTEGER CHECK', 'INTEGER NOT NULL CHECK')
                      .replace('TEXT  REFERENCES', 'TEXT NOT NULL REFERENCES')
                      .replace(/^TEXT$/, 'TEXT NOT NULL')
                  : sql),
            )
            .join(',') +
          ')',
      );
      store.db.exec(
        'INSERT INTO old_tags SELECT * FROM photoTags; DROP TABLE photoTags; ALTER TABLE old_tags RENAME TO photoTags',
      );
    }
    const prior = Object.fromEntries(
      [
        'profiles',
        'friendships',
        'photos',
        'posts',
        'comments',
        'likes',
        'photoTags',
        'photoLikes',
        'photoComments',
      ]
        .filter(
          (table) =>
            !table.startsWith('photo') ||
            [
              'photos',
              ...(hasTags ? ['photoTags'] : []),
              ...(hasFeedback ? ['photoLikes', 'photoComments'] : []),
            ].includes(table),
        )
        .map((table) => [
          table,
          store.db.prepare(`SELECT * FROM ${table}`).all(),
        ]),
    );
    store.db.exec(`PRAGMA user_version=${Number(layout.replace(/\D/g, ''))}`);
    store.close();
    store = createStore(path);
    try {
      assert.equal(
        store.db.prepare('PRAGMA user_version').get().user_version,
        11,
      );
      for (const [table, rows] of Object.entries(prior)) {
        assert.equal(store.getState()[table].length, rows.length);
        for (const row of rows)
          for (const [field, value] of Object.entries(row))
            assert.equal(
              store.get(table, row.id)[field],
              value,
              `${layout}: ${table}.${field}`,
            );
      }
      assert.equal(store.getState().relationshipEvents.length, 0);
      assert.equal(store.getState().profilePictures.length, 0);
      if (layout.startsWith('remote'))
        for (const field of tagFields)
          assert.equal(store.get('photoTags', 'old-tag')[field], null);
      // Nullable evidence also works after upgrading the stricter local v10 table.
      const legacyTag = store.put('photoTags', {
        photoId: photo.id,
        profileId: 'p3',
      });
      assert.equal(legacyTag.x, null);
      assert.equal(legacyTag.actorId, null);
      assert.equal(
        store.db.prepare('PRAGMA foreign_key_check').all().length,
        0,
      );
    } finally {
      store.close();
    }
    const backups = readdirSync(dir).filter((name) =>
      name.startsWith('migration-'),
    );
    assert.equal(backups.length, 1);
    store = createStore(path);
    store.close();
    assert.deepEqual(
      readdirSync(dir).filter((name) => name.startsWith('migration-')),
      backups,
    );
  });

test('remote JSON and profile packages import missing feature fields without inventing tag evidence', (t) => {
  const source = createStore(':memory:');
  const target = createStore(':memory:', { seed: false });
  t.after(() => {
    source.close();
    target.close();
  });
  const photo = source.getState().photos[0];
  source.put('photoTags', { photoId: photo.id, profileId: 'p1' });
  const strip = (data) => {
    for (const table of ['relationshipEvents', 'postPhotos', 'profilePictures'])
      delete data[table];
    for (const row of data.profiles || [])
      for (const field of voiceFields) delete row[field];
    for (const row of data.friendships || [])
      for (const field of Object.keys(friendshipDefaults)) delete row[field];
    for (const row of data.albums || []) {
      delete row.description;
      delete row.location;
    }
    for (const row of data.photos || []) delete row.position;
    for (const row of data.notifications || []) delete row.photoId;
    for (const row of data.photoTags || [])
      for (const field of tagFields) delete row[field];
  };
  const world = source.exportState();
  strip(world);
  target.importState(world, false);
  assert.equal(target.getState().photoTags[0].x, null);
  assert.equal(target.get('profiles', 'p1').voice, '');
  const files = unzip(exportProfilePackage(source, 'p1').buffer);
  const data = JSON.parse(files.get('data.json'));
  for (const field of voiceFields) delete data.rootProfile[field];
  strip(data.entities);
  files.set('data.json', Buffer.from(JSON.stringify(data)));
  const imported = importProfilePackage(
    target,
    createArchive([...files]),
    'merge',
  );
  assert.ok(imported.rootProfileId);
  assert.equal(target.getState().photoTags[0].actorId, null);
});

test('generation tracks and undoes both friendship wall stories', (t) => {
  const store = createStore(':memory:');
  t.after(() => store.close());
  const friendship = store.getState().friendships[0];
  store.put('friendships', { ...friendship, status: 'pending' });
  const before = store.getState();
  const generation = createGeneration(store);
  const run = generation.create({
    prompt: 'Accept this pending request',
    allowNewProfiles: false,
  });
  generation.propose(run.id, [
    {
      key: 'accept',
      action: 'update',
      table: 'friendships',
      data: { id: friendship.id, status: 'accepted' },
      rationale: 'Accept the pending request.',
    },
  ]);
  const committed = generation.commit(run.id);
  const stories = committed.changes.filter(
    (change) => change.table === 'posts' && !change.before,
  );
  assert.equal(stories.length, 2);
  assert.deepEqual(
    stories
      .map((change) => change.after.wallId)
      .sort((a, b) => a.localeCompare(b)),
    [friendship.profileId, friendship.friendId].sort((a, b) =>
      a.localeCompare(b),
    ),
  );
  generation.undo(run.id);
  assert.deepEqual(store.getState(), before);
});

test('JSON export and streaming world package export have independent compatible routes', async (t) => {
  const store = createStore(':memory:');
  const server = createApp(store);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = await fetch(base + '/api/export');
  assert.match(json.headers.get('content-type'), /application\/json/);
  assert.equal((await json.json()).schemaVersion, 2);
  const zip = await fetch(base + '/api/world-packages/export');
  assert.match(zip.headers.get('content-type'), /world\+zip/);
  const bytes = Buffer.from(await zip.arrayBuffer());
  assert.equal(bytes.subarray(0, 2).toString(), 'PK');
});
