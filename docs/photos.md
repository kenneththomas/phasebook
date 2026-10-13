# Photos

The existing layout is retained: album grids, small text tabs, and a classic photo dialog.

## Upload and organize

Create empty albums or upload up to 100 photos at a time. Each local image must be JPG, PNG, or WebP and no larger than 3 MB. External image URLs remain supported. Upload previews have individual captions; failed files are reported without discarding successful files. Publish saves the album/photos together atomically and can create one Wall story with all the selected photos. The composer also accepts multiple existing photos.

Albums have a name, description, location, cover, and ordered photos. Add Photos remembers the current album and uploader. Reorder Photos exposes Earlier/Later controls. Photo Options includes Make Album Cover and Move Photo. Moves are limited to albums with the same uploader and preserve photo IDs, external identities, likes, comments, tags, and post references.

## View and participate

Open any photo for Previous/Next navigation, left/right arrow keys, uploader, date, caption, and an album link. Like and comment directly on the photo. These discussions are the same wherever the photo is opened. Separate posts sharing a photo retain their own discussions; existing post comments and likes are not moved or discarded.

Tag Photo lets you click a position and select a profile. Keyboard users can specify horizontal/vertical percentages. Hover or focus a tag to reveal the name. Tags link to profiles and create notifications; photo likes/comments notify the uploader. Photos of Me (or Photos of a profile) uses these tags. See Friendship shows photos where both people are tagged.

Make My Profile Picture reuses the selected photo, retaining its album and activity. Profile Pictures provides a history view. Changing a profile picture also retains the previous image; if it was only an avatar media record, it gains a photo in a Profile Photos album. The new history entry records when the image was retained, not an invented original upload date. Changing an avatar through Edit Profile also records this history.

Delete Photo and Delete Album require switching to the owning profile and confirming the destructive action. Deleting an album deletes its remaining photos and their photo activity. Move photos out first to retain them. Separate sharing posts remain, with deleted photo references removed. Media still used as an avatar remains available.

## Storage and compatibility

SQLite version 11 adds album description/location, photo position, a nullable photo notification target, and `photoLikes`, `photoComments`, `photoTags`, `postPhotos`, and `profilePictures`. Startup backs up older databases before inspecting their actual tables/columns and adding the missing fields. Earlier local and remote schemas are supported. Existing tags with unknown actor, date, or position retain null values and appear in the tagged-person list. Existing photo IDs, post discussions, and media references are preserved. No world activity is generated during migration.

World packages retain every new collection. Older exports without photo extensions import with empty collections and defaults. Profile packages include the root's photo activity and the activity on its owned photos, with structural photo/album/media dependencies and referenced profile stubs. Importing a profile as new remaps photo identities and their references consistently.
