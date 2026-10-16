import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/store.mjs';
import { createGeneration } from '../server/generation.mjs';

const scenarios = [
  {
    name: 'profile wall activity',
    prompt: 'Make Alex’s wall more active with a natural music conversation.',
    scope: { profileId: 'p1', density: 0.25 },
    context: { limit: 3, activityLimit: 4, tables: ['posts', 'comments'] },
    topics: ['song', 'radio'],
    maxParticipants: 2,
    voiceMarkers: { p1: ['?'], p2: ['like'] },
    operations: [
      {
        key: 'song-post',
        action: 'create',
        table: 'posts',
        data: {
          authorId: 'p1',
          wallId: 'p2',
          body: 'Found a song for the radio set. Does this opening work?',
          createdAt: '2013-03-06T20:00:00Z',
        },
        rationale:
          'Alex likes music and asks a close friend for a specific reaction.',
      },
      {
        key: 'film-reply',
        action: 'create',
        table: 'comments',
        data: {
          postId: { $ref: 'song-post' },
          authorId: 'p2',
          body: 'like the last scene of a good movie — quiet, then suddenly huge.',
          createdAt: '2013-03-06T20:04:00Z',
        },
        rationale:
          'Jamie answers selectively in a lowercase, film-minded voice.',
      },
    ],
  },
  {
    name: 'network event discussion',
    prompt: 'Have campus friends talk naturally about tonight’s concert.',
    scope: { network: true, density: 0.5 },
    context: {
      limit: 4,
      activityLimit: 2,
      tables: ['events', 'eventGuests', 'posts', 'comments'],
    },
    topics: ['concert', 'set'],
    maxParticipants: 2,
    voiceMarkers: { p1: ['?'], p4: ['!'] },
    operations: [
      {
        key: 'concert',
        action: 'create',
        table: 'events',
        data: {
          creatorId: 'p1',
          title: 'Campus concert',
          description: 'An evening concert on campus.',
          location: 'Student center',
          startsAt: '2013-03-06T21:00:00Z',
        },
        rationale: 'The requested concert is represented as a canonical event.',
      },
      {
        key: 'concert-post',
        action: 'create',
        table: 'posts',
        data: {
          authorId: 'p1',
          body: 'Radio booth is packed. Which set are you waiting for?',
          createdAt: '2013-03-06T19:30:00Z',
        },
        rationale:
          'Alex’s campus-radio interest makes this a plausible prompt.',
      },
      {
        key: 'designer-reply',
        action: 'create',
        table: 'comments',
        data: {
          postId: { $ref: 'concert-post' },
          authorId: 'p4',
          body: 'The closer! That poster color deserves a full-volume entrance!',
          createdAt: '2013-03-06T19:33:00Z',
        },
        rationale:
          'Chris responds through a design detail and energetic punctuation.',
      },
    ],
  },
  {
    name: 'sparse distinct voices',
    prompt:
      'Create a small coffee meetup exchange without making every friend join.',
    scope: { profileId: 'p1', density: 0.25 },
    context: { limit: 6, activityLimit: 4, tables: ['posts', 'comments'] },
    topics: ['coffee', 'café'],
    maxParticipants: 2,
    voiceMarkers: { p1: ['?'], p3: ['deadline'] },
    operations: [
      {
        key: 'coffee-post',
        action: 'create',
        table: 'posts',
        data: {
          authorId: 'p1',
          wallId: 'p3',
          body: 'Trying the new café for coffee before radio. Want the window table?',
          createdAt: '2013-03-06T16:00:00Z',
        },
        rationale:
          'Alex makes a brief coffee invitation to an existing friend.',
      },
      {
        key: 'deadline-reply',
        action: 'create',
        table: 'comments',
        data: {
          postId: { $ref: 'coffee-post' },
          authorId: 'p3',
          body: 'yes—if this deadline stops moving. save me the quiet chair.',
          createdAt: '2013-03-06T16:02:00Z',
        },
        rationale:
          'Taylor’s terse reply reflects deadline pressure and a quieter style.',
      },
    ],
  },
];

const authorOf = (operation) =>
  operation.data.authorId ??
  operation.data.creatorId ??
  operation.data.profileId;

