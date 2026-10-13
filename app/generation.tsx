import { useEffect, useState } from 'react';
import { useApp } from './context';
import { request, type Row } from './shared';

export function Generation() {
  const { world, run: mutate, busy } = useApp();
  const [runs, setRuns] = useState<Row[]>([]);
  const [current, setCurrent] = useState<Row | null>(null);
  const [configured, setConfigured] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [prompt, setPrompt] = useState('');
  const [worldDate, setWorldDate] = useState(() =>
    new Date().toISOString().slice(0, 16),
  );
  const [profileId, setProfileId] = useState('');
  const [networkId, setNetworkId] = useState('');
  const [allowNewProfiles, setAllowNewProfiles] = useState(false);
  const [maxNewProfiles, setMaxNewProfiles] = useState(5);
  const [density, setDensity] = useState(0.25);
  const [editor, setEditor] = useState('[]');
  const [selected, setSelected] = useState<string[]>([]);
  const [table, setTable] = useState('profiles');
  const [query, setQuery] = useState('');
  const [inspection, setInspection] = useState('');
  const [generatingId, setGeneratingId] = useState('');
  const refresh = async () => {
    const result = await request<{ runs: Row[]; configured: boolean }>(
      'generation',
    );
    setRuns(result.runs);
    setConfigured(result.configured);
  };
  useEffect(() => {
    request<{ runs: Row[]; configured: boolean }>('generation')
      .then((result) => {
        setRuns(result.runs);
        setConfigured(result.configured);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!generatingId) return;
    let stopped = false;
    const poll = async () => {
      try {
        const value = await request<Row>(`generation/${generatingId}`);
        if (!stopped) setCurrent(value);
      } catch {
        // The generation request reports its own error when it completes.
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [generatingId]);
  const load = (value: Row) => {
    setCurrent(value);
    setSelected((value.operations ?? []).map((op: Row) => op.key));
    setEditor(
      JSON.stringify(
        (value.operations ?? []).map((op: Row) => {
          const data = { ...op.data };
          if (op.action === 'create') delete data.id;
          return {
            key: op.key,
            action: op.action,
            table: op.table,
            data,
            dependsOn: op.dependsOn,
            rationale: op.rationale,
          };
        }),
        null,
        2,
      ),
    );
  };
  const perform = async (action: () => Promise<void>) => {
    setWorking(true);
    setError('');
    try {
      await action();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  };
  const action = (name: string, value = {}) =>
    perform(async () => {
      if (!current) return;
      const path = `generation/${current.id}/${name}`;
      if (name === 'commit' || name === 'undo') {
        if (await mutate(path, value))
          load(await request(`generation/${current.id}`));
      } else load(await request(path, 'POST', value));
    });
  const disabled = busy || working;
  return (
    <section className="generation-panel">
      <h2>Generate world activity</h2>
      <p>
        Describe a change, inspect the world, then review a proposal before
        applying it.
      </p>
      {error && (
        <p role="alert" className="generation-error">
          {error}
        </p>
      )}
      <fieldset disabled={disabled}>
        <legend>New generation run</legend>
        <label>
          Instruction
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
          />
        </label>
        <label>
          World date and time (UTC)
          <input
            type="datetime-local"
            value={worldDate}
            onChange={(e) => setWorldDate(e.target.value)}
          />
        </label>
        <label>
          Network scope
          <select
            value={networkId}
            onChange={(e) => setNetworkId(e.target.value)}
          >
            <option value="">Any network</option>
            {world.networks.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Profile scope
          <select
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
          >
            <option value="">Any profile</option>
            {world.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || 'Unknown profile'}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={allowNewProfiles}
            onChange={(e) => setAllowNewProfiles(e.target.checked)}
          />{' '}
          Allow new profiles
        </label>
        {allowNewProfiles && (
          <label>
            Maximum new profiles
            <input
              type="number"
              min={0}
              max={50}
              value={maxNewProfiles}
              onChange={(e) => setMaxNewProfiles(Number(e.target.value))}
            />
          </label>
        )}
        <label>
          Participation target: {Math.round(density * 100)}%
          <input
            type="range"
            min="0.05"
            max="1"
            step="0.05"
            value={density}
            onChange={(e) => setDensity(Number(e.target.value))}
          />
        </label>
        <button
          className="blue-button"
          onClick={() =>
            void perform(async () =>
              load(
                await request('generation', 'POST', {
                  prompt,
                  worldDate: worldDate + ':00Z',
                  profileId,
                  networkId,
                  allowNewProfiles,
                  maxNewProfiles,
                  density,
                }),
              ),
            )
          }
        >
          Create run
        </button>
      </fieldset>
      <label>
        Recent runs
        <select
          disabled={disabled}
          value={current?.id ?? ''}
          onChange={(e) => {
            const id = e.target.value;
            if (id)
              void perform(async () => load(await request(`generation/${id}`)));
          }}
        >
          <option value="">Choose a run</option>
          {runs.map((r) => (
            <option key={r.id} value={r.id}>
              {r.status} — {r.prompt.slice(0, 70)}
            </option>
          ))}
        </select>
      </label>
      {current && (
        <fieldset disabled={disabled}>
          <legend>
            {current.status} · {current.context?.worldDate}
          </legend>
          <p>{current.prompt}</p>
          {(current.warnings ?? []).map((w: string) => (
            <p key={w}>{w}</p>
          ))}
          {(current.errors ?? []).map((w: string) => (
            <p role="alert" key={w}>
              {w}
            </p>
          ))}
          {['draft', 'failed'].includes(current.status) && (
            <>
              <button
                className="blue-button"
                disabled={!configured}
                onClick={() => {
                  setGeneratingId(current.id);
                  void action('generate').finally(() => setGeneratingId(''));
                }}
              >
                Ask model to inspect and propose
              </button>
              {!configured && (
                <p>
                  No model adapter configured. You can inspect records and enter
                  a manual proposal below.
                </p>
              )}
            </>
          )}
          {current.status === 'inspecting' && current.progress && (
            <div className="generation-progress" aria-live="polite">
              <strong>Processing generation</strong>
              <span>
                Phase: {String(current.progress.phase).replaceAll('-', ' ')}
              </span>
              <span>
                Model turn: {current.progress.turn ?? 0} of{' '}
                {current.progress.maxTurns ?? 12}
              </span>
              <span>
                World inspections: {current.progress.inspections ?? 0}
              </span>
              {current.progress.startedAt && (
                <span>
                  Started:{' '}
                  {new Date(current.progress.startedAt).toLocaleTimeString()}
                </span>
              )}
              <p>
                The model may take up to 3 minutes per turn. This page will
                update as each turn and inspection completes.
              </p>
            </div>
          )}
          {['draft', 'failed', 'proposed'].includes(current.status) && (
            <>
              <details>
                <summary>Inspect world and canonical fields</summary>
                <label>
                  Collection
                  <select
                    value={table}
                    onChange={(e) => setTable(e.target.value)}
                  >
                    {Object.keys(world)
                      .filter((k) =>
                        Array.isArray(world[k as keyof typeof world]),
                      )
                      .map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                  </select>
                </label>
                <label>
                  Search
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                {['inspect', 'schema'].map((name) => (
                  <button
                    key={name}
                    onClick={() =>
                      void perform(async () =>
                        setInspection(
                          JSON.stringify(
                            await request(
                              `generation/${current.id}/inspect`,
                              'POST',
                              {
                                name,
                                arguments: {
                                  table,
                                  query,
                                  ...(table === 'profiles' ||
                                  table === 'networkMemberships'
                                    ? { networkId: current.context.networkId }
                                    : {}),
                                },
                              },
                            ),
                            null,
                            2,
                          ),
                        ),
                      )
                    }
                  >
                    {name === 'schema' ? 'Show fields' : 'Search records'}
                  </button>
                ))}
                <pre>{inspection}</pre>
              </details>
              <details open={current.status !== 'proposed'}>
                <summary>Manual proposal editor</summary>
                <p>
                  Enter an array of operations with key, action (create/update),
                  table, data, and optional rationale. Use {'{"$ref":"key"}'}{' '}
                  for a reference to another operation. Creation IDs are
                  assigned automatically.
                </p>
                <label>
                  Operations JSON
                  <textarea
                    rows={14}
                    value={editor}
                    onChange={(e) => setEditor(e.target.value)}
                    spellCheck={false}
                  />
                </label>
                <button
                  onClick={() =>
                    void perform(async () =>
                      load(
                        await request(
                          `generation/${current.id}/propose`,
                          'POST',
                          { operations: JSON.parse(editor) },
                        ),
                      ),
                    )
                  }
                >
                  Validate and preview
                </button>
              </details>
            </>
          )}
          {current.status === 'proposed' && (
            <>
              <h3>Proposed changes</h3>
              <p>
                Select operations to apply. Include their dependencies. Applying
                a selection closes the run; unselected operations remain in its
                audit history.
              </p>
              {current.operations.map((op: Row) => (
                <article key={op.key}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.includes(op.key)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, op.key]
                            : selected.filter((k) => k !== op.key),
                        )
                      }
                    />
                    {op.key}: {op.action} {op.table}
                  </label>
                  {op.rationale && <p>{op.rationale}</p>}
                  <pre>{JSON.stringify(op.data, null, 2)}</pre>
                  {!!op.dependsOn.length && (
                    <p>Requires: {op.dependsOn.join(', ')}</p>
                  )}
                </article>
              ))}
              <details>
                <summary>
                  All resulting changes, including social side effects (
                  {current.previewChanges?.length ?? 0})
                </summary>
                <pre>{JSON.stringify(current.previewChanges, null, 2)}</pre>
              </details>
              <button
                className="blue-button"
                disabled={!selected.length}
                onClick={() => void action('commit', { selected })}
              >
                Apply selected ({selected.length})
              </button>
              <button
                disabled={!current.operations.length}
                onClick={() => void action('commit')}
              >
                Apply entire run
              </button>
            </>
          )}
          {['draft', 'failed', 'proposed'].includes(current.status) && (
            <button onClick={() => void action('discard')}>Discard run</button>
          )}
          {current.status === 'committed' && (
            <>
              <p>
                Applied {current.committedOperations.length} operations. Undo is
                available if the affected records have not been changed or
                referenced by later activity.
              </p>
              <button onClick={() => void action('undo')}>Undo run</button>
            </>
          )}
          <details>
            <summary>Run history and provenance</summary>
            <pre>{JSON.stringify(current, null, 2)}</pre>
          </details>
        </fieldset>
      )}
      {working && <output>Working…</output>}
    </section>
  );
}
