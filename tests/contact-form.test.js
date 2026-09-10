import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../site/contact-form.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

for (const uncertain of [false, true]) {
  test(`widget callbacks preserve ${uncertain ? 'uncertain' : 'successful'} submission state`, async () => {
    const status = { textContent: '', focus() {} };
    const button = { disabled: true };
    let submit, widgetOptions, resolveSubmission, requests = 0, cleared = false;
    const form = {
      elements: [], reportValidity: () => true, setAttribute() {}, removeAttribute() {},
      reset() { cleared = true; },
      addEventListener(name, handler) { if (name === 'submit') submit = handler; },
      querySelector(selector) { return selector.includes('status') ? status : selector.includes('submit') ? button : {}; }
    };
    const window = { turnstile: {
      render(element, options) { widgetOptions = options; return 1; }, reset() {}
    } };
    runInNewContext(source, {
      window, document: { querySelector: () => form, createElement: () => ({}), head: { append() {} } },
      crypto: { randomUUID: () => '076e80f3-1ceb-4868-9a3a-432aa5f9cfcb' },
      AbortSignal, FormData: class { get(key) { return key === 'acknowledgement' ? 'on' : 'Test'; } },
      fetch: async (url, options) => {
        if (!options.method) return { ok: true, json: async () => ({ ready: true, siteKey: 'test' }) };
        requests++;
        return new Promise(resolve => { resolveSubmission = resolve; });
      }
    });
    await tick();
    window.contactVerificationReady();
    widgetOptions.callback('test-token');
    assert.equal(button.disabled, false);
    const pending = submit({ preventDefault() {} });
    const during = status.textContent;
    widgetOptions['expired-callback']();
    widgetOptions['error-callback']();
    widgetOptions.callback('late-token');
    assert.equal(status.textContent, during);
    assert.equal(button.disabled, true);
    resolveSubmission({ status: uncertain ? 502 : 201, json: async () => uncertain
      ? { uncertain: true, error: 'Please call before resubmitting.' }
      : { ok: true, message: 'Your inquiry has been submitted.', reference: 'test-reference' } });
    await pending;
    const final = status.textContent;
    assert.match(final, uncertain ? /call before resubmitting/ : /submitted/);
    widgetOptions['expired-callback']();
    widgetOptions['error-callback']();
    widgetOptions.callback('late-token');
    assert.equal(status.textContent, final);
    assert.equal(button.disabled, true);
    assert.equal(cleared, !uncertain);
    await submit({ preventDefault() {} });
    assert.equal(requests, 1);
  });
}
