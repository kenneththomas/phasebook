import { Networks } from './networks';
import { Generation } from './generation';
import { useEffect, useRef, useState } from 'react';
import {
  Newspaper,
  Mail,
  CalendarDays,
  Images,
  Users,
  Bell,
  Search,
  MessageCircle,
  ChevronDown,
  Settings,
  X,
} from 'lucide-react';
import {
  SidebarProvider,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from '@/components/ui/sidebar';
import {
  mediaURL,
  albumName,
  profileName,
  Avatar,
  request,
  applyMutation,
  uid,
  now,
  stamp,
  rowById,
  rowsBy,
  type World,
  type Row,
  type MutationResult,
} from './shared';
import { AppContext, useApp, PersonLink, type ModalState } from './context';
import { Feed } from './feed';
import {
  Profile,
  Friends,
  Photos,
  Events,
  Groups,
  Group,
  Messages,
  Notifications,
  SearchResults,
  Title,
} from './screens';
import { Modal } from './dialogs';

function readRoute() {
  const parts = location.hash.slice(1).split('/');
  try {
    return {
      view: parts[0] || 'home',
      id: decodeURIComponent(parts.slice(1).join('/')),
    };
  } catch {
    return { view: 'home', id: '' };
  }
}
export default function App() {
  const [world, setWorld] = useState<World | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pendingWrites = useRef(0);
  const [route, setRoute] = useState(readRoute);
  const [modal, setModal] = useState<ModalState>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('Top News');
  const [chatId, setChatId] = useState('');
  const [chatList, setChatList] = useState(false);
  useEffect(() => {
    request('state')
      .then(setWorld)
      .catch((e) => setError(e.message));
    const change = () => {
      setRoute(readRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    document.title =
      'Phasebook | ' +
      ({
        home: 'Home',
        profile: 'Profile',
        networks: 'Networks',
        generation: 'Generation',
        network: 'Network',
        groups: 'Groups',
        group: 'Group',
        photos: 'Photos',
        messages: 'Messages',
        friends: 'Friends',
        events: 'Events',
        notifications: 'Notifications',
        search: 'Search',
      }[route.view] || 'Wall');
  }, [route]);
  const go = (view: string, id = '') => {
    window.location.assign(
      '#' + view + (id ? '/' + encodeURIComponent(id) : ''),
    );
  };
  const mutate = (
    path: string,
    method: string,
    value?: unknown,
  ): Promise<boolean> => {
    pendingWrites.current += 1;
    setBusy(true);
    const task = queue.current.then(async () => {
      setError('');
      try {
        const result = await request<World | MutationResult>(
          path,
          method,
          value,
        );
        setWorld((current) =>
          'schemaVersion' in result ? result : applyMutation(current!, result),
        );
        if (path === 'switch' || path === 'import') {
          setChatId('');
          setChatList(false);
        }
        return true;
      } catch (e) {
        setError((e as Error).message);
        return false;
      } finally {
        pendingWrites.current -= 1;
        setBusy(pendingWrites.current > 0);
      }
    });
    queue.current = task;
    return task;
  };
  if (!world)
    return (
      <div className="loading">
        <b>phasebook</b>
        <p>{error || 'Opening your local world…'}</p>
        {error && (
          <button className="blue-button" onClick={() => location.reload()}>
            Try Again
          </button>
        )}
      </div>
    );
  const me = rowById(world.profiles, world.settings.activeProfileId)!;
  const person = (id: string) => rowById(world.profiles, id)!;
  const save = (table: string, row: Row) =>
    mutate('records/' + table, 'POST', row);
  const remove = (table: string, id: string) =>
    mutate('records/' + table + '/' + encodeURIComponent(id), 'DELETE');
  const run = (path: string, value: unknown) => mutate(path, 'POST', value);
  const chat = (id: string) => {
    setChatId(id);
    setChatList(false);
    void run('read-conversation', { profileId: me.id, otherId: id });
  };
  const ctx = {
    world,
    me,
    busy,
    save,
    remove,
    run,
    go,
    open: setModal,
    fail: setError,
    person,
    chat,
  };
  const online = world.profiles.filter((p: Row) => p.id !== me.id).slice(0, 4);
  const unread = world.messages.filter(
    (m: Row) => m.recipientId === me.id && !m.read,
  ).length;
  const notices = world.notifications.filter(
    (n: Row) => n.profileId === me.id && !n.read,
  ).length;
  const pending = world.friendships.filter(
    (f: Row) => f.status === 'pending' && f.friendId === me.id,
  ).length;
  const friendship = (a: string, b: string) =>
    world.friendships.some(
      (f: Row) =>
        f.status === 'accepted' &&
        ((f.profileId === a && f.friendId === b) ||
          (f.profileId === b && f.friendId === a)),
    );
  const viewed = route.view === 'profile' ? person(route.id || me.id) : null;
  const posts = [...world.posts]
    .filter(
      (p: Row) =>
        !p.groupId &&
        (p.authorId === me.id ||
          p.wallId === me.id ||
          friendship(me.id, p.authorId)),
    )
    .sort((a: Row, b: Row) => {
      if (sort === 'Top News') {
        const score = (id: string) =>
          rowsBy(world.likes, 'postId', id).length +
          rowsBy(world.comments, 'postId', id).length * 2;
        const delta = score(b.id) - score(a.id);
        if (delta) return delta;
      }
      return b.createdAt.localeCompare(a.createdAt);
    });
  const navItems = [
    { icon: Newspaper, label: 'News Feed', view: 'home' },
    { icon: Mail, label: 'Messages', view: 'messages', count: unread },
    { icon: CalendarDays, label: 'Events', view: 'events' },
    { icon: Images, label: 'Photos', view: 'photos' },
    { icon: Users, label: 'Friends', view: 'friends', count: pending },
    { icon: Users, label: 'Networks', view: 'networks' },
    { icon: Settings, label: 'Generation', view: 'generation' },
    { icon: Users, label: 'Groups', view: 'groups' },
  ];
  let content: React.ReactNode;
  switch (route.view) {
    case 'profile':
      content = <Profile id={route.id || me.id} />;
      break;
    case 'friends':
      content = <Friends />;
      break;
    case 'photos':
      content = <Photos />;
      break;
    case 'events':
      content = <Events />;
      break;
    case 'generation':
      content = <Generation />;
      break;
    case 'networks':
    case 'network':
      content = (
        <Networks
          key={route.id || 'all'}
          id={route.view === 'network' ? route.id : undefined}
        />
      );
      break;
    case 'groups':
      content = <Groups />;
      break;
    case 'group':
      content = <Group id={route.id} />;
      break;
    case 'messages':
      content = <Messages />;
      break;
    case 'notifications':
      content = <Notifications />;
      break;
    case 'search':
      content = <SearchResults key={route.id} query={route.id} />;
      break;
    case 'post':
      content = (
        <>
          <Title>Wall Post</Title>
          <Feed
            compose={false}
            posts={
              rowById(world.posts, route.id)
                ? [rowById(world.posts, route.id)!]
                : []
            }
          />
        </>
      );
      break;
    default:
      content = (
        <>
          <Title
            action={
              <div className="feed-sort">
                {['Top News', 'Most Recent'].map((s) => (
                  <button
                    key={s}
                    className={sort === s ? 'chosen' : ''}
                    aria-pressed={sort === s}
                    onClick={() => setSort(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            }
          >
            News Feed
          </Title>
          <Feed posts={posts} />
        </>
      );
  }
  return (
    <AppContext.Provider value={ctx}>
      <SidebarProvider className="phasebook">
        <header className="topbar">
          <div className="top-inner">
            <button className="logo" onClick={() => go('home')}>
              phasebook
            </button>
            <div className="header-icons">
              <button
                aria-label="Friend requests"
                onClick={() => go('friends')}
              >
                <Users size={19} />
                {pending > 0 && <span className="badge">{pending}</span>}
              </button>
              <button aria-label="Messages" onClick={() => go('messages')}>
                <Mail size={19} />
                {unread > 0 && <span className="badge">{unread}</span>}
              </button>
              <button
                aria-label="Notifications"
                onClick={() => go('notifications')}
              >
                <Bell size={18} />
                {notices > 0 && <span className="badge">{notices}</span>}
              </button>
            </div>
            <form
              className="search"
              onSubmit={(e) => {
                e.preventDefault();
                if (search.trim()) go('search', search.trim());
              }}
            >
              <input
                aria-label="Search Phasebook"
                placeholder="Search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button aria-label="Search">
                <Search size={15} />
              </button>
            </form>
            <nav aria-label="Main">
              <button onClick={() => go('home')}>Home</button>
              <button onClick={() => go('profile', me.id)}>Profile</button>
              <button onClick={() => setModal({ kind: 'manage' })}>
                Account
              </button>
              <button onClick={() => setModal({ kind: 'switch' })}>
                Log In <ChevronDown size={10} />
              </button>
            </nav>
          </div>
        </header>
        <div className="page-shell">
          <aside className="left">
            {viewed ? (
              <div className="profile-left">
                <Avatar person={viewed} size={160} />
                <button
                  className="text-link"
                  onClick={() => setModal({ kind: 'profile', row: viewed })}
                >
                  Edit Profile
                </button>
                <button className="text-link" onClick={() => chat(viewed.id)}>
                  Send {profileName(viewed).split(' ')[0]} a Message
                </button>
                <p className="profile-quote">“{viewed.bio}”</p>
                <h4>INFORMATION</h4>
                <p className="muted">Current City</p>
                <p>{viewed.city || 'Not added'}</p>
                <p className="muted">Education</p>
                <p>{viewed.college || viewed.highSchool || 'Not added'}</p>
                <h4>FRIENDS</h4>
                <div className="friend-thumbnails">
                  {world.profiles
                    .filter((p: Row) => friendship(viewed.id, p.id))
                    .slice(0, 6)
                    .map((p: Row) => (
                      <button key={p.id} onClick={() => go('profile', p.id)}>
                        <Avatar person={p} size={46} />
                        <span>{profileName(p).split(' ')[0]}</span>
                      </button>
                    ))}
                </div>
              </div>
            ) : (
              <div className="identity">
                <button
                  aria-label="My profile"
                  onClick={() => go('profile', me.id)}
                >
                  <Avatar person={me} />
                </button>
                <div>
                  <PersonLink id={me.id} />
                  <button
                    className="text-link"
                    onClick={() => setModal({ kind: 'profile', row: me })}
                  >
                    Edit My Profile
                  </button>
                </div>
              </div>
            )}
            <SidebarMenu>
              {navItems.map(({ icon: Icon, label, view, count }) => (
                <SidebarMenuItem key={view}>
                  <SidebarMenuButton
                    className="nav-item"
                    isActive={route.view === view}
                    onClick={() => go(view)}
                  >
                    <Icon />
                    <span>{label}</span>
                    {!!count && <span className="count">{count}</span>}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
            <h4>GROUPS</h4>
            {world.groups
              .filter((g: Row) =>
                world.groupMembers.some(
                  (m: Row) => m.groupId === g.id && m.profileId === me.id,
                ),
              )
              .map((g: Row) => (
                <button
                  className="group-link"
                  key={g.id}
                  onClick={() => go('group', g.id)}
                >
                  <Users size={13} />
                  {g.name}
                </button>
              ))}
            <h4>FRIENDS ONLINE</h4>
            {online.map((p: Row) => (
              <button
                className="online-person"
                key={p.id}
                onClick={() => chat(p.id)}
              >
                <Avatar person={p} size={25} />
                <span>{profileName(p)}</span>
                <i className="online-dot" />
              </button>
            ))}
          </aside>
          <main
            className="center"
            key={route.view + '/' + route.id + '/' + me.id}
          >
            {content}
          </main>
          <aside className="right">
            <div className="section-heading">Requests</div>
            <p className="side-line">
              <Users size={14} />
              <button onClick={() => go('friends')}>
                {pending
                  ? `${pending} friend request${pending > 1 ? 's' : ''}`
                  : 'Find friends in your world'}
              </button>
            </p>
            <div className="section-heading">
              Upcoming Events <CalendarDays size={12} />
            </div>
            {world.events.slice(0, 2).map((e: Row) => (
              <div className="side-event" key={e.id}>
                <div className="calendar">
                  <span>
                    {new Date(e.startsAt)
                      .toLocaleDateString('en-US', { month: 'short' })
                      .toUpperCase()}
                  </span>
                  <b>{new Date(e.startsAt).getDate()}</b>
                </div>
                <div>
                  <button className="person-name" onClick={() => go('events')}>
                    {e.title}
                  </button>
                  <p>
                    {new Date(e.startsAt).toLocaleDateString('en-US', {
                      weekday: 'long',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </p>
                </div>
              </div>
            ))}
            <div className="section-heading">People You May Know</div>
            {world.profiles
              .filter((p: Row) => p.id !== me.id && !friendship(me.id, p.id))
              .slice(0, 2)
              .map((p: Row) => (
                <div className="suggestion" key={p.id}>
                  <Avatar person={p} />
                  <div>
                    <PersonLink id={p.id} />
                    <p>
                      {
                        world.profiles.filter(
                          (m: Row) =>
                            friendship(me.id, m.id) && friendship(p.id, m.id),
                        ).length
                      }{' '}
                      mutual friends
                    </p>
                    <button className="text-link" onClick={() => go('friends')}>
                      Add as Friend
                    </button>
                  </div>
                </div>
              ))}
            {world.profiles.every(
              (p: Row) => p.id === me.id || friendship(me.id, p.id),
            ) && <p className="muted">You’re connected to everyone here.</p>}
            <div className="section-heading">Photo of the Day</div>
            {world.photos.length > 0 ? (
              <>
                <button
                  className="photo-open"
                  onClick={() =>
                    setModal({
                      kind: 'viewPhoto',
                      row: world.photos[1] || world.photos[0],
                    })
                  }
                >
                  <img
                    className="sidebar-photo"
                    src={mediaURL(
                      world,
                      (world.photos[1] || world.photos[0]).mediaId,
                    )}
                    alt={(world.photos[1] || world.photos[0]).caption}
                  />
                </button>
                <button className="person-name" onClick={() => go('photos')}>
                  {(world.photos[1] || world.photos[0]).caption}
                </button>
                <p className="muted">
                  From{' '}
                  {albumName(
                    world,
                    (world.photos[1] || world.photos[0]).albumId,
                  )}
                </p>
              </>
            ) : (
              <button onClick={() => setModal({ kind: 'photo' })}>
                Share your first photo
              </button>
            )}
            <div className="local-note">
              <i className="online-dot" /> Local simulation
              <br />
              <span>March 2010, all over again.</span>
            </div>
            <button
              className="text-link"
              onClick={() => setModal({ kind: 'manage' })}
            >
              <Settings size={12} /> Manage this world
            </button>
          </aside>
        </div>
        <footer className="site-footer">
          <span>Phasebook © 2010</span>
          <span>
            A fictional, local social world.{' '}
            <span className="footer-separator">·</span> English (US)
          </span>
        </footer>
        <div className="chat-bar">
          <span>Phasebook · Local simulation</span>
          <button
            aria-expanded={chatList}
            onClick={() => setChatList(!chatList)}
          >
            <MessageCircle size={14} />
            <i className="online-dot" /> Chat ({online.length})
          </button>
          {chatList && (
            <div className="chat-list">
              <div className="chat-heading">
                Chat{' '}
                <button
                  aria-label="Close chat list"
                  onClick={() => setChatList(false)}
                >
                  <X size={14} />
                </button>
              </div>
              {online.map((p: Row) => (
                <button
                  className="online-person"
                  key={p.id}
                  onClick={() => chat(p.id)}
                >
                  <Avatar person={p} size={28} />
                  {profileName(p)}
                  <i className="online-dot" />
                </button>
              ))}
              <p className="muted chat-hint">Simulated online friends</p>
            </div>
          )}
        </div>
        {chatId && person(chatId) && (
          <ChatWindow
            key={me.id + chatId}
            otherId={chatId}
            close={() => setChatId('')}
          />
        )}
        <Modal modal={modal} />
        {error && (
          <div role="alert" className="error-toast">
            {error}
            <button onClick={() => setError('')}>Dismiss</button>
          </div>
        )}
        <output className="sr-only">{busy ? 'Saving changes…' : ''}</output>
      </SidebarProvider>
    </AppContext.Provider>
  );
}
function ChatWindow({
  otherId,
  close,
}: {
  otherId: string;
  close: () => void;
}) {
  const { world, me, person, save, busy } = useApp();
  const [body, setBody] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const messages = world.messages
    .filter(
      (m: Row) =>
        (m.senderId === me.id && m.recipientId === otherId) ||
        (m.senderId === otherId && m.recipientId === me.id),
    )
    .sort((a: Row, b: Row) => a.createdAt.localeCompare(b.createdAt));
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length]);
  return (
    <section
      className="chat-window"
      aria-label={'Chat with ' + profileName(person(otherId))}
    >
      <div className="chat-heading">
        <i className="online-dot" />
        {profileName(person(otherId))}
        <button aria-label="Close conversation" onClick={close}>
          <X size={14} />
        </button>
      </div>
      <div className="chat-messages">
        {messages.map((m: Row) => (
          <div className="chat-message" key={m.id}>
            <Avatar person={person(m.senderId)} size={25} />
            <div>
              <b>{profileName(person(m.senderId)).split(' ')[0]}</b>
              <p>{m.body}</p>
              <span className="muted">{stamp(m.createdAt)}</span>
            </div>
          </div>
        ))}
        {!messages.length && <p className="muted">Start a conversation.</p>}
        <div ref={end} />
      </div>
      <form
        className="chat-input"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            body.trim() &&
            (await save('messages', {
              id: uid(),
              senderId: me.id,
              recipientId: otherId,
              subject: 'Chat',
              body: body.trim(),
              createdAt: now(),
              read: 0,
            }))
          )
            setBody('');
        }}
      >
        <input
          aria-label="Chat message"
          placeholder="Type a message…"
          value={body}
          maxLength={20000}
          onChange={(e) => setBody(e.target.value)}
        />
        <button className="gray-button" disabled={busy || !body.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
