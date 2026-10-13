import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../server/store.mjs';
import {
  importWorldPackage,
  previewWorldPackage,
  readWorldPackage,
  writeWorldPackage,
} from '../server/world-package.mjs';

const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHioAAAAASUVORK5CYII=';

test('world packages keep image bytes outside JSON and restore managed media', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'phasebook-world-package-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = createStore(join(dir, 'source.sqlite')),
    local = source.createMedia({ sourceType: 'local', dataUrl: png });
  source.put('profiles', {
    ...source.get('profiles', 'p1'),
    avatarMediaId: local.id,
  });
  const packagePath = join(dir, 'export.phasebook');
  await writeWorldPackage(source, packagePath);
  source.close();

  const parsed = await readWorldPackage(packagePath);
  try {
    assert.equal(parsed.manifest.type, 'world');
    assert.equal(parsed.manifest.packageVersion, 1);
    assert.equal(Object.hasOwn(parsed.world, 'mediaFiles'), false);
    assert.equal(JSON.stringify(parsed.world).includes('base64'), false);
    const packaged = parsed.world.media.find(
      (row) => row.externalId === local.externalId,
    );
    assert.match(packaged.sourceLocation, /^media\//);
    assert.equal(
      readFileSync(parsed.mediaFiles.get(packaged.sourceLocation)).toString(
        'base64',
      ),
      png.split(',')[1],
    );
  } finally {
    await parsed.dispose();
  }

  const preview = await previewWorldPackage(packagePath);
  assert.ok(preview.counts.profiles > 0);
  assert.ok(preview.mediaCount > 0);

  const targetDir = join(dir, 'target'),
    target = createStore(join(targetDir, 'phasebook.sqlite'));
  await importWorldPackage(target, packagePath, targetDir);
  const imported = target.resolveExternal('media', local.externalId);
  assert.equal(imported.sourceType, 'local');
  assert.equal(
    readFileSync(target.mediaFile(imported.id).path).toString('base64'),
    png.split(',')[1],
  );
  const backups = (await readdir(targetDir)).filter(
    (name) => name.startsWith('backup-') && name.endsWith('.phasebook'),
  );
  assert.equal(backups.length, 1);
  const backup = await readWorldPackage(join(targetDir, backups[0]));
  try {
    assert.equal(Object.hasOwn(backup.world, 'mediaFiles'), false);
  } finally {
    await backup.dispose();
  }
  target.close();
});
