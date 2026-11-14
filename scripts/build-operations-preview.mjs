import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [directory] = process.argv.slice(2);
if (!directory) throw new Error('Provide the output directory for the standalone schedule script.');

const runtime = await readFile(new URL('../admin-src/app/shared/named-runtime.js', import.meta.url), 'utf8');
const startMarker = "'use strict';\n// Fictional, browser-memory design.";
const endMarker = "\n'use strict';\n(function(global){";
const start = runtime.indexOf(startMarker);
const end = runtime.indexOf(endMarker, start + startMarker.length);

if (start < 0 || end < 0 || runtime.lastIndexOf(startMarker) !== start ||
    runtime.lastIndexOf(endMarker) !== end) {
  throw new Error('Could not identify the standalone schedule in the hosted runtime.');
}

const schedule = runtime.slice(start, end) + '\n';
const output = resolve(directory, 'schedule-review.js');
await mkdir(resolve(directory), { recursive: true });
await writeFile(output, schedule);
console.log(createHash('sha256').update(schedule).digest('hex'));
