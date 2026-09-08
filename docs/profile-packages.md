# Profile packages

A `.phasebook` file is a ZIP-compatible, versioned partial export. It contains
`manifest.json`, `data.json`, and zero or more files below `media/`. JSON never
contains image bytes or source-machine filesystem paths. Package records use
stable `externalId` values; SQLite IDs are resolved only at import time.

The scope rule is: **export records attributable to this profile; preserve
references to the rest of the social graph without recursively exporting it.**

## Version 1 profile scope

- The selected profile, its fields, and avatar.
- Posts, comments, likes, and accepted or pending friendship edges initiated by
  or involving the profile. A post needed as the parent of an attributable
  comment or like is included only as a structural dependency.
- Albums and photos owned by the profile. A photo/album needed by an included
  post is included only as a structural dependency.
- The profile's group memberships and event attendance, plus the referenced
  group/event records. Groups and events created by the profile are included.
- Messages sent by the profile. Received messages and the rest of each private
  conversation are excluded.
- Notifications are excluded because they are derived, recipient-owned local
  state. The current schema has no photo-tag entity, so photo tags are excluded.

Other profiles encountered as authors, wall owners, friends, recipients,
creators, owners, or participants are represented only by external ID and a
display-name hint. Their profiles and activity are not traversed. Thus a post
written on another person's wall preserves that wall owner as a reference;
friendships preserve the other endpoint; and comments/likes preserve the one
parent post needed for context.

## Media

Managed uploads are copied into `media/`. Bundled seed assets are also copied so
the destination does not depend on the same repository assets. Remote images
remain URL references and are not downloaded. Import validates archive paths,
checksums, declarations, types, sizes, identities, and references before making
changes, then writes packaged images under new managed filenames.

## Merge behavior

Import never clears the current world and runs in one database transaction. A
missing referenced person becomes a stub; an existing stub or full profile is
reused. A matching root stub is hydrated in place. A matching full root requires
an explicit choice: merge/update, import as new, or cancel. Import-as-new assigns
new stable IDs to the root and packaged records and rewrites all internal
references consistently.

For other records, matching external IDs identify the same portable entity and
are updated. Relationship tables additionally reuse an equivalent local edge if
it already exists under a different external ID, avoiding uniqueness conflicts.
Any validation or write failure rolls back database changes and newly written
media files.

Full-world JSON export/import remains a distinct replacement-and-backup feature
under **Manage this world**.
