import fs from 'fs';
import path from 'path';

function convertWaromIife(src) {
  const m = src.match(/\(function\s*\([^)]*\)\s*\{[\s\S]*?function\s*\(\)\s*\{([\s\S]*)\n\s*\}\);?\s*$/);
  if (!m) return null;
  const body = m[1];
  const ret = body.lastIndexOf('return {');
  if (ret < 0) return null;
  const before = body.slice(0, ret).trimEnd();
  const retObj = body.slice(ret + 'return {'.length).replace(/\}\s*;\s*$/, '').trim();
  return `// @ts-nocheck\n${before}\n\nexport {\n${retObj}\n};\n`;
}

function convertDeepseek(src) {
  const m = src.match(/const DeepSeek = \(function\s*\(\)\s*\{([\s\S]*)\}\)\(\);?\s*$/);
  if (!m) return null;
  const body = m[1];
  const ret = body.lastIndexOf('return {');
  const before = body.slice(0, ret).trimEnd();
  const retObj = body.slice(ret + 'return {'.length).replace(/\}\s*;\s*$/, '').trim();
  const keys = retObj
    .split(',')
    .map((s) => s.trim().replace(/,$/, ''))
    .filter(Boolean)
    .map((line) => line.split(/[:\s]/)[0].trim())
    .filter(Boolean);
  return `// @ts-nocheck\n${before}\n\nexport {\n${retObj}\n};\n\nconst DeepSeek = { ${keys.join(', ')} };\nexport default DeepSeek;\n`;
}

const pairs = [
  ['agent.js', 'src/shared/agent.ts'],
  ['habits.js', 'src/shared/habits.ts'],
];

for (const [from, to] of pairs) {
  const src = fs.readFileSync(from, 'utf8');
  const out = convertWaromIife(src);
  if (!out) {
    console.log('FAIL', from);
    continue;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, out);
  console.log('OK', to, out.length);
}

// tools.js uses factory(root)
{
  const src = fs.readFileSync('tools.js', 'utf8');
  const m = src.match(
    /\(function\s*\([^)]*\)\s*\{[\s\S]*?function\s*\(root\)\s*\{([\s\S]*)\n\s*\}\);?\s*$/,
  );
  if (!m) {
    console.log('FAIL tools.js');
  } else {
    const body = m[1];
    const ret = body.lastIndexOf('return {');
    let before = body.slice(0, ret).trimEnd();
    before = before
      .replace(/const Leave = root\.WaromLeaveSkill/g, 'const Leave = LeaveSkill')
      .replace(/const Agent = root\.WaromAgent/g, 'const Agent = AgentApi');
    const retObj = body.slice(ret + 'return {'.length).replace(/\}\s*;\s*$/, '').trim();
    const out = `// @ts-nocheck
import * as LeaveSkill from './leave';
import * as AgentApi from './agent';
${before}

export {
${retObj}
};
`;
    fs.writeFileSync('src/shared/tools.ts', out);
    console.log('OK src/shared/tools.ts', out.length);
  }
}

const ds = fs.readFileSync('deepseek.js', 'utf8');
const dsOut = convertDeepseek(ds);
if (dsOut) {
  fs.writeFileSync('src/shared/deepseek.ts', dsOut);
  console.log('OK deepseek', dsOut.length);
} else {
  console.log('FAIL deepseek');
}

for (const f of ['src/shared/match.ts', 'src/shared/intent.ts', 'src/shared/leave.ts']) {
  let t = fs.readFileSync(f, 'utf8');
  if (!t.includes('@ts-nocheck')) {
    fs.writeFileSync(f, `// @ts-nocheck\n${t}`);
  }
}
