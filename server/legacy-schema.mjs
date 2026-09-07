// Schema v1 retained only for migration and regression fixtures.
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
