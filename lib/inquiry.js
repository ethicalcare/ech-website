const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export function validate(input) {
  const fields = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { fields: { name: 'Please complete the form.' } };
  const value = (key) => typeof input[key] === 'string' ? input[key].trim() : '';
  const data = Object.fromEntries(['name', 'contact', 'location', 'message'].map(k => [k, value(k)]));
  if (!data.name || data.name.length > 100 || /[\r\n\x00-\x1f]/.test(data.name)) fields.name = 'Please enter a name of up to 100 characters.';
  const isEmail = EMAIL.test(data.contact) && data.contact.length <= 254;
  const isPhone = /^\+?[\d\s().-]+(?:\s*(?:x|ext\.?)\s*\d{1,6})?$/i.test(data.contact) && data.contact.replace(/\D/g, '').length >= 10 && data.contact.replace(/\D/g, '').length <= 21 && data.contact.length <= 60;
  if (!isEmail && !isPhone) fields.contact = 'Enter an email address or a phone number with an area code.';
  if (data.location.length > 100 || /[\r\n\x00-\x1f]/.test(data.location)) fields.location = 'Please enter a city of up to 100 characters.';
  if (!data.message || data.message.length > 2000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(data.message)) fields.message = 'Please enter a short message of up to 2,000 characters.';
  if (input.acknowledgement !== true) fields.acknowledgement = 'Please confirm that this message is not for urgent clinical advice.';
  return { data, fields, isEmail };
}
export function composeEmail(data, c, reference, isEmail) {
  const textContent = [
    'A general website inquiry needs follow-up.', `Reference: ${reference}`, '',
    `Name: ${data.name}`, `Phone or email: ${data.contact}`, `General location: ${data.location || 'Not provided'}`, '',
    'Message:', data.message, '', 'The visitor acknowledged that this message is not for emergencies or urgent clinical advice.'
  ].join('\n');
  return { sender: { name: 'Ethical Care', email: c.from }, to: [{ email: c.to }],
    ...(isEmail ? { replyTo: { email: data.contact, name: data.name } } : {}),
    subject: `Website inquiry ${reference}`, textContent, tags: ['website-inquiry'] };
}
