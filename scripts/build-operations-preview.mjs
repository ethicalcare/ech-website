import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [directory] = process.argv.slice(2);
if (!directory) throw new Error('Provide the output directory for the standalone schedule script.');

const runtime = await readFile(new URL('../admin-src/app/shared/named-runtime.js', import.meta.url), 'utf8');
const markers = [
  "'use strict';\nconst $ =",
  "'use strict';\n// Fictional, browser-memory design.",
  "'use strict';\n(function(global){",
  "'use strict';\n// The named design stays separate",
];
const positions = markers.map(marker => runtime.indexOf(marker));
if (positions.some((position, index) => position < 0 || runtime.lastIndexOf(markers[index]) !== position ||
    (index > 0 && position <= positions[index - 1]))) {
  throw new Error('Could not identify the standalone preview scripts in the hosted runtime.');
}
const [base, schedule, core, persistence] = positions;
const persistenceEnd = runtime.indexOf('\n})();', persistence);
if (persistenceEnd < 0) throw new Error('Could not identify the end of the preview persistence script.');
const key = "'ech-named-design:fictional-saved-v1'";
function replaceOnce(source, from, to) {
  const position = source.indexOf(from);
  if (position < 0 || source.lastIndexOf(from) !== position) throw new Error('Unexpected preview storage configuration.');
  return source.replace(from, to);
}
const files = {
  'prototype.js': runtime.slice(base, schedule),
  'schedule-review.js': runtime.slice(schedule, core),
  'demo-persistence-core.js': replaceOnce(runtime.slice(core, persistence), 'const KEY=storageKey;', `const KEY=${key};`),
  'demo-persistence.js': replaceOnce(runtime.slice(persistence, persistenceEnd + '\n})();'.length), 'const key=storageKey;', `const key=${key};`) + '\n',
};
await mkdir(resolve(directory), { recursive: true });
for (const [name, source] of Object.entries(files)) {
  await writeFile(resolve(directory, name), source);
  console.log(`${name} ${createHash('sha256').update(source).digest('hex')}`);
}
