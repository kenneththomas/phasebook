# Phasebook

A local-only desktop social simulation inspired by **Facebook in March 2010**. A centered blue header, three-column News Feed, classic profile tabs, flat comments, photo albums, and bottom-bar chat.

All people, relationships and activity are synthetic. There is no authentication, password, permission model, remote account, cloud database or external API. The browser only talks to the Node server on this computer; there is no real social networking. Seed imagery and fonts are bundled/local.

## Run

Requires **Node.js 24 or newer** and npm. From this directory:

```sh
npm install
npm run build
npm start
```

Open **http://127.0.0.1:5173**. The server binds only to the loopback address. After dependencies are installed, the application works without internet access. Stop it with Ctrl+C.

For development:

```sh
npm run dev
```

The same local URL serves Vite's development interface. Refresh after frontend edits; restart after backend edits. The production command serves only the built app and is the normal way to use the simulation.

## Using your world

- **Log In** switches to any synthetic profile, with no password. The active profile is saved in the database.
- **Edit My Profile**, **Edit Profile**, or **Friends → Create Profile** lets you edit anyone or add someone. You can upload an avatar or select a bundled portrait.
- Share posts on the feed, another person's Wall, or a group Wall. Like/unlike and add flat comments. The pencil beside a post edits it regardless of its author.
- **Friends** lets you add/remove relationships and send and confirm requests.
- **Photos** contains albums; upload a local JPG, PNG or WebP (up to 3 MB), edit its caption, or attach it to a post.
- **Events** supports creation, editing and Attending/Maybe/Not Attending replies.
- **Groups** supports creation, editing, membership and group posts.
- **Messages** and the bottom **Chat** bar save conversations locally. Switch profiles to write the other side of a conversation. Online indicators are simulated, and there are no automatic real-user replies.
- **Notifications** includes seeded activity and new likes, comments, Wall posts and friend requests; opening entries marks them read.
- Search names, profile details, posts and group names from the blue header.

## Database and JSON

The app creates **`data/phasebook.sqlite`** on first launch and seeds it from **`db/seed.json`**. SQLite tables, foreign keys and unique constraints keep profiles, friendships, posts, comments, likes, photos, messages, notifications, events, RSVPs, groups and memberships consistent. UI state is ephemeral; profiles and content do not live in browser storage.

Open **Account** or **Manage this world**:

1. **Export JSON** downloads the complete world, including relationships, the active profile and embedded uploaded images.
2. Choose a JSON file under **Import a world** and review the record counts.
3. **Replace World** validates the complete export and all referenced records in a transaction. Invalid imports leave existing data unchanged. A successful import first writes `data/backup-<timestamp>-<id>.json` containing the previous world.

JSON format is versioned with `schemaVersion: 1`. Every collection is required; IDs are strings and relationships refer to those IDs. See `db/seed.json` for a full example and `server/store.mjs` for exact field definitions. Imports are limited to 25 MB and 20,000 records per collection. Image values must be bundled `/assets/...` paths or embedded PNG/JPEG/WebP data URLs; remote images are intentionally rejected. Bundled-image references travel with the repository, while uploaded images travel inside JSON.

To start an independent world in another database file, set `PHASEBOOK_DB` before starting. For example, in PowerShell:

```powershell
$env:PHASEBOOK_DB = 'data/another-world.sqlite'
npm start
```

`PORT` optionally changes the default 5173 port. `data/`, database journals, dependencies and build output are ignored by Git. Back up with JSON while the server is running; if copying SQLite directly, stop the server first so its journal has been flushed.

## Structure and checks

- `app/` — React interface, shared state, period CSS, screens and dialogs.
- `server/store.mjs` — SQLite schema, record validation and transactional import/export.
- `server/index.mjs` — loopback HTTP server and local persistence endpoints.
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
