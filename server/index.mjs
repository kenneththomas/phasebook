import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, schema } from './store.mjs';

export function createApp(store, middleware = null) {
  const root = resolve('dist');
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2',
  };
  const changes = (upserts = {}, deletes = {}, settings) => ({
    upserts,
    deletes,
    ...(settings ? { settings } : {}),
  });
  const referencedMedia = (record) =>
    ['avatarMediaId', 'coverMediaId', 'mediaId']
      .map((field) => record?.[field])
      .filter(Boolean)
      .map((id) => store.get('media', id))
      .filter(Boolean);
  return createServer(async (req, res) => {
    const json = (status, value) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(value));
    };
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/api/')) {
        // Only same-origin local browser requests. This is not an account/permission system.
        if (
          req.headers.origin &&
          ![
            `http://127.0.0.1:${req.socket.localPort}`,
            `http://localhost:${req.socket.localPort}`,
          ].includes(req.headers.origin)
        )
          return json(403, { error: 'Use the local Phasebook window.' });
        if (
          req.method === 'GET' &&
          ['/api/state', '/api/export'].includes(url.pathname)
        ) {
          if (url.pathname.endsWith('export'))
            res.setHeader(
              'Content-Disposition',
              'attachment; filename="phasebook.json"',
            );
          return json(
            200,
            url.pathname.endsWith('export')
              ? store.exportState()
              : store.getState(),
          );
        }
        const mediaMatch = url.pathname.match(/^\/api\/media\/([^/]+)$/);
        if (req.method === 'GET' && mediaMatch) {
          const file = store.mediaFile(decodeURIComponent(mediaMatch[1]));
          const bytes = await readFile(file.path);
          res.writeHead(200, {
            'Content-Type': file.mimeType,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-cache',
          });
          return res.end(bytes);
        }
        if (!['POST', 'DELETE'].includes(req.method))
          return json(404, { error: 'Not found.' });
        const chunks = [];
        let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 25_000_000)
            return json(413, { error: 'JSON is larger than 25 MB.' });
          chunks.push(chunk);
        }
        // Decode once so multi-byte names survive HTTP chunk boundaries.
        const body = Buffer.concat(chunks).toString('utf8');
        const value = body ? JSON.parse(body) : {};
        if (req.method === 'POST' && url.pathname === '/api/photos/save') {
          const { record, notification, album } = store.writePhotoResult(
            value.photo,
            value.albumName,
          );
          return json(
            200,
            changes({
              photos: [record],
              albums: [album],
              media: referencedMedia(record),
              ...(notification ? { notifications: [notification] } : {}),
            }),
          );
        }
        if (req.method === 'POST' && url.pathname === '/api/media')
          return json(201, store.createMedia(value));
        if (req.method === 'POST' && url.pathname === '/api/profiles/resolve')
          return json(
            200,
            store.ensureProfileStub(value.externalId, value.name),
          );
        if (req.method === 'POST' && url.pathname === '/api/profiles/hydrate')
          return json(
            200,
            store.hydrateProfile(value.externalId, value.profile),
          );
        if (req.method === 'POST' && url.pathname === '/api/import')
          return json(200, store.importState(value));
        if (req.method === 'POST' && url.pathname === '/api/switch') {
          store.switchProfile(value.profileId);
          return json(
            200,
            changes({}, {}, { activeProfileId: value.profileId }),
          );
        }
        if (
          req.method === 'POST' &&
          url.pathname === '/api/read-conversation'
        ) {
          const messages = store.markConversationRead(
            value.profileId,
            value.otherId,
          );
          return json(200, changes({ messages }));
        }
        const match = url.pathname.match(
          /^\/api\/records\/([a-zA-Z]+)(?:\/([^/]+))?$/,
        );
        if (!match || !Object.hasOwn(schema, match[1]))
          return json(404, { error: 'Not found.' });
        let result;
        if (req.method === 'DELETE' && match[2]) {
          const id = decodeURIComponent(match[2]);
          store.remove(match[1], id);
          result = changes({}, { [match[1]]: [id] });
        } else if (req.method === 'POST' && !match[2]) {
          const { record, notification } = store.writeResult(match[1], value);
          const media = referencedMedia(record);
          result = changes({
            [match[1]]: [record],
            ...(media.length ? { media } : {}),
            ...(notification ? { notifications: [notification] } : {}),
          });
        } else return json(404, { error: 'Not found.' });
        return json(200, result);
      }
      if (middleware)
        return middleware(req, res, () => {
          res.writeHead(404);
          res.end('Not found');
        });
      let path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (path !== root && !path.startsWith(root + sep)) {
        res.writeHead(403);
        return res.end();
      }
      if (url.pathname === '/' || !extname(path))
        path = resolve(root, 'index.html');
      if (!(await stat(path)).isFile()) throw new Error('Not found');
      res.writeHead(200, {
        'Content-Type': mime[extname(path)] ?? 'application/octet-stream',
      });
      res.end(await readFile(path));
    } catch (error) {
      json(req.url.startsWith('/api/') ? 400 : 404, { error: error.message });
    }
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const dev = process.argv.includes('--dev');
  const store = createStore(process.env.PHASEBOOK_DB || undefined);
  const vite = dev
    ? await (
        await import('vite')
      ).createServer({
        server: { middlewareMode: true, hmr: false, ws: false },
        appType: 'spa',
      })
    : null;
  const server = createApp(store, vite?.middlewares);
  const port = Number(process.env.PORT || 5173);
  server.listen(port, '127.0.0.1', () =>
    console.log(`Phasebook is local at http://127.0.0.1:${port}`),
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () =>
      server.close(async () => {
        await vite?.close();
        store.close();
        process.exit(0);
      }),
    );
}
