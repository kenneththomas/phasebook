const text = 'TEXT NOT NULL';
const optional = 'TEXT';
const ref = (table, nullable = false) =>
  `TEXT ${nullable ? '' : 'NOT NULL'} REFERENCES ${table}(id) ON DELETE ${nullable ? 'SET NULL' : 'CASCADE'} DEFERRABLE INITIALLY DEFERRED`;
const mediaRef = (nullable = false) =>
  `TEXT ${nullable ? '' : 'NOT NULL'} REFERENCES media(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED`;
export const profileDefaults = {
  name: '',
  bio: '',
  city: '',
  hometown: '',
  highSchool: '',
  highSchoolGraduationYear: '',
  college: '',
  collegeGraduationYear: '',
  collegeMajor: '',
  jobTitle: '',
  employer: '',
  education: '',
  work: '',
  birthday: '',
  relationship: '',
  relationshipWithId: null,
  gender: '',
  politicalViews: '',
  religiousViews: '',
  interests: '',
  voice: '',
  communicationStyle: '',
  behavioralTendencies: '',
  avatarMediaId: null,
};
export const friendshipDefaults = {
  relationshipType: 'Friends',
  howMet: '',
  metAt: null,
  closeness: '',
  sharedHistory: '',
};
export const schema = {
  media: {
    kind: "TEXT NOT NULL CHECK(kind='image')",
    sourceType:
      "TEXT NOT NULL CHECK(sourceType IN ('local','remote','bundled'))",
    sourceLocation: text,
    mimeType: optional,
    originalFilename: optional,
    width: 'INTEGER CHECK(width > 0)',
    height: 'INTEGER CHECK(height > 0)',
    createdAt: text,
    cachedLocalPath: optional,
    metadata: text,
  },
  profiles: {
    state: "TEXT NOT NULL CHECK(state IN ('full','stub'))",
    ...Object.fromEntries(
      Object.keys(profileDefaults)
        .filter((k) => k !== 'avatarMediaId' && k !== 'relationshipWithId')
        .map((k) => [k, text]),
    ),
    relationshipWithId: ref('profiles', true),
    avatarMediaId: mediaRef(true),
  },
  networks: {
    name: text,
    type: text,
    city: text,
    region: text,
    country: text,
    description: text,
    createdAt: text,
  },
  networkMemberships: {
    profileId: ref('profiles'),
    networkId: ref('networks'),
    metadata: text,
    createdAt: text,
  },
  friendships: {
    profileId: ref('profiles'),
    friendId: ref('profiles'),
    status: "TEXT NOT NULL CHECK(status IN ('accepted','pending'))",
    ...Object.fromEntries(
      Object.keys(friendshipDefaults).map((key) => [
        key,
        key === 'metAt' ? optional : text,
      ]),
    ),
  },
  relationshipEvents: {
    friendshipId: ref('friendships'),
    type: "TEXT NOT NULL CHECK(type IN ('met','relationship_changed','milestone','other'))",
    label: text,
    details: text,
    occurredAt: text,
    createdAt: text,
  },
  groups: {
    creatorId: ref('profiles', true),
    name: text,
    description: text,
    category: text,
  },
  groupMembers: { groupId: ref('groups'), profileId: ref('profiles') },
  albums: {
    ownerId: ref('profiles'),
    name: text,
    description: text,
    location: text,
    coverMediaId: mediaRef(true),
    createdAt: text,
  },
  photos: {
    ownerId: ref('profiles'),
    albumId: ref('albums'),
    caption: text,
    position: 'INTEGER NOT NULL CHECK(position > 0)',
    mediaId: mediaRef(),
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
  postPhotos: {
    postId: ref('posts'),
    photoId: ref('photos'),
    position: 'INTEGER NOT NULL CHECK(position > 0)',
  },
  photoLikes: { photoId: ref('photos'), profileId: ref('profiles') },
  photoComments: {
    photoId: ref('photos'),
    authorId: ref('profiles'),
    body: text,
    createdAt: text,
  },
  photoTags: {
    photoId: ref('photos'),
    profileId: ref('profiles'),
    actorId: ref('profiles', true),
    x: 'INTEGER CHECK(x BETWEEN 1 AND 10000)',
    y: 'INTEGER CHECK(y BETWEEN 1 AND 10000)',
    createdAt: optional,
  },
  profilePictures: {
    profileId: ref('profiles'),
    photoId: ref('photos'),
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
    photoId: ref('photos', true),
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
export const photoTables = [
  'postPhotos',
  'photoLikes',
  'photoComments',
  'photoTags',
  'profilePictures',
];
export const photoDefaults = {
  photoTags: { actorId: null, x: null, y: null, createdAt: null },
  albums: { description: '', location: '' },
  photos: { position: 1 },
  notifications: { photoId: null },
};
export function upgradePhotoData(world) {
  if (Array.isArray(world.profiles))
    world.profiles = world.profiles.map((row) => ({
      voice: '',
      communicationStyle: '',
      behavioralTendencies: '',
      ...row,
    }));
  for (const table of photoTables) world[table] ??= [];
  for (const [table, defaults] of Object.entries(photoDefaults))
    if (Array.isArray(world[table]))
      world[table] = world[table].map((row) => ({ ...defaults, ...row }));
  return world;
}
export function createPhotoSchema(db) {
  for (const table of photoTables)
    db.exec(
      `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY NOT NULL, externalId TEXT NOT NULL UNIQUE, ${Object.entries(
        schema[table],
      )
        .map(([k, v]) => `${k} ${v}`)
        .join(',')})`,
    );
  // Earlier local builds required tag evidence that remote tags never recorded.
  // Relax those columns without fabricating values or changing identities.
  const tagColumns = db.prepare('PRAGMA table_info(photoTags)').all();
  if (
    tagColumns.some(
      (row) =>
        ['actorId', 'x', 'y', 'createdAt'].includes(row.name) && row.notnull,
    )
  ) {
    db.exec(
      'CREATE TABLE photoTags_upgrade (id TEXT PRIMARY KEY NOT NULL, externalId TEXT NOT NULL UNIQUE, ' +
        Object.entries(schema.photoTags)
          .map(([k, v]) => k + ' ' + v)
          .join(',') +
        ')',
    );
    db.exec(
      'INSERT INTO photoTags_upgrade SELECT id,externalId,photoId,profileId,actorId,x,y,createdAt FROM photoTags; DROP TABLE photoTags; ALTER TABLE photoTags_upgrade RENAME TO photoTags;',
    );
  }
  for (const [table, fields] of Object.entries(photoDefaults)) {
    const present = new Set(
      db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => row.name),
    );
    for (const [field, value] of Object.entries(fields))
      if (!present.has(field))
        db.exec(
          `ALTER TABLE ${table} ADD COLUMN ${field} ${schema[table][field]} DEFAULT ${value === null ? 'NULL' : typeof value === 'number' ? value : "''"}`,
        );
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS photo_like_pair ON photoLikes(photoId,profileId);
    CREATE UNIQUE INDEX IF NOT EXISTS photo_tag_pair ON photoTags(photoId,profileId);
    CREATE UNIQUE INDEX IF NOT EXISTS post_photo_pair ON postPhotos(postId,photoId);
    CREATE UNIQUE INDEX IF NOT EXISTS profile_picture_pair ON profilePictures(profileId,photoId);
    CREATE INDEX IF NOT EXISTS idx_photo_comments ON photoComments(photoId,createdAt);
    CREATE INDEX IF NOT EXISTS idx_photo_tags_profile ON photoTags(profileId);
    PRAGMA user_version=11;`);
}
// Version numbers 8/9 were used for different structures by earlier checkouts.
// Inspect columns so any prior layout can receive the missing additions safely.
export function createFeatureSchema(db) {
  for (const [table, fields] of Object.entries({
    profiles: { voice: '', communicationStyle: '', behavioralTendencies: '' },
    friendships: friendshipDefaults,
  })) {
    const present = new Set(
      db
        .prepare('PRAGMA table_info(' + table + ')')
        .all()
        .map((row) => row.name),
    );
    for (const [field, value] of Object.entries(fields))
      if (!present.has(field))
        db.exec(
          'ALTER TABLE ' +
            table +
            ' ADD COLUMN ' +
            field +
            ' ' +
            schema[table][field] +
            ' DEFAULT ' +
            (value === null ? 'NULL' : "'" + value + "'"),
        );
  }
  db.exec(
    'CREATE TABLE IF NOT EXISTS relationshipEvents (id TEXT PRIMARY KEY NOT NULL, externalId TEXT NOT NULL UNIQUE, ' +
      Object.entries(schema.relationshipEvents)
        .map(([k, v]) => k + ' ' + v)
        .join(',') +
      ')',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_relationship_events_friendship ON relationshipEvents(friendshipId,occurredAt)',
  );
  createPhotoSchema(db);
}
export const references = Object.fromEntries(
  tables.map((table) => [
    table,
    Object.fromEntries(
      Object.entries(schema[table]).flatMap(([field, sql]) => {
        const match = sql.match(/REFERENCES (\w+)/);
        return match ? [[field, match[1]]] : [];
      }),
    ),
  ]),
);
export function validateRecord(table, row) {
  if (
    !Object.hasOwn(schema, table) ||
    !row ||
    typeof row !== 'object' ||
    Array.isArray(row)
  )
    throw new Error('Unknown collection or invalid record.');
  const fields = { id: text, externalId: text, ...schema[table] };
  if (table === 'photoTags' && (row.x > 10000 || row.y > 10000))
    throw new Error('Tag coordinates must be within the photo.');
  if (Object.keys(row).some((k) => !Object.hasOwn(fields, k)))
    throw new Error(`Unknown field in ${table}.`);
  for (const [field, sql] of Object.entries(fields)) {
    const value = row[field];
    if (value === null && !sql.includes('NOT NULL')) continue;
    if (sql.startsWith('INTEGER')) {
      if (
        !Number.isSafeInteger(value) ||
        (field === 'read' ? ![0, 1].includes(value) : value <= 0)
      )
        throw new Error(`Invalid ${table}.${field}.`);
    } else if (typeof value !== 'string' || value.length > 20000)
      throw new Error(`Invalid ${table}.${field}.`);
    if (
      ['id', 'externalId', 'name', 'title', 'body'].includes(field) &&
      !value.trim() &&
      !(table === 'profiles' && row.state === 'stub' && field === 'name')
    )
      throw new Error(`${field} cannot be empty.`);
    if (field === 'externalId' && !/^[A-Za-z0-9_-]{1,200}$/.test(value))
      throw new Error(`Invalid ${field}.`);
    if (
      ['createdAt', 'startsAt', 'occurredAt', 'metAt'].includes(field) &&
      !Number.isFinite(Date.parse(value))
    )
      throw new Error(`${field} must be a date.`);
  }
  if (table === 'networks' && !/^[a-z][a-z_-]{0,49}$/.test(row.type))
    throw new Error('Invalid network type.');
  if (table === 'networkMemberships') {
    let metadata;
    try {
      metadata = JSON.parse(row.metadata);
    } catch {
      throw new Error('Invalid membership metadata.');
    }
    if (
      !metadata ||
      typeof metadata !== 'object' ||
      Array.isArray(metadata) ||
      Object.values(metadata).some(
        (v) => typeof v !== 'string' || v.length > 500,
      )
    )
      throw new Error('Membership metadata must contain text fields.');
    for (const key of ['classYear', 'startYear', 'endYear'])
      if (metadata[key] && !/^(18|19|20|21)[0-9]{2}$/.test(metadata[key]))
        throw new Error('Enter a four-digit membership year.');
    if (
      metadata.startYear &&
      metadata.endYear &&
      metadata.startYear > metadata.endYear
    )
      throw new Error('End year must not precede start year.');
  }
  if (table === 'friendships') {
    if (row.profileId === row.friendId)
      throw new Error('Choose two different profiles.');
    if (
      row.closeness &&
      !['Acquaintances', 'Casual', 'Close', 'Very close'].includes(
        row.closeness,
      )
    )
      throw new Error('Choose a valid closeness.');
  }
}
export function createNetworkSchema(db) {
  for (const table of ['networks', 'networkMemberships']) {
    db.exec(
      `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY NOT NULL, externalId TEXT NOT NULL UNIQUE, ${Object.entries(
        schema[table],
      )
        .map(([k, v]) => `${k} ${v}`)
        .join(',')})`,
    );
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS network_member_pair ON networkMemberships(networkId,profileId);
    CREATE INDEX IF NOT EXISTS idx_network_members_profile ON networkMemberships(profileId,networkId);`);
}
export function createSchema(db) {
  for (const [table, fields] of Object.entries(schema))
    db.exec(
      `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY NOT NULL, externalId TEXT NOT NULL UNIQUE CHECK(length(externalId)>0), ${Object.entries(
        fields,
      )
        .map(([k, v]) => `${k} ${v}`)
        .join(',')})`,
    );
  createNetworkSchema(db);
  db.exec(`CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1), activeProfileId TEXT NOT NULL REFERENCES profiles(id) DEFERRABLE INITIALLY DEFERRED);
    CREATE UNIQUE INDEX friendship_pair ON friendships(min(profileId,friendId),max(profileId,friendId));
    CREATE INDEX idx_relationship_events_friendship ON relationshipEvents(friendshipId,occurredAt);
    CREATE UNIQUE INDEX like_pair ON likes(postId,profileId);
    CREATE UNIQUE INDEX member_pair ON groupMembers(groupId,profileId);
    CREATE UNIQUE INDEX guest_pair ON eventGuests(eventId,profileId);
    CREATE INDEX idx_posts_author ON posts(authorId,createdAt);
    CREATE INDEX idx_posts_wall ON posts(wallId,createdAt);
    CREATE INDEX idx_posts_group ON posts(groupId,createdAt);
    CREATE INDEX idx_comments_post ON comments(postId);
    CREATE INDEX idx_likes_post ON likes(postId);
    CREATE INDEX idx_albums_owner ON albums(ownerId);
    CREATE INDEX idx_photos_album ON photos(albumId);
    CREATE INDEX idx_messages_recipient ON messages(recipientId,read,createdAt);
    CREATE INDEX idx_messages_sender ON messages(senderId,createdAt);
    CREATE INDEX idx_notifications_profile ON notifications(profileId,read,createdAt);
    CREATE INDEX idx_event_guests_event ON eventGuests(eventId,status);
    CREATE INDEX idx_group_members_profile ON groupMembers(profileId,groupId);
    PRAGMA user_version=9;`);
  createPhotoSchema(db);
}
