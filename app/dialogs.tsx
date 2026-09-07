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
import { Avatar, emptyProfile, uid, now, type Row, type World } from './shared';
import { useApp, type ModalState } from './context';

async function imageData(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('Choose a JPG, PNG, or WebP image.');
  if (file.size > 3_000_000)
    throw new Error('Choose an image smaller than 3 MB.');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('The image could not be read.'));
    reader.onerror = () => reject(new Error('The image could not be read.'));
    reader.readAsDataURL(file);
  });
}
export function Modal({ modal }: { modal: ModalState }) {
  const { open } = useApp();
  if (!modal) return null;
  const titles: Record<string, string> = {
    switch: 'Log In · Choose a Profile',
    profile: modal.row ? 'Edit Profile' : 'Create a Profile',
    manage: 'Manage this world',
    post: 'Edit Post',
    photo: 'Upload a Photo',
    viewPhoto: modal.row?.album || 'Photo',
    event: modal.row ? 'Edit Event' : 'Create an Event',
    group: modal.row ? 'Edit Group' : 'Create a Group',
    message: 'New Message',
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
          {modal.kind === 'switch' ? (
            <Switcher />
          ) : modal.kind === 'manage' ? (
            <Manage />
          ) : modal.kind === 'viewPhoto' ? (
            <PhotoViewer row={modal.row!} />
          ) : (
            <Editor
              key={modal.kind + (modal.row?.id || 'new')}
              kind={modal.kind}
              row={modal.row}
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
              <b>{p.name}</b>
              <p className="muted">{p.city}</p>
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
function PhotoViewer({ row }: { row: Row }) {
  const { person, open } = useApp();
  return (
    <>
      <img className="full-photo" src={row.src} alt={row.caption} />
      <p className="photo-caption">{row.caption}</p>
      <p className="muted">
        Added by {person(row.ownerId).name} · {row.album}
      </p>
      <div className="dialog-actions">
        <button onClick={() => open({ kind: 'photo', row })}>Edit Photo</button>
      </div>
    </>
  );
}
function Manage() {
  const { world, run, busy, fail, open } = useApp();
  const [incoming, setIncoming] = useState<World | null>(null);
  const [confirm, setConfirm] = useState(false);
  const readImport = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 25_000_000)
        throw new Error('Choose a JSON export smaller than 25 MB.');
      const value = JSON.parse(await file.text());
      if (
        value.schemaVersion !== 1 ||
        !Array.isArray(value.profiles) ||
        !value.profiles.length
      )
        throw new Error(
          'Choose a Phasebook JSON export with schemaVersion 1 and at least one profile.',
        );
      setIncoming(value);
    } catch (e) {
      setIncoming(null);
      fail((e as Error).message);
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
        Download every record, relationship, and uploaded image in one JSON
        file.
      </p>
      <a className="blue-button" href="/api/export" download="phasebook.json">
        Export JSON
      </a>
      <hr />
      <h3>Import a world</h3>
      <p className="form-help">
        Replace this world with a Phasebook export. A backup of the current
        world is saved in the data folder before replacement.
      </p>
      <input
        type="file"
        accept=".json,application/json"
        aria-label="Import JSON file"
        onChange={(e) => readImport(e.target.files?.[0])}
      />
      {incoming && (
        <div className="import-preview">
          <b>{incoming.profiles.length} profiles</b> and{' '}
          {incoming.posts?.length ?? 0} posts in this file.
          <div className="dialog-actions">
            <button
              className="blue-button"
              disabled={busy}
              onClick={() => setConfirm(true)}
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
            The selected JSON will replace all current records. A backup will be
            saved locally. Invalid files leave your current world unchanged.
          </AlertDialogDescription>
          <div className="dialog-actions">
            <button
              className="gray-button"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              Cancel
            </button>
            <button
              className="blue-button"
              disabled={busy}
              onClick={async () => {
                if (await run('import', incoming)) {
                  setConfirm(false);
                  open(null);
                  location.hash = '#home';
                }
              }}
            >
              Replace World
            </button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
function Editor({
  kind,
  row,
  onSaved,
}: {
  kind: string;
  row?: Row;
  onSaved?: (row: Row) => void;
}) {
  const { me, world, save, open, fail, busy, go } = useApp();
  const defaults: Record<string, Record<string, unknown>> = {
    profile: emptyProfile,
    post: { body: '' },
    photo: {
      ownerId: me.id,
      album: 'My Photos',
      caption: '',
      src: '',
      createdAt: now(),
    },
    event: {
      creatorId: me.id,
      title: '',
      description: '',
      location: '',
      startsAt: new Date().toISOString(),
    },
    group: { name: '', description: '', category: 'Common Interest' },
    message: {
      senderId: me.id,
      recipientId: world.profiles.find((p: Row) => p.id !== me.id)?.id || me.id,
      subject: '',
      body: '',
      createdAt: now(),
      read: 0,
    },
  };
  const [form, setForm] = useState<Row>({
    id: uid(),
    ...defaults[kind],
    ...row,
  });
  const [uploading, setUploading] = useState(false);
  const set = (key: string, value: unknown) =>
    setForm((f) => ({ ...f, [key]: value }));
  const fields: Record<string, string[][]> = {
    profile: [
      ['name', 'Name'],
      ['bio', 'About Me', 'area'],
      ['city', 'Current City'],
      ['hometown', 'Hometown'],
      ['education', 'Education'],
      ['work', 'Work'],
      ['birthday', 'Birthday', 'date'],
      ['relationship', 'Relationship Status'],
      ['interests', 'Interests', 'area'],
    ],
    post: [['body', 'Post', 'area']],
    photo: [
      ['album', 'Album'],
      ['caption', 'Caption'],
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
  };
  const upload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      set(kind === 'profile' ? 'avatar' : 'src', await imageData(file));
    } catch (e) {
      fail((e as Error).message);
    } finally {
      setUploading(false);
    }
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
          event: 'events',
          group: 'groups',
          message: 'messages',
        };
        if (kind === 'photo' && !form.src) {
          fail('Choose a photo to upload.');
          return;
        }
        if (await save(table[kind], form)) {
          open(null);
          if (kind === 'profile') go('profile', form.id);
          if (onSaved) onSaved(form);
          else if (kind === 'photo') go('photos');
        }
      }}
    >
      {kind === 'profile' && (
        <div className="avatar-editor">
          <Avatar person={form} size={80} />
          <div>
            <span>Profile Picture</span>
            <div className="avatar-options">
              {Array.from({ length: 6 }, (_, i) => (
                <button
                  type="button"
                  aria-label={'Choose portrait ' + (i + 1)}
                  className={
                    form.avatar === `/assets/avatar-${i + 1}.jpg`
                      ? 'picked'
                      : ''
                  }
                  key={i}
                  onClick={() => set('avatar', `/assets/avatar-${i + 1}.jpg`)}
                >
                  <img src={`/assets/avatar-${i + 1}.jpg`} alt="" />
                </button>
              ))}
            </div>
            <input
              aria-label="Upload profile picture"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => upload(e.target.files?.[0])}
            />
          </div>
        </div>
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
                  {p.name}
                </option>
              ))}
          </NativeSelect>
        </label>
      )}
      {kind === 'photo' && (
        <label className="form-field">
          Photo (JPG, PNG, or WebP, up to 3 MB)
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => upload(e.target.files?.[0])}
          />
          {form.src && (
            <img
              className="upload-preview"
              src={form.src}
              alt="Upload preview"
            />
          )}
        </label>
      )}
      {fields[kind]?.map(([key, label, type]) => (
        <label className="form-field" key={key}>
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
              required={['name', 'title', 'album', 'startsAt'].includes(key)}
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
      ))}
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
