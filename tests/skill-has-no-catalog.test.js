const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const skillDir = path.join(process.env.USERPROFILE, '.cursor', 'skills', 'warom-open-workflow');

const forbidden = [
  '请假申请',
  'AttendanceLeave',
  '内部留言',
  'InternalMessage',
  '补考勤',
  'SigninRecords',
  '通用流程',
  '00001',
  '00003',
  '00004',
  '00005',
];

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(fullPath);
    return [fullPath];
  });
}

test('技能目录不保存流程名称和代码对照', () => {
  const hits = [];
  for (const file of listFiles(skillDir)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const word of forbidden) {
      if (text.includes(word)) hits.push(`${file} 含有 ${word}`);
    }
  }
  assert.deepEqual(hits, []);
});
