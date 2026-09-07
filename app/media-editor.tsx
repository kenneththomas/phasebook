import { useState } from 'react';
import { useApp } from './context';
import { mediaSource, request, type Row } from './shared';

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
  const media =
    created?.id === id ? created : world.media.find((m) => m.id === id);
  const attach = async (input: unknown) => {
    setWorking(true);
    onBusy(true);
    try {
      const result = await request<Row>('media', 'POST', input);
      setCreated(result);
      onChange(result.id);
      setUrl('');
    } catch (error) {
      fail((error as Error).message);
    } finally {
      setWorking(false);
      onBusy(false);
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
    onBusy(true);
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
      await attach({
        sourceType: 'local',
        dataUrl,
        originalFilename: file.name,
      });
    } catch (error) {
      fail((error as Error).message);
    } finally {
      setWorking(false);
      onBusy(false);
    }
  };
  return (
    <fieldset className="media-editor" disabled={working}>
      <legend>{portraits ? 'Profile picture' : 'Image'}</legend>
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
          onChange={(e) => upload(e.target.files?.[0])}
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
