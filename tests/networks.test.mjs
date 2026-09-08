import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../server/store.mjs';
import {
  exportProfilePackage,
  importProfilePackage,
  validateProfilePackage,
  createArchive,
  unzip,
} from '../server/profile-package.mjs';
import { sharedNetworks } from '../lib/networks.mjs';
const memory = (t) => {
  const s = createStore(':memory:');
  t.after(() => s.close());
  return s;
};

test('all network types, extensible types, multiple memberships and metadata validation', (t) => {
  const s = memory(t);
  for (const type of [
    'college',
    'high_school',
    'workplace',
    'regional',
    'professional',
  ]) {
    const n = s.put('networks', { name: `Test ${type}`, type });
    const m = s.put('networkMemberships', { profileId: 'p1', networkId: n.id });
    assert.equal(s.get('networkMemberships', m.id).networkId, n.id);
    assert.throws(
      () => s.put('networkMemberships', { profileId: 'p1', networkId: n.id }),
      /UNIQUE/,
    );
    s.remove('networkMemberships', m.id);
    assert.equal(s.get('networkMemberships', m.id), undefined);
  }
  assert.ok(
    s.getState().networkMemberships.filter((m) => m.profileId === 'p1').length >
      1,
  );
  assert.throws(
    () =>
      s.put('networkMemberships', {
        profileId: 'p2',
        networkId: 'n-nu',
        metadata: '{"position":"DJ"}',
      }),
    /network type/,
  );
  assert.throws(
    () =>
      s.put('networkMemberships', {
        profileId: 'p2',
        networkId: 'n-nu',
        metadata: '{"classYear":"10"}',
      }),
    /four-digit/,
  );
  assert.throws(
    () =>
      s.put('networkMemberships', {
        profileId: 'p2',
        networkId: 'n-radio',
        metadata: '{"startYear":"2010","endYear":"2009"}',
      }),
    /End year/,
  );
  assert.throws(
    () => s.put('networks', { ...s.get('networks', 'n-nu'), type: 'regional' }),
    /Remove memberships/,
  );
});

test('directories include full and stub members, typed filters and active-user context', (t) => {
  const s = memory(t);
  let rows = s.networkDirectory('n-nu');
  assert.deepEqual(
    new Set(rows.map((r) => r.profile.state)),
    new Set(['full', 'stub']),
  );
  assert.equal(
    s.networkDirectory('n-nu', {
      name: 'CASEY',
      classYear: '2013',
      major: 'comm',
      residence: 'Stetson',
    }).length,
    1,
  );
  assert.equal(s.networkDirectory('n-nu', { classYear: '2011' }).length, 0);
  assert.equal(
    s.networkDirectory('n-radio', {
      position: 'photographer',
      startYear: '2009',
    })[0].profile.id,
    'p8',
  );
  assert.equal(
    rows.find((r) => r.profile.id === 'ns1').context,
    'Same network',
  );
  s.put('friendships', {
    profileId: 'p1',
    friendId: 'ns2',
    status: 'accepted',
  });
  s.put('friendships', {
    profileId: 'ns1',
    friendId: 'ns2',
    status: 'accepted',
  });
  rows = s.networkDirectory('n-nu');
  assert.deepEqual(rows.find((r) => r.profile.id === 'ns1').mutualIds, ['ns2']);
  assert.equal(
    rows.find((r) => r.profile.id === 'ns1').context,
    'Friend of friend',
  );
  s.switchProfile('ns2');
  assert.equal(s.networkDirectory('n-nu', { context: 'Friend' }).length, 2);
  s.switchProfile('p3');
  assert.equal(
    s.networkDirectory('n-nu').find((r) => r.profile.id === 'ns1').context,
    'Network member',
  );
  assert.ok(sharedNetworks(s.getState(), 'p1', 'ns1').includes('n-nu'));
  assert.ok(s.search('Northeastern').profiles.some((p) => p.id === 'ns1'));
  assert.equal(s.search('Northeastern').networks[0].id, 'n-nu');
});

test('deleting networks cascades affiliations without deleting profiles', (t) => {
  const s = memory(t),
    count = s.getState().profiles.length;
  s.remove('networks', 'n-nu');
  assert.equal(s.getState().profiles.length, count);
  assert.equal(
    s.getState().networkMemberships.some((m) => m.networkId === 'n-nu'),
    false,
  );
});

