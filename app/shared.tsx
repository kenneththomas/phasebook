// Generic record adapter for the shared entity editor. The server validates
// concrete fields and types against its SQLite schema before every write.
// oxlint-disable-next-line typescript/no-explicit-any
export type Row = { id: string; [key: string]: any };
export type CollectionName =
  | 'profiles'
  | 'friendships'
  | 'posts'
  | 'comments'
  | 'likes'
  | 'messages'
  | 'notifications'
  | 'events'
  | 'eventGuests'
  | 'groups'
  | 'groupMembers'
  | 'photos';
export type World = Record<CollectionName, Row[]> & {
  schemaVersion: number;
  settings: { activeProfileId: string };
  error?: string;
};
export const emptyProfile = {
  name: '',
  bio: '',
  city: '',
  hometown: '',
  education: '',
  work: '',
  birthday: '',
  relationship: '',
  interests: '',
  avatar: '/assets/avatar-1.jpg',
};
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export function stamp(date: string) {
  return new Date(date).toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
export async function request(
  path: string,
  method = 'GET',
  value?: unknown,
): Promise<World> {
  const res = await fetch('/api/' + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  const data = (await res.json()) as World;
  if (!res.ok) throw new Error(data.error || 'Could not save your changes.');
  return data;
}
export function Avatar({ person, size = 50 }: { person?: Row; size?: number }) {
  return (
    <img
      className="avatar"
      src={person?.avatar || '/assets/avatar-1.jpg'}
      alt={person?.name || 'Profile'}
      style={{ width: size, height: size }}
    />
  );
}
