/**
 * `default.ini` / episode / level config parser (`CConfigFile`).
 *
 * Format: `Key = Value` lines, `#`/`;` comments, optional indexed keys like
 * `FragText[0]`. Merge order mirrors the original: files are loaded
 * primary → secondary → defaults and the *first* insert of a key wins
 * (`std::map::insert` semantics).
 */

export interface ConfigFile {
  get(key: string): string | undefined;
  getIndexed(prefix: string, index: number): string | undefined;
  has(key: string): boolean;
  entries(): IterableIterator<[string, string]>;
}

function isSpace(ch: number): boolean {
  return ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0b || ch === 0x0c || ch === 0x0d;
}

/** Parses one `.ini` text into ordered key/value pairs (first occurrence kept per file). */
export function parseIni(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const lines = text.split("\n");
  for (const raw of lines) {
    let idx = 0;
    while (idx < raw.length && isSpace(raw.charCodeAt(idx))) idx++;
    const first = raw[idx];
    if (first === "#" || first === ";") continue;

    let eq = idx;
    while (eq < raw.length && raw[eq] !== "=" && raw[eq] !== "\0") eq++;
    if (raw[eq] !== "=" || eq === idx) continue;

    const key = raw.slice(idx, eq).trim();
    const value = raw.slice(eq + 1).trim();
    if (key.length > 0 && value.length > 0) out.push([key, value]);
  }
  return out;
}

/**
 * Merges config files in the given priority order (earliest wins), matching
 * `CConfigFile::Load(primary, secondary, defaults)`.
 */
export function mergeIni(...texts: Array<string | undefined>): ConfigFile {
  const map = new Map<string, string>();
  for (const text of texts) {
    if (text === undefined) continue;
    for (const [k, v] of parseIni(text)) {
      if (!map.has(k)) map.set(k, v);
    }
  }
  return {
    get: (key) => map.get(key),
    getIndexed: (prefix, index) => map.get(`${prefix}[${index}]`),
    has: (key) => map.has(key),
    entries: () => map.entries(),
  };
}