test('profile packages include only root affiliations without expanding network graph', (t) => {
  const source = memory(t),
    pkg = exportProfilePackage(source, 'ns1').buffer;
  const { data } = validateProfilePackage(pkg);
  assert.equal(data.rootProfile.state, 'stub');
  assert.equal(data.entities.networkMemberships.length, 3);
  assert.equal(data.entities.networks.length, 3);
  assert.equal(data.referencedProfiles.length, 0);
  assert.ok(
    data.entities.networkMemberships.every(
      (m) => m.profileId === data.rootProfile.externalId,
    ),
  );
  const target = memory(t);
  // Same stable network ID with locally edited metadata must be retained.
  target.put('networks', {
    ...target.get('networks', 'n-nu'),
    name: 'Local Northeastern',
  });
  const result = importProfilePackage(target, pkg, 'merge');
  assert.equal(target.get('profiles', result.rootProfileId).state, 'stub');
  assert.equal(target.get('networks', 'n-nu').name, 'Local Northeastern');
  assert.equal(target.getState().networks.length, 12);
  assert.equal(
    target
      .getState()
      .networkMemberships.filter((m) => m.profileId === result.rootProfileId)
      .length,
    3,
  );
});

test('missing networks are created, same names stay distinct, hydration preserves memberships', (t) => {
  const source = memory(t),
    target = createStore(':memory:', { seed: false });
  t.after(() => target.close());
  const root = source.get('profiles', 'ns1');
  target.put('networks', { name: 'Northeastern University', type: 'college' });
  let imported = importProfilePackage(
    target,
    exportProfilePackage(source, root.id).buffer,
    'merge',
  );
  assert.equal(target.getState().networks.length, 4);
  assert.equal(target.get('profiles', imported.rootProfileId).state, 'stub');
  source.hydrateProfile(root.externalId, { name: 'Casey Full' });
  imported = importProfilePackage(
    target,
    exportProfilePackage(source, root.id).buffer,
    'merge',
  );
  assert.equal(target.get('profiles', imported.rootProfileId).state, 'full');
  assert.equal(target.getState().networkMemberships.length, 3);
  const duplicate = importProfilePackage(
    target,
    exportProfilePackage(source, root.id).buffer,
    'new',
  );
  assert.notEqual(duplicate.rootProfileId, imported.rootProfileId);
  assert.equal(target.getState().networks.length, 4);
  assert.equal(target.getState().networkMemberships.length, 6);
});

test('natural membership reconciliation updates metadata without duplication', (t) => {
  const source = memory(t),
    target = memory(t);
  const root = source.get('profiles', 'ns1'),
    old = target.get('networkMemberships', 'nm-ns1-nu');
  target.remove('networkMemberships', old.id);
  target.put('networkMemberships', {
    networkId: old.networkId,
    profileId: old.profileId,
    metadata: '{"classYear":"2010"}',
  });
  importProfilePackage(
    target,
    exportProfilePackage(source, root.id).buffer,
    'merge',
  );
  assert.equal(
    target.networkDirectory('n-nu', { name: 'Casey' })[0].metadata.classYear,
    '2013',
  );
  assert.equal(
    target.getState().networkMemberships.filter((m) => m.profileId === root.id)
      .length,
    3,
  );
});

test('older worlds and profile packages without network collections remain importable', (t) => {
  const s = memory(t),
    world = s.exportState();
  delete world.networks;
  delete world.networkMemberships;
  s.importState(world, false);
  assert.equal(s.getState().networks.length, 0);
  const files = unzip(exportProfilePackage(s, 'p1').buffer),
    data = JSON.parse(files.get('data.json'));
  delete data.entities.networks;
  delete data.entities.networkMemberships;
  files.set('data.json', Buffer.from(JSON.stringify(data)));
  assert.equal(
    validateProfilePackage(createArchive([...files])).data.entities.networks
      .length,
    0,
  );
});

test('v3 database upgrades additively with backup and preserves edited city data', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'phasebook-networks-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'world.sqlite');
  let s = createStore(path);
  s.put('profiles', { ...s.get('profiles', 'p1'), city: 'Operator City' });
  s.db.exec(
    'DROP TABLE networkMemberships; DROP TABLE networks; PRAGMA user_version=3;',
  );
  s.close();
  s = createStore(path);
  assert.equal(s.db.prepare('PRAGMA user_version').get().user_version, 4);
  assert.equal(s.get('profiles', 'p1').city, 'Operator City');
  assert.equal(s.getState().networks.length, 0);
  assert.ok(readdirSync(dir).some((f) => f.startsWith('migration-v3-')));
  s.close();
});

test('original demo current cities and hometowns include state abbreviations', (t) => {
  const s = memory(t);
  for (const p of s.getState().profiles.filter((p) => p.state === 'full')) {
    assert.match(p.city, /, [A-Z]{2}$/);
    assert.match(p.hometown, /, [A-Z]{2}$/);
  }
});

test('network search filters before the result limit', (t) => {
  const s = memory(t);
  for (let i = 0; i < 55; i++)
    s.put('profiles', { name: 'Search Person ' + i });
  const last = s.put('profiles', { name: 'Search Person Z' });
  s.put('networkMemberships', { profileId: last.id, networkId: 'n-nu' });
  assert.equal(s.search('Search Person', 50, 'n-nu').profiles[0].id, last.id);
});
