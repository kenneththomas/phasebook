import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import yauzl from 'yauzl';
import { remoteURL, validateImageFile } from './media.mjs';
import { photoTables, upgradePhotoData } from './schema.mjs';
import {
  assertUniqueIdentities,
  references,
  tables,
  validateRecord,
} from './store.mjs';

export const WORLD_PACKAGE_FORMAT = 'phasebook-package';
export const WORLD_PACKAGE_VERSION = 1;
export const WORLD_PACKAGE_MIME = 'application/vnd.phasebook.world+zip';
const MAX_JSON_BYTES = 100_000_000;
const MAX_MEDIA_BYTES = 3_000_000;
const MAX_EXPANDED_BYTES = 61_000_000_000;
const MAX_ENTRIES = 20_002;
const idPattern = /^[A-Za-z0-9_-]{1,200}$/;
const mediaPathPattern = /^media\/[A-Za-z0-9_-]{1,200}\.(png|jpg|webp)$/;

const mimeExtension = (mimeType) =>
  ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' })[mimeType];
const pathMime = (path) =>
  /\.png$/i.test(path)
    ? 'image/png'
    : /\.webp$/i.test(path)
      ? 'image/webp'
      : 'image/jpeg';

function packageData(store) {
  const world = store.exportState({ includeMedia: false }),
    files = [];
  delete world.mediaFiles;
  world.media = world.media.map((source) => {
    const media = { ...source, cachedLocalPath: null };
    if (media.sourceType === 'remote') return media;
    const mimeType = media.mimeType ?? pathMime(media.sourceLocation),
      extension = mimeExtension(mimeType);
    if (!extension)
      throw new Error('World contains an unsupported image type.');
    const packagePath = `media/${media.externalId}.${extension}`;
    files.push([
      media.sourceType === 'local'
        ? store.mediaFile(media.id).path
        : store.bundledMediaFile(media.sourceLocation),
      packagePath,
    ]);
    return {
      ...media,
      sourceType: 'local',
      sourceLocation: packagePath,
      mimeType,
    };
  });
  const counts = Object.fromEntries(
    tables.map((table) => [table, world[table].length]),
  );
  const manifest = {
    format: WORLD_PACKAGE_FORMAT,
    packageVersion: WORLD_PACKAGE_VERSION,
    type: 'world',
    worldSchemaVersion: world.schemaVersion,
    exportedAt: new Date().toISOString(),
    application: { name: 'Phasebook' },
    counts,
    mediaCount: files.length,
  };
  return { world, files, manifest };
}

export function exportWorldPackage(store) {
  const { world, files, manifest } = packageData(store),
    zip = new yazl.ZipFile();
  zip.addBuffer(
    Buffer.from(JSON.stringify(manifest, null, 2)),
    'manifest.json',
  );
  zip.addBuffer(Buffer.from(JSON.stringify(world, null, 2)), 'world.json');
  for (const [source, destination] of files)
    zip.addFile(source, destination, { compress: false });
  zip.end();
  return {
    stream: zip.outputStream,
    filename: 'phasebook-world.phasebook',
    manifest,
  };
}

export async function writeWorldPackage(store, path) {
  await mkdir(dirname(path), { recursive: true });
  const { stream } = exportWorldPackage(store);
  try {
    await pipeline(stream, createWriteStream(path, { flags: 'wx' }));
  } catch (error) {
    await unlink(path).catch(() => {});
    throw error;
  }
  return path;
}

export async function backupWorldPackage(store, directory) {
  const path = join(
    directory,
    `backup-${Date.now()}-${randomUUID().slice(0, 8)}.phasebook`,
  );
  return writeWorldPackage(store, path);
}

async function readLimited(stream, limit, name) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > limit) throw new Error(`${name} is too large.`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function byteLimiter(limit, name) {
  let total = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      total += chunk.length;
      callback(
        total > limit ? new Error(`${name} is too large.`) : null,
        chunk,
      );
    },
  });
}

