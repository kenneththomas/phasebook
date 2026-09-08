import { ProfileNetworks } from './networks';
import { useEffect, useState } from 'react';
import { Users, Plus } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { NativeSelect } from '@/components/ui/native-select';
import { useApp, PersonLink } from './context';
import { Pager, pageRows } from './pagination';
import {
  mediaURL,
  albumName,
  profileName,
  Avatar,
  uid,
  stamp,
  type Row,
  request,
  type SearchResult,
} from './shared';
import { Feed } from './feed';

export function Title({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-title">
      <h1>{children}</h1>
      {action}
    </div>
  );
}
export function Profile({ id }: { id: string }) {
  const { world, person, open } = useApp();
  const p = person(id);
  if (!p) return <p>Profile not found.</p>;
  return (
    <>
      <Title
        action={
          <button
            className="gray-button"
            onClick={() => open({ kind: 'profile', row: p })}
          >
            Edit Profile
          </button>
        }
      >
        {profileName(p)}
      </Title>
      <p className="profile-bio">
        {p.state === 'stub' ? 'Full profile data is unavailable.' : p.bio}
      </p>
      <ProfileNetworks profileId={id} />
      <Tabs key={id} defaultValue="Wall" className="period-tabs">
        <TabsList>
          {['Wall', 'Info', 'Photos', 'Boxes'].map((t) => (
            <TabsTrigger key={t} value={t}>
              {t}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="Wall">
          <Feed
            wallId={id}
            posts={[...world.posts]
              .filter(
                (r: Row) =>
                  !r.groupId && (r.wallId === id || r.authorId === id),
              )
              .sort((a: Row, b: Row) => b.createdAt.localeCompare(a.createdAt))}
          />
        </TabsContent>
        <TabsContent value="Info">
          <ProfileNetworks profileId={id} details />
          <h2 className="info-heading">Basic Information</h2>
          <dl className="profile-info">
            {[
              ['City', 'city'],
              ['Hometown', 'hometown'],
              ['Birthday', 'birthday'],
              ['Relationship Status', 'relationship'],
              ['Education', 'education'],
              ['Work', 'work'],
              ['Interests', 'interests'],
              ['About Me', 'bio'],
            ].map(([label, key]) => (
              <div key={key}>
                <dt>{label}:</dt>
                <dd>{p[key] || 'Not added yet'}</dd>
              </div>
            ))}
          </dl>
        </TabsContent>
        <TabsContent value="Photos">
          <Photos ownerId={id} />
        </TabsContent>
        <TabsContent value="Boxes">
          <h2 className="info-heading">My Groups</h2>
          <div className="box-list">
            {world.groups
              .filter((g: Row) =>
                world.groupMembers.some(
                  (m: Row) => m.groupId === g.id && m.profileId === id,
                ),
              )
              .map((g: Row) => (
                <p key={g.id}>{g.name}</p>
              ))}
          </div>
          <h2 className="info-heading">Interests</h2>
          <p className="profile-bio">{p.interests || 'No interests added.'}</p>
        </TabsContent>
      </Tabs>
    </>
  );
}
export function Friends() {
  const { world, me, save, remove, open, busy } = useApp();
  const [filter, setFilter] = useState('');
  const relation = (id: string) =>
    world.friendships.find(
      (f: Row) =>
        (f.profileId === me.id && f.friendId === id) ||
        (f.friendId === me.id && f.profileId === id),
    );
  return (
    <>
      <Title
        action={
          <button
            className="blue-button"
            onClick={() => open({ kind: 'profile' })}
          >
            <Plus size={12} />
            Create Profile
          </button>
        }
      >
        Friends
      </Title>
      <input
        className="full-input"
        aria-label="Find a friend"
        placeholder="Find someone by name…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="list-caption">
        Everyone in this world · {world.profiles.length} profiles
      </div>
      {world.profiles
        .filter(
          (p: Row) =>
            p.id !== me.id &&
            p.name.toLowerCase().includes(filter.toLowerCase()),
        )
        .map((p: Row) => {
          const rel = relation(p.id);
          return (
            <div className="directory-row" key={p.id}>
              <Avatar person={p} size={60} />
              <div className="grow">
                <PersonLink id={p.id} />
                <p className="muted">{p.education}</p>
                <p className="muted">{p.city}</p>
                <button
                  className="text-link"
                  onClick={() => open({ kind: 'profile', row: p })}
                >
                  Edit Profile
                </button>
              </div>
              <div className="row-actions">
                {rel?.status === 'accepted' ? (
                  <>
                    <span className="muted">Friends</span>
                    <button
                      disabled={busy}
                      onClick={() => remove('friendships', rel.id)}
                    >
                      Remove Friend
                    </button>
                  </>
                ) : rel?.profileId === me.id ? (
                  <>
                    <span className="muted">Friend Request Sent</span>
                    <button
                      disabled={busy}
                      onClick={() => remove('friendships', rel.id)}
                    >
                      Cancel Request
                    </button>
                  </>
                ) : rel ? (
                  <>
                    <button
                      className="blue-button"
                      disabled={busy}
                      onClick={() =>
                        save('friendships', { ...rel, status: 'accepted' })
                      }
                    >
                      Confirm Friend
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => remove('friendships', rel.id)}
                    >
                      Ignore
                    </button>
                  </>
                ) : (
                  <button
                    className="gray-button"
                    disabled={busy}
                    onClick={() =>
                      save('friendships', {
                        id: uid(),
                        profileId: me.id,
                        friendId: p.id,
                        status: 'pending',
                      })
                    }
                  >
                    Add as Friend
                  </button>
                )}
              </div>
            </div>
          );
        })}
    </>
  );
}
export function Photos({ ownerId }: { ownerId?: string }) {
  const { world, open } = useApp();
  const [album, setAlbum] = useState('');
  const photos = world.photos.filter(
    (p: Row) => !ownerId || p.ownerId === ownerId,
  );
  const albums = world.albums.filter(
    (a) =>
      (!ownerId || a.ownerId === ownerId) &&
      photos.some((p) => p.albumId === a.id),
  );
  return (
    <>
      <Title
        action={
          <button
            className="blue-button"
            onClick={() => open({ kind: 'photo' })}
          >
            Upload Photos
          </button>
        }
      >
        {album ? albumName(world, album) : 'Photos'}
      </Title>
      {album ? (
        <>
          <button className="back-link" onClick={() => setAlbum('')}>
            « All albums
          </button>
          <button
            className="gray-button"
            onClick={() =>
              open({
                kind: 'album',
                row: world.albums.find((a) => a.id === album),
              })
            }
          >
            Edit Album
          </button>
          <div className="photo-grid">
            {photos
              .filter((p: Row) => p.albumId === album)
              .map((p: Row) => (
                <button
                  className="album"
                  key={p.id}
                  onClick={() => open({ kind: 'viewPhoto', row: p })}
                >
                  <img src={mediaURL(world, p.mediaId)} alt={p.caption} />
                  <b>{p.caption}</b>
                </button>
              ))}
          </div>
        </>
      ) : (
        <div className="photo-grid">
          {albums.map((a) => (
            <button className="album" key={a.id} onClick={() => setAlbum(a.id)}>
              <img
                src={mediaURL(
                  world,
                  a.coverMediaId ||
                    photos.find((p: Row) => p.albumId === a.id)?.mediaId,
                )}
                alt={a.name}
              />
              <b>{a.name}</b>
              <span>
                {profileName(world.profiles.find((p) => p.id === a.ownerId))}
              </span>
              <span>
                {photos.filter((p: Row) => p.albumId === a.id).length} photos
              </span>
            </button>
          ))}
        </div>
      )}
      {!photos.length && (
        <div className="empty-state">
          No photos yet. Upload a photo to start an album.
        </div>
      )}
    </>
  );
}
export function Events() {
  const { world, me, save, open, busy } = useApp();
  return (
    <>
      <Title
        action={
          <button
            className="blue-button"
            onClick={() => open({ kind: 'event' })}
          >
            Create an Event
          </button>
        }
      >
        Events
      </Title>
      <div className="list-caption">Events in your world</div>
      {[...world.events]
        .sort((a: Row, b: Row) => a.startsAt.localeCompare(b.startsAt))
        .map((e: Row) => {
          const guest = world.eventGuests.find(
            (g: Row) => g.eventId === e.id && g.profileId === me.id,
          );
          return (
            <article className="event-card" key={e.id}>
              <div className="calendar large">
                <span>
                  {new Date(e.startsAt)
                    .toLocaleString('en-US', { month: 'short' })
                    .toUpperCase()}
                </span>
                <b>{new Date(e.startsAt).getDate()}</b>
              </div>
              <div className="grow">
                <button
                  className="person-name"
                  onClick={() => open({ kind: 'event', row: e })}
                >
                  {e.title}
                </button>
                <p className="muted">{stamp(e.startsAt)}</p>
                <p>{e.location}</p>
                <p className="event-description">{e.description}</p>
                <div className="muted">
                  {
                    world.eventGuests.filter(
                      (g: Row) =>
                        g.eventId === e.id && g.status === 'attending',
                    ).length
                  }{' '}
                  attending · Hosted by <PersonLink id={e.creatorId} />
                </div>
                <div className="rsvp">
                  <label htmlFor={'rsvp-' + e.id}>Your reply:</label>
                  <NativeSelect
                    id={'rsvp-' + e.id}
                    disabled={busy}
                    value={guest?.status || ''}
                    onChange={(ev) =>
                      save('eventGuests', {
                        id: guest?.id || uid(),
                        eventId: e.id,
                        profileId: me.id,
                        status: ev.target.value,
                      })
                    }
                  >
                    <option value="" disabled>
                      Choose a reply
                    </option>
                    <option value="attending">Attending</option>
                    <option value="maybe">Maybe Attending</option>
                    <option value="declined">Not Attending</option>
                  </NativeSelect>
                  <button onClick={() => open({ kind: 'event', row: e })}>
                    Edit Event
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      {!world.events.length && (
        <div className="empty-state">No events yet.</div>
      )}
    </>
  );
}
export function Groups({ profileId }: { profileId?: string }) {
  const { world, me, go, open, save, remove, busy } = useApp();
  const groups = world.groups.filter(
    (g: Row) =>
      !profileId ||
      world.groupMembers.some(
        (m: Row) => m.groupId === g.id && m.profileId === profileId,
      ),
  );
  return (
    <>
      {!profileId && (
        <Title
          action={
            <button
              className="blue-button"
              onClick={() => open({ kind: 'group' })}
            >
              Create a Group
            </button>
          }
        >
          Groups
        </Title>
      )}
      {groups.map((g: Row) => {
        const member = world.groupMembers.find(
          (m: Row) => m.profileId === me.id && m.groupId === g.id,
        );
        return (
          <div className="directory-row" key={g.id}>
            <div className="group-icon">
              <Users size={30} />
            </div>
            <div className="grow">
              <button className="person-name" onClick={() => go('group', g.id)}>
                {g.name}
              </button>
              <p className="muted">
                {g.category} ·{' '}
                {
                  world.groupMembers.filter((m: Row) => m.groupId === g.id)
                    .length
                }{' '}
                members
              </p>
              <p>{g.description}</p>
            </div>
            <button
              className="gray-button"
              disabled={busy}
              onClick={() =>
                member
                  ? remove('groupMembers', member.id)
                  : save('groupMembers', {
                      id: uid(),
                      groupId: g.id,
                      profileId: me.id,
                    })
              }
            >
              {member ? 'Leave Group' : 'Join Group'}
            </button>
          </div>
        );
      })}
      {!groups.length && <p className="empty-state">No groups yet.</p>}
    </>
  );
}
export function Group({ id }: { id: string }) {
  const { world, go, open, person } = useApp();
  const g = world.groups.find((r: Row) => r.id === id);
  if (!g) return <p>Group not found.</p>;
  return (
    <>
      <button className="back-link" onClick={() => go('groups')}>
        « All Groups
      </button>
      <Title
        action={
          <button
            className="gray-button"
            onClick={() => open({ kind: 'group', row: g })}
          >
            Edit Group
          </button>
        }
      >
        {g.name}
      </Title>
      <p className="profile-bio">{g.description}</p>
      <div className="member-strip">
        {world.groupMembers
          .filter((m: Row) => m.groupId === id)
          .map((m: Row) => (
            <button
              key={m.id}
              onClick={() => go('profile', m.profileId)}
              aria-label={profileName(person(m.profileId))}
            >
              <Avatar person={person(m.profileId)} size={35} />
            </button>
          ))}
        <span className="muted">{g.category}</span>
      </div>
      <Feed
        groupId={id}
        posts={[...world.posts]
          .filter((p: Row) => p.groupId === id)
          .sort((a: Row, b: Row) => b.createdAt.localeCompare(a.createdAt))}
      />
    </>
  );
}
export function Messages() {
  const { world, me, person, save, open, chat } = useApp();
  const [tab, setTab] = useState('Inbox');
  const [page, setPage] = useState(1);
  const messages = world.messages
    .filter((m: Row) =>
      tab === 'Inbox' ? m.recipientId === me.id : m.senderId === me.id,
    )
    .sort((a: Row, b: Row) => b.createdAt.localeCompare(a.createdAt));
  const pagedMessages = pageRows(messages, page, 8);
  return (
    <>
      <Title
        action={
          <button
            className="blue-button"
            onClick={() => open({ kind: 'message' })}
          >
            + New Message
          </button>
        }
      >
        Messages
      </Title>
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(String(v));
          setPage(1);
        }}
        className="period-tabs"
      >
        <TabsList>
          <TabsTrigger value="Inbox">Inbox</TabsTrigger>
          <TabsTrigger value="Sent">Sent</TabsTrigger>
        </TabsList>
        {['Inbox', 'Sent'].map((t) => (
          <TabsContent value={t} key={t}>
            {pagedMessages.rows.map((m: Row) => {
              const other = tab === 'Inbox' ? m.senderId : m.recipientId;
              return (
                <button
                  key={m.id}
                  className={
                    'message-row ' +
                    (!m.read && tab === 'Inbox' ? 'unread' : '')
                  }
                  onClick={async () => {
                    if (!m.read && m.recipientId === me.id)
                      await save('messages', { ...m, read: 1 });
                    chat(other);
                  }}
                >
                  <Avatar person={person(other)} />
                  <div className="grow">
                    <b className="person-name">{profileName(person(other))}</b>
                    <b className="message-subject">{m.subject}</b>
                    <p>{m.body}</p>
                  </div>
                  <span className="muted">{stamp(m.createdAt)}</span>
                </button>
              );
            })}
            <Pager
              page={pagedMessages.page}
              pageCount={pagedMessages.pageCount}
              onChange={setPage}
            />
            {!messages.length && (
              <div className="empty-state">No messages here yet.</div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}
export function Notifications() {
  const { world, me, person, save, go } = useApp();
  const [page, setPage] = useState(1);
  const rows = world.notifications
    .filter((n: Row) => n.profileId === me.id)
    .sort((a: Row, b: Row) => b.createdAt.localeCompare(a.createdAt));
  const pagedRows = pageRows(rows, page, 8);
  return (
    <>
      <Title>Notifications</Title>
      {pagedRows.rows.map((n: Row) => (
        <button
          key={n.id}
          className={'message-row ' + (!n.read ? 'unread' : '')}
          onClick={async () => {
            if (!n.read) await save('notifications', { ...n, read: 1 });
            go(n.postId ? 'post' : 'profile', n.postId || n.actorId);
          }}
        >
          <Avatar person={person(n.actorId)} size={40} />
          <div>
            <p>{n.body}</p>
            <span className="muted">{stamp(n.createdAt)}</span>
          </div>
        </button>
      ))}
      <Pager
        page={pagedRows.page}
        pageCount={pagedRows.pageCount}
        onChange={setPage}
      />
      {!rows.length && <div className="empty-state">You’re all caught up.</div>}
    </>
  );
}
export function SearchResults({ query }: { query: string }) {
  const { world, go } = useApp();
  const [networkId, setNetworkId] = useState('');
  const [results, setResults] = useState<SearchResult | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    request<SearchResult>(
      'search?q=' +
        encodeURIComponent(query) +
        '&network=' +
        encodeURIComponent(networkId),
    )
      .then((value) => active && setResults(value))
      .catch((reason: Error) => active && setError(reason.message));
    return () => {
      active = false;
    };
  }, [query, world, networkId]);
  const people = results?.profiles ?? [];
  const posts = results?.posts ?? [];
  const groups = results?.groups ?? [];
  return (
    <>
      <Title>Search Results</Title>
      <p className="list-caption">Results for “{query}”</p>
      {!results && !error && <p className="empty-state">Searching…</p>}
      {error && <p className="error">{error}</p>}
      <label className="list-caption">
        Network{' '}
        <select
          aria-label="Filter people by network"
          value={networkId}
          onChange={(e) => setNetworkId(e.target.value)}
        >
          <option value="">All networks</option>
          {world.networks.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
      </label>
      {(results?.networks ?? []).map((n) => (
        <div className="directory-row" key={n.id}>
          <Users size={24} />
          <button className="person-name" onClick={() => go('network', n.id)}>
            {n.name}
          </button>
          <span className="muted">Network</span>
        </div>
      ))}
      {people.map((p: Row) => (
        <div className="directory-row" key={p.id}>
          <Avatar person={p} />
          <div>
            <PersonLink id={p.id} />
            <p className="muted">{p.city}</p>
          </div>
        </div>
      ))}
      {groups.map((g: Row) => (
        <div className="directory-row" key={g.id}>
          <Users size={24} />
          <button className="person-name" onClick={() => go('group', g.id)}>
            {g.name}
          </button>
        </div>
      ))}
      <Feed posts={posts} compose={false} />
    </>
  );
}
