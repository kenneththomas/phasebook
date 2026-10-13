import { useContext } from 'react';
import { AppContext } from './context';
// Generic record adapter for the shared entity editor. The server validates
// concrete fields and types against its SQLite schema before every write.
// oxlint-disable-next-line typescript/no-explicit-any
export type Row = { id: string; [key: string]: any };
export type CollectionName =
  | 'networks'
  | 'networkMemberships'
  | 'profiles'
  | 'friendships'
  | 'relationshipEvents'
  | 'posts'
  | 'comments'
  | 'likes'
  | 'messages'
  | 'notifications'
  | 'events'
  | 'eventGuests'
  | 'groups'
  | 'groupMembers'
  | 'photos'
  | 'albums'
  | 'postPhotos'
  | 'photoLikes'
  | 'photoComments'
  | 'photoTags'
  | 'profilePictures'
  | 'media';
export type World = Record<CollectionName, Row[]> & {
  schemaVersion: number;
  settings: { activeProfileId: string };
  error?: string;
};
export type MutationResult = {
  upserts: Partial<Record<CollectionName, Row[]>>;
  deletes: Partial<Record<CollectionName, string[]>>;
  settings?: World['settings'];
};
export type SearchResult = Pick<
  World,
  'profiles' | 'posts' | 'groups' | 'networks'
>;

const idIndexes = new WeakMap<Row[], Map<string, Row>>();
const fieldIndexes = new WeakMap<Row[], Map<string, Map<unknown, Row[]>>>();
export function rowById(rows: Row[], id?: string | null) {
  if (!id) return undefined;
  let index = idIndexes.get(rows);
  if (!index) {
    index = new Map(rows.map((row) => [row.id, row]));
    idIndexes.set(rows, index);
  }
  return index.get(id);
}
export function rowsBy(rows: Row[], field: string, value: unknown) {
  let fields = fieldIndexes.get(rows);
  if (!fields) {
    fields = new Map();
    fieldIndexes.set(rows, fields);
  }
  let index = fields.get(field);
  if (!index) {
    index = new Map();
    for (const row of rows) {
      const bucket = index.get(row[field]);
      if (bucket) bucket.push(row);
      else index.set(row[field], [row]);
    }
    fields.set(field, index);
  }
  return index.get(value) ?? [];
}

const collections: CollectionName[] = [
  'networks',
  'networkMemberships',
  'profiles',
  'friendships',
  'relationshipEvents',
  'posts',
  'comments',
  'likes',
  'messages',
  'notifications',
  'events',
  'eventGuests',
  'groups',
  'groupMembers',
  'photos',
  'albums',
  'postPhotos',
  'photoLikes',
  'photoComments',
  'photoTags',
  'profilePictures',
  'media',
];
const references: Partial<
  Record<CollectionName, Record<string, [CollectionName, 'cascade' | 'null']>>
> = {
  postPhotos: { postId: ['posts', 'cascade'], photoId: ['photos', 'cascade'] },
  photoLikes: {
    photoId: ['photos', 'cascade'],
    profileId: ['profiles', 'cascade'],
  },
  photoComments: {
    photoId: ['photos', 'cascade'],
    authorId: ['profiles', 'cascade'],
  },
  photoTags: {
    photoId: ['photos', 'cascade'],
    profileId: ['profiles', 'cascade'],
    actorId: ['profiles', 'cascade'],
  },
  profilePictures: {
    photoId: ['photos', 'cascade'],
    profileId: ['profiles', 'cascade'],
  },
  networkMemberships: {
    profileId: ['profiles', 'cascade'],
    networkId: ['networks', 'cascade'],
  },
  friendships: {
    profileId: ['profiles', 'cascade'],
    friendId: ['profiles', 'cascade'],
  },
  relationshipEvents: {
    friendshipId: ['friendships', 'cascade'],
  },
  groups: { creatorId: ['profiles', 'null'] },
  groupMembers: {
    groupId: ['groups', 'cascade'],
    profileId: ['profiles', 'cascade'],
  },
  albums: {
    ownerId: ['profiles', 'cascade'],
    coverMediaId: ['media', 'null'],
  },
  photos: {
    ownerId: ['profiles', 'cascade'],
    albumId: ['albums', 'cascade'],
    mediaId: ['media', 'cascade'],
  },
  posts: {
    authorId: ['profiles', 'cascade'],
    wallId: ['profiles', 'null'],
    groupId: ['groups', 'null'],
    photoId: ['photos', 'null'],
  },
  comments: {
    postId: ['posts', 'cascade'],
    authorId: ['profiles', 'cascade'],
  },
  likes: {
    postId: ['posts', 'cascade'],
    profileId: ['profiles', 'cascade'],
  },
  messages: {
    senderId: ['profiles', 'cascade'],
    recipientId: ['profiles', 'cascade'],
  },
  notifications: {
    profileId: ['profiles', 'cascade'],
    actorId: ['profiles', 'cascade'],
    postId: ['posts', 'null'],
    photoId: ['photos', 'null'],
  },
  events: { creatorId: ['profiles', 'cascade'] },
  eventGuests: {
    eventId: ['events', 'cascade'],
    profileId: ['profiles', 'cascade'],
  },
};

