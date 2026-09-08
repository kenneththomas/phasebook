# Networks: historical research and design

Research performed September 8, 2026 before implementation.

## Historical findings

The [April 2007 network portal announcement](https://about.fb.com/news/2007/04/facebook-develops-network-portals-new-inbox-and-updates-site-design/) describes 47,000 school, company and regional networks. Users could have multiple affiliations. Network portals displayed membership statistics and public groups/events. Networks were prominent navigation alongside Profile, Friends and Inbox, and distinct from groups.

The [workplace launch](https://about.fb.com/news/2006/05/facebook-expands-to-include-work-networks-2/) and [regional expansion](https://about.fb.com/news/2006/09/facebook-expansion-enables-more-people-to-connect-with-friends-in-a-trusted-environment/) explain email-based school/work affiliation verification and adding work affiliations to existing accounts. Shared networks historically affected profile access; search visibility, contact permissions and profile pictures also had controls. Membership was not equivalent to friendship or unconditional visibility.

The [December 9, 2009 privacy announcement](https://about.fb.com/news/2009/12/facebook-asks-more-than-350-million-users-around-the-world-to-personalize-their-privacy/) removed regional networks. Regional directories in Phasebook's March 2010 world are an intentional earlier-era extension requested for this simulation, not a claim about actual 2010 Facebook.

Visual research: [2008 Facebook screenshots](https://www.webdesignmuseum.org/gallery/facebook-2008), particularly Browse by Name, Find Friends and Browse Pages, supplied adjacent directory references with compact blue links, small pictures and dividers. These are not exact network-page references. Search supplied screenshot previews/descriptions; the direct full-size image fetch failed. An exact network-directory screenshot, exact profile affiliation placement, and exhaustive historical advanced-filter inventory were not verified. The UI adapts existing Phasebook rows and Info sections, not a claimed pixel-identical recreation. College class/major/residence filters are period-plausible adaptations; relationship filtering reuses existing profile data.

## Design decisions

- `networks` and `networkMemberships` are relational tables with local foreign keys and independent stable external IDs. Membership pairs are unique. Network deletion removes affiliations but retains profiles.
- Type is an extensible string. College metadata: classYear, status, school, major, residence; high school: classYear; workplace: position, startYear, endYear. Regional geography belongs to the network. Metadata is a validated JSON object on each membership row, never an array embedded in profiles.
- Schema version 4 adds tables and indexes with a pre-migration backup. Existing worlds are not reseeded. Old world/package network collections default to empty, retaining their existing format versions as additive extensions.
- Profile links and directory filters include full and stub identities. Shared-network and mutual-friend helpers derive context from the active simulated profile and remain reusable for recommendations or future visibility rules.
- No permission model is introduced into this local simulation. All identities stay browsable; real network privacy and verification are documented above, not falsely simulated. Operator controls explicitly say World management.
- Profile packages contain only the root's memberships and referenced network definitions, never other network members through affiliation expansion. Matching uses external IDs only. Local network metadata wins same-ID conflicts. Import-as-new retains network identity while remapping the copied profile and membership identities. Importing a stub preserves its stub state and does not downgrade existing full profiles.
- Fresh demos retain the original eight full people, add two stub members, and demonstrate twelve overlapping school, workplace and regional networks. Current-city and hometown text uses City, ST. Ambiguous Portland is interpreted as Portland, ME in this New England demo.

## Verification

Targeted network tests cover all types, metadata, full/stub directories, filters, active-user context, cascades, package graph boundaries, existing/missing network imports, stub hydration, import-as-new, backward compatibility and migration. Existing tests and the production build are run alongside these checks.

Manual verification used a separate local demo database: browsed Northeastern as Alex and Taylor, filtered class year 2013 to Casey, edited Casey’s student status, and verified the directory updated. Casey changed from Same network to Network member after switching to Taylor. Network rows and filter layout were inspected visually. The main saved world was not modified.
