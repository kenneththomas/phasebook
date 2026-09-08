export const NAMEY_API = 'https://namey.muffinlabs.com/name.json';

/**
 * Shared by the React name hook and agent tools. Only name options leave the app.
 * @param {{count?: number, type?: 'male'|'female', frequency?: 'common'|'rare'|'all', withSurname?: boolean}} options
 * @param {typeof fetch} fetcher
 * @returns {Promise<string[]>}
 */
export async function fetchNames(options = {}, fetcher = fetch) {
  const { count = 1, type, frequency = 'all', withSurname = true } = options;
  if (!Number.isInteger(count) || count < 1 || count > 10)
    throw new Error('Request 1–10 names at a time.');
  if (type !== undefined && !['male', 'female'].includes(type))
    throw new Error('Invalid Namey name type.');
  if (
    !['common', 'rare', 'all'].includes(frequency) ||
    typeof withSurname !== 'boolean'
  )
    throw new Error('Invalid Namey options.');
  const params = new URLSearchParams({
    count: String(count),
    frequency,
    with_surname: String(withSurname),
  });
  if (type) params.set('type', type);
  const response = await fetcher(`${NAMEY_API}?${params}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Namey API error: ${response.status}`);
  const data = await response.json();
  if (
    !Array.isArray(data) ||
    data.length !== count ||
    data.some(
      (name) => typeof name !== 'string' || !name.trim() || name.length > 200,
    )
  )
    throw new Error('Namey returned an invalid name list.');
  return data.map((name) => name.trim());
}
