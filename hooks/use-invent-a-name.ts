import * as React from "react";

const NAMEY_API = "https://namey.muffinlabs.com/name.json";

type NameType = "male" | "female";
type Frequency = "common" | "rare" | "all";

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
      const { type, frequency = "all", withSurname = true } = options;

      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        count: "1",
        frequency,
        with_surname: String(withSurname),
      });

      if (type) {
        params.set("type", type);
      }

      try {
        const response = await fetch(`${NAMEY_API}?${params}`);

        if (!response.ok) {
          throw new Error(`Namey API error: ${response.status}`);
        }

        const data: string[] = await response.json();
        const result = data[0] ?? "";

        setName(result);
        return result;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to generate name";
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
