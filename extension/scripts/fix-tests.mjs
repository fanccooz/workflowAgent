import fs from 'fs';

function convert(file, importBlock) {
  let s = fs.readFileSync(file, 'utf8');
  s = s.replace(/^[\s\S]*?(?=test\(|\/\/ |const |const rows)/m, `${importBlock}\n\n`);
  s = s.replace(/\btest\(/g, 'it(');
  s = s.replace(/assert\.equal\(/g, 'expect(').replace(/,\s*([^)]+)\)/g, (m, v, offset, str) => {
    // too naive - don't
    return m;
  });
  // simpler assert replacements
  s = s.replace(/assert\.equal\(([^,]+),\s*([^)]+)\)/g, 'expect($1).toBe($2)');
  s = s.replace(/assert\.deepEqual\(([^,]+),\s*([^)]+)\)/g, 'expect($1).toEqual($2)');
  s = s.replace(/assert\.ok\(([^)]+)\)/g, 'expect(Boolean($1)).toBe(true)');
  s = `import { describe, expect, it } from 'vitest';\n${importBlock}\n\ndescribe(${JSON.stringify(file)}, () => {\n${s}\n});\n`;
  // remove duplicate vitest import if any
  const lines = s.split('\n');
  const seen = new Set();
  s = lines
    .filter((line) => {
      if (line.startsWith("import { describe, expect, it }")) {
        if (seen.has('vitest')) return false;
        seen.add('vitest');
      }
      return true;
    })
    .join('\n');
  fs.writeFileSync(file, s);
  console.log('fixed', file);
}

// Manual cleaner approach: rewrite files completely from originals with sed-like
const files = [
  {
    file: 'tests/intent.test.ts',
    from: '../extension/intent',
    to: '@/shared/intent',
  },
  {
    file: 'tests/match.test.ts',
    from: '../extension/match',
    to: '@/shared/match',
  },
  {
    file: 'tests/agent.test.ts',
    from: '../extension/agent',
    to: '@/shared/agent',
  },
  {
    file: 'tests/leave.test.ts',
    from: '../extension/skills/leave',
    to: '@/shared/leave',
  },
];

for (const item of files) {
  let s = fs.readFileSync(item.file, 'utf8');
  s = s.replace(/const test = require\('node:test'\);\r?\n/, '');
  s = s.replace(/const assert = require\('node:assert\/strict'\);\r?\n/, '');
  s = s.replace(
    /const \{([\s\S]*?)\} = require\('([^']+)'\);/,
    `import {$1} from '${item.to}';`,
  );
  s = `import { expect, it } from 'vitest';\n${s}`;
  s = s.replace(/\btest\(/g, 'it(');
  s = s.replace(/assert\.equal\(([^,]+),\s*([^)]+)\)/g, 'expect($1).toBe($2)');
  s = s.replace(/assert\.deepEqual\(([^,]+),\s*([^)]+)\)/g, 'expect($1).toEqual($2)');
  s = s.replace(/assert\.ok\(([^)]+)\)/g, 'expect(Boolean($1)).toBe(true)');
  fs.writeFileSync(item.file, s);
  console.log('ok', item.file);
}
