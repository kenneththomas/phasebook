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
    const [{ AppContext }, screens, { Feed }] = await Promise.all([
      vite.ssrLoadModule('/app/context.tsx'),
      vite.ssrLoadModule('/app/screens.tsx'),
      vite.ssrLoadModule('/app/feed.tsx'),
    ]);
    const world = store.getState();
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
    render(React.createElement(screens.Photos), 'Photos');
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
  } finally {
    await vite.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
