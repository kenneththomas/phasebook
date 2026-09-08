import { DatabaseSync } from 'node:sqlite';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  schema,
  tables,
  references,
  profileDefaults,
  validateRecord,
  createSchema,
  createNetworkSchema,
} from './schema.mjs';
import { networkFields, networkDirectory } from '../lib/networks.mjs';
import { schema as legacySchema } from './legacy-schema.mjs';
import {
  validateMedia,
  storeUpload,
  filePayload,
  localPath,
  remoteURL,
} from './media.mjs';
export { schema, tables, validateRecord } from './schema.mjs';
export const newExternalId = () => randomUUID();

export function assertUniqueIdentities(table, rows, requireExternal = true) {
  const ids = new Set(),
    externalIds = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object')
      throw new Error(`Invalid record in ${table}.`);
    if (ids.has(row.id)) throw new Error(`Duplicate id in ${table}.`);
    if (requireExternal && externalIds.has(row.externalId))
      throw new Error(`Duplicate external id in ${table}.`);
    ids.add(row.id);
    externalIds.add(row.externalId);
  }
}
export function createStore(
  filename = resolve('data/phasebook.sqlite'),
  { seed = true, mediaDirectory } = {},
) {
  if (filename !== ':memory:')
    mkdirSync(dirname(filename), { recursive: true });
  const ephemeralMedia = filename === ':memory:' && !mediaDirectory;
  const mediaDir = mediaDirectory
    ? resolve(mediaDirectory)
    : ephemeralMedia
      ? mkdtempSync(resolve(tmpdir(), 'phasebook-media-'))
      : resolve(dirname(filename), 'media');
  const db = new DatabaseSync(filename);
  db.exec(
    'PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;',
  );
  let inTransaction = false,
    newFiles = [];
  function transaction(action) {
    if (inTransaction) return action();
    db.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON;');
    inTransaction = true;
    newFiles = [];
    try {
      const result = action();
      if (db.prepare('PRAGMA foreign_key_check').all().length)
        throw new Error('Reference to a missing record (FOREIGN KEY).');
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      for (const path of newFiles) unlinkSync(path);
      throw error;
    } finally {
      inTransaction = false;
      newFiles = [];
    }
  }
  function checkTable(table) {
    if (!Object.hasOwn(schema, table)) throw new Error('Unknown collection.');
  }
  function get(table, id) {
    checkTable(table);
    return db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
  }
  function resolveExternal(table, externalId) {
    checkTable(table);
    if (
      typeof externalId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,200}$/.test(externalId)
    )
      throw new Error('Invalid externalId.');
    return db
      .prepare(`SELECT * FROM ${table} WHERE externalId=?`)
      .get(externalId);
  }
  function rawPut(table, record) {
    validateRecord(table, record);
    if (table === 'media') validateMedia(record, mediaDir);
    if (table === 'networkMemberships') {
      const network = get('networks', record.networkId);
      const fields = networkFields[network?.type];
      if (fields && Object.keys(JSON.parse(record.metadata)).some(key => !fields.includes(key)))
        throw new Error('Metadata does not match the network type.');
    }
    if (table === 'networks') {
      const previous = get('networks', record.id);
      if (previous && previous.type !== record.type && db.prepare('SELECT 1 FROM networkMemberships WHERE networkId=? LIMIT 1').get(record.id))
        throw new Error('Remove memberships before changing the network type.');
    }
    const fields = ['id', 'externalId', ...Object.keys(schema[table])];
    db.prepare(
      `INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${fields
        .slice(1)
        .map((k) => `${k}=excluded.${k}`)
        .join(',')}`,
    ).run(...fields.map((k) => record[k]));
    return record;
  }
  function createMedia(input) {
    return transaction(() => {
      const {
        sourceType,
        sourceLocation,
        dataUrl,
        originalFilename = null,
        externalId = newExternalId(),
      } = input;
      if (
        Object.keys(input).some(
          (k) =>
            ![
              'sourceType',
              'sourceLocation',
              'dataUrl',
              'originalFilename',
              'externalId',
            ].includes(k),
        )
      )
        throw new Error('Unknown media input field.');
      if (
        originalFilename !== null &&
        (typeof originalFilename !== 'string' || originalFilename.length > 255)
      )
        throw new Error('Invalid original filename.');
      const row = {
        id: randomUUID(),
        externalId,
        kind: 'image',
        sourceType,
        sourceLocation:
          sourceType === 'remote' ? remoteURL(sourceLocation) : sourceLocation,
        mimeType: null,
        originalFilename,
        width: null,
        height: null,
        createdAt: new Date().toISOString(),
        cachedLocalPath: null,
        metadata: '{}',
      };
      if (sourceType === 'local')
        Object.assign(
          row,
          storeUpload(mediaDir, dataUrl, (path) => newFiles.push(path)),
        );
      else if (dataUrl !== undefined)
        throw new Error('Only local uploads accept image data.');
      return rawPut('media', row);
    });
  }
  function createPackagedMedia(source, dataUrl) {
    return transaction(() => {
      if (
        !source ||
        typeof source !== 'object' ||
        source.sourceType !== 'local'
      )
        throw new Error('Invalid packaged media record.');
      const stored = storeUpload(mediaDir, dataUrl, (path) =>
        newFiles.push(path),
      );
      return rawPut('media', {
        ...source,
        id: randomUUID(),
        sourceType: 'local',
        sourceLocation: stored.sourceLocation,
        mimeType: stored.mimeType,
        cachedLocalPath: null,
      });
    });
  }
  // Only the v1 input adapter accepts old image/album strings. Storage is v2.
  function legacyMedia(source) {
    if (typeof source !== 'string') throw new Error('Invalid legacy image.');
    if (source.startsWith('data:'))
      return createMedia({ sourceType: 'local', dataUrl: source }).id;
    const sourceType = source.startsWith('/assets/') ? 'bundled' : 'remote';
    const existing = db
      .prepare('SELECT id FROM media WHERE sourceType=? AND sourceLocation=?')
      .get(sourceType, source);
    return (
      existing?.id ?? createMedia({ sourceType, sourceLocation: source }).id
    );
  }
  function normalize(table, input) {
    const row = { ...input };
    if (table === 'profiles') {
      if (Object.hasOwn(row, 'avatar')) {
        row.avatarMediaId = legacyMedia(row.avatar);
        delete row.avatar;
      }
      return { ...profileDefaults, state: 'full', ...row };
    }
    if (table === 'networks') return { city: '', region: '', country: '', description: '', createdAt: new Date().toISOString(), ...row };
    if (table === 'networkMemberships') return { metadata: '{}', createdAt: new Date().toISOString(), ...row };
    if (table === 'groups') return { creatorId: null, ...row };
    if (table === 'photos') {
      if (Object.hasOwn(row, 'src')) {
        row.mediaId = legacyMedia(row.src);
        delete row.src;
      }
      if (Object.hasOwn(row, 'album')) {
        let album = db
          .prepare(
            'SELECT * FROM albums WHERE ownerId=? AND name=? ORDER BY rowid LIMIT 1',
          )
          .get(row.ownerId, row.album);
        album ??= rawPut('albums', {
          id: randomUUID(),
          externalId: newExternalId(),
          ownerId: row.ownerId,
          name: row.album,
          coverMediaId: null,
          createdAt: row.createdAt,
        });
        row.albumId = album.id;
        delete row.album;
      }
    }
    return row;
  }
  function put(table, input) {
    return transaction(() => {
      checkTable(table);
      if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new Error('Invalid record.');
      let record = { ...input, id: input.id ?? randomUUID() };
      let previous = get(table, record.id);
      record.externalId ??= previous?.externalId ?? newExternalId();
      const existing = resolveExternal(table, record.externalId);
      if (existing && existing.id !== record.id) {
        if (
          table !== 'profiles' ||
          existing.state !== 'stub' ||
          (record.state ?? 'full') !== 'full' ||
          previous
        )
          throw new Error(`Duplicate external id in ${table}.`);
        record = {
          ...existing,
          ...input,
          id: existing.id,
          externalId: existing.externalId,
          state: 'full',
        };
        previous = existing;
      }
      if (table === 'profiles' && previous?.state === 'stub')
        record = { ...previous, ...record };
      record = normalize(table, record);
      if (previous && previous.externalId !== record.externalId)
        throw new Error('External identity cannot be changed.');
      if (
        table === 'profiles' &&
        previous?.state === 'full' &&
        record.state === 'stub'
      )
        throw new Error('A full profile cannot be downgraded to a stub.');
      return rawPut(table, record);
    });
  }
  function ensureProfileStub(externalId, name = '') {
    return transaction(
      () =>
        resolveExternal('profiles', externalId) ??
        put('profiles', {
          ...profileDefaults,
          id: randomUUID(),
          externalId,
          state: 'stub',
          name,
        }),
    );
  }
  function hydrateProfile(externalId, data) {
    return transaction(() => {
      const existing = resolveExternal('profiles', externalId);
      if (!data || typeof data !== 'object' || Array.isArray(data))
        throw new Error('Invalid profile data.');
      if (
        (data.id && existing && data.id !== existing.id) ||
        (data.externalId && data.externalId !== externalId)
      )
        throw new Error('Hydration identity mismatch.');
      return put('profiles', {
        ...profileDefaults,
        ...existing,
        ...data,
        id: existing?.id ?? data.id ?? randomUUID(),
        externalId,
        state: 'full',
      });
    });
  }
  // Input reference fields contain external IDs; only local IDs reach SQLite.
  function putExternal(table, input) {
    return transaction(() => {
      checkTable(table);
      if (Object.hasOwn(input, 'id'))
        throw new Error('Portable input must not contain a local id.');
      const existing = resolveExternal(table, input.externalId);
      const record = {
        ...existing,
        ...input,
        id: existing?.id ?? randomUUID(),
      };
      for (const [field, target] of Object.entries(references[table])) {
        if (!Object.hasOwn(input, field) || input[field] === null) continue;
        const resolved =
          target === 'profiles'
            ? ensureProfileStub(input[field])
            : resolveExternal(target, input[field]);
        if (!resolved)
          throw new Error(`Unresolved ${target} external id: ${input[field]}`);
        record[field] = resolved.id;
      }
      return put(table, record);
    });
  }
  const getState = () => ({
    schemaVersion: 2,
    settings:
      db.prepare('SELECT activeProfileId FROM settings WHERE id=1').get() ?? {},
    ...Object.fromEntries(
      tables.map((t) => [
        t,
        db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
      ]),
    ),
  });
  function search(query, limit = 50, networkId = '') {
    if (typeof query !== 'string' || !query.trim())
      return { profiles: [], posts: [], groups: [], networks: [] };
    const normalizedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const pattern = `%${query.trim().replace(/[\\%_]/g, '\\$&')}%`;
    return {
      profiles: db
        .prepare(
          `SELECT * FROM profiles
           WHERE (name LIKE ? ESCAPE '\\' OR city LIKE ? ESCAPE '\\' OR education LIKE ? ESCAPE '\\' OR id IN (SELECT m.profileId FROM networkMemberships m JOIN networks n ON n.id=m.networkId WHERE n.name LIKE ? ESCAPE '\\')) AND (? = '' OR id IN (SELECT profileId FROM networkMemberships WHERE networkId = ?))
           ORDER BY name COLLATE NOCASE, id LIMIT ?`,
        )
        .all(pattern, pattern, pattern, pattern, networkId, networkId, normalizedLimit),
      posts: db
        .prepare(
          `SELECT * FROM posts WHERE body LIKE ? ESCAPE '\\'
           ORDER BY createdAt DESC, id LIMIT ?`,
        )
        .all(pattern, normalizedLimit),
      networks: db.prepare("SELECT * FROM networks WHERE name LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE LIMIT ?").all(pattern, normalizedLimit),
      groups: db
        .prepare(
          `SELECT * FROM groups WHERE name LIKE ? ESCAPE '\\'
           ORDER BY name COLLATE NOCASE, id LIMIT ?`,
        )
        .all(pattern, normalizedLimit),
    };
  }
  function exportState() {
    const state = getState();
    const local = state.media.filter((m) => m.sourceType === 'local');
    if (local.length)
      state.mediaFiles = Object.fromEntries(
        local.map((m) => [m.externalId, filePayload(mediaDir, m)]),
      );
    state.media = state.media.map((m) => ({ ...m, cachedLocalPath: null }));
    return state;
  }
  function replaceState(value) {
    if (
      !value ||
      ![1, 2].includes(value.schemaVersion) ||
      typeof value.settings?.activeProfileId !== 'string'
    )
      throw new Error('Expected a Phasebook schemaVersion 1 or 2 export.');
    value = { ...value, networks: value.networks ?? [], networkMemberships: value.networkMemberships ?? [] };
    const collections =
      value.schemaVersion === 1 ? [...Object.keys(legacySchema), 'networks', 'networkMemberships'] : tables;
    if (
      !collections.every((t) => Array.isArray(value[t])) ||
      !value.profiles.length
    )
      throw new Error(
        'Export must contain every collection and at least one profile.',
      );
    for (const t of collections) {
      if (value[t].length > 20000)
        throw new Error('Collection exceeds 20,000 records.');
      assertUniqueIdentities(t, value[t], value.schemaVersion === 2);
      if (value.schemaVersion === 2)
        for (const row of value[t]) validateRecord(t, row);
    }
    db.exec('DELETE FROM settings');
    for (const t of [...tables].reverse()) db.exec(`DELETE FROM ${t}`);
    if (value.schemaVersion === 1) {
      for (const t of collections) for (const row of value[t]) put(t, row);
    } else {
      if (
        value.mediaFiles !== undefined &&
        (!value.mediaFiles ||
          typeof value.mediaFiles !== 'object' ||
          Array.isArray(value.mediaFiles))
      )
        throw new Error('Invalid mediaFiles payload.');
      const fileIds = new Set(
        value.media
          .filter((m) => m.sourceType === 'local')
          .map((m) => m.externalId),
      );
      if (Object.keys(value.mediaFiles ?? {}).some((id) => !fileIds.has(id)))
        throw new Error('Media payload has no matching local record.');
      for (const t of tables)
        for (const source of value[t]) {
          const row = { ...source };
          if (t === 'media') {
            row.cachedLocalPath = null;
            if (
              row.sourceType === 'local' &&
              Object.hasOwn(value.mediaFiles ?? {}, row.externalId)
            )
              Object.assign(
                row,
                storeUpload(
                  mediaDir,
                  value.mediaFiles[row.externalId],
                  (path) => newFiles.push(path),
                ),
              );
          }
          rawPut(t, row);
        }
    }
    db.prepare('INSERT INTO settings VALUES (1,?)').run(
      value.settings.activeProfileId,
    );
  }
  function importState(value, backup = true) {
    const before = backup ? exportState() : null;
    return transaction(() => {
      replaceState(value);
      if (db.prepare('PRAGMA foreign_key_check').all().length)
        throw new Error('Import contains a reference to a missing record.');
      if (backup && filename !== ':memory:')
        writeFileSync(
          resolve(
            dirname(filename),
            `backup-${Date.now()}-${randomUUID().slice(0, 8)}.json`,
          ),
          JSON.stringify(before, null, 2),
          { flag: 'wx' },
        );
      return getState();
    });
  }
  function writePhotoResult(photo, albumName) {
    return transaction(() => {
      const record = { ...photo };
      if (!record.albumId) {
        if (typeof albumName !== 'string' || !albumName.trim())
          throw new Error('Enter an album name.');
        let album = db
          .prepare(
            'SELECT * FROM albums WHERE ownerId=? AND name=? ORDER BY rowid LIMIT 1',
          )
          .get(record.ownerId, albumName.trim());
        album ??= put('albums', {
          ownerId: record.ownerId,
          name: albumName.trim(),
          coverMediaId: null,
          createdAt: record.createdAt,
        });
        record.albumId = album.id;
      }
      const result = writeResult('photos', record);
      return { ...result, album: get('albums', result.record.albumId) };
    });
  }
  function writePhoto(photo, albumName) {
    return writePhotoResult(photo, albumName).record;
  }
  function writeResult(table, input) {
    return transaction(() => {
      checkTable(table);
      const previous = input.id ? get(table, input.id) : undefined;
      const record = put(table, input);
      let recipient,
        actor,
        body,
        postId = null,
        story = null;
      if (!previous && ['comments', 'likes'].includes(table)) {
        const post = get('posts', record.postId);
        if (post) {
          recipient = post.authorId;
          actor = record.authorId || record.profileId;
          postId = post.id;
          body =
            table === 'likes' ? 'liked your post.' : 'commented on your post.';
        }
      } else if (
        !previous &&
        table === 'posts' &&
        record.wallId &&
        record.wallId !== record.authorId
      ) {
        recipient = record.wallId;
        actor = record.authorId;
        postId = record.id;
        body = 'wrote on your Wall.';
      } else if (
        table === 'friendships' &&
        !previous &&
        record.status === 'pending'
      ) {
        recipient = record.friendId;
        actor = record.profileId;
        body = 'sent you a friend request.';
      } else if (
        table === 'friendships' &&
        previous?.status === 'pending' &&
        record.status === 'accepted'
      ) {
        recipient = record.profileId;
        actor = record.friendId;
        body = 'accepted your friend request.';
        const requester = get('profiles', record.profileId);
        const accepter = get('profiles', record.friendId);
        if (requester && accepter)
          story = put('posts', {
            id: randomUUID(),
            authorId: accepter.id,
            wallId: accepter.id,
            groupId: null,
            body: `is now friends with ${String(requester.name || 'a new friend')}.`,
            photoId: null,
            createdAt: new Date().toISOString(),
          });
      }
      let notification = null;
      if (recipient && actor && recipient !== actor) {
        const profile = get('profiles', actor);
        if (profile)
          notification = put('notifications', {
            id: randomUUID(),
            profileId: recipient,
            actorId: actor,
            body: (profile.name || 'Unknown profile') + ' ' + body,
            postId,
            createdAt: new Date().toISOString(),
            read: 0,
          });
      }
      return { record, notification, story };
    });
  }
  function write(table, input) {
    return writeResult(table, input).record;
  }
  try {
    const version = db.prepare('PRAGMA user_version').get().user_version;
    const hasProfiles = db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='profiles'",
      )
      .get();
    if (version > 4)
      throw new Error(
        'This database was created by a newer Phasebook version.',
      );
    if (!hasProfiles) transaction(() => createSchema(db));
    else if (version < 2) {
      const legacy = {
        schemaVersion: 1,
        settings:
          db.prepare('SELECT activeProfileId FROM settings WHERE id=1').get() ??
          {},
        ...Object.fromEntries(
          Object.keys(legacySchema).map((t) => [
            t,
            db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
          ]),
        ),
      };
      if (filename !== ':memory:')
        db.prepare('VACUUM INTO ?').run(
          resolve(
            dirname(filename),
            `migration-v1-${Date.now()}-${randomUUID().slice(0, 8)}.sqlite`,
          ),
        );
      db.exec('PRAGMA foreign_keys=OFF');
      try {
        transaction(() => {
          db.exec('DROP TABLE settings');
          for (const t of Object.keys(legacySchema).reverse())
            db.exec(`DROP TABLE ${t}`);
          createSchema(db);
          if (legacy.profiles.length) replaceState(legacy);
          else if (
            Object.keys(legacySchema).some((t) => legacy[t].length) ||
            legacy.settings.activeProfileId
          )
            throw new Error(
              'Legacy records exist without a profile; repair the legacy world before migration.',
            );
        });
      } catch (error) {
        throw new Error(
          `Migration to v2 failed; the original database is unchanged: ${error.message}`,
          { cause: error },
        );
      } finally {
        db.exec('PRAGMA foreign_keys=ON');
      }
    }
    if (db.prepare('PRAGMA user_version').get().user_version === 2) {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_posts_wall ON posts(wallId,createdAt);
        CREATE INDEX IF NOT EXISTS idx_posts_group ON posts(groupId,createdAt);
        CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(postId);
        CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipientId,read,createdAt);
        CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(senderId,createdAt);
        CREATE INDEX IF NOT EXISTS idx_notifications_profile ON notifications(profileId,read,createdAt);
        CREATE INDEX IF NOT EXISTS idx_event_guests_event ON eventGuests(eventId,status);
        CREATE INDEX IF NOT EXISTS idx_group_members_profile ON groupMembers(profileId,groupId);
        PRAGMA user_version=3;`);
    }
    if (db.prepare('PRAGMA user_version').get().user_version === 3) {
      if (filename !== ':memory:') db.prepare('VACUUM INTO ?').run(resolve(dirname(filename), `migration-v3-${Date.now()}-${randomUUID().slice(0,8)}.sqlite`));
      transaction(() => { createNetworkSchema(db); db.exec('PRAGMA user_version=4;'); });
    }
    if (seed && !db.prepare('SELECT 1 FROM settings').get())
      importState(
        JSON.parse(
          readFileSync(new URL('../db/seed.json', import.meta.url), 'utf8'),
        ),
        false,
      );
  } catch (error) {
    db.close();
    if (ephemeralMedia) rmSync(mediaDir, { recursive: true, force: true });
    throw error;
  }
  return {
    db,
    mediaDir,
    transaction,
    get,
    getState,
    search,
    networkDirectory: (id, filters = {}) => networkDirectory(getState(), id, filters),
    exportState,
    put,
    write,
    writeResult,
    importState,
    createMedia,
    createPackagedMedia,
    writePhoto,
    writePhotoResult,
    resolveExternal,
    ensureProfileStub,
    hydrateProfile,
    putExternal,
    mediaFile(id) {
      const row = get('media', id);
      if (!row || row.sourceType !== 'local')
        throw new Error('Local media not found.');
      return {
        path: localPath(mediaDir, row.sourceLocation),
        mimeType: row.mimeType,
      };
    },
    bundledMediaFile(sourceLocation) {
      return resolve('public', `.${sourceLocation}`);
    },
    remove(table, id) {
      checkTable(table);
      if (table === 'profiles')
        throw new Error(
          'Profile deletion is not supported; edit the profile instead.',
        );
      db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
    },
    switchProfile(id) {
      if (!get('profiles', id)) throw new Error('Profile not found.');
      db.prepare('UPDATE settings SET activeProfileId=? WHERE id=1').run(id);
    },
    markConversationRead(profileId, otherId) {
      if (
        ![profileId, otherId].every(
          (id) => typeof id === 'string' && get('profiles', id),
        )
      )
        throw new Error('Profile not found.');
      const unread = db
        .prepare(
          'SELECT * FROM messages WHERE recipientId=? AND senderId=? AND read=0',
        )
        .all(profileId, otherId);
      db.prepare(
        'UPDATE messages SET read=1 WHERE recipientId=? AND senderId=?',
      ).run(profileId, otherId);
      return unread.map((message) => ({ ...message, read: 1 }));
    },
    close() {
      db.close();
      if (ephemeralMedia) rmSync(mediaDir, { recursive: true, force: true });
    },
  };
}