export function applyMutation(world: World, mutation: MutationResult): World {
  const next = {
    ...world,
    settings: mutation.settings ?? world.settings,
  } as World;

  for (const [name, rows] of Object.entries(mutation.upserts)) {
    const table = name as CollectionName;
    const incoming = rows ?? [];
    const byId = new Map(incoming.map((row) => [row.id, row]));
    const existing = new Set(next[table].map((row) => row.id));
    next[table] = [
      ...next[table].map((row) => byId.get(row.id) ?? row),
      ...incoming.filter((row) => !existing.has(row.id)),
    ];
  }

  const removed = new Map<CollectionName, Set<string>>();
  for (const [name, ids] of Object.entries(mutation.deletes))
    removed.set(name as CollectionName, new Set(ids));
  if (!removed.size) return next;
  for (const table of collections)
    next[table] = next[table].map((row) => ({ ...row }));
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, fields] of Object.entries(references)) {
      const table = name as CollectionName;
      for (const row of next[table]) {
        for (const [field, [target, action]] of Object.entries(fields)) {
          if (!removed.get(target)?.has(row[field])) continue;
          if (action === 'null') row[field] = null;
          else {
            const ids = removed.get(table) ?? new Set<string>();
            if (!ids.has(row.id)) {
              ids.add(row.id);
              removed.set(table, ids);
              changed = true;
            }
          }
        }
      }
    }
  }
  for (const [table, ids] of removed)
    next[table] = next[table].filter((row) => !ids.has(row.id));
  return next;
}
export const emptyProfile = {
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
  state: 'full',
  avatarMediaId: null,
};
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export function ageFromBirthday(
  birthday: unknown,
  today = new Date(),
): number | null {
  if (typeof birthday !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(birthday))
    return null;

  const [year, month, day] = birthday.split('-').map(Number);
  const birthdayDate = new Date(year, month - 1, day);
  if (
    birthdayDate.getFullYear() !== year ||
    birthdayDate.getMonth() !== month - 1 ||
    birthdayDate.getDate() !== day ||
    birthdayDate > today
  )
    return null;

  let age = today.getFullYear() - year;
  const hasHadBirthday =
    today.getMonth() > month - 1 ||
    (today.getMonth() === month - 1 && today.getDate() >= day);
  if (!hasHadBirthday) age -= 1;
  return age;
}
export function stamp(date: string) {
  return new Date(date).toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
export async function request<T = World>(
  path: string,
  method = 'GET',
  value?: unknown,
): Promise<T> {
  const res = await fetch('/api/' + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  const data = (await res.json()) as World;
  if (!res.ok) throw new Error(data.error || 'Could not save your changes.');
  return data as T;
}
export const profileName = (person?: Row) => person?.name || 'Unknown profile';
export function mediaSource(media?: Row) {
  if (!media) return undefined;
  return media.sourceType === 'local'
    ? '/api/media/' + encodeURIComponent(media.id)
    : media.sourceLocation;
}
export function mediaURL(world: World, id?: string | null) {
  return mediaSource(rowById(world.media, id));
}
export const albumName = (world: World, id: string) =>
  rowById(world.albums, id)?.name || 'Photos';
export function Avatar({ person, size = 50 }: { person?: Row; size?: number }) {
  const { world } = useContext(AppContext);
  return (
    <img
      className="avatar"
      src={
        mediaURL(world, person?.avatarMediaId) ||
        '/assets/profile-placeholder.svg'
      }
      alt={profileName(person)}
      style={{ width: size, height: size }}
    />
  );
}
