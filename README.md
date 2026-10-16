# Phasebook

A local-only desktop social simulation inspired by **Facebook in March 2010**. A centered blue header, three-column News Feed, classic profile tabs, flat comments, photo albums, and bottom-bar chat.

All people, relationships and activity are synthetic. There is no authentication, password, permission model, remote social account, cloud database or required external service. Canonical social data is stored by the Node server on this computer; there is no real social networking. Optional configured generation adapters receive instructions and bounded inspected context. Seed imagery and fonts are bundled/local. Optional external images load directly from their source URLs.

## Run

Requires **Node.js 24 or newer** and npm. From this directory:

```sh
npm install
npm run build
npm start
```

Open **http://127.0.0.1:5173**. By default the server binds only to the loopback address. To make it reachable from other devices on the same LAN, start it with an explicit host binding:

```powershell
$env:HOST = '0.0.0.0'
npm start
```

The startup log will print the usable LAN URL, such as `http://192.168.1.25:5173`. This exposes the app and its local data APIs to anyone who can reach that port; there is no authentication or permission system, so use it only on a trusted network. After dependencies are installed, the application works without internet access; optional remote images require their source to be reachable. Stop it with Ctrl+C.

For development:

```sh
npm run dev
```

The same local URL serves Vite's development interface. Refresh after frontend edits; restart after backend edits. The production command serves only the built app and is the normal way to use the simulation.

## Using your world

- **Log In** switches to any synthetic profile, with no password. The active profile is saved in the database.
- **Edit My Profile**, **Edit Profile**, or **Friends → Create Profile** lets you edit anyone or add someone. You can upload an avatar, attach an external image URL, or select a bundled portrait. Manage this world lists full and stub profiles; edit a stub and select Full profile to complete it in place.
- Share posts on the feed, another person's Wall, or a group Wall. Like/unlike and add flat comments. The pencil beside a post edits it regardless of its author.
- **Friends** lets you add/remove relationships and send and confirm requests. **See Friendship** collects their Wall posts and photos with both people tagged, and lets you edit relationship context—how they met, closeness, shared history, and dated changes.
- **Photos** supports albums with descriptions and locations, batch uploads (up to 50 JPG/PNG/WebP images, 3 MB each), captions, covers, ordering, and optional album stories. Viewers include keyboard navigation, photo likes/comments, positioned tags, sharing, moving photos, and profile-picture history. Moving a photo retains its identity, discussion, and tags. See [Photos](docs/photos.md).
- **Events** supports creation, editing and Attending/Maybe/Not Attending replies.
- **Networks** provides school, workplace and regional people directories, including stub members. Profile affiliations link to searchable directories; World management controls create networks and edit memberships. See [historical research and design](docs/networks.md) for the intentional earlier-era regional-network extension.
- **Generation** provides world inspection, manual or model-assisted proposals, selectable previews, atomic commit and conflict-checked undo. See [generation architecture and setup](docs/generation.md) for OpenRouter configuration, provider adapters, temporal limits and provenance.
- **Agent generation** lets an agent in your coding task inspect, propose and apply changes directly through [command-line tools](docs/agent-generation.md), with no browser or additional model required.
- **Groups** supports creation, editing, membership and group posts.
- **Messages** and the bottom **Chat** bar save conversations locally. Switch profiles to write the other side of a conversation. Online indicators are simulated, and there are no automatic real-user replies.
- **Notifications** includes seeded activity and new likes, comments, Wall posts and friend requests; opening entries marks them read.
- Search names, profile details, posts and group names from the blue header.

## Database and JSON

The app creates **`data/phasebook.sqlite`** on first launch and seeds it from **`db/seed.json`**. SQLite tables, foreign keys and unique constraints keep profiles, friendships, relationship events, posts, comments, likes, photos, messages, notifications, events, RSVPs, groups and memberships consistent. UI state is ephemeral; profiles and content do not live in browser storage.

Open **Account** or **Manage this world**:

1. **Export World Package** downloads the complete world as a streaming `.phasebook` archive.
2. Choose a world package under **Import a world** and review the record counts.
3. **Replace World** validates the complete package and all referenced records in a transaction. Invalid imports leave existing data unchanged. A successful import first writes `data/backup-<timestamp>-<id>.phasebook` containing the previous world.

World packages contain `manifest.json`, a byte-free `world.json`, and binary image files below `media/`. World package JSON contains no base64 image bytes. ZIP64 and streaming I/O keep large media libraries out of server memory. Every domain record has a stable `externalId`, while local IDs remain the relational keys. Profiles may be full or stubs. Uploaded files live under `data/media/`, never in social records or frontend source. Legacy schemaVersion 1 and 2 JSON worlds remain importable for migration, and the existing `/api/export` JSON download remains available for compatibility.

Existing SQLite databases are automatically migrated on startup, with a `migration-v1-*.sqlite` backup written first. Local IDs and relationships are preserved. Embedded images are converted to files; invalid legacy media stops migration with an error instead of being dropped. Legacy JSON imports remain limited to 25 MB and all imports remain limited to 20,000 records per collection.

See [world packages](docs/world-packages.md) and [the data model and migration guide](docs/data-model.md) for the entity overview, ownership rules, media storage, backups and migration behavior.

Individual profiles can also be exported as merge-oriented `.phasebook`
archives. See [portable profile packages](docs/profile-packages.md) for their
precise scope, conflict handling, and media behavior.

To start an independent world in another database file, set `PHASEBOOK_DB` before starting. For example, in PowerShell:

```powershell
$env:PHASEBOOK_DB = 'data/another-world.sqlite'
npm start
```

`PORT` optionally changes the default 5173 port. `data/`, database journals, dependencies and build output are ignored by Git. Back up with a world package while the server is running; if copying SQLite directly, stop the server first and copy its media directory too.

## Structure and checks

- `app/` — React interface, shared state, period CSS, screens and dialogs.
- `server/schema.mjs` — relational schema, constraints and reference definitions.
- `server/store.mjs` — migrations, external identity resolution, stub hydration, social writes and import/export.
- `server/media.mjs` — source validation and managed file storage.
- `server/index.mjs` — configurable local/LAN HTTP server and local persistence endpoints.
- `db/seed.json` — editable, synthetic starter world.
- `public/assets/` — bundled fictional portraits and album images.
- `tests/` — SQLite persistence, relationship constraints, imports and HTTP tests.
- `docs/historical-references.md` — period research, sources and intentional approximations.

```sh
npm test
npm run build
npm run lint
```

This is a small single-computer sandbox. It intentionally has no multi-user sync, background notification delivery, real presence, account deletion flow, advertising delivery or hosted deployment. New activity uses the computer's actual timestamp; seeded memories retain their March 2010 dates. Top News uses local engagement counts and Most Recent sorts by date.

## Historical research

The chosen period combines the February 2010 home redesign with the classic Wall/Info/Photos/Boxes profile. The typography and 980px layout approximate period screenshots; the wordmark and simulation controls are deliberate additions. It is not an exact archived Facebook build and is not affiliated with Meta.

See [the historical reference notes](docs/historical-references.md), including contemporary Facebook announcements, the February 2010 annotated homepage, and preserved screenshots.

Network schema updates are additive: existing worlds gain empty network tables and keep their data. New demo worlds contain overlapping networks and two stub members; original demo city and hometown labels include state abbreviations. Profile packages include only the exported profile's affiliations and referenced network definitions.
