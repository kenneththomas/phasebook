import { NetworkEditor } from './networks';
import { PhotoViewer, PhotoUploader } from './photos';
export { PhotoViewer } from './photos';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
} from '@/components/ui/alert-dialog';
import { NativeSelect } from '@/components/ui/native-select';
import {
  albumName,
  profileName,
  Avatar,
  emptyProfile,
  uid,
  now,
  type Row,
  type World,
} from './shared';
import { useApp, type ModalState } from './context';
import { MediaEditor } from './media-editor';
import { useInventAName } from '../hooks/use-invent-a-name';

export function Modal({ modal }: { modal: ModalState }) {
  const { open, world, error } = useApp();
  if (!modal) return null;
  const titles: Record<string, string> = {
    switch: 'Log In · Choose a Profile',
    profile: modal.row ? 'Edit Profile' : 'Create a Profile',
    manage: 'Manage this world',
    network: 'Manage Network',
    networkMembership: 'Manage Network Membership',
    post: 'Edit Post',
    photo: modal.row ? 'Edit Photo' : 'Upload Photos',
    viewPhoto: modal.row ? albumName(world, modal.row.albumId) : 'Photo',
    album: modal.row ? 'Edit Album' : 'Create Album',
    event: modal.row ? 'Edit Event' : 'Create an Event',
    group: modal.row ? 'Edit Group' : 'Create a Group',
    message: 'New Message',
    relationship: 'Edit Relationship Context',
    relationshipEvent: modal.row
      ? 'Edit Relationship Event'
      : 'Add Relationship Event',
  };
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) open(null);
      }}
    >
      <DialogContent
        className={
          'period-dialog ' + (modal.kind === 'viewPhoto' ? 'photo-dialog' : '')
        }
      >
        <DialogTitle className="dialog-title">{titles[modal.kind]}</DialogTitle>
        <DialogDescription className="dialog-description">
          {modal.kind === 'switch'
            ? 'Choose anyone in your local world. No password needed.'
            : modal.kind === 'manage'
              ? 'Your profiles, memories, and conversations, saved on this computer.'
              : modal.kind === 'profile'
                ? 'You can create and edit every profile in this world.'
                : 'Saved in your local Phasebook world.'}
        </DialogDescription>
        <div className="dialog-body">
          {error && (
            <p className="photo-confirm" role="alert">
              {error}
            </p>
          )}
          {modal.kind === 'switch' ? (
            <Switcher />
          ) : modal.kind === 'manage' ? (
            <Manage />
          ) : ['network', 'networkMembership'].includes(modal.kind) ? (
            <NetworkEditor
              key={modal.kind + (modal.row?.id || 'new')}
              kind={modal.kind}
              row={modal.row}
            />
          ) : modal.kind === 'viewPhoto' ? (
            <PhotoViewer
              key={modal.row!.id}
              row={modal.row!}
              photoIds={modal.photoIds}
            />
          ) : modal.kind === 'photo' && !modal.row ? (
            <PhotoUploader
              ownerId={modal.ownerId}
              albumId={modal.albumId}
              onSaved={modal.onSaved}
            />
          ) : (
            <Editor
              key={modal.kind + (modal.row?.id || 'new')}
              kind={modal.kind}
              row={modal.row}
              friendshipId={modal.friendshipId}
              ownerId={modal.ownerId}
              onSaved={modal.onSaved}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
function Switcher() {
  const { world, me, run, open, go, busy } = useApp();
  return (
    <>
      <div className="switch-list">
        {world.profiles.map((p: Row) => (
          <button
            key={p.id}
            disabled={busy}
            className={'switch-person ' + (me.id === p.id ? 'current' : '')}
            onClick={async () => {
              if (await run('switch', { profileId: p.id })) {
                open(null);
                go('home');
              }
            }}
          >
            <Avatar person={p} />
            <div>
              <b>{profileName(p)}</b>
              <p className="muted">
                {p.state === 'stub' ? 'Stub profile' : p.city}
              </p>
            </div>
            <span>{me.id === p.id ? 'Current profile' : 'Log In →'}</span>
          </button>
        ))}
      </div>
      <div className="dialog-actions">
        <button
          className="gray-button"
          onClick={() => open({ kind: 'profile' })}
        >
          Create a Profile
        </button>
      </div>
    </>
  );
}
function Manage() {
  const { world, run, busy, fail, open } = useApp();
  const [incoming, setIncoming] = useState<World | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [worldFile, setWorldFile] = useState<File | null>(null);
  const [worldPreview, setWorldPreview] = useState<{
    exportedAt: string;
    counts: Record<string, number>;
    mediaCount: number;
  } | null>(null);
  const [worldBusy, setWorldBusy] = useState(false);
  const [profileFile, setProfileFile] = useState<File | null>(null);
  const [profilePreview, setProfilePreview] = useState<{
    profile: { name: string; externalId: string; status: string };
    counts: Record<string, number>;
    newStubs: number;
    mediaCount: number;
  } | null>(null);
  const [profileStrategy, setProfileStrategy] = useState('');
  const [profileBusy, setProfileBusy] = useState(false);
  const readImport = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 25_000_000)
        throw new Error('Choose a JSON export smaller than 25 MB.');
      const value = JSON.parse(await file.text());
      if (
        ![1, 2].includes(value.schemaVersion) ||
        !Array.isArray(value.profiles) ||
        !value.profiles.length
      )
        throw new Error(
          'Choose a Phasebook JSON export with schemaVersion 1 or 2 and at least one profile.',
        );
      setIncoming(value);
    } catch (e) {
      setIncoming(null);
      fail((e as Error).message);
    }
  };
  const packageRequest = async (
    path: string,
    file: File,
    contentType = 'application/vnd.phasebook.profile+zip',
  ) => {
    const response = await fetch('/api/' + path, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: file,
    });
    const value = await response.json();
    if (!response.ok)
      throw new Error(value.error || 'Could not read Phasebook package.');
    return value;
  };
  const readWorldPackage = async (file?: File) => {
    setWorldPreview(null);
    setWorldFile(null);
    if (!file) return;
    try {
      setWorldBusy(true);
      const preview = await packageRequest(
        'world-packages/preview',
        file,
        'application/vnd.phasebook.world+zip',
      );
      setWorldFile(file);
      setWorldPreview(preview);
    } catch (e) {
      fail((e as Error).message);
    } finally {
      setWorldBusy(false);
    }
  };
  const readProfilePackage = async (file?: File) => {
    setProfilePreview(null);
    setProfileFile(null);
    setProfileStrategy('');
    if (!file) return;
    try {
      if (file.size > 50_000_000)
        throw new Error('Choose a profile package smaller than 50 MB.');
      setProfileBusy(true);
      const preview = await packageRequest('profile-packages/preview', file);
      setProfileFile(file);
      setProfilePreview(preview);
    } catch (e) {
      fail((e as Error).message);
    } finally {
      setProfileBusy(false);
    }
  };
  return (
    <>
      <div className="world-stats">
        {[
          'profiles',
          'posts',
          'comments',
          'photos',
          'messages',
          'events',
          'groups',
        ].map((t) => (
          <div key={t}>
            <b>
              {
                world[
                  t as keyof Pick<
                    World,
                    | 'profiles'
                    | 'posts'
                    | 'comments'
                    | 'photos'
                    | 'messages'
                    | 'events'
                    | 'groups'
                  >
                ].length
              }
            </b>
            <span>{t}</span>
          </div>
        ))}
      </div>
      <h3>Export your world</h3>
      <p className="form-help">
        Download every record, relationship, and image in one Phasebook package.
        Images are stored as files, never inside JSON.
      </p>
      <a
        className="blue-button"
        href="/api/world-packages/export"
        download="phasebook-world.phasebook"
      >
        Export World Package
      </a>
      <hr />
      <h3>Import a world</h3>
      <p className="form-help">
        Replace this world from a Phasebook package. The package is validated
        first, and a complete package backup is saved before replacement.
      </p>
      <input
        type="file"
        accept=".phasebook,application/vnd.phasebook.world+zip,application/zip"
        aria-label="Import world package"
        disabled={worldBusy}
        onChange={(e) => void readWorldPackage(e.target.files?.[0])}
      />
      {worldBusy && <p className="form-help">Validating world package…</p>}
      {worldPreview && worldFile && (
        <div className="import-preview">
          <b>{worldPreview.counts.profiles ?? 0} profiles</b> and{' '}
          {worldPreview.counts.posts ?? 0} posts · {worldPreview.mediaCount}{' '}
          packaged images
          <div className="dialog-actions">
            <button
              className="blue-button"
              disabled={worldBusy}
              onClick={() => {
                setIncoming(null);
                setConfirm(true);
              }}
            >
              Review & Replace World
            </button>
          </div>
        </div>
      )}
      <details>
        <summary>Import a legacy JSON export</summary>
        <p className="form-help">
          Older schemaVersion 1 and 2 JSON exports remain supported for
          migration.
        </p>
        <input
          type="file"
          accept=".json,application/json"
          aria-label="Import legacy JSON file"
          onChange={(e) => readImport(e.target.files?.[0])}
        />
      </details>
      {incoming && (
        <div className="import-preview">
          <b>{incoming.profiles.length} profiles</b> and{' '}
          {incoming.posts?.length ?? 0} posts in this file.
          <div className="dialog-actions">
            <button
              className="blue-button"
              disabled={busy}
              onClick={() => {
                setWorldFile(null);
                setConfirm(true);
              }}
            >
              Review & Replace World
            </button>
          </div>
        </div>
      )}
      <hr />
      <h3>Profiles</h3>
      <p className="form-help">
        Change the person you are using, or create someone new.
      </p>
      <div className="button-row">
        <button
          className="gray-button"
          onClick={() => open({ kind: 'switch' })}
        >
          Switch Profile
        </button>
        <button
          className="gray-button"
          onClick={() => open({ kind: 'profile' })}
        >
          Create Profile
        </button>
      </div>
      <h3>Networks</h3>
      <p className="form-help">
        Manage school, workplace and regional affiliations, including stub
        members.
      </p>
      <button className="gray-button" onClick={() => open({ kind: 'network' })}>
        Create Network
      </button>
      <button
        className="gray-button"
        onClick={() => open({ kind: 'networkMembership' })}
      >
        Add Network Membership
      </button>
      <div className="admin-profiles">
        {world.networks.map((n) => (
          <div key={n.id}>
            <button onClick={() => open({ kind: 'network', row: n })}>
              {n.name}
            </button>
          </div>
        ))}
      </div>
      <h3>Profiles</h3>
      <div className="admin-profiles">
        {world.profiles.map((p) => (
          <div key={p.id} className="button-row">
            <button onClick={() => open({ kind: 'profile', row: p })}>
              {profileName(p)}
            </button>
            <span className="muted">
              {p.state === 'stub'
                ? 'Stub · full data unavailable'
                : 'Full profile'}
            </span>
          </div>
        ))}
      </div>
      <p className="form-help bottom-help">
        All people and activity are fictional. Everything is stored in SQLite on
        this computer. No login credentials or external services.
      </p>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent className="period-dialog confirm-dialog">
          <AlertDialogTitle className="dialog-title">
            Replace this world?
          </AlertDialogTitle>
          <AlertDialogDescription className="dialog-description">
            The selected {worldFile ? 'package' : 'legacy JSON'} will replace
            all current records. A complete world package backup will be saved
            locally. Invalid files leave your current world unchanged.
          </AlertDialogDescription>
          <div className="dialog-actions">
            <button
              className="gray-button"
              disabled={busy || worldBusy}
              onClick={() => setConfirm(false)}
            >
              Cancel
            </button>
            <button
              className="blue-button"
              disabled={busy || worldBusy}
              onClick={async () => {
                if (worldFile) {
                  try {
                    setWorldBusy(true);
                    await packageRequest(
                      'world-packages/import',
                      worldFile,
                      'application/vnd.phasebook.world+zip',
                    );
                    location.reload();
                  } catch (e) {
                    fail((e as Error).message);
                    setWorldBusy(false);
                  }
                } else if (await run('import', incoming)) {
                  setConfirm(false);
                  open(null);
                  location.hash = '#home';
                }
              }}
            >
              {worldBusy ? 'Importing…' : 'Replace World'}
            </button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
      <hr />
      <h3>Import a profile package</h3>
      <p className="form-help">
        Merge one profile and its attributable activity into this world. Other
        people referenced by the package are reused or created as stubs.
      </p>
      <input
        type="file"
        accept=".phasebook,application/vnd.phasebook.profile+zip,application/zip"
        aria-label="Import profile package"
        disabled={profileBusy}
        onChange={(e) => void readProfilePackage(e.target.files?.[0])}
      />
      {profileBusy && <p className="form-help">Validating package…</p>}
      {profilePreview && profileFile && (
        <div className="import-preview">
          <b>{profilePreview.profile.name || 'Unknown profile'}</b>{' '}
          <span className="muted">({profilePreview.profile.externalId})</span>
          <p>
            {profilePreview.profile.status === 'new'
              ? 'New full profile'
              : profilePreview.profile.status === 'stub'
                ? 'Will hydrate the existing stub in place'
                : 'Conflicts with an existing full profile'}
          </p>
          <p>
            {Object.entries(profilePreview.counts)
              .filter(([, count]) => count > 0)
              .map(([name, count]) => `${count} ${name}`)
              .join(' · ') || 'Profile data only'}
          </p>
          <p>
            {profilePreview.newStubs} new referenced stubs ·{' '}
            {profilePreview.mediaCount} media records
          </p>
          {profilePreview.profile.status === 'conflict' && (
            <label className="form-field" htmlFor="profile-conflict-strategy">
              Existing full profile
              <NativeSelect
                id="profile-conflict-strategy"
                value={profileStrategy}
                onChange={(e) => setProfileStrategy(e.target.value)}
              >
                <option value="">Choose an action…</option>
                <option value="merge">Merge/update existing profile</option>
                <option value="new">Import as a new profile</option>
              </NativeSelect>
            </label>
          )}
          <div className="dialog-actions">
            <button
              className="blue-button"
              disabled={
                profileBusy ||
                (profilePreview.profile.status === 'conflict' &&
                  !profileStrategy)
              }
              onClick={async () => {
                try {
                  setProfileBusy(true);
                  await packageRequest(
                    'profile-packages/import?strategy=' +
                      (profileStrategy || 'merge'),
                    profileFile,
                  );
                  location.reload();
                } catch (e) {
                  fail((e as Error).message);
                  setProfileBusy(false);
                }
              }}
            >
              {profileBusy ? 'Importing…' : 'Import Profile Package'}
            </button>
            <button
              className="gray-button"
              disabled={profileBusy}
              onClick={() => {
                setProfileFile(null);
                setProfilePreview(null);
                setProfileStrategy('');
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
export function Editor({
  kind,
  row,
  friendshipId,
  ownerId,
  onSaved,
}: {
  kind: string;
  row?: Row;
  friendshipId?: string;
  ownerId?: string;
  onSaved?: (row: Row) => void;
}) {
  const { me, world, save, run, open, fail, busy, go } = useApp();
  const { generateName, loading: naming } = useInventAName();
  const defaults: Record<string, Record<string, unknown>> = {
    profile: emptyProfile,
    post: { body: '' },
    photo: {
      ownerId: me.id,
      albumId: '',
      caption: '',
      mediaId: null,
      createdAt: now(),
    },
    event: {
      creatorId: me.id,
      title: '',
      description: '',
      location: '',
      startsAt: new Date().toISOString(),
    },
    group: {
      creatorId: me.id,
      name: '',
      description: '',
      category: 'Common Interest',
    },
    album: {
      ownerId: ownerId || me.id,
      name: '',
      description: '',
      location: '',
      coverMediaId: null,
      createdAt: now(),
    },
    message: {
      senderId: me.id,
      recipientId: world.profiles.find((p: Row) => p.id !== me.id)?.id || me.id,
      subject: '',
      body: '',
      createdAt: now(),
      read: 0,
    },
    relationship: {
      relationshipType: 'Friends',
      howMet: '',
      metAt: null,
      closeness: '',
      sharedHistory: '',
    },
    relationshipEvent: {
      friendshipId,
      type: 'relationship_changed',
      label: '',
      details: '',
      occurredAt: new Date().toISOString().slice(0, 10),
      createdAt: now(),
    },
  };
  const [form, setForm] = useState<Row>({
    id: uid(),
    externalId: uid(),
    ...defaults[kind],
    ...row,
  });
  const [uploading, setUploading] = useState(false);
  const [newAlbum, setNewAlbum] = useState('My Photos');
  const set = (key: string, value: unknown) =>
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (
        key === 'relationship' &&
        kind === 'profile' &&
        (!value || value === 'Single')
      )
        next.relationshipWithId = null;
      return next;
    });
  const fields: Record<string, string[][]> = {
    profile: [
      ['name', 'Name'],
      ['bio', 'About Me', 'area'],
      ['city', 'Current City'],
      ['hometown', 'Hometown'],
      ['highSchool', 'High School'],
      ['highSchoolGraduationYear', 'High School Graduation Year'],
      ['college', 'College'],
      ['collegeGraduationYear', 'College Graduation Year'],
      ['collegeMajor', 'College Major'],
      ['jobTitle', 'Job Title'],
      ['employer', 'Employer'],
      ['birthday', 'Birthday', 'date'],
      ['relationship', 'Relationship Status'],
      ['gender', 'Gender'],
      ['politicalViews', 'Political Views'],
      ['religiousViews', 'Religious Views'],
      ['interests', 'Interests', 'area'],
      ['voice', 'Voice', 'area'],
      ['communicationStyle', 'Communication Style', 'area'],
      ['behavioralTendencies', 'Behavioral Tendencies', 'area'],
    ],
    post: [['body', 'Post', 'area']],
    photo: [['caption', 'Caption']],
    album: [
      ['name', 'Album name'],
      ['description', 'Description', 'area'],
      ['location', 'Location'],
    ],
    event: [
      ['title', 'Event Name'],
      ['description', 'Description', 'area'],
      ['location', 'Where'],
      ['startsAt', 'When', 'datetime-local'],
    ],
    group: [
      ['name', 'Group Name'],
      ['description', 'Description', 'area'],
      ['category', 'Category'],
    ],
    message: [
      ['subject', 'Subject'],
      ['body', 'Message', 'area'],
    ],
    relationship: [
      ['relationshipType', 'Relationship type'],
      ['howMet', 'How they know each other', 'area'],
      ['metAt', 'When they met', 'date'],
      ['sharedHistory', 'Shared history', 'area'],
    ],
    relationshipEvent: [
      ['label', 'What changed'],
      ['occurredAt', 'When it happened', 'date'],
      ['details', 'Details', 'area'],
    ],
  };
  const dateLocal = (v: string) => {
    const d = new Date(v);
    if (!Number.isFinite(d.getTime())) return '';
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  };
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const table: Record<string, string> = {
          profile: 'profiles',
          post: 'posts',
          photo: 'photos',
          album: 'albums',
          event: 'events',
          group: 'groups',
          message: 'messages',
          relationship: 'friendships',
          relationshipEvent: 'relationshipEvents',
        };
        if (kind === 'photo' && !form.mediaId) {
          fail('Choose an uploaded image or an external image URL.');
          return;
        }
        const existing =
          kind === 'profile'
            ? world.profiles.find((p) => p.externalId === form.externalId)
            : null;
        const record =
          existing?.state === 'stub' && !row
            ? { ...form, id: existing.id }
            : kind === 'relationship'
              ? { ...form, metAt: form.metAt || null }
              : form;
        const saved =
          kind === 'photo'
            ? await run('photos/save', { photo: record, albumName: newAlbum })
            : await save(table[kind], record);
        if (saved) {
          open(null);
          if (kind === 'profile') go('profile', record.id);
          if (kind === 'album') go('photos', record.id);
          if (onSaved) onSaved(record);
          else if (kind === 'photo') go('photos');
        }
      }}
    >
      {kind === 'profile' && (
        <>
          <label className="form-field">
            Portable identity
            <input
              value={form.externalId}
              readOnly={!!row}
              required
              onChange={(e) => set('externalId', e.target.value)}
            />
          </label>
          <label className="form-field" htmlFor="profile-state">
            Profile data
            <NativeSelect
              id="profile-state"
              value={form.state}
              onChange={(e) => set('state', e.target.value)}
            >
              <option value="full">Full profile</option>
              <option value="stub" disabled={row?.state === 'full'}>
                Stub — full data unavailable
              </option>
            </NativeSelect>
          </label>
          {row?.state === 'stub' && (
            <p className="form-help">
              To complete this profile, enter its details and select Full
              profile. Existing relationships will be preserved.
            </p>
          )}
          {row && (
            <p className="form-help">
              <a
                className="text-link"
                href={'/api/profile-packages/' + encodeURIComponent(row.id)}
                download={(row.name || 'profile') + '.phasebook'}
              >
                Export Profile
              </a>{' '}
              as a portable Phasebook package.
            </p>
          )}
        </>
      )}
      {['profile', 'photo'].includes(kind) && (
        <MediaEditor
          id={
            form[
              kind === 'profile'
                ? 'avatarMediaId'
                : kind === 'album'
                  ? 'coverMediaId'
                  : 'mediaId'
            ]
          }
          portraits={kind === 'profile'}
          onBusy={setUploading}
          onChange={(id) =>
            set(
              kind === 'profile'
                ? 'avatarMediaId'
                : kind === 'album'
                  ? 'coverMediaId'
                  : 'mediaId',
              id,
            )
          }
        />
      )}
      {kind === 'message' && (
        <label className="form-field">
          To
          <NativeSelect
            value={form.recipientId}
            onChange={(e) => set('recipientId', e.target.value)}
          >
            {world.profiles
              .filter((p: Row) => p.id !== me.id)
              .map((p: Row) => (
                <option key={p.id} value={p.id}>
                  {profileName(p)}
                </option>
              ))}
          </NativeSelect>
        </label>
      )}
      {kind === 'relationship' && (
        <label className="form-field" htmlFor="relationship-closeness">
          Closeness
          <NativeSelect
            id="relationship-closeness"
            value={form.closeness}
            onChange={(e) => set('closeness', e.target.value)}
          >
            <option value="">Not specified</option>
            {['Acquaintances', 'Casual', 'Close', 'Very close'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </NativeSelect>
        </label>
      )}
      {kind === 'relationshipEvent' && (
        <label className="form-field" htmlFor="relationship-event-type">
          Event type
          <NativeSelect
            id="relationship-event-type"
            value={form.type}
            onChange={(e) => set('type', e.target.value)}
          >
            <option value="met">Met</option>
            <option value="relationship_changed">Relationship changed</option>
            <option value="milestone">Milestone</option>
            <option value="other">Other</option>
          </NativeSelect>
        </label>
      )}
      {kind === 'photo' && (
        <>
          <label className="form-field">
            Album
            <NativeSelect
              value={form.albumId}
              onChange={(e) => set('albumId', e.target.value)}
            >
              <option value="">Create an album</option>
              {world.albums
                .filter((a) => a.ownerId === form.ownerId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </NativeSelect>
          </label>
          {!form.albumId && (
            <label className="form-field">
              New album name
              <input
                required
                value={newAlbum}
                onChange={(e) => setNewAlbum(e.target.value)}
              />
            </label>
          )}
        </>
      )}
      {fields[kind]?.map(([key, label, type]) => (
        <div key={key}>
          <label className="form-field">
            {label}
            {type === 'area' ? (
              <textarea
                value={form[key] ?? ''}
                rows={key === 'body' ? 4 : 2}
                required={key === 'body'}
                maxLength={20000}
                onChange={(e) => set(key, e.target.value)}
              />
            ) : (
              <input
                type={type || 'text'}
                value={
                  type === 'datetime-local'
                    ? dateLocal(form[key])
                    : (form[key] ?? '')
                }
                maxLength={20000}
                required={
                  ['name', 'title', 'startsAt', 'label', 'occurredAt'].includes(
                    key,
                  ) &&
                  !(
                    kind === 'profile' &&
                    form.state === 'stub' &&
                    key === 'name'
                  )
                }
                onChange={(e) =>
                  set(
                    key,
                    type === 'datetime-local' && e.target.value
                      ? new Date(e.target.value).toISOString()
                      : e.target.value,
                  )
                }
              />
            )}
          </label>
          {kind === 'profile' && key === 'name' && (
            <button
              type="button"
              className="gray-button"
              disabled={naming || busy}
              onClick={async () => {
                try {
                  set('name', await generateName());
                } catch (error) {
                  fail((error as Error).message);
                }
              }}
            >
              {naming ? 'Getting name…' : 'Generate name with Namey'}
            </button>
          )}
        </div>
      ))}
      {kind === 'profile' &&
        form.relationship &&
        form.relationship !== 'Single' && (
          <label className="form-field">
            Relationship With
            <NativeSelect
              value={form.relationshipWithId ?? ''}
              onChange={(e) =>
                set('relationshipWithId', e.target.value || null)
              }
            >
              <option value="">None</option>
              {world.profiles
                .filter((p: Row) => p.id !== form.id)
                .map((p: Row) => (
                  <option key={p.id} value={p.id}>
                    {profileName(p)}
                  </option>
                ))}
            </NativeSelect>
          </label>
        )}
      <div className="dialog-actions">
        <button
          type="button"
          className="gray-button"
          onClick={() => open(null)}
        >
          Cancel
        </button>
        <button className="blue-button" disabled={busy || uploading}>
          {busy
            ? 'Saving…'
            : kind === 'message'
              ? 'Send'
              : kind === 'profile' && !row
                ? 'Create Profile'
                : 'Save Changes'}
        </button>
      </div>
    </form>
  );
}
