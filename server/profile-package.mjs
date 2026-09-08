import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { references, schema, validateRecord } from './schema.mjs';
import { decodeImage, remoteURL } from './media.mjs';

export const PACKAGE_FORMAT = 'phasebook-package';
export const PACKAGE_VERSION = 1;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const portableTables = Object.keys(schema).filter(
  (table) => table !== 'profiles',
);
const idPattern = /^[A-Za-z0-9_-]{1,200}$/;

let crcTable;
function crc32(bytes) {
  crcTable ??= Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function createArchive(files) {
  const local = [],
    central = [];
  let offset = 0;
  for (const [name, value] of files) {
    const nameBytes = encoder.encode(name),
      bytes = value instanceof Uint8Array ? value : encoder.encode(value);
    const crc = crc32(bytes);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x800, 6);
    head.writeUInt16LE(0, 8);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(bytes.length, 18);
    head.writeUInt32LE(bytes.length, 22);
    head.writeUInt16LE(nameBytes.length, 26);
    local.push(head, nameBytes, bytes);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x800, 8);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(bytes.length, 20);
    entry.writeUInt32LE(bytes.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += head.length + nameBytes.length + bytes.length;
  }
  const centralBytes = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}

function safePath(name) {
  return (
    typeof name === 'string' &&
    name.length <= 500 &&
    !name.includes('\\') &&
    !name.startsWith('/') &&
    !name.split('/').some((part) => !part || part === '.' || part === '..')
  );
}

export function unzip(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  if (buffer.length > 50_000_000)
    throw new Error('Profile package is larger than 50 MB.');
  const files = new Map();
  let offset = 0,
    total = 0;
  while (
    offset + 4 <= buffer.length &&
    buffer.readUInt32LE(offset) === 0x04034b50
  ) {
    if (offset + 30 > buffer.length)
      throw new Error('Malformed profile package archive.');
    const flags = buffer.readUInt16LE(offset + 6),
      method = buffer.readUInt16LE(offset + 8);
    const crc = buffer.readUInt32LE(offset + 14),
      compressed = buffer.readUInt32LE(offset + 18);
    const size = buffer.readUInt32LE(offset + 22),
      nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28),
      start = offset + 30 + nameLength + extraLength;
    if (
      flags & 1 ||
      flags & 8 ||
      method !== 0 ||
      compressed !== size ||
      start + size > buffer.length
    )
      throw new Error('Unsupported or malformed profile package archive.');
    const name = decoder.decode(
      buffer.subarray(offset + 30, offset + 30 + nameLength),
    );
    if (!safePath(name) || files.has(name))
      throw new Error('Unsafe or duplicate media path in package.');
    const bytes = buffer.subarray(start, start + size);
    total += size;
    if (files.size >= 5000 || total > 50_000_000)
      throw new Error('Profile package expands beyond safe limits.');
    if (crc32(bytes) !== crc)
      throw new Error(`Archive checksum failed for ${name}.`);
    files.set(name, Buffer.from(bytes));
    offset = start + size;
  }
  if (!files.size) throw new Error('Not a valid Phasebook package archive.');
  return files;
}

const toPortable = (store, table, row) => {
  const result = { ...row };
  delete result.id;
  for (const [field, target] of Object.entries(references[table] ?? {}))
    if (row[field] !== null)
      result[field] = store.get(target, row[field])?.externalId;
  return result;
};

function slug(name) {
  return (
    (name || 'profile')
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'profile'
  );
}

