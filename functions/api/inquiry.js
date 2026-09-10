import { validate, composeEmail } from "../../lib/inquiry.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
});

export async function handleInquiry(request, env, fetcher = fetch) {
  const origin = new URL(request.url).origin;
  const allowed = (env.INQUIRY_ORIGINS || "").split(",").map(s => s.trim());
  const ready = env.INQUIRY_ENABLED === "true" && allowed.includes(origin) &&
    !!(env.BREVO_API_KEY && env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY && env.INQUIRY_FROM_EMAIL && env.INQUIRY_TO_EMAIL);
  if (request.method === "GET") return json(200, { ready, siteKey: ready ? env.TURNSTILE_SITE_KEY : null });
  if (request.method !== "POST") return json(405, { error: "Please use the contact form." });
  if (!ready) return json(503, { error: "Online inquiries are unavailable right now. Please call 778-903-5683 or email info@ethicalcarehome.ca." });
  if (request.headers.get("origin") !== origin) return json(403, { error: "Please open the form on the Ethical Care website." });
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return json(415, { error: "Please use the contact form." });
  let input;
  try {
    const reader = request.body?.getReader();
    if (!reader) return json(400, { error: "Please complete the form." });
    const chunks = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) { await reader.cancel(); return json(413, { error: "Please keep your message brief." }); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    input = JSON.parse(new TextDecoder().decode(bytes));
  } catch { return json(400, { error: "We could not read this form. Please try again." }); }
  const { data, fields, isEmail } = validate(input);
  if (Object.keys(fields).length) return json(422, { error: Object.values(fields)[0], fields });
  if (input.website || !UUID.test(input.requestId || "")) return json(422, { error: "Please refresh the page and try again." });
  if (typeof input.token !== "string" || !input.token || input.token.length > 2048) return json(422, { error: "Please complete the security check.", resetVerification: true });
  try {
    const response = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: input.token })
    });
    const verified = await response.json();
    if (!response.ok || !verified.success || verified.hostname !== new URL(origin).hostname || verified.action !== "inquiry") {
      return json(422, { error: "Please complete the security check again.", resetVerification: true });
    }
  } catch { return json(503, { error: "The security check is unavailable. Please try again or call 778-903-5683.", resetVerification: true }); }
  // Single-use verification prevents replaying a submission, including across server instances.
  const reference = `ECH-${input.requestId}`;
  const email = composeEmail(data, { from: env.INQUIRY_FROM_EMAIL, to: env.INQUIRY_TO_EMAIL }, reference, isEmail);
  const uncertain = () => json(502, { uncertain: true, reference,
    error: `We could not confirm whether your inquiry was submitted. Please call 778-903-5683 and quote ${reference} before sending it again.` });
  try {
    const response = await fetcher("https://api.brevo.com/v3/smtp/email", {
      method: "POST", headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", "Accept": "application/json" },
      signal: AbortSignal.timeout(12000), body: JSON.stringify(email)
    });
    const receipt = await response.json().catch(() => ({}));
    if (response.status === 201 && typeof receipt.messageId === "string" && receipt.messageId) {
      return json(201, { ok: true, reference, message: "Thank you. Your inquiry has been submitted. Ethical Care will use the phone number or email you provided to follow up." });
    }
    if ([400, 401, 402, 403, 422, 429].includes(response.status)) return json(503, {
      error: "We could not submit your inquiry. Your details are still here. Please call 778-903-5683 or email info@ethicalcarehome.ca.", resetVerification: true
    });
    return uncertain();
  } catch { return uncertain(); }
}

export const onRequest = ({ request, env }) => handleInquiry(request, env);
