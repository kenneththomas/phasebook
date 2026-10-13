// User-requested photo operations for the local simulation. Moving a photo keeps its identity.
export function photoAction(store, action, value) {
  return store.transaction(() => {
    const date = new Date().toISOString();
    const required = (table, id) => {
      const row = store.get(table, id);
      if (!row) throw new Error(`${table} record not found.`);
      return row;
    };
    if (action === 'publish') {
      if (
        !Array.isArray(value.photos) ||
        !value.photos.length ||
        value.photos.length > 100
      )
        throw new Error('Choose between 1 and 100 photos.');
      const owner = required('profiles', value.ownerId);
      if (
        !value.albumId &&
        value.newAlbumId &&
        store.get('albums', value.newAlbumId)
      )
        throw new Error('This album has already been published.');
      let album = value.albumId
        ? required('albums', value.albumId)
        : store.put('albums', {
            id: value.newAlbumId,
            ownerId: owner.id,
            name: value.name,
            description: value.description || '',
            location: value.location || '',
            coverMediaId: null,
            createdAt: date,
          });
      if (album.ownerId !== owner.id)
        throw new Error('Choose an album belonging to the uploader.');
      const existing = store
        .getState()
        .photos.filter((p) => p.albumId === album.id);
      const position = Math.max(0, ...existing.map((p) => p.position));
      const photos = value.photos.map((photo, i) => {
        if (photo.id && store.get('photos', photo.id))
          throw new Error('This upload has already been published.');
        return store.put('photos', {
          id: photo.id,
          ownerId: owner.id,
          albumId: album.id,
          mediaId: photo.mediaId,
          caption: photo.caption || '',
          createdAt: date,
          position: position + i + 1,
        });
      });
      if (!album.coverMediaId)
        album = store.put('albums', {
          ...album,
          coverMediaId: photos[0].mediaId,
        });
      if (value.share) {
        const post = store.write('posts', {
          authorId: owner.id,
          wallId: owner.id,
          groupId: null,
          body: `added ${photos.length} photo${photos.length === 1 ? '' : 's'} to ${album.name}.`,
          photoId: photos[0].id,
          createdAt: date,
        });
        photos.forEach((photo, i) =>
          store.put('postPhotos', {
            postId: post.id,
            photoId: photo.id,
            position: i + 1,
          }),
        );
      }
    } else if (action === 'post') {
      if (
        !Array.isArray(value.photoIds) ||
        value.photoIds.length > 100 ||
        new Set(value.photoIds).size !== value.photoIds.length
      )
        throw new Error('Choose up to 100 different photos.');
      value.photoIds.forEach((id) => required('photos', id));
      const post = store.write('posts', {
        ...value.post,
        photoId: value.photoIds[0] || null,
      });
      value.photoIds.forEach((photoId, i) =>
        store.put('postPhotos', { postId: post.id, photoId, position: i + 1 }),
      );
    } else if (action === 'reorder') {
      required('albums', value.albumId);
      const photos = store
        .getState()
        .photos.filter((p) => p.albumId === value.albumId);
      if (
        !Array.isArray(value.ids) ||
        value.ids.length !== photos.length ||
        new Set(value.ids).size !== photos.length ||
        photos.some((p) => !value.ids.includes(p.id))
      )
        throw new Error('Album changed. Refresh before reordering.');
      value.ids.forEach((id, i) =>
        store.put('photos', { ...required('photos', id), position: i + 1 }),
      );
    } else if (action === 'move') {
      const photo = required('photos', value.photoId),
        album = required('albums', value.albumId);
      if (photo.ownerId !== album.ownerId)
        throw new Error('Choose an album belonging to the uploader.');
      const position =
        Math.max(
          0,
          ...store
            .getState()
            .photos.filter((p) => p.albumId === album.id)
            .map((p) => p.position),
        ) + 1;
      store.put('photos', { ...photo, albumId: album.id, position });
      const old = required('albums', photo.albumId);
      if (old.id !== album.id && old.coverMediaId === photo.mediaId)
        store.put('albums', { ...old, coverMediaId: null });
    } else if (action === 'cover') {
      const photo = required('photos', value.photoId),
        album = required('albums', photo.albumId);
      store.put('albums', { ...album, coverMediaId: photo.mediaId });
    } else if (action === 'profile-picture') {
      const photo = required('photos', value.photoId),
        profile = required('profiles', value.profileId);
      store.rememberProfilePicture(profile.id, profile.avatarMediaId);
      store.put('profiles', { ...profile, avatarMediaId: photo.mediaId });
      store.rememberProfilePicture(profile.id, photo.mediaId, photo.id);
    } else if (action === 'delete-photo' || action === 'delete-album') {
      // Destructive photo management requires active ownership AND explicit confirmation.
      const table = action === 'delete-photo' ? 'photos' : 'albums';
      const record = required(table, value.id);
      if (
        value.confirm !== true ||
        record.ownerId !== store.getState().settings.activeProfileId
      )
        throw new Error('Switch to the owner and confirm deletion first.');
      if (table === 'photos') {
        const album = required('albums', record.albumId);
        if (album.coverMediaId === record.mediaId)
          store.put('albums', { ...album, coverMediaId: null });
      }
      store.remove(table, record.id);
    } else throw new Error('Unknown photo action.');
    return store.getState();
  });
}
