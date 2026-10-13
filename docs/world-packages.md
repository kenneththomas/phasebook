# World packages

A world `.phasebook` file is a ZIP-compatible, versioned replacement snapshot.
It contains `manifest.json`, `world.json`, and zero or more binary files below
`media/`. Exported JSON never contains image bytes, base64 data URLs, managed
filesystem names, or cached paths.

The manifest uses `format: "phasebook-package"`, `packageVersion: 1`, and
`type: "world"`. It records the enclosed world schema version, export time,
collection counts and packaged-media count. The world retains its complete local
record graph and stable external identities. Remote HTTP(S) images remain URL
references. Managed uploads and bundled assets are copied into `media/`; imported
copies receive fresh managed filenames.

Export uses a streaming ZIP writer with automatic ZIP64 support. Import streams
the request to a temporary archive, reads entries lazily, and stages media on
disk. It limits entry count, expanded size, JSON size, per-image size, paths,
MIME signatures, identities, collection counts and references before replacing
the database. Unexpected, missing and duplicate archive entries are rejected.

Import is replacement-oriented. After validation, Phasebook first writes a full
`backup-<timestamp>-<id>.phasebook` beside the SQLite database. Database changes
and newly managed media files are then applied transactionally. Profile packages
remain a separate merge-oriented format.

SchemaVersion 1 and 2 JSON worlds remain accepted through the legacy importer so
old backups can be migrated. The existing `/api/export` JSON export and direct JSON import backups remain
available for compatibility. Streaming ZIP export uses `/api/world-packages/export`
and avoids embedding image bytes or loading all images into memory.
