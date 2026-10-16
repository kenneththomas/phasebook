import { createServer } from 'node:http';
import os from 'node:os';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, extname, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createStore, schema } from './store.mjs';
import { photoAction } from './photos.mjs';
import {
  createGeneration,
  httpProviderFromEnvironment,
} from './generation.mjs';
import {
  exportProfilePackage,
  previewProfilePackage,
  importProfilePackage,
} from './profile-package.mjs';
import {
  backupWorldPackage,
  exportWorldPackage,
  importWorldPackage,
  previewWorldPackage,
  WORLD_PACKAGE_MIME,
} from './world-package.mjs';

const MAX_WORLD_PACKAGE_BYTES = 61_000_000_000;

export function createApp(store, middleware = null) {
  const generation = createGeneration(store, {
    provider: httpProviderFromEnvironment(),
  });
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
        // Only same-origin browser requests. This is not an account/permission system.
        // Include the Host header so an explicitly LAN-bound server can be used from
        // another device on the same network.
        const requestHost = req.headers.host;
        const allowedOrigins = new Set([
          `http://127.0.0.1:${req.socket.localPort}`,
          `http://localhost:${req.socket.localPort}`,
          ...(requestHost ? [`http://${requestHost}`] : []),
        ]);
        if (req.headers.origin && !allowedOrigins.has(req.headers.origin))
          return json(403, { error: 'Use the local Phasebook window.' });
        if (req.method === 'GET' && url.pathname === '/api/state')
          return json(200, store.getState());
        if (req.method === 'GET' && url.pathname === '/api/export') {
          const payload = JSON.stringify(store.exportState(), null, 2);
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': 'attachment; filename="phasebook.json"',
            'Cache-Control': 'no-store',
          });
          return res.end(payload);
        }
        if (
          req.method === 'GET' &&
          url.pathname === '/api/world-packages/export'
        ) {
          const result = exportWorldPackage(store);
          res.writeHead(200, {
            'Content-Type': WORLD_PACKAGE_MIME,
            'Content-Disposition': `attachment; filename="${result.filename}"`,
            'Cache-Control': 'no-store',
          });
          result.stream.on('error', () => res.destroy());
          return result.stream.pipe(res);
        }
        if (req.method === 'GET' && url.pathname === '/api/generation')
          return json(200, {
            runs: generation.list(),
            configured: generation.configured,
          });
        if (
          req.method === 'GET' &&
          url.pathname === '/api/generation-provenance'
        )
          return json(
            200,
            generation.provenance(
              url.searchParams.get('table'),
              url.searchParams.get('id'),
            ),
          );
        const generationRoute = url.pathname.match(
          /^\/api\/generation\/([^/]+)(?:\/([a-z]+))?$/,
        );
        if (req.method === 'GET' && generationRoute && !generationRoute[2])
          return json(200, generation.get(generationRoute[1]));
        if (req.method === 'GET' && url.pathname === '/api/search')
          return json(
            200,
            store.search(
              url.searchParams.get('q') ?? '',
              50,
              url.searchParams.get('network') ?? '',
            ),
          );
        const packageExport = url.pathname.match(
          /^\/api\/profile-packages\/([^/]+)$/,
        );
        if (req.method === 'GET' && packageExport) {
          const result = exportProfilePackage(
            store,
            decodeURIComponent(packageExport[1]),
          );
          res.writeHead(200, {
            'Content-Type': 'application/vnd.phasebook.profile+zip',
            'Content-Disposition': `attachment; filename="${result.filename}"`,
            'Content-Length': result.buffer.length,
            'Cache-Control': 'no-store',
          });
          return res.end(result.buffer);
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
        const worldPackageUpload = url.pathname.startsWith(
          '/api/world-packages/',
        );
        if (worldPackageUpload && req.method === 'POST') {
          const uploadDirectory = await mkdtemp(
              join(tmpdir(), 'phasebook-upload-'),
            ),
            uploadPath = join(uploadDirectory, 'world.phasebook');
          let bytes = 0;
          const counter = new Transform({
            transform(chunk, _encoding, callback) {
              bytes += chunk.length;
              callback(
                bytes > MAX_WORLD_PACKAGE_BYTES
                  ? new Error('World package is larger than 61 GB.')
                  : null,
                chunk,
              );
            },
          });
          try {
            await pipeline(
              req,
              counter,
              createWriteStream(uploadPath, { flags: 'wx' }),
            );
            if (url.pathname === '/api/world-packages/preview')
              return json(200, await previewWorldPackage(uploadPath));
            if (url.pathname === '/api/world-packages/import')
              return json(
                200,
                await importWorldPackage(
                  store,
                  uploadPath,
                  store.filename === ':memory:'
                    ? store.mediaDir
                    : dirname(store.filename),
                ),
              );
            return json(404, { error: 'Unknown world package action.' });
          } finally {
            await rm(uploadDirectory, { recursive: true, force: true });
          }
        }
        const chunks = [];
        let bytes = 0;
        const profilePackageUpload = url.pathname.startsWith(
          '/api/profile-packages/',
        );
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > (profilePackageUpload ? 50_000_000 : 25_000_000))
            return json(413, {
              error: profilePackageUpload
                ? 'Profile package is larger than 50 MB.'
                : 'JSON is larger than 25 MB.',
            });
          chunks.push(chunk);
        }
        const rawBody = Buffer.concat(chunks);
        if (
          req.method === 'POST' &&
          url.pathname === '/api/profile-packages/preview'
        )
          return json(200, previewProfilePackage(store, rawBody));
        if (
          req.method === 'POST' &&
          url.pathname === '/api/profile-packages/import'
        ) {
          const result = importProfilePackage(
            store,
            rawBody,
            url.searchParams.get('strategy') ?? 'cancel',
          );
          return json(200, result);
        }
        // Decode once so multi-byte names survive HTTP chunk boundaries.
        const body = rawBody.toString('utf8');
        const value = body ? JSON.parse(body) : {};
        if (req.method === 'POST' && url.pathname === '/api/generation')
          return json(201, generation.create(value));
        if (req.method === 'POST' && generationRoute) {
          const [, id, action] = generationRoute;
          if (action === 'inspect')
            return json(
              200,
              await generation.inspect(
                id,
                value.name ?? 'inspect',
                value.arguments,
              ),
            );
          if (action === 'propose')
            return json(200, generation.propose(id, value.operations));
          if (action === 'generate')
            return json(200, await generation.generate(id));
          if (action === 'discard') return json(200, generation.discard(id));
          if (action === 'commit' || action === 'undo') {
            generation[action](id, value.selected);
            return json(200, store.getState());
          }
          return json(404, { error: 'Unknown generation action.' });
        }
        if (
          req.method === 'POST' &&
          /^\/api\/photos\/(publish|post|reorder|move|cover|profile-picture|delete-photo|delete-album)$/.test(
            url.pathname,
          )
        )
          return json(
            200,
            photoAction(store, url.pathname.split('/').at(-1), value),
          );
        if (req.method === 'POST' && url.pathname === '/api/photos/batch') {
          const { photos, album } = store.writePhotosResult(
            value.photos,
            value.albumName,
          );
          return json(
            200,
            changes({
              photos,
              albums: [album],
              media: [
                ...new Map(
                  photos.flatMap(referencedMedia).map((row) => [row.id, row]),
                ).values(),
              ],
            }),
          );
        }
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
        if (req.method === 'POST' && url.pathname === '/api/import') {
          const backup = await backupWorldPackage(
            store,
            store.filename === ':memory:'
              ? store.mediaDir
              : dirname(store.filename),
          );
          try {
            return json(200, store.importState(value, false));
          } catch (error) {
            await unlink(backup).catch(() => {});
            throw error;
          }
        }
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
          const { record, notification, stories } =
            match[1] === 'profiles'
              ? store.writeProfileResult(value)
              : store.writeResult(match[1], value);
          const media = referencedMedia(record);
          result = changes({
            [match[1]]: [record],
            ...(match[1] === 'profiles'
              ? {
                  networks: store.getState().networks,
                  networkMemberships: store.getState().networkMemberships,
                  albums: store.getState().albums,
                  photos: store.getState().photos,
                  profilePictures: store.getState().profilePictures,
                }
              : {}),
            ...(stories?.length ? { posts: stories } : {}),
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
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => {
    if (host === '0.0.0.0' || host === '::') {
      const addresses = Object.values(os.networkInterfaces())
        .flat()
        .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
        .map((entry) => `http://${entry.address}:${port}`);
      console.log(`Phasebook is listening on ${host}:${port}`);
      console.log(
        `LAN URLs: ${addresses.join(', ') || '(no LAN IPv4 address found)'}`,
      );
    } else {
      console.log(`Phasebook is local at http://${host}:${port}`);
    }
  });
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () =>
      server.close(async () => {
        await vite?.close();
        store.close();
        process.exit(0);
      }),
    );
}
