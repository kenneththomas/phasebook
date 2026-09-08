import { useRef, useState } from 'react';
import { Camera, Pencil, Globe, ThumbsUp } from 'lucide-react';
import {
  mediaURL,
  profileName,
  Avatar,
  now,
  stamp,
  uid,
  type Row,
  rowById,
  rowsBy,
} from './shared';
import { useApp, PersonLink } from './context';
import { Pager, pageRows } from './pagination';

export function Composer({
  wallId,
  groupId,
}: {
  wallId?: string;
  groupId?: string;
}) {
  const { me, world, save, busy, open } = useApp();
  const [draft, setDraft] = useState('');
  const [choosePhoto, setChoosePhoto] = useState(false);
  const [photoId, setPhotoId] = useState<string | null>(null);
  return (
    <form
      className="composer"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!draft.trim() && !photoId) return;
        if (
          await save('posts', {
            id: uid(),
            authorId: me.id,
            wallId: groupId ? null : wallId || me.id,
            groupId: groupId || null,
            body: draft.trim() || 'Shared a photo.',
            photoId,
            createdAt: now(),
          })
        ) {
          setDraft('');
          setPhotoId(null);
          setChoosePhoto(false);
        }
      }}
    >
      <div className="attach">
        <b>Share:</b>
        <button
          type="button"
          className={!choosePhoto ? 'selected' : ''}
          onClick={() => setChoosePhoto(false)}
        >
          <Pencil size={13} />
          Status
        </button>
        <button
          type="button"
          className={choosePhoto ? 'selected' : ''}
          onClick={() => setChoosePhoto(!choosePhoto)}
        >
          <Camera size={14} />
          Photo
        </button>
      </div>
      <textarea
        aria-label="What's on your mind?"
        placeholder={
          wallId && wallId !== me.id
            ? 'Write something on this Wall…'
            : "What's on your mind?"
        }
        value={draft}
        maxLength={20000}
        onChange={(e) => setDraft(e.target.value)}
      />
      {choosePhoto && (
        <div className="photo-picker">
          {world.photos.map((p: Row) => (
            <button
              type="button"
              key={p.id}
              aria-label={'Attach ' + p.caption}
              aria-pressed={photoId === p.id}
              className={photoId === p.id ? 'picked' : ''}
              onClick={() => setPhotoId(photoId === p.id ? null : p.id)}
            >
              <img src={mediaURL(world, p.mediaId)} alt={p.caption} />
            </button>
          ))}
          <button
            type="button"
            className="text-link"
            onClick={() =>
              open({ kind: 'photo', onSaved: (photo) => setPhotoId(photo.id) })
            }
          >
            Upload a photo
          </button>
        </div>
      )}
      <div className="composer-bottom">
        {photoId && <span className="muted">1 photo attached</span>}
        <Globe size={12} />
        <button
          className="blue-button"
          disabled={busy || (!draft.trim() && !photoId)}
        >
          Share
        </button>
      </div>
    </form>
  );
}
export function Post({ post }: { post: Row }) {
  const { world, me, person, save, remove, open, busy, go } = useApp();
  const [comment, setComment] = useState('');
  const [showComment, setShowComment] = useState(false);
  const [commentPage, setCommentPage] = useState(1);
  const input = useRef<HTMLInputElement>(null);
  const likes = rowsBy(world.likes, 'postId', post.id);
  const mine = likes.find((l: Row) => l.profileId === me.id);
  const comments = [...rowsBy(world.comments, 'postId', post.id)].sort(
    (a: Row, b: Row) => a.createdAt.localeCompare(b.createdAt),
  );
  const pagedComments = pageRows(comments, commentPage, 3);
  const photo = rowById(world.photos, post.photoId);
  return (
    <article className="post" id={'post-' + post.id}>
      <button
        className="avatar-button"
        onClick={() => go('profile', post.authorId)}
        aria-label={'View ' + profileName(person(post.authorId))}
      >
        <Avatar person={person(post.authorId)} />
      </button>
      <div className="post-body">
        <div className="post-byline">
          <span>
            <PersonLink id={post.authorId} />
            {post.wallId && post.wallId !== post.authorId && (
              <>
                {' '}
                <span className="muted">▸</span> <PersonLink id={post.wallId} />
              </>
            )}
          </span>
          <button
            className="edit-post"
            aria-label="Edit post"
            onClick={() => open({ kind: 'post', row: post })}
          >
            <Pencil size={11} />
          </button>
        </div>
        <p>{post.body}</p>
        {photo && (
          <button
            className="photo-open"
            onClick={() => open({ kind: 'viewPhoto', row: photo })}
          >
            <img
              className="post-photo"
              src={mediaURL(world, photo.mediaId)}
              alt={photo.caption}
            />
          </button>
        )}
        <div className="post-actions">
          <span>{stamp(post.createdAt)}</span> ·{' '}
          <button
            disabled={busy}
            onClick={() =>
              mine
                ? remove('likes', mine.id)
                : save('likes', {
                    id: uid(),
                    postId: post.id,
                    profileId: me.id,
                  })
            }
          >
            {mine ? 'Unlike' : 'Like'}
          </button>{' '}
          ·{' '}
          <button
            onClick={() => {
              setShowComment(true);
              setTimeout(() => input.current?.focus(), 0);
            }}
          >
            Comment
          </button>
        </div>
        {likes.length > 0 && (
          <div className="feedback likes">
            <ThumbsUp size={12} />
            <span>
              {likes.slice(0, 2).map((l: Row, i: number) => (
                <span key={l.id}>
                  {i > 0 ? ' and ' : ''}
                  <PersonLink id={l.profileId}>
                    {l.profileId === me.id
                      ? 'You'
                      : profileName(person(l.profileId))}
                  </PersonLink>
                </span>
              ))}
              {likes.length > 2 ? ` and ${likes.length - 2} others` : ''}{' '}
              {likes.length === 1 && likes[0].profileId !== me.id
                ? 'likes'
                : 'like'}{' '}
              this.
            </span>
          </div>
        )}
        {pagedComments.rows.map((c: Row) => (
          <div className="feedback comment" key={c.id}>
            <Avatar person={person(c.authorId)} size={32} />
            <div>
              <PersonLink id={c.authorId} /> {c.body}
              <div className="muted">{stamp(c.createdAt)}</div>
            </div>
          </div>
        ))}
        <Pager
          page={pagedComments.page}
          pageCount={pagedComments.pageCount}
          onChange={setCommentPage}
        />
        {(showComment || comments.length > 0) && (
          <form
            className="feedback comment-input"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                comment.trim() &&
                (await save('comments', {
                  id: uid(),
                  postId: post.id,
                  authorId: me.id,
                  body: comment.trim(),
                  createdAt: now(),
                }))
              )
                setComment('');
            }}
          >
            <Avatar person={me} size={28} />
            <input
              ref={input}
              aria-label="Write a comment"
              placeholder="Write a comment…"
              maxLength={20000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <button className="gray-button" disabled={busy || !comment.trim()}>
              Post
            </button>
          </form>
        )}
      </div>
    </article>
  );
}
export function Feed({
  posts,
  compose = true,
  wallId,
  groupId,
}: {
  posts: Row[];
  compose?: boolean;
  wallId?: string;
  groupId?: string;
}) {
  const [page, setPage] = useState(1);
  const pagedPosts = pageRows(posts, page, 5);
  return (
    <>
      {compose && (
        <Composer
          key={(wallId || '') + (groupId || '')}
          wallId={wallId}
          groupId={groupId}
        />
      )}{' '}
      {pagedPosts.rows.map((p) => (
        <Post key={p.id} post={p} />
      ))}
      <Pager
        page={pagedPosts.page}
        pageCount={pagedPosts.pageCount}
        onChange={setPage}
      />
      <div className="end-feed">
        {posts.length
          ? "You're all caught up."
          : 'No posts yet. Be the first to share something.'}
      </div>
    </>
  );
}
