import * as React from 'react';

import { fetchNames } from '../lib/namey.mjs';

type NameType = 'male' | 'female';
type Frequency = 'common' | 'rare' | 'all';

interface InventNameOptions {
  type?: NameType;
  frequency?: Frequency;
  withSurname?: boolean;
}

interface InventNameResult {
  name: string | null;
  loading: boolean;
  error: string | null;
  generateName: (options?: InventNameOptions) => Promise<string>;
}

export function useInventAName(): InventNameResult {
  const [name, setName] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const generateName = React.useCallback(
    async (options: InventNameOptions = {}): Promise<string> => {
      setLoading(true);
      setError(null);

      try {
        const [result] = await fetchNames(options);

        setName(result);
        return result;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to generate name';
        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { name, loading, error, generateName };
}
