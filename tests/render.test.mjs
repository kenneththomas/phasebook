import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { createStore } from '../server/store.mjs';

test('main screens render through Vite SSR with seeded state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'phasebook-render-'));
  const store = createStore(join(dir, 'phasebook.sqlite'));
  const vite = await createServer({
    configFile: false,
    resolve: { alias: { '@': join(process.cwd(), '') } },
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  try {
    const [
      { AppContext },
      screens,
      { Feed },
      { Avatar, applyMutation },
      { Editor, PhotoViewer },
    ] = await Promise.all([
      vite.ssrLoadModule('/app/context.tsx'),
      vite.ssrLoadModule('/app/screens.tsx'),
      vite.ssrLoadModule('/app/feed.tsx'),
      vite.ssrLoadModule('/app/shared.tsx'),
      vite.ssrLoadModule('/app/dialogs.tsx'),
    ]);
    const { Networks, NetworkEditor } =
      await vite.ssrLoadModule('/app/networks.tsx');
    const world = store.getState();
    const deletedPost = world.posts[0];
    const cached = structuredClone(world);
    cached.comments.push({
      id: 'cached-comment',
      postId: deletedPost.id,
      authorId: 'p1',
    });
    cached.likes.push({
      id: 'cached-like',
      postId: deletedPost.id,
      profileId: 'p1',
    });
    cached.notifications.push({
      id: 'cached-notice',
      postId: deletedPost.id,
      profileId: 'p1',
      actorId: 'p2',
    });
    const merged = applyMutation(cached, {
      upserts: { profiles: [{ ...cached.profiles[0], name: 'Updated Name' }] },
      deletes: { posts: [deletedPost.id] },
    });
    assert.equal(merged.profiles[0].name, 'Updated Name');
    assert.equal(
      merged.posts.some((post) => post.id === deletedPost.id),
      false,
    );
    assert.equal(
      merged.comments.some((row) => row.id === 'cached-comment'),
      false,
    );
    assert.equal(
      merged.likes.some((row) => row.id === 'cached-like'),
      false,
    );
    assert.equal(
      merged.notifications.find((row) => row.id === 'cached-notice').postId,
      null,
    );
    assert.equal(
      cached.notifications.find((row) => row.id === 'cached-notice').postId,
      deletedPost.id,
    );
    const me = world.profiles.find((p) => p.id === 'p1');
    const value = {
      world,
      me,
      busy: false,
      save: async () => true,
      remove: async () => true,
      run: async () => true,
      go: () => {},
      open: () => {},
      fail: () => {},
      person: (id) => world.profiles.find((p) => p.id === id),
      chat: () => {},
    };
    const render = (element, expected) => {
      const html = renderToString(
        React.createElement(AppContext.Provider, { value }, element),
      );
      assert.match(
        html,
        new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      );
      return html;
    };
    render(React.createElement(screens.Profile, { id: 'p1' }), 'Alex Morgan');
    render(React.createElement(screens.Friends), 'Friends');
    const friendship = world.friendships.find(
      (row) => row.status === 'accepted',
    );
    render(
      React.createElement(screens.Friendship, { id: friendship.id }),
      'Wall Posts Between',
    );
    const { PhotoUploader } = await vite.ssrLoadModule('/app/photos.tsx');
    const uploadHtml = render(
      React.createElement(PhotoUploader),
      'Share one album story',
    );
    assert.match(uploadHtml, /Select multiple files/);
    assert.match(uploadHtml, /Album name/);
    const { Generation } = await vite.ssrLoadModule('/app/generation.tsx');
    render(React.createElement(Generation), 'New generation run');
    render(React.createElement(Networks), 'Northeastern University');
    render(React.createElement(Networks, { id: 'n-nu' }), 'Casey Sullivan');
    render(
      React.createElement(NetworkEditor, {
        kind: 'networkMembership',
        row: world.networkMemberships[0],
      }),
      'Class Year',
    );
    render(React.createElement(screens.Photos), 'Photos');
    const reactionPhoto = world.photos[0];
    world.photoLikes.push({
      id: 'render-photo-like',
      photoId: reactionPhoto.id,
      profileId: value.me.id,
    });
    world.photoComments.push({
      id: 'render-photo-comment',
      photoId: reactionPhoto.id,
      authorId: 'p2',
      body: 'Great photo!',
      createdAt: '2010-03-21T12:00:00Z',
    });
    const photoHtml = render(
      React.createElement(PhotoViewer, { row: reactionPhoto }),
      'Great photo!',
    );
    assert.match(photoHtml, /Unlike/);
    assert.match(photoHtml, /Write a comment on this photo/);
    const withoutPhoto = applyMutation(world, {
      upserts: {},
      deletes: { photos: [reactionPhoto.id] },
    });
    assert.equal(withoutPhoto.photoLikes.length, 0);
    assert.equal(withoutPhoto.photoComments.length, 0);
    render(
      React.createElement(screens.TaggedPhotos, { profileId: 'p1' }),
      'No tagged photos yet.',
    );
    const taggedPhoto = world.photos.find((photo) => photo.ownerId !== 'p1');
    world.photoTags.push({
      id: 'render-tag',
      photoId: taggedPhoto.id,
      profileId: 'p1',
    });
    const taggedHtml = render(
      React.createElement(screens.TaggedPhotos, { profileId: 'p1' }),
      taggedPhoto.caption,
    );
    assert.match(
      taggedHtml.replaceAll('<!-- -->', ''),
      /Photos of Alex Morgan/,
    );
    assert.match(taggedHtml, /Added by/);
    render(React.createElement(screens.Events), 'Events');
    render(React.createElement(screens.Groups), 'Groups');
    render(
      React.createElement(screens.Group, { id: 'g1' }),
      'Campus Radio Friends',
    );
    render(React.createElement(screens.Messages), 'Messages');
    render(React.createElement(screens.Notifications), 'Notifications');
    render(
      React.createElement(screens.SearchResults, { query: 'coffee' }),
      'Search Results',
    );
    render(
      React.createElement(Feed, { posts: world.posts.slice(0, 2) }),
      'Midterms are officially over',
    );
    const stub = store.ensureProfileStub('render_stub');
    const remote = store.createMedia({
      sourceType: 'remote',
      sourceLocation: 'https://example.com/portrait.png?size=200',
    });
    store.put('profiles', { ...stub, avatarMediaId: remote.id });
    Object.assign(world, store.getState());
    render(
      React.createElement(screens.Profile, { id: stub.id }),
      'Full profile data is unavailable.',
    );
    const portrait = render(
      React.createElement(Avatar, {
        person: world.profiles.find((p) => p.id === stub.id),
      }),
      remote.sourceLocation,
    );
    assert.match(portrait, /alt="Unknown profile"/);
    const photo = store.getState().photos[0];
    store.put('photos', { ...photo, mediaId: remote.id });
    Object.assign(world, store.getState());
    render(React.createElement(screens.Photos), remote.sourceLocation);
    render(
      React.createElement(Editor, { kind: 'profile', row: stub }),
      'Existing relationships will be preserved.',
    );
    render(
      React.createElement(Editor, { kind: 'photo', row: world.photos[0] }),
      'External image URL',
    );
    render(
      React.createElement(Editor, { kind: 'album', row: world.albums[0] }),
      'Album name',
    );
  } finally {
    await vite.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