export function exportProfilePackage(store, profileId, now = new Date()) {
  const state = store.getState(),
    root = store.get('profiles', profileId);
  if (!root) throw new Error('Profile not found.');
  const rootId = root.id;
  const chosen = Object.fromEntries(
    portableTables.map((table) => [table, new Map()]),
  );
  const add = (table, row) => row && chosen[table].set(row.id, row);
  const ownedGroups = new Set(
    state.groups.filter((r) => r.creatorId === rootId).map((r) => r.id),
  );
  const ownedEvents = new Set(
    state.events.filter((r) => r.creatorId === rootId).map((r) => r.id),
  );
  for (const row of state.groups)
    if (ownedGroups.has(row.id)) add('groups', row);
  for (const row of state.groupMembers)
    if (row.profileId === rootId) {
      add('groupMembers', row);
      add('groups', store.get('groups', row.groupId));
    }
  for (const row of state.events)
    if (ownedEvents.has(row.id)) add('events', row);
  for (const row of state.eventGuests)
    if (row.profileId === rootId) {
      add('eventGuests', row);
      add('events', store.get('events', row.eventId));
    }
  for (const row of state.friendships)
    if (row.profileId === rootId || row.friendId === rootId)
      add('friendships', row);
  for (const row of state.albums)
    if (row.ownerId === rootId) add('albums', row);
  for (const row of state.photos)
    if (row.ownerId === rootId) {
      add('photos', row);
      add('albums', store.get('albums', row.albumId));
    }
  for (const row of state.posts) if (row.authorId === rootId) add('posts', row);
  for (const row of state.comments)
    if (row.authorId === rootId) {
      add('comments', row);
      add('posts', store.get('posts', row.postId));
    }
  for (const row of state.likes)
    if (row.profileId === rootId) {
      add('likes', row);
      add('posts', store.get('posts', row.postId));
    }
  for (const row of state.messages)
    if (row.senderId === rootId) add('messages', row);
  // Pull in only structural dependencies, never another person's activity graph.
  for (const post of chosen.posts.values()) {
    if (post.groupId) add('groups', store.get('groups', post.groupId));
    if (post.photoId) add('photos', store.get('photos', post.photoId));
  }
  for (const photo of chosen.photos.values())
    add('albums', store.get('albums', photo.albumId));
  const mediaIds = new Set([root.avatarMediaId]);
  for (const row of chosen.albums.values()) mediaIds.add(row.coverMediaId);
  for (const row of chosen.photos.values()) mediaIds.add(row.mediaId);
  for (const id of mediaIds) add('media', id && store.get('media', id));
  const profileIds = new Set([rootId]);
  for (const [table, rows] of Object.entries(chosen))
    for (const row of rows.values())
      for (const [field, target] of Object.entries(references[table] ?? {}))
        if (target === 'profiles' && row[field]) profileIds.add(row[field]);
  const referencedProfiles = [...profileIds]
    .filter((id) => id !== rootId)
    .map((id) => {
      const p = store.get('profiles', id);
      return { externalId: p.externalId, name: p.name || '' };
    });
  const files = [],
    mediaPath = new Map();
  for (const media of chosen.media.values()) {
    if (media.sourceType === 'remote') continue;
    const path = `media/${media.externalId}-${basename(media.sourceLocation)}`;
    const source =
      media.sourceType === 'local'
        ? store.mediaFile(media.id).path
        : store.bundledMediaFile(media.sourceLocation);
    files.push([path, readFileSync(source)]);
    mediaPath.set(media.id, path);
  }
  const entities = Object.fromEntries(
    portableTables.map((table) => [
      table,
      [...chosen[table].values()].map((row) => {
        const result = toPortable(store, table, row);
        if (table === 'media') {
          result.cachedLocalPath = null;
          if (row.sourceType !== 'remote') {
            result.sourceType = 'local';
            result.sourceLocation = mediaPath.get(row.id);
            result.mimeType ??= /\.png$/i.test(row.sourceLocation)
              ? 'image/png'
              : /\.webp$/i.test(row.sourceLocation)
                ? 'image/webp'
                : 'image/jpeg';
          }
        }
        return result;
      }),
    ]),
  );
  const data = {
    rootProfile: toPortable(store, 'profiles', root),
    referencedProfiles,
    entities,
  };
  const counts = Object.fromEntries(
    Object.entries(entities).map(([k, rows]) => [k, rows.length]),
  );
  const manifest = {
    format: PACKAGE_FORMAT,
    schemaVersion: PACKAGE_VERSION,
    type: 'profile',
    rootProfileExternalId: root.externalId,
    exportedAt: now.toISOString(),
    application: { name: 'Phasebook', worldSchemaVersion: state.schemaVersion },
    counts,
    mediaCount: files.length,
  };
  return {
    buffer: createArchive([
      ['manifest.json', JSON.stringify(manifest, null, 2)],
      ['data.json', JSON.stringify(data, null, 2)],
      ...files,
    ]),
    filename: `${slug(root.name)}.phasebook`,
    manifest,
    data,
  };
}

function jsonFile(files, name) {
  const bytes = files.get(name);
  if (!bytes || bytes.length > 10_000_000)
    throw new Error(`Package is missing a valid ${name}.`);
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    throw new Error(`${name} is not valid JSON.`);
  }
}

