import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
// CSS/markup contract only. Native viewport, sticky behavior and touch acceptance
// require the separate browser fixture; this does not claim layout measurement.
test('selected visit uses a scoped narrow scroll panel while desktop remains inline',async()=>{
 const css=await readFile(new URL('../admin-src/app/shared/shared-visit-details.css',import.meta.url),'utf8');
 const source=await readFile(new URL('../admin-src/app/shared/SharedVisitRead.tsx',import.meta.url),'utf8');
 assert.match(source,/className="panel dashboard-card shared-visit-details"/);
 assert.match(source,/className="shared-visit-details__heading"[\s\S]*Close visit details<\/button><\/header>/);
 assert.match(css,/@media\(max-width:700px\)\{[\s\S]*max-height:calc\(100dvh - 48px\);overflow-y:auto;overscroll-behavior-y:auto;/);
 assert.match(css,/@media\(max-width:700px\)\{[\s\S]*position:sticky;top:0;/);
 assert.doesNotMatch(css,/position:fixed|overscroll-behavior-y:contain|overflow:hidden/);
 assert.doesNotMatch(css.slice(0,css.indexOf('@media')),/max-height|position:sticky/);
});
