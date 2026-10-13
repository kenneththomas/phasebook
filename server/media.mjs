import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const extensions = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
function validImageHeader(bytes, mimeType) {
  return mimeType === 'image/png'
    ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    : mimeType === 'image/jpeg'
      ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : mimeType === 'image/webp' &&
        bytes.toString('ascii', 0, 4) === 'RIFF' &&
        bytes.toString('ascii', 8, 12) === 'WEBP';
}
export function decodeImage(dataUrl) {
  const match =
    typeof dataUrl === 'string' &&
    dataUrl.match(
      /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/,
    );
  if (!match || match[2].length > 4_000_000)
    throw new Error('Choose a PNG, JPEG, or WebP image up to 3 MB.');
  const bytes = Buffer.from(match[2], 'base64');
  if (
    bytes.toString('base64') !== match[2] ||
    !bytes.length ||
    bytes.length > 3_000_000
  )
    throw new Error('Invalid image encoding.');
  const detected = bytes
    .subarray(0, 8)
    .equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    ? 'image/png'
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      ? 'image/jpeg'
      : bytes.toString('ascii', 0, 4) === 'RIFF' &&
          bytes.toString('ascii', 8, 12) === 'WEBP'
        ? 'image/webp'
        : null;
  if (!detected)
    throw new Error('Image bytes do not match a supported image type.');
  return { bytes, mimeType: detected, extension: extensions[detected] };
}
export function validateImageFile(path, mimeType) {
  if (!Object.hasOwn(extensions, mimeType))
    throw new Error('Package contains an unsupported image type.');
  const size = statSync(path).size;
  if (!size || size > 3_000_000)
    throw new Error('Packaged images must be no larger than 3 MB each.');
  const bytes = Buffer.alloc(12),
    descriptor = openSync(path, 'r');
  try {
    readSync(descriptor, bytes, 0, bytes.length, 0);
  } finally {
    closeSync(descriptor);
  }
  if (!validImageHeader(bytes, mimeType))
    throw new Error('Image bytes do not match the image type.');
  return { size, extension: extensions[mimeType] };
}
export function remoteURL(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Enter a valid HTTP or HTTPS image URL.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    value.length > 20000
  )
    throw new Error(
      'Enter a valid HTTP or HTTPS image URL without credentials.',
    );
  return url.href;
}
export function localPath(directory, key) {
  if (typeof key !== 'string' || !/^[a-f0-9-]{36}\.(png|jpg|webp)$/.test(key))
    throw new Error('Invalid managed media path.');
  return resolve(directory, key);
}
export function validateMedia(row, directory) {
  if (row.sourceType === 'remote') remoteURL(row.sourceLocation);
  else if (row.sourceType === 'bundled') {
    if (
      !/^\/assets\/[a-zA-Z0-9._-]+\.(jpg|jpeg|png|webp)$/.test(
        row.sourceLocation,
      ) ||
      !existsSync(new URL('../public' + row.sourceLocation, import.meta.url))
    )
      throw new Error('Bundled image does not exist: ' + row.sourceLocation);
  } else if (row.sourceType === 'local') {
    if (!existsSync(localPath(directory, row.sourceLocation)))
      throw new Error(
        'Local media file is missing; include mediaFiles in the export.',
      );
    if (extensions[row.mimeType] !== row.sourceLocation.split('.').pop())
      throw new Error('Invalid local media MIME type.');
  } else throw new Error('Unknown media source type.');
  if (row.cachedLocalPath !== null) {
    if (
      row.sourceType !== 'remote' ||
      !existsSync(localPath(directory, row.cachedLocalPath))
    )
      throw new Error('Invalid cached media path.');
  }
  try {
    const metadata = JSON.parse(row.metadata);
    if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object')
      throw new Error();
  } catch {
    throw new Error('Media metadata must be a JSON object.');
  }
}
export function storeUpload(directory, dataUrl, trackFile) {
  const { bytes, mimeType, extension } = decodeImage(dataUrl);
  mkdirSync(directory, { recursive: true });
  const sourceLocation = `${randomUUID()}.${extension}`;
  const path = localPath(directory, sourceLocation);
  writeFileSync(path, bytes, { flag: 'wx' });
  trackFile(path);
  return { sourceLocation, mimeType };
}
export function storeUploadFile(directory, sourcePath, mimeType, trackFile) {
  const { extension } = validateImageFile(sourcePath, mimeType);
  mkdirSync(directory, { recursive: true });
  const sourceLocation = `${randomUUID()}.${extension}`;
  const path = localPath(directory, sourceLocation);
  copyFileSync(sourcePath, path, 1);
  trackFile(path);
  return { sourceLocation, mimeType };
}

export function filePayload(directory, row) {
  return (
    'data:' +
    row.mimeType +
    ';base64,' +
    readFileSync(localPath(directory, row.sourceLocation)).toString('base64')
  );
}
