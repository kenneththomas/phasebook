# Portable identities and partial worlds

Phasebook uses SQLite schema version **2** (`PRAGMA user_version`). Every portable
record has a world-local `id` primary key and an immutable, unique `externalId`.
New external identities are UUID v4 values, generated independently of local IDs.
Opaque imported identities such as `usr_bob` are also accepted (1–200 ASCII
letters, digits, underscores or hyphens). Uniqueness is enforced per entity table
by SQLite and checked explicitly during imports. The entity type is part of a
portable reference's meaning.

The existing indexed **TEXT local primary keys and foreign keys are retained**.
This preserves existing routes and relationships without a costly re-keying.
Their string representation does not make them portable: `p1` in two independent
worlds need not mean the same person. All joins use local IDs. Portable resolution
happens at the store boundary, never in individual social route handlers.

## Entity relationships and ownership

All tables below have `id` and `externalId`. Arrows describe local foreign keys.

| Record               | References                                                                                  | Ownership / initiating actor for future export                  |
| -------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Profile              | `avatarMediaId → media` (optional)                                                          | The profile itself                                              |
| Friendship           | `profileId, friendId → profiles`                                                            | Involves both; `profileId` initiates a pending request          |
| Post                 | `authorId → profiles`; optional `wallId → profiles`, `groupId → groups`, `photoId → photos` | Author initiates; wall recipient and group are distinct targets |
| Comment              | `authorId → profiles`, `postId → posts`                                                     | Comment author; parent post is a dependency                     |
| Like                 | `profileId → profiles`, `postId → posts`                                                    | Acting profile                                                  |
| Album                | `ownerId → profiles`; optional `coverMediaId → media`                                       | Album creator/owner                                             |
| Photo                | `ownerId → profiles`, `albumId → albums`, `mediaId → media`                                 | Uploader/owner; media and album are dependencies                |
| Group                | optional `creatorId → profiles`                                                             | Creator; null means historical provenance is unknown            |
| Group membership     | `groupId → groups`, `profileId → profiles`                                                  | Associated member; group is a dependency                        |
| Event                | `creatorId → profiles`                                                                      | Event creator                                                   |
| RSVP (`eventGuests`) | `eventId → events`, `profileId → profiles`                                                  | Attendee initiates                                              |
| Message              | `senderId, recipientId → profiles`                                                          | Sender initiates; recipient is a dependency                     |
| Notification         | `profileId, actorId → profiles`; optional `postId → posts`                                  | Recipient's notification, derived from the actor's action       |
| Media                | No social owner FK                                                                          | Shared resource; exported as a dependency of referring entities |

Settings contain the active profile's local ID and are world configuration, not a
portable domain entity. Conversations currently group messages by participant
pair: there is no independently stored thread object. Photo tags do not yet exist.
If either feature is added, it should have its own relational table and portable
identity. Comments and likes currently target posts; other target types should use
enforced relational references, rather than an unchecked generic string target.

Pair constraints prevent duplicate friendships, likes, memberships and RSVPs.
Deleting a post cascades its comments and likes. Referenced media cannot be
deleted (`RESTRICT`). Profile deletion remains unsupported. Album deletion
cascades its photos, so ordinary editing preserves the album rather than deleting
and recreating it.

## Full and stub profiles

`profiles.state` is `full` or `stub`, enforced by a CHECK constraint. A stub is a
normal profile row with local and external identities, an optional name hint
(represented as an empty string when absent), optional avatar, and empty detail
fields. Empty names display as “Unknown profile.” Full profiles require a name;
“full” does not require every optional biographical field to be filled in.

Every existing profile foreign key accepts a stub. It can receive Wall posts,
participate in friendships or messages, be selected as the active profile, and
have its own profile URL. Its page explains that full profile data is unavailable.
Administrative status and portable identity controls live in the editor and
Manage this world, not in the News Feed.

Hydration updates the existing row in a transaction. It preserves both IDs and
every inbound relationship, merges supplied fields, and changes `state` to `full`.
It never creates a replacement row or rewrites the world. Editing a full profile
cannot change its external identity or downgrade it to a stub. An attempted
creation with an external identity belonging to a full profile is a duplicate.

## Shared store boundary

`server/schema.mjs` defines the relational schema and a derived reference map.
`server/store.mjs` owns validation, transactions, identity resolution, and social
side effects. `server/media.mjs` owns source validation and managed file storage.

- `newExternalId()` generates a UUID; `assertUniqueIdentities()` checks a batch.
- `resolveExternal(table, externalId)` returns a local row or `undefined`.
- `ensureProfileStub(externalId, nameHint?)` returns an existing profile or creates
  a stub atomically. Repeated calls never downgrade or overwrite an existing row.
- `hydrateProfile(externalId, data)` merges profile details in place or creates a
  full profile if no row exists. Explicitly conflicting identities are rejected.
- `putExternal(table, record)` is a small shared ingestion primitive: omit `id`,
  provide `externalId`, and put **external IDs** in reference fields. It resolves
  them using the schema's reference map, creates missing profile stubs, and writes
  local FKs in one transaction. Missing non-profile references currently fail with
  an explicit error; the entire operation, including newly created stubs, rolls
  back. This primitive preserves imported records without generating notifications.
- `write(table, record)` handles local editor/social writes and creates derived
  notifications atomically. `writePhoto(photo, albumName)` additionally creates or
  selects an owner-scoped album when the photo has no album ID.

Example (in a service using an open store):