export function validateProfilePackage(buffer) {
  const files = unzip(buffer),
    manifest = jsonFile(files, 'manifest.json'),
    data = jsonFile(files, 'data.json');
  if (
    manifest.format !== PACKAGE_FORMAT ||
    manifest.schemaVersion !== PACKAGE_VERSION ||
    manifest.type !== 'profile'
  )
    throw new Error('Unsupported Phasebook profile package format or version.');
  if (
    !idPattern.test(manifest.rootProfileExternalId ?? '') ||
    !data.rootProfile ||
    data.rootProfile.externalId !== manifest.rootProfileExternalId
  )
    throw new Error('Package root profile is missing or inconsistent.');
  if (Object.hasOwn(data.rootProfile, 'id'))
    throw new Error('Portable records cannot contain local database ids.');
  const validationProfile = { id: 'validation-profile', ...data.rootProfile };
  if (validationProfile.avatarMediaId !== null)
    validationProfile.avatarMediaId = 'validation-avatar';
  validateRecord('profiles', validationProfile);
  if (!Array.isArray(data.referencedProfiles))
    throw new Error('Package referenced profiles must be an array.');
  const refs = new Map();
  for (const p of data.referencedProfiles) {
    if (!p || !idPattern.test(p.externalId ?? '') || typeof p.name !== 'string')
      throw new Error('Invalid referenced profile metadata.');
    if (p.externalId === data.rootProfile.externalId || refs.has(p.externalId))
      throw new Error('Duplicate referenced profile external id.');
    refs.set(p.externalId, p);
  }
  const entities = data.entities;
  if (
    !entities ||
    portableTables.some((t) => !Array.isArray(entities[t])) ||
    Object.keys(entities).some((t) => !portableTables.includes(t))
  )
    throw new Error(
      'Package does not contain the required entity collections.',
    );
  const ids = Object.fromEntries(portableTables.map((t) => [t, new Set()]));
  for (const table of portableTables)
    for (const row of entities[table]) {
      if (entities[table].length > 20000)
        throw new Error(`Package collection ${table} exceeds 20,000 records.`);
      if (
        !row ||
        Object.hasOwn(row, 'id') ||
        !idPattern.test(row.externalId ?? '') ||
        ids[table].has(row.externalId)
      )
        throw new Error(`Invalid or duplicate external id in ${table}.`);
      ids[table].add(row.externalId);
      const local = { id: 'validation-id', ...row };
      for (const field of Object.keys(references[table] ?? {}))
        if (local[field] !== null) local[field] = `validation-${field}`;
      validateRecord(table, local);
    }
  const profileIds = new Set([data.rootProfile.externalId, ...refs.keys()]);
  for (const table of portableTables)
    for (const row of entities[table])
      for (const [field, target] of Object.entries(references[table] ?? {}))
        if (
          row[field] !== null &&
          !(target === 'profiles' ? profileIds : ids[target]).has(row[field])
        )
          throw new Error(`Unresolved ${table}.${field} external id.`);
  if (
    data.rootProfile.avatarMediaId !== null &&
    !ids.media.has(data.rootProfile.avatarMediaId)
  )
    throw new Error('Root profile avatar media reference is unresolved.');
  const declaredMediaPaths = new Set();
  for (const media of entities.media)
    if (media.sourceType === 'local') {
      if (
        !safePath(media.sourceLocation) ||
        !media.sourceLocation.startsWith('media/') ||
        !files.has(media.sourceLocation)
      )
        throw new Error(
          `Packaged media file is missing or unsafe: ${media.sourceLocation}.`,
        );
      declaredMediaPaths.add(media.sourceLocation);
      decodeImage(
        `data:${media.mimeType};base64,${files.get(media.sourceLocation).toString('base64')}`,
      );
    } else if (media.sourceType === 'remote') remoteURL(media.sourceLocation);
    else throw new Error('Package media must be local or remote.');
  for (const name of files.keys())
    if (
      !['manifest.json', 'data.json'].includes(name) &&
      !declaredMediaPaths.has(name)
    )
      throw new Error(`Unexpected archive entry: ${name}.`);
  return { files, manifest, data };
}

export function previewProfilePackage(store, buffer) {
  const parsed = validateProfilePackage(buffer),
    existing = store.resolveExternal(
      'profiles',
      parsed.data.rootProfile.externalId,
    );
  const newStubs = parsed.data.referencedProfiles.filter(
    (p) => !store.resolveExternal('profiles', p.externalId),
  ).length;
  return {
    manifest: parsed.manifest,
    profile: {
      name: parsed.data.rootProfile.name,
      externalId: parsed.data.rootProfile.externalId,
      status: !existing
        ? 'new'
        : existing.state === 'stub'
          ? 'stub'
          : 'conflict',
    },
    counts: Object.fromEntries(
      Object.entries(parsed.data.entities).map(([k, v]) => [k, v.length]),
    ),
    newStubs,
    mediaCount: parsed.data.entities.media.length,
  };
}

