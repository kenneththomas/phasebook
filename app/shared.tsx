import { useContext } from 'react';
import { AppContext } from './context';
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
  | 'photos'
  | 'albums'
  | 'media';
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
  state: 'full',
  avatarMediaId: null,
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
  return mediaSource(world.media.find((m) => m.id === id));
}
export const albumName = (world: World, id: string) =>
  world.albums.find((a) => a.id === id)?.name || 'Photos';
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
