export const networkTypes = {
  college: 'College / University',
  high_school: 'High School',
  workplace: 'Workplace',
  regional: 'Region',
};
export const networkFields = {
  college: ['classYear', 'status', 'school', 'major', 'residence', 'startYear', 'endYear'],
  high_school: ['classYear', 'startYear', 'endYear'],
  workplace: ['position', 'startYear', 'endYear'],
  regional: [],
};
export const membershipLabels = {
  classYear: 'Class Year',
  status: 'Student Status',
  school: 'School / College',
  major: 'Major',
  residence: 'Residence',
  position: 'Title',
  startYear: 'Start Year',
  endYear: 'End Year',
};
export function membershipDetails(membership) {
  try {
    return JSON.parse(membership.metadata);
  } catch {
    return {};
  }
}
export function sharedNetworks(world, first, second) {
  const ids = new Set(
    world.networkMemberships
      .filter((m) => m.profileId === first)
      .map((m) => m.networkId),
  );
  return world.networkMemberships
    .filter((m) => m.profileId === second && ids.has(m.networkId))
    .map((m) => m.networkId);
}
export function networkDirectory(world, networkId, filters = {}) {
  const activeId = world.settings.activeProfileId;
  const friendMap = new Map();
  for (const f of world.friendships)
    if (f.status === 'accepted') {
      if (!friendMap.has(f.profileId)) friendMap.set(f.profileId, new Set());
      if (!friendMap.has(f.friendId)) friendMap.set(f.friendId, new Set());
      friendMap.get(f.profileId).add(f.friendId);
      friendMap.get(f.friendId).add(f.profileId);
    }
  const mine = friendMap.get(activeId) ?? new Set();
  const profiles = new Map(world.profiles.map((p) => [p.id, p]));
  const network = world.networks.find((n) => n.id === networkId);
  const fields = networkFields[network?.type] ?? [];
  const includes = (value, query) =>
    String(value ?? '')
      .toLocaleLowerCase()
      .includes(
        String(query ?? '')
          .trim()
          .toLocaleLowerCase(),
      );
  return world.networkMemberships
    .filter((m) => m.networkId === networkId)
    .flatMap((membership) => {
      const profile = profiles.get(membership.profileId);
      if (!profile) return [];
      const metadata = membershipDetails(membership);
      const mutualIds = [...(friendMap.get(profile.id) ?? [])].filter((id) =>
        mine.has(id),
      );
      const context =
        profile.id === activeId
          ? 'You'
          : mine.has(profile.id)
            ? 'Friend'
            : mutualIds.length
              ? 'Friend of friend'
              : sharedNetworks(world, activeId, profile.id).length
                ? 'Same network'
                : 'Network member';
      if (!includes(profile.name || 'Unknown profile', filters.name)) return [];
      if (
        fields.some(
          (key) =>
            filters[key] &&
            (key.endsWith('Year')
              ? metadata[key] !== filters[key]
              : !includes(metadata[key], filters[key])),
        )
      )
        return [];
      if (filters.relationship && profile.relationship !== filters.relationship)
        return [];
      if (filters.context && context !== filters.context) return [];
      return [{ profile, membership, metadata, mutualIds, context }];
    })
    .sort(
      (a, b) =>
        (a.profile.name || 'Unknown profile').localeCompare(
          b.profile.name || 'Unknown profile',
        ) || a.profile.id.localeCompare(b.profile.id),
    );
}
