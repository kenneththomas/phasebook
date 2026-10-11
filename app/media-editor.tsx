import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useApp } from './context';
import { mediaSource, request, type Row } from './shared';

export function PhotoBatchEditor({
  items,
  onChange,
  onBusy,
}: {
  items: Row[];
  onChange: Dispatch<SetStateAction<Row[]>>;
  onBusy: (busy: boolean) => void;
}) {
  const { fail } = useApp();
  const [progress, setProgress] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [url, setUrl] = useState('');
  const upload = async (files: File[]) => {
    if (items.length + files.length > 100) {
      fail('Choose up to 100 photos per batch.');
      return;
    }
    onBusy(true);
    setErrors([]);
    const failures: string[] = [];
    try {
      for (const [index, file] of files.entries()) {
        setProgress(`Uploading ${index + 1} of ${files.length}…`);
        try {
          if (
            !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
            file.size > 3_000_000
          )
            throw new Error('Choose a JPG, PNG, or WebP up to 3 MB.');
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () =>
              typeof reader.result === 'string'
                ? resolve(reader.result)
                : reject(new Error('Could not read file.'));
            reader.onerror = () => reject(new Error('Could not read file.'));
            reader.readAsDataURL(file);
          });
          const media = await request<Row>('media', 'POST', {
            sourceType: 'local',
            dataUrl,
            originalFilename: file.name,
          });
          onChange((previous) => [...previous, { ...media, caption: '' }]);
        } catch (error) {
          failures.push(`${file.name}: ${(error as Error).message}`);
        }
      }
    } finally {
      setErrors(failures);
      setProgress('');
      onBusy(false);
    }
  };
  const addURL = async () => {
    if (items.length >= 100) {
      fail('Choose up to 100 photos per batch.');
      return;
    }
    onBusy(true);
    setProgress('Adding image…');
    try {
      const media = await request<Row>('media', 'POST', {
        sourceType: 'remote',
        sourceLocation: url.trim(),
      });
      onChange((previous) => [...previous, { ...media, caption: '' }]);
      setUrl('');
    } catch (error) {
      fail((error as Error).message);
    } finally {
      onBusy(false);
      setProgress('');
    }
  };
  return (
    <fieldset className="media-editor" disabled={!!progress}>
      <legend>Photos</legend>
      <label className="form-field">
        Add photos (JPG, PNG, WebP; up to 3 MB each)
        <input
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length) void upload(files);
          }}
        />
      </label>
      <p className="form-help">
        Select multiple files, or add more before saving. All photos go into the
        album you choose below.
      </p>
      <label className="form-field">
        External image URL
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/image.jpg"
        />
      </label>
      <button type="button" disabled={!url.trim()} onClick={addURL}>
        Add image URL
      </button>
      <output>{progress || `${items.length} photos selected`}</output>
      {errors.length > 0 && (
        <ul role="alert">
          {errors.map((error, i) => (
            <li key={i}>{error}</li>
          ))}
        </ul>
      )}
      <div className="photo-upload-grid">
        {items.map((media, index) => (
          <div className="photo-upload-card" key={media.id}>
            <img
              src={mediaSource(media)}
              alt={`Selected upload ${index + 1}`}
            />
            <label className="form-field">
              Caption for {media.originalFilename || `upload ${index + 1}`}
              <input
                value={media.caption}
                maxLength={20000}
                onChange={(e) =>
                  onChange((previous) =>
                    previous.map((item, i) =>
                      i === index ? { ...item, caption: e.target.value } : item,
                    ),
                  )
                }
              />
            </label>
            <button
              type="button"
              onClick={() =>
                onChange((previous) => previous.filter((_, i) => i !== index))
              }
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

export function MediaEditor({
  id,
  portraits = false,
  onChange,
  onBusy,
}: {
  id: string | null;
  portraits?: boolean;
  onChange: (id: string | null) => void;
  onBusy: (busy: boolean) => void;
}) {
  const { world, fail } = useApp();
  const [created, setCreated] = useState<Row | null>(null);
  const [url, setUrl] = useState('');
  const [working, setWorking] = useState(false);
  const [crop, setCrop] = useState<{
    image: HTMLImageElement;
    filename: string;
  } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 50, y: 50 });
  useEffect(() => {
    onBusy(working || crop !== null);
    return () => onBusy(false);
  }, [working, crop, onBusy]);
  const cropSize = crop
    ? Math.min(crop.image.naturalWidth, crop.image.naturalHeight) / zoom
    : 0;
  const cancelCrop = () => {
    setCrop(null);
  };
  const saveCrop = async () => {
    if (!crop) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = Math.max(
        1,
        Math.min(768, Math.round(cropSize)),
      );
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image cropping is unavailable.');
      context.drawImage(
        crop.image,
        ((crop.image.naturalWidth - cropSize) * position.x) / 100,
        ((crop.image.naturalHeight - cropSize) * position.y) / 100,
        cropSize,
        cropSize,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      await attach({
        sourceType: 'local',
        dataUrl: canvas.toDataURL('image/png'),
        originalFilename: crop.filename,
      });
    } catch (error) {
      fail((error as Error).message);
    }
  };
  const media =
    created?.id === id ? created : world.media.find((m) => m.id === id);
  const attach = async (input: unknown) => {
    setWorking(true);

    try {
      const result = await request<Row>('media', 'POST', input);
      setCreated(result);
      onChange(result.id);
      setUrl('');
      setCrop(null);
    } catch (error) {
      fail((error as Error).message);
    } finally {
      setWorking(false);
    }
  };
  const upload = async (file?: File) => {
    if (!file) return;
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size > 3_000_000
    ) {
      fail('Choose a JPG, PNG, or WebP image up to 3 MB.');
      return;
    }
    setWorking(true);

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          typeof reader.result === 'string'
            ? resolve(reader.result)
            : reject(new Error('The image could not be read.'));
        reader.onerror = () =>
          reject(new Error('The image could not be read.'));
        reader.readAsDataURL(file);
      });
      if (portraits) {
        const image = new Image();
        image.src = dataUrl;
        await image.decode();
        setZoom(1);
        setPosition({ x: 50, y: 50 });
        setCrop({ image, filename: file.name });
        return;
      }
      await attach({
        sourceType: 'local',
        dataUrl,
        originalFilename: file.name,
      });
    } catch (error) {
      fail((error as Error).message);
    } finally {
      setWorking(false);
    }
  };
  return (
    <fieldset className="media-editor" disabled={working}>
      <legend>{portraits ? 'Profile picture' : 'Image'}</legend>
      {crop && (
        <div className="profile-crop">
          <p>
            Crop your profile picture. Adjust the zoom and position, then use
            the crop.
          </p>
          <div className="profile-crop-preview">
            <img
              src={crop.image.src}
              alt="Selected crop preview"
              style={{
                width: `${(crop.image.naturalWidth / cropSize) * 100}%`,
                height: `${(crop.image.naturalHeight / cropSize) * 100}%`,
                maxWidth: 'none',
                left: `${-(crop.image.naturalWidth / cropSize - 1) * position.x}%`,
                top: `${-(crop.image.naturalHeight / cropSize - 1) * position.y}%`,
              }}
            />
          </div>
          <label className="form-field">
            Zoom
            <input
              type="range"
              min="1"
              max="4"
              step="0.01"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
          </label>
          <label className="form-field">
            Horizontal position
            <input
              type="range"
              min="0"
              max="100"
              value={position.x}
              onChange={(e) =>
                setPosition({ ...position, x: Number(e.target.value) })
              }
            />
          </label>
          <label className="form-field">
            Vertical position
            <input
              type="range"
              min="0"
              max="100"
              value={position.y}
              onChange={(e) =>
                setPosition({ ...position, y: Number(e.target.value) })
              }
            />
          </label>
          <div className="button-row">
            <button type="button" onClick={saveCrop}>
              Use crop
            </button>
            <button type="button" onClick={cancelCrop}>
              Cancel crop
            </button>
          </div>
        </div>
      )}
      {media && (
        <>
          <img
            className="upload-preview"
            src={mediaSource(media)}
            alt="Selected preview"
          />
          <p className="form-help">
            {media.sourceType === 'remote'
              ? 'External image'
              : media.sourceType === 'local'
                ? 'Saved on this computer'
                : 'Bundled image'}
          </p>
        </>
      )}
      {portraits && (
        <div className="avatar-options">
          {Array.from({ length: 6 }, (_, i) => (
            <button
              type="button"
              key={i}
              aria-label={'Choose portrait ' + (i + 1)}
              onClick={() =>
                attach({
                  sourceType: 'bundled',
                  sourceLocation: `/assets/avatar-${i + 1}.jpg`,
                })
              }
            >
              <img src={`/assets/avatar-${i + 1}.jpg`} alt="" />
            </button>
          ))}
        </div>
      )}
      <label className="form-field">
        Upload image (JPG, PNG, WebP; up to 3 MB)
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            void upload(file);
          }}
        />
      </label>
      <label className="form-field">
        External image URL
        <input
          type="url"
          value={url}
          placeholder="https://example.com/image.jpg"
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      <div className="button-row">
        <button
          type="button"
          className="gray-button"
          disabled={!url.trim()}
          onClick={() =>
            attach({ sourceType: 'remote', sourceLocation: url.trim() })
          }
        >
          Use image URL
        </button>
        {id && (
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setCreated(null);
            }}
          >
            Clear image
          </button>
        )}
      </div>
      {working && <output>Saving image…</output>}
    </fieldset>
  );
}
