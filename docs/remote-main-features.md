# Features added on remote main

The implementation branch starts at remote main c4986e3. The earlier local work
was preserved separately on codex/local-features-snapshot; it was used as a
reference for missing features.

Added friendship details and dated history; profile voice/style/tendencies;
scoped generation context and evaluation scenarios; streaming world packages;
album description/location, ordering and moves; multi-photo posts; spatial photo
tags and notifications; and profile picture history.

Remote's batch uploader and portrait crop editor remain the shared upload UI.
Batches and post attachments support up to 100 photos. Actual image-byte detection,
repeat file selections, photo interactions, and both friendship wall stories
are retained. The earlier photo batch API and JSON export remain available.
Streaming export uses /api/world-packages/export.

SQLite v11 inspects actual columns before adding structures. Temporary database
tests cover shared v7, local v8/v9/v10 and remote v8/v9 layouts, identity and
content preservation, backups, restart, and nullable legacy tag evidence. Old
tags retain unknown actor, time and location; the viewer lists them without
drawing fabricated location markers.

Legacy JSON and profile packages normalize missing new fields. World ZIP
packages carry binary images separately, while legacy JSON export can still
carry embedded uploads. Generation records and undoes both friendship stories.

Validation: 105 tests plus added UI render assertions, production build, lint,
whitespace checks, and a browser smoke check of an in-memory seeded demo.
The browser check covered album navigation, the shared batch-upload dialog,
photo viewer, and extended photo options. No active world database was used.
