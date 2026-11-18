import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Exercise the actual hook with deterministic effects, clock and browser lifecycle.
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../admin-src/app/shared/AccessRequests.tsx', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
  plugins: [{name: 'hook-runtime', setup(builder) {
    builder.onResolve({filter: /^react$/}, () => ({path: 'react', namespace: 'hooks'}));
    builder.onLoad({filter: /.*/, namespace: 'hooks'}, () => ({contents: `
      export const useRef = value => globalThis.accountHooks.ref(value);
      export const useState = value => globalThis.accountHooks.state(value);
      export const useCallback = (fn, deps) => globalThis.accountHooks.callback(fn, deps);
      export const useEffect = (fn, deps) => globalThis.accountHooks.effect(fn, deps);
      export const useId = () => 'test';
    `}));
  }}],
});
const {useAccountRequests} = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('opening Accounts refreshes stale lists immediately, without duplicate or hidden requests', async () => {
  const original = {document: globalThis.document, window: globalThis.window, now: Date.now};
  const slots = []; let cursor = 0; let effects = []; let now = 120_000; let calls = 0; const signals = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((v,i) => Object.is(v,b[i]));
  globalThis.accountHooks = {
    ref(value) {const i=cursor++; return slots[i] ||= {current:value};},
    state(value) {const i=cursor++; slots[i] ||= {value}; return [slots[i].value, v => {slots[i].value=v;}];},
    callback(fn,deps) {const i=cursor++; if (!same(slots[i]?.deps,deps)) slots[i]={value:fn,deps}; return slots[i].value;},
    effect(fn,deps) {const i=cursor++; if (!same(slots[i]?.deps,deps)) effects.push(() => {slots[i]?.cleanup?.(); slots[i]={deps,cleanup:fn()};});},
  };
  globalThis.document = {visibilityState:'visible', addEventListener(){}, removeEventListener(){}};
  globalThis.window = {setInterval(){return 1;},clearInterval(){}};
  Date.now = () => now;
  let finish;
  const fetcher = async (_url, options) => {calls++; const requestNumber=calls; signals.push(options.signal); await new Promise(resolve => {finish=resolve;}); return new Response(JSON.stringify({schema:1,items:[{userId:'10000000-0000-4000-8000-000000000001',email:`read${requestNumber}@example.test`,displayName:'Fictional account',state:'pending',role:null,revision:requestNumber,requestedAt:'2026-11-17T12:00:00Z',decidedAt:null}]}), {status:200,headers:{'content-type':'application/json'}});};
  const render = (open, scope = 'owner-scope') => {cursor=0; effects=[]; const value=useAccountRequests(fetcher,scope,open); effects.forEach(fn=>fn()); return value;};
  const settle = async () => {finish(); await new Promise(resolve=>setImmediate(resolve));};
  try {
    render(false); assert.equal(calls,1); await settle();
    render(true); assert.equal(calls,1,'fresh initial list is reused');
    render(false); now += 60_001;
    render(true); assert.equal(calls,2,'stale list reloads on opening, not one minute later');
    render(false); render(true); assert.equal(calls,2,'opening during a request reuses it');
    const oldFinish = finish;
    const postWriteRefresh = render(true).reload();
    assert.equal(calls,3,'verified mutation/manual refresh starts a newer GET, not the old background GET');
    assert.equal(signals[1].aborted,true,'older background request is cancelled');
    oldFinish(); await new Promise(resolve=>setImmediate(resolve));
    assert.equal(render(true).state.status,'loading','old response cannot publish stale rows');
    await settle(); await postWriteRefresh;
    assert.equal(render(true).state.status,'ready','new post-write response is published');
    render(false); now += 60_001; document.visibilityState='hidden';
    render(true); assert.equal(calls,3,'hidden tab does not issue a new request');
    document.visibilityState='visible';
    render(false).reload(); assert.equal(calls,4);
    const priorScopeFinish=finish;
    assert.equal(render(false,'new-owner-scope').state.status,'loading');
    assert.equal(calls,5,'new scope starts immediately without waiting for aborted old transport');
    assert.equal(signals[3].aborted,true);
    await settle();
    assert.equal(render(false,'new-owner-scope').state.status,'ready');
    priorScopeFinish();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(render(false,'new-owner-scope').state.status,'ready','late old-scope response cannot replace new snapshot');
    assert.equal(render(false,'new-owner-scope').state.rows[0].email,'read5@example.test');
    assert.equal(calls,5,'settling old transport does not schedule another read');
  } finally {
    slots.forEach(slot=>slot?.cleanup?.());
    Date.now=original.now; globalThis.document=original.document; globalThis.window=original.window;
    delete globalThis.accountHooks;
  }
});