export function importProfilePackage(store, buffer, strategy = 'cancel') {
  const parsed = validateProfilePackage(buffer),
    originalRoot = parsed.data.rootProfile.externalId;
  const existingRoot = store.resolveExternal('profiles', originalRoot);
  if (existingRoot?.state === 'full' && !['merge', 'new'].includes(strategy))
    throw new Error('Choose merge, import as new, or cancel.');
  if (!existingRoot?.state && !['merge', 'new'].includes(strategy))
    strategy = 'merge';
  const remapAll = strategy === 'new' && existingRoot?.state === 'full';
  return store.transaction(() => {
    const remaps = Object.fromEntries(
      portableTables.map((t) => [t, new Map()]),
    );
    const rootExternalId = remapAll ? randomUUID() : originalRoot;
    if (remapAll)
      for (const table of portableTables)
        for (const row of parsed.data.entities[table])
          remaps[table].set(row.externalId, randomUUID());
    const mapId = (table, id) =>
      id === null
        ? null
        : table === 'profiles'
          ? id === originalRoot
            ? rootExternalId
            : id
          : (remaps[table].get(id) ?? id);
    for (const hint of parsed.data.referencedProfiles)
      store.ensureProfileStub(hint.externalId, hint.name);
    for (const source of parsed.data.entities.media) {
      let externalId = mapId('media', source.externalId),
        existing = store.resolveExternal('media', externalId);
      if (existing) {
        const incomingBytes =
          source.sourceType === 'local'
            ? parsed.files.get(source.sourceLocation)
            : null;
        const existingBytes =
          existing.sourceType === 'local'
            ? readFileSync(store.mediaFile(existing.id).path)
            : existing.sourceType === 'bundled'
              ? readFileSync(store.bundledMediaFile(existing.sourceLocation))
              : null;
        const equivalent =
          source.kind === existing.kind &&
          (source.sourceType === 'remote'
            ? existing.sourceType === 'remote' &&
              source.sourceLocation === existing.sourceLocation
            : existingBytes?.equals(incomingBytes));
        if (equivalent) continue;
        // A stable-ID collision with different bytes/source is ambiguous. Keep
        // the local record and remap this package asset and its references.
        externalId = randomUUID();
        remaps.media.set(source.externalId, externalId);
        existing = undefined;
      }
      if (source.sourceType === 'local')
        store.createPackagedMedia(
          { ...source, externalId },
          `data:${source.mimeType};base64,${parsed.files.get(source.sourceLocation).toString('base64')}`,
        );
      else store.putExternal('media', { ...source, externalId });
    }
    const profile = { ...parsed.data.rootProfile, externalId: rootExternalId };
    if (profile.avatarMediaId !== null)
      profile.avatarMediaId = store.resolveExternal(
        'media',
        mapId('media', profile.avatarMediaId),
      ).id;
    store.hydrateProfile(rootExternalId, profile);
    for (const table of portableTables.filter((t) => t !== 'media'))
      for (const source of parsed.data.entities[table]) {
        const row = { ...source, externalId: mapId(table, source.externalId) };
        for (const [field, target] of Object.entries(references[table] ?? {}))
          row[field] = mapId(target, row[field]);
        const naturalFields = {
          friendships: ['profileId', 'friendId'],
          groupMembers: ['groupId', 'profileId'],
          likes: ['postId', 'profileId'],
          eventGuests: ['eventId', 'profileId'],
        }[table];
        if (naturalFields && !store.resolveExternal(table, row.externalId)) {
          const localRefs = Object.fromEntries(
            naturalFields.map((field) => {
              const target = references[table][field];
              return [field, store.resolveExternal(target, row[field])?.id];
            }),
          );
          const equivalent = store
            .getState()
            [table].find((candidate) =>
              table === 'friendships'
                ? [candidate.profileId, candidate.friendId]
                    .sort((a, b) => a.localeCompare(b))
                    .join('\0') ===
                  [localRefs.profileId, localRefs.friendId]
                    .sort((a, b) => a.localeCompare(b))
                    .join('\0')
                : naturalFields.every(
                    (field) => candidate[field] === localRefs[field],
                  ),
            );
          if (equivalent) {
            const changes = {};
            if (Object.hasOwn(row, 'status')) changes.status = row.status;
            if (Object.keys(changes).length)
              store.put(table, { ...equivalent, ...changes });
            continue;
          }
        }
        store.putExternal(table, row);
      }
    return {
      state: store.getState(),
      rootProfileId: store.resolveExternal('profiles', rootExternalId).id,
      rootProfileExternalId: rootExternalId,
    };
  });
}
