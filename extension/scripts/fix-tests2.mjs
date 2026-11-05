import fs from 'fs';

const specs = [
  {
    file: 'tests/intent.test.ts',
    importPath: '@/shared/intent',
  },
  {
    file: 'tests/match.test.ts',
    importPath: '@/shared/match',
  },
  {
    file: 'tests/agent.test.ts',
    importPath: '@/shared/agent',
  },
  {
    file: 'tests/leave.test.ts',
    importPath: '@/shared/leave',
  },
];

for (const spec of specs) {
  let s = fs.readFileSync(spec.file, 'utf8');
  s = s.replace(/const test = require\('node:test'\);\r?\n/, '');
  s = s.replace(/const assert = require\('node:assert\/strict'\);\r?\n/, "import assert from 'node:assert/strict';\n");
  s = s.replace(
    /const \{([\s\S]*?)\} = require\('[^']+'\);/,
    `import {$1} from '${spec.importPath}';`,
  );
  s = `import { it } from 'vitest';\n${s}`;
  s = s.replace(/\btest\(/g, 'it(');
  fs.writeFileSync(spec.file, s);
  console.log('ok', spec.file);
}