```js
const post = store.putExternal('posts', {
  externalId: 'post_alice_to_bob',
  authorId: alice.externalId,
  wallId: 'usr_bob',
  groupId: null,
  photoId: null,
  body: 'Hello Bob',
  createdAt: new Date().toISOString(),
});
const bob = store.resolveExternal('profiles', 'usr_bob'); // state: stub
store.hydrateProfile('usr_bob', { name: 'Bob', city: 'Boston' });
// post.wallId === bob.id, before and after hydration
```

HTTP endpoints expose media creation (`POST /api/media`), stub resolution
(`POST /api/profiles/resolve`, `{externalId, name?}`), and hydration
(`POST /api/profiles/hydrate`, `{externalId, profile}`). These return the resolved
record. Standard record writes and `/api/photos/save` return the updated world.
No per-profile export product or partial-world import endpoint is implemented yet.

## Media and storage

Social rows store only local media FKs. A media row has `kind` (currently image),
`sourceType`, `sourceLocation`, optional `mimeType`, `originalFilename`, `width`,
`height`, `cachedLocalPath`, plus `createdAt` and a JSON `metadata` object. Dimensions
are currently unknown (`null`); metadata is reserved for later thumbnailing.

| Source    | Location and behavior                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| `local`   | A generated UUID filename under the backend-managed media directory. Served by `/api/media/:localId`.               |
| `remote`  | An absolute HTTP(S) URL, without embedded credentials. The browser loads it directly; the backend never fetches it. |
| `bundled` | An explicitly marked `/assets/...` application image. The file must exist in `public/assets`.                       |

By default storage is `data/phasebook.sqlite` plus `data/media/`. A custom
`PHASEBOOK_DB` uses `media/` beside that database. Databases in the same directory
share that media directory, with collision-resistant filenames. Programmatic
stores can override `mediaDirectory`; in-memory tests use a temporary directory.
Original filenames are descriptive metadata, never storage keys. Mutable images
are never written to frontend source or bundled asset directories.

Uploads accept PNG/JPEG/WebP up to 3 MB. JSON data URLs are used **only as upload or
backup transport**, decoded and signature-checked on the server, then written as
files before the media row commits. Failed transactions remove files they created.
File paths are constrained to managed UUID filenames. This is format/signature
validation, not a complete image-decoder check; a damaged image can still fail to
render. Files from successful uploads, including an editor subsequently canceled,
are retained. Deleting/replacing rows does not automatically garbage-collect
files, so older backups are not broken; maintenance/garbage collection is deferred.

Remote URLs are not downloaded or validated for availability. They may fail,
change, or require network access. `cachedLocalPath` reserves a managed cache
location; current rendering uses the original source URL and no cache population
is implemented. Caching can later change the media resolver without changing
social entities. Exports omit machine-local remote caches.

Seed imagery remains explicitly bundled. The placeholder silhouette is a UI
fallback, not a portable profile picture. A future portable export should package
or materialize bundled resources so independent entities need not depend on a
particular repository's filenames.

## Migration and full-world compatibility

Opening a v1 database first writes a consistent SQLite backup named
`migration-v1-<timestamp>-<id>.sqlite` beside it. The v2 table rebuild is transactional:
local IDs, data, relationships and settings are copied; external UUIDs are assigned;
profiles become full; image strings become media records; and each distinct
`(photo owner, album label)` becomes an album. Album creation time comes from its
first migrated photo. Historical groups have null creator IDs because v1 did not
record their creator. No ownership is guessed from membership.

Bundled paths remain bundled. Valid embedded uploads become managed files. HTTP(S)
legacy URLs are supported through the same adapter. Missing assets, malformed
uploads, invalid references or unsupported paths **stop the migration**, roll back
the original schema and data, and report the problem; nothing is silently dropped.
The backup also retains the original image representation. Newer database schema
versions are rejected instead of overwritten. Successful migrations run once.

`db/seed.json` remains a v1 compatibility fixture and is upgraded when a fresh
world is seeded. V1 inputs have no portable identity: each import assigns new
external IDs. Save a v2 export to retain those identities on subsequent transfers.
The legacy record adapter also accepts existing v1 callers at the store boundary;
the new editor and v2 state do not expose legacy image/album fields.

The existing complete-world format now has `schemaVersion: 2` with required
`media` and `albums` collections. It retains **local references for full-world
snapshot compatibility**, alongside stable external IDs. It is not the future
per-entity portable format. `/api/state` contains no image bytes. `/api/export`
includes local bytes only in a separate top-level `mediaFiles` map keyed by media
external ID. On import, local files are materialized with fresh managed filenames;
record identities and references remain intact. Remote sources and bundled
source distinctions survive the round trip.

Full-world replacement still requires every referenced row and at least one
profile, but referenced profiles may be stubs. SQLite FK validation and batch
duplicate checking are separate from external reference resolution, so future
partial imports can use `putExternal` rather than requiring a closed world.
JSON HTTP imports remain limited to 25 MB and collections to 20,000 rows. Successful
replacement saves the previous world (including local media payloads) to
`backup-<timestamp>-<id>.json`. Invalid replacement leaves the prior world intact.
Very large worlds will eventually need an archive/streaming export; that is deferred.

For filesystem backups, stop the server and copy the SQLite database **and its
media directory** together. Keep automatic migration backups until the upgraded
world has been checked. Restoring a v1 SQLite backup requires stopping Phasebook
and using the matching legacy code, or repairing its data and migrating again.
