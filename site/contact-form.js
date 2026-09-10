(() => {
  const form = document.querySelector("[data-contact-form]");
  if (!form) return;
  const status = form.querySelector("[data-contact-form-status]");
  const button = form.querySelector('button[type="submit"]');
  const verification = form.querySelector("[data-verification]");
  let widget, token = "", sending = false, finished = false;
  const requestId = crypto.randomUUID();
  const say = message => { status.textContent = message; };
  const enable = () => { button.disabled = !token || sending || finished; };
  const reset = () => { token = ""; if (widget !== undefined) window.turnstile.reset(widget); enable(); };
  const unavailable = () => say("The online form is unavailable right now. Please call 778-903-5683 or email info@ethicalcarehome.ca using the links above.");
  button.disabled = true;
  fetch("/api/inquiry", { cache: "no-store" }).then(async response => {
    if (!response.ok) throw new Error();
    const config = await response.json();
    if (!config.ready || !config.siteKey) throw new Error();
    window.contactVerificationReady = () => {
      widget = window.turnstile.render(verification, {
        sitekey: config.siteKey, action: "inquiry", theme: "light", size: "flexible",
        callback: value => { token = value; say(""); enable(); },
        "expired-callback": () => { token = ""; say("Please complete the security check again."); enable(); },
        "error-callback": () => { token = ""; say("The security check could not load. Please try reloading the page, or use the phone or email links above."); enable(); }
      });
    };
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=contactVerificationReady&render=explicit";
    script.async = true; script.onerror = unavailable;
    document.head.append(script);
  }).catch(unavailable);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (sending || finished || !token || !form.reportValidity()) return;
    const data = new FormData(form);
    const payload = Object.fromEntries(["name", "contact", "location", "message", "website"].map(key => [key, String(data.get(key) || "").trim()]));
    payload.acknowledgement = data.get("acknowledgement") === "on";
    payload.requestId = requestId; payload.token = token;
    sending = true; enable(); button.textContent = "Sending…";
    form.setAttribute("aria-busy", "true"); say("Sending your inquiry…");
    for (const field of form.elements) field.removeAttribute("aria-invalid");
    try {
      const response = await fetch("/api/inquiry", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(25000) });
      const result = await response.json();
      if (response.status === 201 && result.ok === true) {
        finished = true; form.reset(); say(`${result.message} Reference: ${result.reference}`);
      } else {
        if (!result.error || ![400, 403, 405, 413, 415, 422, 502, 503].includes(response.status)) throw new Error();
        say(result.error || "We could not submit your inquiry. Please call 778-903-5683.");
        if (result.uncertain) finished = true;
        else {
          reset();
          for (const key of Object.keys(result.fields || {})) form.elements.namedItem(key)?.setAttribute("aria-invalid", "true");
        }
      }
    } catch {
      finished = true;
      say(`We could not confirm whether your inquiry was submitted. Please call 778-903-5683 and quote ECH-${requestId} before sending it again.`);
    } finally {
      sending = false; enable(); form.removeAttribute("aria-busy"); button.textContent = "Send inquiry";
      status.focus();
    }
  });
})();
