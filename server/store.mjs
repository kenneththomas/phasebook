import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// Every collection is a real SQLite table. References are enforced by SQLite.
const text = 'TEXT NOT NULL';
const ref = (table, nullable = false) =>
  `TEXT ${nullable ? '' : 'NOT NULL'} REFERENCES ${table}(id) ON DELETE ${nullable ? 'SET NULL' : 'CASCADE'} DEFERRABLE INITIALLY DEFERRED`;
export const schema = {
  profiles: {
    name: text,
    bio: text,
    city: text,
    hometown: text,
    education: text,
    work: text,
    birthday: text,
    relationship: text,
    interests: text,
    avatar: text,
  },
  friendships: {
    profileId: ref('profiles'),
    friendId: ref('profiles'),
    status: "TEXT NOT NULL CHECK(status IN ('accepted','pending'))",
  },
  groups: { name: text, description: text, category: text },
  groupMembers: { groupId: ref('groups'), profileId: ref('profiles') },
  photos: {
    ownerId: ref('profiles'),
    album: text,
    caption: text,
    src: text,
    createdAt: text,
  },
  posts: {
    authorId: ref('profiles'),
    wallId: ref('profiles', true),
    groupId: ref('groups', true),
    body: text,
    photoId: ref('photos', true),
    createdAt: text,
  },
  comments: {
    postId: ref('posts'),
    authorId: ref('profiles'),
    body: text,
    createdAt: text,
  },
  likes: { postId: ref('posts'), profileId: ref('profiles') },
  messages: {
    senderId: ref('profiles'),
    recipientId: ref('profiles'),
    subject: text,
    body: text,
    createdAt: text,
    read: 'INTEGER NOT NULL CHECK(read IN (0,1))',
  },
  notifications: {
    profileId: ref('profiles'),
    actorId: ref('profiles'),
    body: text,
    postId: ref('posts', true),
    createdAt: text,
    read: 'INTEGER NOT NULL CHECK(read IN (0,1))',
  },
  events: {
    creatorId: ref('profiles'),
    title: text,
    description: text,
    location: text,
    startsAt: text,
  },
  eventGuests: {
    eventId: ref('events'),
    profileId: ref('profiles'),
    status: "TEXT NOT NULL CHECK(status IN ('attending','maybe','declined'))",
  },
};
export const tables = Object.keys(schema);
export function validateRecord(table, row) {
  if (!schema[table] || !row || typeof row !== 'object' || Array.isArray(row))
    throw new Error('Unknown collection or invalid record.');
  const fields = { id: text, ...schema[table] };
  if (Object.keys(row).some((k) => !Object.hasOwn(fields, k)))
    throw new Error(`Unknown field in ${table}.`);
  for (const [field, sql] of Object.entries(fields)) {
    const value = row[field];
    if (value === null && !sql.includes('NOT NULL')) continue;
    if (sql.startsWith('INTEGER')) {
      if (![0, 1].includes(value)) throw new Error(`${field} must be 0 or 1.`);
    } else if (
      typeof value !== 'string' ||
      value.length > (['src', 'avatar'].includes(field) ? 5_000_000 : 20000)
    )
      throw new Error(`Invalid ${table}.${field}.`);
    if (
      ['id', 'name', 'title', 'body'].includes(field) &&
      typeof value === 'string' &&
      !value.trim()
    )
      throw new Error(`${field} cannot be empty.`);
    if (
      ['createdAt', 'startsAt'].includes(field) &&
      !Number.isFinite(Date.parse(value))
    )
      throw new Error(`${field} must be a date.`);
    if (
      ['avatar', 'src'].includes(field) &&
      !(
        /^\/assets\/[a-zA-Z0-9._-]+$/.test(value) ||
        /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)
      )
    )
      throw new Error(
        'Images must be bundled assets or embedded PNG, JPEG, or WebP data.',
      );
  }
  for (const field of ['avatar', 'src']) {
    const value = row[field];
    if (typeof value === 'string' && value.startsWith('/assets/')) {
      if (
        !/\.(jpg|jpeg|png|webp)$/i.test(value) ||
        !existsSync(new URL('../public' + value, import.meta.url))
      )
        throw new Error('Bundled image does not exist: ' + value);
    }
  }
  if (table === 'friendships' && row.profileId === row.friendId)
    throw new Error('Choose two different profiles.');
}
export function createStore(
  filename = resolve('data/phasebook.sqlite'),
  { seed = true } = {},
) {
  if (filename !== ':memory:')
    mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(
    'PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;',
  );
  for (const [table, fields] of Object.entries(schema))
    db.exec(
      `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY NOT NULL, ${Object.entries(
        fields,
      )
        .map(([k, v]) => `${k} ${v}`)
        .join(',')})`,
    );
  db.exec(`CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), activeProfileId TEXT NOT NULL REFERENCES profiles(id) DEFERRABLE INITIALLY DEFERRED);
    CREATE UNIQUE INDEX IF NOT EXISTS friendship_pair ON friendships(min(profileId,friendId),max(profileId,friendId));
    CREATE UNIQUE INDEX IF NOT EXISTS like_pair ON likes(postId,profileId);
    CREATE UNIQUE INDEX IF NOT EXISTS member_pair ON groupMembers(groupId,profileId);
    CREATE UNIQUE INDEX IF NOT EXISTS guest_pair ON eventGuests(eventId,profileId);
    CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(authorId,createdAt);
    CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(postId);
    PRAGMA user_version=1;`);
  const getState = () => ({
    schemaVersion: 1,
    settings:
      db.prepare('SELECT activeProfileId FROM settings WHERE id=1').get() ?? {},
    ...Object.fromEntries(
      tables.map((t) => [
        t,
        db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
      ]),
    ),
  });
  function put(table, record) {
    validateRecord(table, record);
    const fields = ['id', ...Object.keys(schema[table])];
    db.prepare(
      `INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${fields
        .slice(1)
        .map((k) => `${k}=excluded.${k}`)
        .join(',')}`,
    ).run(...fields.map((k) => record[k]));
    return record;
  }
  // Social actions and their derived notifications commit together. Bulk JSON
  // import uses put() directly to preserve the export exactly.
  function write(table, record) {
    validateRecord(table, record);
    const previous = db
      .prepare(`SELECT * FROM ${table} WHERE id=?`)
      .get(record.id);
    db.exec('BEGIN');
    try {
      put(table, record);
      let recipient,
        actor,
        body,
        postId = null;
      if (!previous && ['comments', 'likes'].includes(table)) {
        const post = db
          .prepare('SELECT * FROM posts WHERE id=?')
          .get(record.postId);
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
      }
      if (recipient && actor && recipient !== actor) {
        const profile = db
          .prepare('SELECT name FROM profiles WHERE id=?')
          .get(actor);
        if (profile)
          put('notifications', {
            id: randomUUID(),
            profileId: recipient,
            actorId: actor,
            body: profile.name + ' ' + body,
            postId,
            createdAt: new Date().toISOString(),
            read: 0,
          });
      }
      db.exec('COMMIT');
      return record;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  function importState(value, backup = true) {
    if (
      !value ||
      value.schemaVersion !== 1 ||
      !value.settings ||
      typeof value.settings.activeProfileId !== 'string'
    )
      throw new Error('Expected a Phasebook schemaVersion 1 export.');
    if (!tables.every((t) => Array.isArray(value[t])) || !value.profiles.length)
      throw new Error(
        'Export must contain every collection and at least one profile.',
      );
    for (const t of tables) {
      if (value[t].length > 20000)
        throw new Error('Collection exceeds 20,000 records.');
      const ids = new Set();
      for (const row of value[t]) {
        validateRecord(t, row);
        if (ids.has(row.id)) throw new Error(`Duplicate id in ${t}.`);
        ids.add(row.id);
      }
    }
    const before = getState();
    db.exec('BEGIN; PRAGMA defer_foreign_keys=ON;');
    try {
      db.exec('DELETE FROM settings');
      for (const t of [...tables].reverse()) db.exec(`DELETE FROM ${t}`);
      for (const t of tables) for (const row of value[t]) put(t, row);
      db.prepare('INSERT INTO settings VALUES (1,?)').run(
        value.settings.activeProfileId,
      );
      if (db.prepare('PRAGMA foreign_key_check').all().length)
        throw new Error('Import contains a reference to a missing record.');
      if (backup && filename !== ':memory:')
        writeFileSync(
          resolve(
            dirname(filename),
            `backup-${Date.now()}-${randomUUID().slice(0, 8)}.json`,
          ),
          JSON.stringify(before, null, 2),
        );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return getState();
  }
  if (seed && !db.prepare('SELECT 1 FROM settings').get())
    importState(
      JSON.parse(
        readFileSync(new URL('../db/seed.json', import.meta.url), 'utf8'),
      ),
      false,
    );
  return {
    db,
    getState,
    put,
    write,
    importState,
    remove(table, id) {
      if (!schema[table]) throw new Error('Unknown collection.');
      if (table === 'profiles')
        throw new Error(
          'Profile deletion is not supported; edit the profile instead.',
        );
      db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
    },
    switchProfile(id) {
      if (!db.prepare('SELECT 1 FROM profiles WHERE id=?').get(id))
        throw new Error('Profile not found.');
      db.prepare('UPDATE settings SET activeProfileId=? WHERE id=1').run(id);
    },
    markConversationRead(profileId, otherId) {
      if (
        ![profileId, otherId].every(
          (id) =>
            typeof id === 'string' &&
            db.prepare('SELECT 1 FROM profiles WHERE id=?').get(id),
        )
      )
        throw new Error('Profile not found.');
      db.prepare(
        'UPDATE messages SET read=1 WHERE recipientId=? AND senderId=?',
      ).run(profileId, otherId);
    },
    close() {
      db.close();
    },
  };
}
