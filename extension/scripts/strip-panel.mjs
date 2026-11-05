import fs from 'fs';

let s = fs.readFileSync('src/content/legacy-runner.ts', 'utf8');
const start = s.indexOf('  function mountPanel()');
const end = s.indexOf('  chrome.runtime.onMessage');
if (start < 0 || end < 0) {
  console.error('markers', start, end);
  process.exit(1);
}
s = s.slice(0, start) + s.slice(end);
s = s.replace(/\nmountPanel\(\);\s*\n/g, '\n');
s = s.replace(
  /export \{[\s\S]*?\};/,
  `export {
  handleUtterance,
  confirmLeaveSubmit,
  delay,
  waitFor,
};
`,
);
fs.writeFileSync('src/content/legacy-runner.ts', s);
console.log('ok', s.length, 'hasMount', s.includes('mountPanel'));
