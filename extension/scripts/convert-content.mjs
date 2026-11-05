import fs from 'fs';

let src = fs.readFileSync('content.js', 'utf8');
// strip outer IIFE guard
src = src.replace(
  /^\(function\s*\(\)\s*\{\s*if\s*\(globalThis\.__waromAgentLoaded\)\s*return;\s*globalThis\.__waromAgentLoaded\s*=\s*true;\s*/,
  '',
);
src = src.replace(/\n\}\)\(\);\s*$/, '\n');

src = src
  .replace(/WaromMatch\./g, 'Match.')
  .replace(/WaromIntent\./g, 'Intent.')
  .replace(/WaromLeaveSkill/g, 'Leave')
  .replace(/WaromAgent\./g, 'Agent.')
  .replace(/WaromTools\./g, 'Tools.')
  .replace(/WaromHabits/g, 'Habits')
  .replace(/typeof WaromLeaveSkill/g, 'typeof Leave')
  .replace(/typeof Leave !== 'undefined'/g, 'true')
  .replace(/typeof Habits !== 'undefined'/g, 'true');

const header = `// @ts-nocheck
import * as Match from '@/shared/match';
import * as Intent from '@/shared/intent';
import * as Leave from '@/shared/leave';
import * as Agent from '@/shared/agent';
import * as Tools from '@/shared/tools';
import * as Habits from '@/shared/habits';
import { MSG } from '@/shared/types';

`;

// Replace message type string literals with MSG where obvious
src = src
  .replace(/type:\s*'warom-get-settings'/g, 'type: MSG.getSettings')
  .replace(/type:\s*'warom-ai-decide'/g, 'type: MSG.aiDecide')
  .replace(/type:\s*'warom-ai-chat'/g, 'type: MSG.aiChat')
  .replace(/type:\s*'warom-ai-fill-form'/g, 'type: MSG.aiFillForm')
  .replace(/type:\s*'warom-ai-reflect'/g, 'type: MSG.aiReflect')
  .replace(/type:\s*'warom-open-options'/g, 'type: MSG.openOptions')
  .replace(/type:\s*'warom-run'/g, 'type: MSG.run')
  .replace(/message\.type !== 'warom-run'/g, 'message.type !== MSG.run');

const out = `${header}${src}

export {
  handleUtterance,
  acceptLeaveConfirm,
  delay,
  waitFor,
};
`;

fs.writeFileSync('src/content/legacy-runner.ts', out);
console.log('wrote legacy-runner', out.length);
