import { useState } from 'react';
import { useApp, PersonLink } from './context';
import { Avatar, profileName, uid, now, type Row } from './shared';
import { Pager, pageRows } from './pagination';
import {
  networkTypes,
  networkFields,
  membershipLabels,
  membershipDetails,
  networkDirectory,
} from '../lib/networks.mjs';

const types = networkTypes as Record<string, string>;
const fields = networkFields as Record<string, string[]>;
const labels = membershipLabels as Record<string, string>;

export function ProfileNetworks({
  profileId,
  details = false,
}: {
  profileId: string;
  details?: boolean;
}) {
  const { world, go } = useApp();
  const memberships = world.networkMemberships.filter(
    (m) => m.profileId === profileId,
  );
  if (!memberships.length) return null;
  return (
    <dl className="profile-info network-affiliations">
      <div>
        <dt>Networks:</dt>
        <dd>
          {memberships.map((m) => {
            const n = world.networks.find((n) => n.id === m.networkId);
            if (!n) return null;
            const metadata = membershipDetails(m);
            return (
              <div key={m.id}>
                <button
                  className="person-name"
                  onClick={() => go('network', n.id)}
                >
                  {n.name}
                  {metadata.classYear
                    ? ` '${metadata.classYear.slice(-2)}`
                    : ''}
                </button>
                {details && (
                  <p className="muted">
                    {Object.entries(metadata)
                      .map(
                        ([key, value]) =>
                          `${labels[key] || key}: ${String(value)}`,
                      )
                      .join(' · ')}
                  </p>
                )}
              </div>
            );
          })}
        </dd>
      </div>
    </dl>
  );
}