function validateWorld(world, manifest, mediaFiles) {
  if (world && typeof world === 'object') {
    for (const table of photoTables)
      if (
        world[table] === undefined &&
        manifest.counts?.[table] === undefined
      ) {
        world[table] = [];
        manifest.counts[table] = 0;
      }
    upgradePhotoData(world);
  }
  if (
    !world ||
    world.schemaVersion !== 2 ||
    typeof world.settings?.activeProfileId !== 'string' ||
    Object.hasOwn(world, 'mediaFiles')
  )
    throw new Error(
      'Package must contain a byte-free Phasebook schemaVersion 2 world.',
    );
  if (
    !tables.every((table) => Array.isArray(world[table])) ||
    !world.profiles.length
  )
    throw new Error(
      'World package must contain every collection and at least one profile.',
    );
  const ids = {};
  for (const table of tables) {
    if (world[table].length > 20_000)
      throw new Error(`Collection ${table} exceeds 20,000 records.`);
    assertUniqueIdentities(table, world[table], true);
    ids[table] = new Set(world[table].map((row) => row.id));
    for (const row of world[table]) validateRecord(table, row);
    if (manifest.counts?.[table] !== world[table].length)
      throw new Error(`Manifest count does not match ${table}.`);
  }
  if (!ids.profiles.has(world.settings.activeProfileId))
    throw new Error('Active profile reference is unresolved.');
  for (const table of tables)
    for (const row of world[table])
      for (const [field, target] of Object.entries(references[table] ?? {}))
        if (row[field] !== null && !ids[target].has(row[field]))
          throw new Error(`Unresolved ${table}.${field} reference.`);
  const declared = new Set();
  for (const media of world.media) {
    if (media.cachedLocalPath !== null)
      throw new Error('Packaged media cannot contain cached local paths.');
    if (media.sourceType === 'remote') {
      remoteURL(media.sourceLocation);
      continue;
    }
    if (
      media.sourceType !== 'local' ||
      !mediaPathPattern.test(media.sourceLocation) ||
      !idPattern.test(media.externalId) ||
      declared.has(media.sourceLocation)
    )
      throw new Error('Package contains an invalid or duplicate media path.');
    const path = mediaFiles.get(media.sourceLocation);
    if (!path) throw new Error(`Package is missing ${media.sourceLocation}.`);
    validateImageFile(path, media.mimeType);
    declared.add(media.sourceLocation);
  }
  if (
    declared.size !== mediaFiles.size ||
    manifest.mediaCount !== declared.size
  )
    throw new Error('Package contains undeclared media files.');
}

export async function readWorldPackage(path) {
  const stage = await mkdtemp(resolve(tmpdir(), 'phasebook-world-'));
  try {
    const zip = await yauzl.openPromise(path, {
      decodeStrings: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
    const json = new Map(),
      mediaFiles = new Map(),
      seen = new Set();
    let expanded = 0,
      entries = 0;
    for await (const entry of zip.eachEntry()) {
      const name = entry.fileName;
      if (name.endsWith('/') || seen.has(name) || ++entries > MAX_ENTRIES)
        throw new Error('World package contains invalid or duplicate entries.');
      seen.add(name);
      expanded += entry.uncompressedSize;
      if (expanded > MAX_EXPANDED_BYTES)
        throw new Error('World package expands beyond the safe size limit.');
      const stream = await zip.openReadStreamPromise(entry);
      if (name === 'manifest.json' || name === 'world.json') {
        json.set(name, await readLimited(stream, MAX_JSON_BYTES, name));
      } else if (mediaPathPattern.test(name)) {
        if (entry.uncompressedSize > MAX_MEDIA_BYTES)
          throw new Error(`Packaged image is too large: ${name}.`);
        const stagedPath = join(stage, randomUUID());
        await pipeline(
          stream,
          byteLimiter(MAX_MEDIA_BYTES, name),
          createWriteStream(stagedPath, { flags: 'wx' }),
        );
        mediaFiles.set(name, stagedPath);
      } else {
        throw new Error(`Unexpected archive entry: ${name}.`);
      }
    }
    let manifest, world;
    try {
      manifest = JSON.parse(json.get('manifest.json')?.toString('utf8'));
      world = JSON.parse(json.get('world.json')?.toString('utf8'));
    } catch {
      throw new Error('World package contains invalid JSON.');
    }
    if (
      manifest?.format !== WORLD_PACKAGE_FORMAT ||
      manifest?.packageVersion !== WORLD_PACKAGE_VERSION ||
      manifest?.type !== 'world' ||
      manifest?.worldSchemaVersion !== 2
    )
      throw new Error('Unsupported Phasebook world package format or version.');
    validateWorld(world, manifest, mediaFiles);
    return {
      manifest,
      world,
      mediaFiles,
      dispose: () => rm(stage, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

export async function previewWorldPackage(path) {
  const parsed = await readWorldPackage(path);
  try {
    return {
      exportedAt: parsed.manifest.exportedAt,
      counts: parsed.manifest.counts,
      mediaCount: parsed.manifest.mediaCount,
    };
  } finally {
    await parsed.dispose();
  }
}

export async function importWorldPackage(store, path, backupDirectory) {
  const parsed = await readWorldPackage(path);
  let backup;
  try {
    backup = await backupWorldPackage(store, backupDirectory);
    return store.importState(parsed.world, false, parsed.mediaFiles);
  } catch (error) {
    if (backup) await unlink(backup).catch(() => {});
    throw error;
  } finally {
    await parsed.dispose();
  }
}
