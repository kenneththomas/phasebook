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
  avatarMediaId: null,
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
    coverMediaId: mediaRef(true),
    createdAt: text,
  },
  photos: {
    ownerId: ref('profiles'),
    albumId: ref('albums'),
    caption: text,
    mediaId: mediaRef(),
    createdAt: text,
  },
  photoTags: {
    photoId: ref('photos'),
    profileId: ref('profiles'),
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
      ['createdAt', 'startsAt'].includes(field) &&
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
  if (table === 'friendships' && row.profileId === row.friendId)
    throw new Error('Choose two different profiles.');
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
export function createPhotoTagSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS photoTags (id TEXT PRIMARY KEY NOT NULL, externalId TEXT NOT NULL UNIQUE, photoId ${ref('photos')}, profileId ${ref('profiles')});
    CREATE UNIQUE INDEX IF NOT EXISTS photo_tag_pair ON photoTags(photoId,profileId);
    CREATE INDEX IF NOT EXISTS idx_photo_tags_profile ON photoTags(profileId,photoId);`);
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
  createPhotoTagSchema(db);
  db.exec(`CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1), activeProfileId TEXT NOT NULL REFERENCES profiles(id) DEFERRABLE INITIALLY DEFERRED);
    CREATE UNIQUE INDEX friendship_pair ON friendships(min(profileId,friendId),max(profileId,friendId));
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
    PRAGMA user_version=6;`);
}