export function Networks({ id }: { id?: string }) {
  const { world, go, open, me } = useApp();
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const network = world.networks.find((n) => n.id === id);
  const setFilter = (key: string, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };
  if (id && !network)
    return (
      <p className="empty-state">
        Network not found.{' '}
        <button onClick={() => go('networks')}>Browse Networks</button>
      </p>
    );
  if (!network) {
    const found = world.networks.filter(
      (n) =>
        (!type || n.type === type) &&
        n.name.toLowerCase().includes(query.toLowerCase()),
    );
    const paged = pageRows(found, page, 20);
    return (
      <>
        <div className="page-title">
          <h1>Networks</h1>
        </div>
        <p className="list-caption">
          Find people from your school, workplace or region.
        </p>
        <div className="network-filters">
          <label>
            Find a Network
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            Type
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All types</option>
              {Object.entries(types).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="list-caption">{found.length} networks</p>
        {paged.rows.map((n) => (
          <div className="directory-row" key={n.id}>
            <div>
              <button
                className="person-name"
                onClick={() => go('network', n.id)}
              >
                {n.name}
              </button>
              <p className="muted">
                {types[n.type] || n.type} ·{' '}
                {
                  world.networkMemberships.filter((m) => m.networkId === n.id)
                    .length
                }{' '}
                members
                {world.networkMemberships.some(
                  (m) => m.networkId === n.id && m.profileId === me.id,
                )
                  ? ' · Your network'
                  : ''}
              </p>
            </div>
          </div>
        ))}
        {!found.length && <p className="empty-state">No networks found.</p>}
        <Pager
          page={paged.page}
          pageCount={paged.pageCount}
          onChange={setPage}
        />
        <div className="network-admin">
          <b>World management</b>
          <button onClick={() => open({ kind: 'network' })}>
            Create Network
          </button>
          <button onClick={() => open({ kind: 'networkMembership' })}>
            Add Membership
          </button>
        </div>
      </>
    );
  }
  const members = networkDirectory(world, network.id, filters) as {
    profile: Row;
    membership: Row;
    metadata: Record<string, string>;
    context: string;
    mutualIds: string[];
  }[];
  const paged = pageRows(members, page, 20);
  const count = world.networkMemberships.filter(
    (m) => m.networkId === network.id,
  ).length;
  return (
    <>
      <button className="back-link" onClick={() => go('networks')}>
        « All Networks
      </button>
      <div className="page-title">
        <h1>{network.name}</h1>
      </div>
      <p className="list-caption">
        {types[network.type] || network.type} · {count} members ·{' '}
        {[network.city, network.region, network.country]
          .filter(Boolean)
          .join(', ')}
      </p>
      {network.description && (
        <p className="profile-bio">{network.description}</p>
      )}
      <h2 className="info-heading">People in {network.name}</h2>
      <div className="network-filters">
        <label>
          Name
          <input
            value={filters.name || ''}
            onChange={(e) => setFilter('name', e.target.value)}
          />
        </label>
        {(fields[network.type] || []).map((key) => (
          <label key={key}>
            {labels[key]}
            <input
              value={filters[key] || ''}
              onChange={(e) => setFilter(key, e.target.value)}
            />
          </label>
        ))}
        {['college', 'high_school'].includes(network.type) && (
          <label>
            Relationship Status
            <select
              value={filters.relationship || ''}
              onChange={(e) => setFilter('relationship', e.target.value)}
            >
              <option value="">Any</option>
              {[
                ...new Set(
                  world.profiles.map((p) => p.relationship).filter(Boolean),
                ),
              ].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        )}
        <label>
          Connection
          <select
            value={filters.context || ''}
            onChange={(e) => setFilter('context', e.target.value)}
          >
            <option value="">Everyone</option>
            {[
              'Friend',
              'Friend of friend',
              'Same network',
              'Network member',
              'You',
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <button
          onClick={() => {
            setFilters({});
            setPage(1);
          }}
        >
          Clear filters
        </button>
      </div>
      <p className="list-caption">{members.length} people found</p>
      {paged.rows.map(
        ({ profile, membership, metadata, context, mutualIds }) => (
          <div className="directory-row" key={membership.id}>
            <Avatar person={profile} size={50} />
            <div className="network-person">
              <PersonLink id={profile.id}>{profileName(profile)}</PersonLink>
              <p className="muted">
                {Object.entries(metadata)
                  .map(
                    ([key, value]) => `${labels[key] || key}: ${String(value)}`,
                  )
                  .join(' · ') || profile.city}
              </p>
              <p className="muted">
                {context}
                {profile.id !== me.id && mutualIds.length > 0
                  ? ` · ${mutualIds.length} mutual friend${mutualIds.length === 1 ? '' : 's'}`
                  : ''}
                {profile.state === 'stub' ? ' · Full profile unavailable' : ''}
              </p>
            </div>
            <button
              className="network-edit"
              aria-label={`Manage membership for ${profileName(profile)}`}
              onClick={() =>
                open({ kind: 'networkMembership', row: membership })
              }
            >
              Manage
            </button>
          </div>
        ),
      )}
      {!members.length && (
        <p className="empty-state">No people match these filters.</p>
      )}
      <Pager page={paged.page} pageCount={paged.pageCount} onChange={setPage} />
      <div className="network-admin">
        <b>World management</b>
        <button onClick={() => open({ kind: 'network', row: network })}>
          Edit Network
        </button>
        <button
          onClick={() =>
            open({
              kind: 'networkMembership',
              row: { id: '', networkId: network.id },
            })
          }
        >
          Add Membership
        </button>
      </div>
    </>
  );
}

export function NetworkEditor({ kind, row }: { kind: string; row?: Row }) {
  const { world, me, save, remove, open, go, busy } = useApp();
  const membership = kind === 'networkMembership';
  const [form, setForm] = useState<Row>({
    externalId: uid(),
    ...(membership
      ? {
          networkId: world.networks[0]?.id || '',
          profileId: me.id,
          metadata: '{}',
        }
      : {
          name: '',
          type: 'college',
          city: '',
          region: '',
          country: 'US',
          description: '',
        }),
    createdAt: now(),
    ...row,
    id: row?.id || uid(),
  });
  const [metadata, setMetadata] = useState<Record<string, string>>(
    membership ? membershipDetails(form) : {},
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (key: string, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  const network = world.networks.find((n) => n.id === form.networkId);
  const table = membership ? 'networkMemberships' : 'networks';
  const existing = !!row?.id;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          await save(
            table,
            membership
              ? {
                  ...form,
                  metadata: JSON.stringify(
                    Object.fromEntries(
                      Object.entries(metadata).filter(([, v]) => v.trim()),
                    ),
                  ),
                }
              : form,
          )
        ) {
          open(null);
          go('network', membership ? form.networkId : form.id);
        }
      }}
    >
      <p className="form-help">
        World management · Affiliations are assigned by the operator in this
        local simulation.
      </p>
      {membership ? (
        <>
          <label className="form-field">
            Network
            <select
              required
              disabled={existing}
              value={form.networkId}
              onChange={(e) => {
                set('networkId', e.target.value);
                setMetadata({});
              }}
            >
              <option value="">Select a network</option>
              {world.networks.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            Profile
            <select
              disabled={existing}
              value={form.profileId}
              onChange={(e) => set('profileId', e.target.value)}
            >
              {world.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {profileName(p)}
                  {p.state === 'stub' ? ' (stub)' : ''}
                </option>
              ))}
            </select>
          </label>
          {(fields[network?.type] || []).map((key) => (
            <label className="form-field" key={key}>
              {labels[key]}
              <input
                maxLength={500}
                placeholder={key.endsWith('Year') ? '2010' : ''}
                value={metadata[key] || ''}
                onChange={(e) =>
                  setMetadata((m) => ({ ...m, [key]: e.target.value }))
                }
              />
            </label>
          ))}
        </>
      ) : (
        <>
          <label className="form-field">
            Network Type
            <select
              value={form.type}
              onChange={(e) => set('type', e.target.value)}
            >
              {!types[form.type] && (
                <option value={form.type}>{form.type}</option>
              )}
              {Object.entries(types).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {[
            ['name', 'Name'],
            ['city', 'City'],
            ['region', 'State / Region'],
            ['country', 'Country'],
            ['description', 'Description'],
          ].map(([key, label]) => (
            <label className="form-field" key={key}>
              {label}
              <input
                required={key === 'name'}
                value={form[key]}
                onChange={(e) => set(key, e.target.value)}
              />
            </label>
          ))}
        </>
      )}
      <label className="form-field">
        Portable identity
        <input value={form.externalId} readOnly />
      </label>
      <div className="dialog-actions">
        <button
          type="submit"
          className="blue-button"
          disabled={busy || (membership && !form.networkId)}
        >
          Save
        </button>
        <button
          type="button"
          className="gray-button"
          onClick={() => open(null)}
        >
          Cancel
        </button>
        {existing && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
          >
            Delete
          </button>
        )}
        {!membership && existing && (
          <button
            type="button"
            onClick={() => {
              open(null);
              go('network', form.id);
            }}
          >
            Browse Members
          </button>
        )}
      </div>
      {confirmDelete && (
        <div className="import-preview">
          <p>
            {membership
              ? 'Remove this affiliation?'
              : `Delete this network and its ${world.networkMemberships.filter((m) => m.networkId === form.id).length} memberships? Profiles will be retained.`}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (await remove(table, form.id)) {
                open(null);
                go(
                  membership ? 'network' : 'networks',
                  membership ? form.networkId : undefined,
                );
              }
            }}
          >
            Confirm Delete
          </button>
          <button type="button" onClick={() => setConfirmDelete(false)}>
            Keep
          </button>
        </div>
      )}
    </form>
  );
}