function evaluate(run, scenario, evidence = {}) {
  const content = run.operations
    .flatMap((operation) => [
      operation.data.body,
      operation.data.title,
      operation.data.description,
    ])
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const authored = new Map();
  for (const operation of run.operations) {
    const author = authorOf(operation);
    if (author && operation.data.body)
      authored.set(author, [
        ...(authored.get(author) ?? []),
        operation.data.body,
      ]);
  }
  const participants = new Set(
    run.operations.map(authorOf).filter((author) => author),
  );
  const sociallyPlausible = (id) => {
    if (!evidence.world) return false;
    if (scenario.scope.profileId)
      return (
        id === scenario.scope.profileId ||
        evidence.world.friendships.some(
          (friendship) =>
            friendship.status === 'accepted' &&
            [friendship.profileId, friendship.friendId].includes(
              scenario.scope.profileId,
            ) &&
            [friendship.profileId, friendship.friendId].includes(id),
        )
      );
    return evidence.world.networkMemberships.some(
      (membership) =>
        membership.networkId === evidence.networkId &&
        membership.profileId === id,
    );
  };
  const operationByKey = new Map(
    run.operations.map((operation) => [operation.key, operation]),
  );
  const temporalOperation = (operation) => {
    const date = operation.data.createdAt ?? operation.data.startsAt;
    if (date && !Number.isFinite(Date.parse(date))) return false;
    if (
      date &&
      (Date.parse(date) < Date.parse('2013-03-06T00:00:00Z') ||
        Date.parse(date) > Date.parse('2013-03-06T23:59:00Z'))
    )
      return false;
    const parentRef = operation.data.postId?.$ref;
    const parentDate = parentRef
      ? operationByKey.get(parentRef)?.data.createdAt
      : null;
    return !parentDate || !date || Date.parse(date) >= Date.parse(parentDate);
  };
  const checks = {
    relevance: scenario.topics.every((topic) => content.includes(topic)),
    profileConsistency: Object.entries(scenario.voiceMarkers).every(
      ([author, markers]) =>
        markers.every((marker) =>
          (authored.get(author) ?? []).some((body) =>
            body.toLowerCase().includes(marker),
          ),
        ),
    ),
    distinctVoice:
      new Set(
        [...authored.values()].map((bodies) =>
          bodies
            .join(' ')
            .replaceAll(/[^!?—]/g, '')
            .toLowerCase(),
        ),
      ).size === authored.size,
    socialPlausibility: [...participants].every(sociallyPlausible),
    temporalConsistency: run.operations.every(temporalOperation),
    sparsity: participants.size <= scenario.maxParticipants,
    canonicalValidation:
      run.status === 'proposed' &&
      run.previewChanges.length >= run.operations.length,
  };
  return {
    checks,
    score:
      Object.values(checks).filter(Boolean).length / Object.keys(checks).length,
  };
}

for (const scenario of scenarios)
  test(`generation quality: ${scenario.name}`, async (t) => {
    const store = createStore(':memory:');
    t.after(() => store.close());
    for (const [id, guidance] of Object.entries({
      p1: {
        voice: 'warm, curious, and observant',
        communicationStyle:
          'brief; asks direct questions; restrained punctuation',
        behavioralTendencies:
          'shares music finds and invites one person at a time',
      },
      p2: {
        voice: 'wry and cinematic',
        communicationStyle: 'lowercase; vivid comparisons; no greeting',
        behavioralTendencies:
          'responds selectively and notices film-like moments',
      },
      p3: {
        voice: 'dry and deadline-conscious',
        communicationStyle: 'lowercase, terse, occasional em dash',
        behavioralTendencies:
          'rarely initiates; accepts quiet plans around work',
      },
      p4: {
        voice: 'enthusiastic and visual',
        communicationStyle: 'punchy sentences and exclamation points',
        behavioralTendencies: 'notices design details at concerts and diners',
      },
    }))
      store.put('profiles', { ...store.get('profiles', id), ...guidance });
    let networkId;
    if (scenario.scope.network) {
      const network = store.put('networks', {
        name: 'Campus Arts Network',
        type: 'college',
      });
      networkId = network.id;
      for (const profileId of ['p1', 'p4'])
        store.put('networkMemberships', {
          profileId,
          networkId,
          metadata: '{"startYear":"2010","endYear":"2014"}',
        });
    }
    let calls = 0,
      packet;
    const generation = createGeneration(store, {
      provider: {
        name: 'fixed-evaluation-agent',
        model: 'fixture-v1',
        async next(input) {
          if (calls++ === 0) {
            assert.ok(input.tools.some((tool) => tool.name === 'context'));
            return {
              calls: [{ name: 'context', arguments: scenario.context }],
            };
          }
          packet = input.messages[0].result;
          return { operations: scenario.operations };
        },
      },
    });
    const run = generation.create({
      prompt: scenario.prompt,
      worldDate: '2013-03-06T23:59:00Z',
      density: scenario.scope.density,
      profileId: scenario.scope.profileId,
      networkId,
    });
    const proposed = await generation.generate(run.id);
    assert.equal(calls, 2);
    assert.equal(proposed.inspected.length, 1);
    assert.ok(JSON.stringify(packet).length < 10_000);
    assert.ok(
      JSON.stringify(packet).includes('communicationStyle'),
      'voice guidance must reach the generating agent',
    );
    assert.deepEqual(
      evaluate(proposed, scenario, { world: store.getState(), networkId }),
      {
        checks: {
          relevance: true,
          profileConsistency: true,
          distinctVoice: true,
          socialPlausibility: true,
          temporalConsistency: true,
          sparsity: true,
          canonicalValidation: true,
        },
        score: 1,
      },
    );
  });

test('quality rubric rejects a dense, generic, irrelevant proposal', () => {
  const scenario = scenarios[0];
  const result = evaluate(
    {
      status: 'draft',
      previewChanges: [],
      operations: ['p1', 'p2', 'p3'].map((authorId, index) => ({
        table: 'posts',
        data: { authorId, body: `Great update ${index}` },
      })),
    },
    scenario,
    {},
  );
  assert.ok(result.score < 0.5);
  assert.equal(result.checks.relevance, false);
  assert.equal(result.checks.sparsity, false);
  assert.equal(result.checks.canonicalValidation, false);
});
