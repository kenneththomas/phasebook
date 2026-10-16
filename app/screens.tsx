import { ProfileNetworks } from './networks';
import { Photos, PhotoGrid } from './photos';
export { Photos } from './photos';
import { useEffect, useState } from 'react';
import { Users, Plus } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { NativeSelect } from '@/components/ui/native-select';
import { useApp, PersonLink } from './context';
import { Pager, pageRows } from './pagination';
import {
  profileName,
  Avatar,
  uid,
  stamp,
  type Row,
  request,
  type SearchResult,
  ageFromBirthday,
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
  const { world, me, person, open, go } = useApp();
  const p = person(id);
  if (!p) return <p>Profile not found.</p>;
  const friendship = world.friendships.find(
    (row: Row) =>
      row.status === 'accepted' &&
      ((row.profileId === me.id && row.friendId === id) ||
        (row.friendId === me.id && row.profileId === id)),
  );
  const shortYear = (year: unknown) => {
    const value =
      typeof year === 'string' || typeof year === 'number' ? year : '';
    return value ? `'${value.toString().slice(-2)}` : '';
  };
  const highSchoolInfo = [p.highSchool, shortYear(p.highSchoolGraduationYear)]
    .filter(Boolean)
    .join(' ');
  const collegeYear = shortYear(p.collegeGraduationYear);
  const collegeLine = [p.college, collegeYear].filter(Boolean).join(' ');
  const collegeInfo = p.collegeMajor
    ? ([collegeLine, p.collegeMajor] as const)
    : collegeLine;
  const age = ageFromBirthday(p.birthday);
  return (
    <>
      <Title
        action={
          <div className="title-actions">
            {friendship && (
              <button
                className="gray-button"
                onClick={() => go('friendship', friendship.id)}
              >
                See Friendship
              </button>
            )}
            <button
              className="gray-button"
              onClick={() => open({ kind: 'profile', row: p })}
            >
              Edit Profile
            </button>
          </div>
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
              ['Gender', 'gender'],
              ['Political Views', 'politicalViews'],
              ['Religious Views', 'religiousViews'],
              ['High School', 'highSchoolInfo'],
              ['College', 'collegeInfo'],
              ['Job Title', 'jobTitle'],
              ['Employer', 'employer'],
              ['Interests', 'interests'],
              ['About Me', 'bio'],
              ['Voice', 'voice'],
              ['Communication Style', 'communicationStyle'],
              ['Behavioral Tendencies', 'behavioralTendencies'],
            ].map(([label, key]) => (
              <div key={key}>
                <dt>{label}:</dt>
                <dd>
                  {key === 'highSchoolInfo' ? (
                    highSchoolInfo || 'Not added yet'
                  ) : key === 'collegeInfo' ? (
                    Array.isArray(collegeInfo) ? (
                      <>
                        {collegeInfo[0]}
                        <br />
                        {collegeInfo[1]}
                      </>
                    ) : (
                      collegeInfo || 'Not added yet'
                    )
                  ) : key === 'birthday' ? (
                    p.birthday ? (
                      <>
                        {p.birthday}
                        {age !== null && (
                          <>
                            {' '}
                            ({age} {age === 1 ? 'year' : 'years'} old)
                          </>
                        )}
                      </>
                    ) : (
                      'Not added yet'
                    )
                  ) : key === 'relationship' ? (
                    <>
                      {p.relationship || 'Not added yet'}
                      {p.relationshipWithId && (
                        <>
                          {' '}
                          with <PersonLink id={p.relationshipWithId} />
                        </>
                      )}
                    </>
                  ) : (
                    p[key] || 'Not added yet'
                  )}
                </dd>
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
export function TaggedPhotos({ profileId }: { profileId: string }) {
  const { world, person } = useApp();
  const ids = new Set(
    world.photoTags
      .filter((tag) => tag.profileId === profileId)
      .map((tag) => tag.photoId),
  );
  const photos = world.photos.filter((photo) => ids.has(photo.id));
  return (
    <section className="tagged-photos">
      <Title>
        Photos of {profileName(person(profileId))} ({photos.length})
      </Title>
      {photos.length ? (
        <PhotoGrid photos={photos} />
      ) : (
        <div className="empty-state">No tagged photos yet.</div>
      )}
    </section>
  );
}
export function Friends() {
  const { world, me, save, remove, open, busy, go } = useApp();
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
                <p className="muted">{p.college || p.highSchool}</p>
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
                      className="text-link"
                      onClick={() => go('friendship', rel.id)}
                    >
                      See Friendship
                    </button>
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
                      className="blue-button"
                      disabled={busy}
                      onClick={() =>
                        save('friendships', { ...rel, status: 'accepted' })
                      }
                    >
                      Force Accept (Simulation)
                    </button>
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
export function Friendship({ id }: { id: string }) {
  const { world, person, open } = useApp();
  const friendship = world.friendships.find(
    (row: Row) => row.id === id && row.status === 'accepted',
  );
  if (!friendship) return <p>Friendship not found.</p>;
  const first = person(friendship.profileId);
  const second = person(friendship.friendId);
  const betweenPosts = [...world.posts]
    .filter(
      (post: Row) =>
        !post.groupId &&
        ((post.authorId === first.id && post.wallId === second.id) ||
          (post.authorId === second.id && post.wallId === first.id)),
    )
    .sort((a: Row, b: Row) => b.createdAt.localeCompare(a.createdAt));
  const events = world.relationshipEvents
    .filter((event: Row) => event.friendshipId === friendship.id)
    .sort((a: Row, b: Row) => b.occurredAt.localeCompare(a.occurredAt));
  const date = (value: string) =>
    new Date(
      value + (value.length === 10 ? 'T12:00:00' : ''),
    ).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  return (
    <>
      <Title
        action={
          <button
            className="gray-button"
            onClick={() => open({ kind: 'relationship', row: friendship })}
          >
            Edit Relationship
          </button>
        }
      >
        Friendship
      </Title>
      <section className="friendship-hero">
        <div className="friendship-people">
          <div>
            <Avatar person={first} size={82} />
            <PersonLink id={first.id} />
          </div>
          <span className="friendship-ampersand">&amp;</span>
          <div>
            <Avatar person={second} size={82} />
            <PersonLink id={second.id} />
          </div>
        </div>
        <h2>{friendship.relationshipType || 'Friends'}</h2>
        <div className="relationship-summary">
          {friendship.closeness && (
            <p>
              <b>Closeness:</b> {friendship.closeness}
            </p>
          )}
          {friendship.howMet && (
            <p>
              <b>How they know each other:</b> {friendship.howMet}
            </p>
          )}
          {friendship.metAt && (
            <p>
              <b>Met:</b> {date(friendship.metAt)}
            </p>
          )}
          {friendship.sharedHistory && (
            <p>
              <b>Shared history:</b> {friendship.sharedHistory}
            </p>
          )}
          {!friendship.closeness &&
            !friendship.howMet &&
            !friendship.metAt &&
            !friendship.sharedHistory && (
              <p className="muted">
                No relationship context has been added yet.
              </p>
            )}
        </div>
      </section>
      <section className="friendship-section">
        <div className="section-heading-row">
          <h2>Relationship History</h2>
          <button
            className="gray-button"
            onClick={() =>
              open({ kind: 'relationshipEvent', friendshipId: friendship.id })
            }
          >
            Add Event
          </button>
        </div>
        {events.length ? (
          <ol className="relationship-timeline">
            {events.map((event: Row) => (
              <li key={event.id}>
                <button
                  className="text-link"
                  onClick={() =>
                    open({ kind: 'relationshipEvent', row: event })
                  }
                >
                  {event.label}
                </button>
                <time>{date(event.occurredAt)}</time>
                {event.details && <p>{event.details}</p>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">No relationship events have been added.</p>
        )}
      </section>
      <section className="friendship-section">
        <h2>
          Wall Posts Between {profileName(first)} and {profileName(second)}
        </h2>
        {betweenPosts.length ? (
          <Feed compose={false} posts={betweenPosts} />
        ) : (
          <p className="muted">
            They have not written on each other’s Walls yet.
          </p>
        )}
      </section>
      <section className="friendship-section">
        <h2>Photos of Both</h2>
        <PhotoGrid
          photos={world.photos.filter(
            (p) =>
              world.photoTags.some(
                (t) => t.photoId === p.id && t.profileId === first.id,
              ) &&
              world.photoTags.some(
                (t) => t.photoId === p.id && t.profileId === second.id,
              ),
          )}
        />
        {!world.photos.some(
          (p) =>
            world.photoTags.some(
              (t) => t.photoId === p.id && t.profileId === first.id,
            ) &&
            world.photoTags.some(
              (t) => t.photoId === p.id && t.profileId === second.id,
            ),
        ) && <p>No photos have both people tagged yet.</p>}
      </section>
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
  const { world, me, person, save, go, open } = useApp();
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
            const photo = world.photos.find((p) => p.id === n.photoId);
            if (photo) open({ kind: 'viewPhoto', row: photo });
            else go(n.postId ? 'post' : 'profile', n.postId || n.actorId);
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
