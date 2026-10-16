import { useEffect, useState } from 'react';
import { PhotoBatchEditor } from './media-editor';
import { useApp, PersonLink } from './context';
import {
  Avatar,
  mediaURL,
  profileName,
  now,
  stamp,
  uid,
  type Row,
} from './shared';
import { Pager, pageRows } from './pagination';

export const orderedPhotos = (photos: Row[]) =>
  [...photos].sort(
    (a, b) =>
      (a.position || 1) - (b.position || 1) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );

export function PhotoGrid({
  photos,
  photoIds,
  reorder,
}: {
  photos: Row[];
  photoIds?: string[];
  reorder?: (index: number, offset: number) => void;
}) {
  const { world, open, busy, person } = useApp();
  return (
    <div className="photo-grid">
      {photos.map((p, i) => (
        <div key={p.id}>
          <button
            className="album"
            onClick={() =>
              open({
                kind: 'viewPhoto',
                row: p,
                photoIds: photoIds || photos.map((p) => p.id),
              })
            }
          >
            <img
              loading="lazy"
              src={mediaURL(world, p.mediaId)}
              alt={p.caption || 'Open photo'}
            />
            <b>{p.caption || 'Untitled photo'}</b>
            <span>Added by {profileName(person(p.ownerId))}</span>
            <span>
              {world.photoLikes.filter((l) => l.photoId === p.id).length} likes
              · {world.photoComments.filter((c) => c.photoId === p.id).length}{' '}
              comments
            </span>
          </button>
          {reorder && (
            <div className="button-row">
              <button
                disabled={busy || i === 0}
                aria-label={`Move photo ${i + 1} earlier`}
                onClick={() => reorder(i, -1)}
              >
                ← Earlier
              </button>
              <button
                disabled={busy || i === photos.length - 1}
                aria-label={`Move photo ${i + 1} later`}
                onClick={() => reorder(i, 1)}
              >
                Later →
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function Photos({
  ownerId,
  initialAlbumId = '',
}: {
  ownerId?: string;
  initialAlbumId?: string;
}) {
  const { world, me, open, run, busy, person } = useApp();
  const [albumId, setAlbumId] = useState(initialAlbumId);
  const [tab, setTab] = useState('albums');
  const [confirm, setConfirm] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [page, setPage] = useState(1);
  const album = world.albums.find((a) => a.id === albumId);
  const subject = ownerId || me.id;
  const tagged = new Set(
    world.photoTags
      .filter((t) => t.profileId === subject)
      .map((t) => t.photoId),
  );
  const pictures = new Set(
    world.profilePictures
      .filter((t) => t.profileId === subject)
      .map((t) => t.photoId),
  );
  const photos = album
    ? orderedPhotos(world.photos.filter((p) => p.albumId === album.id))
    : world.photos
        .filter((p) =>
          tab === 'tagged'
            ? tagged.has(p.id)
            : tab === 'pictures'
              ? pictures.has(p.id)
              : !ownerId || p.ownerId === ownerId,
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const albums = world.albums
    .filter((a) => !ownerId || a.ownerId === ownerId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const paged = pageRows(
    tab === 'albums' && !album ? albums : photos,
    page,
    24,
  );
  const upload = () =>
    open({
      kind: 'photo',
      ownerId: album?.ownerId || ownerId || me.id,
      albumId: album?.id,
    });
  return (
    <>
      <div className="page-title">
        <h1>{album?.name || 'Photos'}</h1>
        <div className="button-row">
          {!album && (
            <button
              className="gray-button"
              onClick={() => open({ kind: 'album', ownerId: ownerId || me.id })}
            >
              Create Album
            </button>
          )}
          <button className="blue-button" onClick={upload}>
            {album ? 'Add Photos' : 'Upload Photos'}
          </button>
        </div>
      </div>
      {album ? (
        <>
          <button
            className="back-link"
            onClick={() => {
              setAlbumId('');
              setPage(1);
              setReordering(false);
              setConfirm(false);
            }}
          >
            « All albums
          </button>
          <p>
            By <PersonLink id={album.ownerId} /> · {photos.length} photos
            {album.location && ` · ${album.location}`}
          </p>
          {album.description && (
            <p className="photo-caption">{album.description}</p>
          )}
          <div className="photo-toolbar">
            <button onClick={() => open({ kind: 'album', row: album })}>
              Edit Album
            </button>
            <button
              onClick={() => {
                setReordering(!reordering);
                setPage(1);
              }}
            >
              {reordering ? 'Done Reordering' : 'Reorder Photos'}
            </button>
            {album.ownerId === me.id && (
              <button onClick={() => setConfirm(true)}>Delete Album</button>
            )}
          </div>
          {confirm && (
            <div className="photo-confirm" role="alert">
              <p>
                Delete “{album.name}” and its {photos.length} photos? Their
                photo likes, comments, and tags will also be deleted. This
                cannot be undone. Move photos to another album first to keep
                them.
              </p>
              <button
                disabled={busy}
                className="blue-button"
                onClick={async () => {
                  if (
                    await run('photos/delete-album', {
                      id: album.id,
                      confirm: true,
                    })
                  ) {
                    setAlbumId('');
                    setConfirm(false);
                  }
                }}
              >
                Delete album and photos
              </button>{' '}
              <button onClick={() => setConfirm(false)}>Cancel</button>
            </div>
          )}
        </>
      ) : (
        <div className="photo-tabs" aria-label="Photo views">
          {[
            ['albums', 'Albums'],
            ['uploads', ownerId ? 'Uploaded Photos' : 'All Photos'],
            [
              'tagged',
              ownerId
                ? `Photos of ${profileName(person(subject))}`
                : 'Photos of Me',
            ],
            ['pictures', 'Profile Pictures'],
          ].map(([id, label]) => (
            <button
              key={id}
              aria-pressed={tab === id}
              className={tab === id ? 'selected' : ''}
              onClick={() => {
                setTab(id);
                setPage(1);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {!album && tab === 'albums' ? (
        <div className="photo-grid">
          {paged.rows.map((a) => {
            const members = orderedPhotos(
              world.photos.filter((p) => p.albumId === a.id),
            );
            const cover = a.coverMediaId || members[0]?.mediaId;
            return (
              <button
                className="album"
                key={a.id}
                onClick={() => {
                  setAlbumId(a.id);
                  setPage(1);
                }}
              >
                {cover ? (
                  <img
                    loading="lazy"
                    src={mediaURL(world, cover)}
                    alt={a.name}
                  />
                ) : (
                  <div className="empty-album">Empty album</div>
                )}
                <b>{a.name}</b>
                <span>
                  {profileName(person(a.ownerId))} · {members.length} photos
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <PhotoGrid
          photoIds={photos.map((p) => p.id)}
          photos={reordering ? photos : paged.rows}
          reorder={
            reordering
              ? (i, offset) => {
                  const ids = photos.map((p) => p.id);
                  [ids[i], ids[i + offset]] = [ids[i + offset], ids[i]];
                  void run('photos/reorder', { albumId: album!.id, ids });
                }
              : undefined
          }
        />
      )}
      {!paged.rows.length && (
        <div className="empty-state">
          {tab === 'tagged'
            ? 'No tagged photos yet.'
            : tab === 'pictures'
              ? 'Choose “Make My Profile Picture” while viewing a photo to keep it here.'
              : 'No photos here yet. Create an album or add photos to get started.'}
        </div>
      )}
      {!reordering && (
        <Pager
          page={paged.page}
          pageCount={paged.pageCount}
          onChange={setPage}
        />
      )}
    </>
  );
}

export function PhotoViewer({
  row,
  photoIds,
}: {
  row: Row;
  photoIds?: string[];
}) {
  const { world, me, person, open, go, save, remove, run, busy } = useApp();
  const photo = world.photos.find((p) => p.id === row.id);
  const [caption, setCaption] = useState(row.caption || '');
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState('');
  const [commentPage, setCommentPage] = useState(1);
  const [tagging, setTagging] = useState(false);
  const [point, setPoint] = useState({ x: 5000, y: 5000 });
  const [tagPerson, setTagPerson] = useState('');
  const [destination, setDestination] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState('');
  const sequence = photoIds
    ? photoIds
        .map((id) => world.photos.find((p) => p.id === id))
        .filter((p): p is Row => !!p)
    : orderedPhotos(world.photos.filter((p) => p.albumId === photo?.albumId));
  const index = sequence.findIndex((p) => p.id === row.id);
  const navigate = (offset: number) => {
    const next = sequence[index + offset];
    if (next)
      open({
        kind: 'viewPhoto',
        row: next,
        photoIds: sequence.map((p) => p.id),
      });
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement)?.closest(
          'input,textarea,select,[contenteditable="true"]',
        )
      )
        return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        navigate(event.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  if (!photo) return <p>This photo has been deleted.</p>;
  const album = world.albums.find((a) => a.id === photo.albumId);
  const likes = world.photoLikes.filter((l) => l.photoId === photo.id);
  const mine = likes.find((l) => l.profileId === me.id);
  const tags = world.photoTags.filter((t) => t.photoId === photo.id);
  const comments = world.photoComments
    .filter((c) => c.photoId === photo.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const pagedComments = pageRows(comments, commentPage, 10);
  const action = async (
    name: string,
    values: Record<string, unknown>,
    message: string,
  ) => {
    if (await run(`photos/${name}`, values)) setNotice(message);
  };
  return (
    <>
      <div className="photo-navigation">
        <button disabled={index <= 0} onClick={() => navigate(-1)}>
          « Previous
        </button>
        <span>
          Photo {index + 1} of {sequence.length}
        </span>
        <button
          disabled={index < 0 || index >= sequence.length - 1}
          onClick={() => navigate(1)}
        >
          Next »
        </button>
      </div>
      <div className={'photo-stage ' + (tagging ? 'tagging' : '')}>
        <button
          className="photo-surface"
          aria-label={
            tagging
              ? 'Choose tag position; keyboard selection uses the center'
              : 'Photo; click to view next'
          }
          onClick={(e) => {
            if (!tagging) {
              navigate(1);
              return;
            }
            const rect = e.currentTarget.getBoundingClientRect();
            setPoint(
              e.detail === 0
                ? { x: 5000, y: 5000 }
                : {
                    x: Math.max(
                      1,
                      Math.min(
                        10000,
                        Math.round(
                          ((e.clientX - rect.left) / rect.width) * 10000,
                        ),
                      ),
                    ),
                    y: Math.max(
                      1,
                      Math.min(
                        10000,
                        Math.round(
                          ((e.clientY - rect.top) / rect.height) * 10000,
                        ),
                      ),
                    ),
                  },
            );
          }}
        >
          <img
            src={mediaURL(world, photo.mediaId)}
            alt={photo.caption || 'Photo'}
          />
        </button>
        {tags
          .filter((tag) => tag.x != null && tag.y != null)
          .map((tag) => (
            <button
              key={tag.id}
              className="photo-tag"
              style={{ left: `${tag.x / 100}%`, top: `${tag.y / 100}%` }}
              title={profileName(person(tag.profileId))}
              aria-label={`View ${profileName(person(tag.profileId))}`}
              onClick={() => {
                open(null);
                go('profile', tag.profileId);
              }}
            >
              <span>{profileName(person(tag.profileId))}</span>
            </button>
          ))}
        {tagging && (
          <span
            className="tag-position"
            style={{ left: `${point.x / 100}%`, top: `${point.y / 100}%` }}
            aria-hidden="true"
          >
            +
          </span>
        )}
      </div>
      {editing ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (await save('photos', { ...photo, caption })) setEditing(false);
          }}
        >
          <label className="form-field">
            Caption
            <textarea
              value={caption}
              maxLength={20000}
              onChange={(e) => setCaption(e.target.value)}
            />
          </label>
          <button disabled={busy} className="blue-button">
            Save Caption
          </button>{' '}
          <button type="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <p className="photo-caption">{photo.caption}</p>
      )}
      <p className="muted">
        Added by <PersonLink id={photo.ownerId} /> · {stamp(photo.createdAt)} ·{' '}
        <button
          onClick={() => {
            open(null);
            go('photos', photo.albumId);
          }}
        >
          {album?.name}
        </button>
      </p>
      {tags.length > 0 && (
        <p>
          In this photo:{' '}
          {tags.map((tag, i) => (
            <span key={tag.id}>
              {i > 0 && ', '}
              <PersonLink id={tag.profileId} />{' '}
              <button
                disabled={busy}
                aria-label={`Remove tag for ${profileName(person(tag.profileId))}`}
                onClick={() => remove('photoTags', tag.id)}
              >
                ×
              </button>
            </span>
          ))}
        </p>
      )}
      <div className="photo-toolbar">
        <button
          disabled={busy}
          onClick={() =>
            mine
              ? remove('photoLikes', mine.id)
              : save('photoLikes', {
                  id: uid(),
                  photoId: photo.id,
                  profileId: me.id,
                })
          }
        >
          {mine ? 'Unlike' : 'Like'}
        </button>
        <button onClick={() => setTagging(!tagging)}>
          {tagging ? 'Done Tagging' : 'Tag Photo'}
        </button>
        <button
          onClick={() => {
            setCaption(photo.caption);
            setEditing(true);
          }}
        >
          Edit Caption
        </button>
        <button
          disabled={busy}
          onClick={() =>
            action(
              'post',
              {
                post: {
                  authorId: me.id,
                  wallId: me.id,
                  groupId: null,
                  body: 'Shared a photo.',
                  createdAt: now(),
                },
                photoIds: [photo.id],
              },
              'Shared on your Wall.',
            )
          }
        >
          Share
        </button>
      </div>
      {tagging && (
        <form
          className="photo-tag-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              tagPerson &&
              (await save('photoTags', {
                id: uid(),
                photoId: photo.id,
                profileId: tagPerson,
                actorId: me.id,
                ...point,
                createdAt: now(),
              }))
            )
              setTagPerson('');
          }}
        >
          <p>
            Click a person in the photo, then select their name. Keyboard users
            can set the position below.
          </p>
          <div className="button-row">
            <label>
              Across (%){' '}
              <input
                type="number"
                min="0.01"
                max="100"
                step="0.01"
                value={point.x / 100}
                onChange={(e) =>
                  setPoint({
                    ...point,
                    x: Math.max(
                      1,
                      Math.min(10000, Math.round(Number(e.target.value) * 100)),
                    ),
                  })
                }
              />
            </label>
            <label>
              Down (%){' '}
              <input
                type="number"
                min="0.01"
                max="100"
                step="0.01"
                value={point.y / 100}
                onChange={(e) =>
                  setPoint({
                    ...point,
                    y: Math.max(
                      1,
                      Math.min(10000, Math.round(Number(e.target.value) * 100)),
                    ),
                  })
                }
              />
            </label>
          </div>
          <label className="form-field">
            Person
            <select
              value={tagPerson}
              onChange={(e) => setTagPerson(e.target.value)}
            >
              <option value="">Select a person</option>
              {world.profiles
                .filter((p) => !tags.some((t) => t.profileId === p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {profileName(p)}
                  </option>
                ))}
            </select>
          </label>
          <button disabled={busy || !tagPerson} className="blue-button">
            Save Tag
          </button>
        </form>
      )}
      {likes.length > 0 && (
        <div className="feedback likes">
          {likes.slice(0, 3).map((l, i) => (
            <span key={l.id}>
              {i > 0 && ', '}
              <PersonLink id={l.profileId} />
            </span>
          ))}
          {likes.length > 3 && ` and ${likes.length - 3} others`} liked this
          photo.
        </div>
      )}
      {pagedComments.rows.map((c) => (
        <div className="feedback comment" key={c.id}>
          <Avatar person={person(c.authorId)} size={32} />
          <div>
            <PersonLink id={c.authorId} /> {c.body}
            <div className="muted">
              {stamp(c.createdAt)}{' '}
              {c.authorId === me.id && (
                <button
                  disabled={busy}
                  onClick={() => remove('photoComments', c.id)}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
      <Pager
        page={pagedComments.page}
        pageCount={pagedComments.pageCount}
        onChange={setCommentPage}
      />
      <form
        className="feedback photo-comment-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            comment.trim() &&
            (await save('photoComments', {
              id: uid(),
              photoId: photo.id,
              authorId: me.id,
              body: comment.trim(),
              createdAt: now(),
            }))
          ) {
            setComment('');
            setCommentPage(Math.ceil((comments.length + 1) / 10));
          }
        }}
      >
        <label className="form-field">
          Comment on this photo
          <textarea
            aria-label="Write a comment on this photo"
            value={comment}
            maxLength={20000}
            onChange={(e) => setComment(e.target.value)}
          />
        </label>
        <button disabled={busy || !comment.trim()} className="blue-button">
          Comment
        </button>
      </form>
      <details className="photo-options">
        <summary>Photo Options</summary>
        <div className="photo-toolbar">
          <button
            disabled={busy}
            onClick={() =>
              action('cover', { photoId: photo.id }, 'Album cover updated.')
            }
          >
            Make Album Cover
          </button>
          <button
            disabled={busy}
            onClick={() =>
              action(
                'profile-picture',
                { photoId: photo.id, profileId: me.id },
                'Profile picture updated. This photo is also in your Profile Pictures history.',
              )
            }
          >
            Make My Profile Picture
          </button>
          {photo.ownerId === me.id && (
            <button onClick={() => setDeleting(true)}>Delete Photo</button>
          )}
        </div>
        <label className="form-field">
          Move to another album
          <select
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          >
            <option value="">Choose an album</option>
            {world.albums
              .filter(
                (a) => a.ownerId === photo.ownerId && a.id !== photo.albumId,
              )
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
        <button
          disabled={busy || !destination}
          onClick={async () => {
            await action(
              'move',
              { photoId: photo.id, albumId: destination },
              'Photo moved. Likes, comments, and tags are preserved.',
            );
            setDestination('');
          }}
        >
          Move Photo
        </button>
      </details>
      {deleting && (
        <div className="photo-confirm" role="alert">
          <p>
            Delete this photo and its likes, comments, and tags? This cannot be
            undone.
          </p>
          <button
            className="blue-button"
            disabled={busy}
            onClick={async () => {
              if (
                await run('photos/delete-photo', {
                  id: photo.id,
                  confirm: true,
                })
              )
                open(null);
            }}
          >
            Delete Photo
          </button>{' '}
          <button onClick={() => setDeleting(false)}>Cancel</button>
        </div>
      )}
      {notice && <output>{notice}</output>}
    </>
  );
}

export function PhotoUploader({
  ownerId,
  albumId,
  onSaved,
}: {
  ownerId?: string;
  albumId?: string;
  onSaved?: (row: Row) => void;
}) {
  const { world, me, run, open, busy, go } = useApp();
  const [newAlbumId] = useState(uid);
  const [owner, setOwner] = useState(ownerId || me.id);
  const [album, setAlbum] = useState(albumId || '');
  const [name, setName] = useState('My Photos');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [drafts, setDrafts] = useState<Row[]>([]);
  const [working, setWorking] = useState(false);
  const [share, setShare] = useState(!onSaved);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (working || busy || !drafts.length) return;
        if (
          await run('photos/publish', {
            ownerId: owner,
            albumId: album,
            newAlbumId,
            name,
            description,
            location,
            photos: drafts.map((d) => ({
              id: d.id,
              mediaId: d.id,
              caption: d.caption,
            })),
            share,
          })
        ) {
          open(null);
          if (onSaved)
            onSaved({ id: drafts[0].id, photoIds: drafts.map((d) => d.id) });
          else go('photos', album || newAlbumId);
        }
      }}
    >
      <PhotoBatchEditor
        items={drafts}
        onChange={setDrafts}
        onBusy={setWorking}
      />
      <fieldset disabled={working || busy} className="photo-upload-fields">
        <label className="form-field">
          Uploader
          <select
            value={owner}
            disabled={!!albumId}
            onChange={(e) => {
              setOwner(e.target.value);
              setAlbum('');
            }}
          >
            {world.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {profileName(p)}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          Album
          <select value={album} onChange={(e) => setAlbum(e.target.value)}>
            <option value="">Create a new album</option>
            {world.albums
              .filter((a) => a.ownerId === owner)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
        {!album && (
          <>
            <label className="form-field">
              Album name
              <input
                required
                maxLength={20000}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="form-field">
              Description
              <textarea
                maxLength={20000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label className="form-field">
              Location
              <input
                maxLength={20000}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </label>
          </>
        )}
        <label>
          <input
            type="checkbox"
            checked={share}
            onChange={(e) => setShare(e.target.checked)}
          />{' '}
          Share one album story on the uploader’s Wall
        </label>
        <div className="dialog-actions">
          <button
            type="button"
            className="gray-button"
            onClick={() => open(null)}
          >
            Cancel
          </button>
          <button className="blue-button" disabled={!drafts.length}>
            Publish {drafts.length || ''} Photo{drafts.length === 1 ? '' : 's'}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
