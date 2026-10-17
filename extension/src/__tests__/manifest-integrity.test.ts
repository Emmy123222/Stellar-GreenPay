// Jest resolves node builtins through `require`; the extension build never
// compiles test files, so the browser tsconfig does not need node types.
declare const require: (id: string) => unknown;
declare const __dirname: string;

const fs = require('fs') as { readFileSync: (file: string, encoding: string) => string };
const path = require('path') as { resolve: (...parts: string[]) => string };

/**
 * Reports object keys that appear more than once in raw JSON text.
 *
 * `JSON.parse` silently keeps the last occurrence, so it cannot detect a merge
 * that duplicated a key (the defect behind #1641). This walks the raw text and
 * compares keys per object scope, decoding string tokens so escape variants of
 * the same key are compared by value.
 */
function findDuplicateKeys(raw: string): string[] {
  const duplicates: string[] = [];
  const stack: { isObject: boolean; keys: Set<string> }[] = [];
  let i = 0;

  while (i < raw.length) {
    const ch = raw[i];

    if (ch === '"') {
      const start = i;
      i++;
      while (i < raw.length && raw[i] !== '"') {
        if (raw[i] === '\\') i++;
        i++;
      }
      const token = raw.slice(start, i + 1);
      i++;

      let next = i;
      while (next < raw.length && /\s/.test(raw[next])) next++;
      const parent = stack[stack.length - 1];
      if (raw[next] === ':' && parent && parent.isObject) {
        const key = JSON.parse(token) as string;
        if (parent.keys.has(key)) duplicates.push(key);
        parent.keys.add(key);
      }
      continue;
    }

    if (ch === '{') stack.push({ isObject: true, keys: new Set() });
    else if (ch === '[') stack.push({ isObject: false, keys: new Set() });
    else if (ch === '}' || ch === ']') stack.pop();

    i++;
  }

  return duplicates;
}

function readRaw(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', relativePath), 'utf8');
}

describe('extension manifest integrity', () => {
  describe('findDuplicateKeys detector', () => {
    it('detects the duplicated matches/js keys from the #1641 merge residue', () => {
      const raw =
        '{"content_scripts":[{"matches":["<all_urls>"],"js":["dist/content-script.js"],' +
        '"matches":["https://greenpay.app/*"],"js":["dist/content-script.js"]}]}';
      expect(findDuplicateKeys(raw)).toEqual(['matches', 'js']);
    });

    it('detects duplicates at nested object and array levels', () => {
      expect(findDuplicateKeys('{"a":{"b":1,"b":2},"c":[{"d":1,"d":2}]}')).toEqual(['b', 'd']);
    });

    it('decodes string escapes before comparing keys', () => {
      expect(findDuplicateKeys('{"a\\"b":1,"a\\"b":2}')).toEqual(['a"b']);
    });

    it('ignores colons and braces inside string values', () => {
      const raw = '{"url":"https://greenpay.app/*","text":"a : b { }","nested":"{\\"a\\":1}"}';
      expect(findDuplicateKeys(raw)).toEqual([]);
    });

    it('returns nothing for clean JSON', () => {
      expect(findDuplicateKeys('{"a":{"b":1},"c":[1,2,3],"d":"e"}')).toEqual([]);
    });
  });

  it.each(['manifest.json', 'manifest.firefox.json'])(
    '%s parses as strict JSON without duplicate keys',
    (file) => {
      const raw = readRaw(file);
      const manifest = JSON.parse(raw) as { manifest_version?: number };
      expect(manifest.manifest_version).toBe(3);
      expect(findDuplicateKeys(raw)).toEqual([]);
    }
  );
});
