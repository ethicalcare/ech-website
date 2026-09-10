import test from "node:test";
import assert from "node:assert/strict";
import { handleInquiry } from "../functions/api/inquiry.js";

const origin = "https://example.com";
const env = { INQUIRY_ENABLED: "true", INQUIRY_ORIGINS: origin, BREVO_API_KEY: "test-key", TURNSTILE_SECRET_KEY: "test-secret",
  TURNSTILE_SITE_KEY: "test-site", INQUIRY_FROM_EMAIL: "sender@example.com", INQUIRY_TO_EMAIL: "inbox@example.com" };
const input = { name: "Test visitor", contact: "visitor@example.com", location: "Coquitlam", message: "Delivery test only.", acknowledgement: true,
  website: "", requestId: "ae56af47-d419-49ce-8f57-46be6e8f3cab", token: "single-use-token" };
const request = (body = input, headers = {}) => new Request(`${origin}/api/inquiry`, { method: "POST",
  headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const verified = () => Response.json({ success: true, hostname: "example.com", action: "inquiry" });
const noNetwork = () => { throw new Error("Unexpected network call"); };

test("public configuration never reveals private credentials and fails closed", async () => {
  const r = await handleInquiry(new Request(`${origin}/api/inquiry`), env, noNetwork);
  assert.deepEqual(await r.json(), { ready: true, siteKey: "test-site" });
  assert.equal((await handleInquiry(request(), { ...env, INQUIRY_ENABLED: "false" }, noNetwork)).status, 503);
  assert.equal((await handleInquiry(request(), { ...env, BREVO_API_KEY: "" }, noNetwork)).status, 503);
});
test("rejects cross-origin, bad content type, invalid contact, absent consent and honeypot", async () => {
  for (const [req, status] of [[request(input, { origin: "https://other.example" }), 403], [request(input, { "content-type": "text/plain" }), 415],
    [request({ ...input, contact: "invalid" }), 422], [request({ ...input, acknowledgement: false }), 422],
    [request({ ...input, website: "spam" }), 422], [request(null), 422], [request({ ...input, name: "Header\r\nInjection" }), 422]]) {
    assert.equal((await handleInquiry(req, env, noNetwork)).status, status);
  }
});
test("bounds actual body size before validation", async () => {
  assert.equal((await handleInquiry(request({ ...input, message: "x".repeat(17000) }), env, noNetwork)).status, 413);
});
test("requires a verified single-use token for the same hostname and action", async () => {
  for (const result of [{ success: false }, { success: true, hostname: "other.example", action: "inquiry" },
    { success: true, hostname: "example.com", action: "other" }]) {
    let count = 0;
    const r = await handleInquiry(request(), env, async () => { count++; return Response.json(result); });
    assert.equal(r.status, 422); assert.equal(count, 1);
  }
});
test("sends only to the configured inbox with a validated reply-to", async () => {
  let count = 0;
  const r = await handleInquiry(request({ ...input, to: "attacker@example.com" }), env, async (url, options) => {
    if (count++ === 0) return verified();
    assert.equal(url, "https://api.brevo.com/v3/smtp/email");
    const email = JSON.parse(options.body);
    assert.deepEqual(email.to, [{ email: env.INQUIRY_TO_EMAIL }]);
    assert.equal(email.replyTo.email, input.contact);
    assert.equal(email.sender.email, env.INQUIRY_FROM_EMAIL);
    assert.equal(email.htmlContent, undefined);
    return Response.json({ messageId: "test-receipt" }, { status: 201 });
  });
  assert.equal(r.status, 201); assert.equal((await r.json()).ok, true); assert.equal(count, 2);
});
test("phone-only inquiry does not create an invalid reply-to", async () => {
  let count = 0;
  const r = await handleInquiry(request({ ...input, contact: "604-555-0100" }), env, async (url, options) => {
    if (count++ === 0) return verified();
    assert.equal(JSON.parse(options.body).replyTo, undefined);
    return Response.json({ messageId: "test-receipt" }, { status: 201 });
  });
  assert.equal(r.status, 201);
});
test("provider rejection never reports success or leaks credentials", async () => {
  let count = 0;
  const r = await handleInquiry(request(), env, async () => count++ === 0 ? verified() : Response.json({ message: env.BREVO_API_KEY }, { status: 403 }));
  assert.equal(r.status, 503); const body = await r.text(); assert.ok(!body.includes(env.BREVO_API_KEY)); assert.ok(!body.includes('"ok":true'));
});
test("timeouts and ambiguous provider responses discourage duplicate submission", async () => {
  for (const fail of [() => { throw new Error("timeout"); }, () => Response.json({}, { status: 500 }), () => Response.json({}, { status: 201 })]) {
    let count = 0;
    const r = await handleInquiry(request(), env, async () => count++ === 0 ? verified() : fail());
    assert.equal(r.status, 502); assert.equal((await r.json()).uncertain, true);
  }
});
test("replayed verification cannot send a second email", async () => {
  let verifiedOnce = false, sent = 0;
  const fetcher = async url => {
    if (url.includes("siteverify")) { if (verifiedOnce) return Response.json({ success: false }); verifiedOnce = true; return verified(); }
    sent++; return Response.json({ messageId: "receipt" }, { status: 201 });
  };
  assert.equal((await handleInquiry(request(), env, fetcher)).status, 201);
  assert.equal((await handleInquiry(request(), env, fetcher)).status, 422);
  assert.equal(sent, 1);
});
