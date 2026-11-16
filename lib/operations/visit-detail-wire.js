export const VISIT_DETAIL_MAX_BYTES = 16_384;

const fields = new Set(['address', 'unit', 'entry', 'preferences', 'contact']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const text = value => typeof value === 'string' && value.length <= 1000
  && Boolean(value.trim()) && !/[\p{Cc}]/u.test(value);
const phone = value => typeof value === 'string' && value === value.trim() && /^\+[1-9][0-9]{6,14}$/u.test(value);

function isContact(value) {
  return exact(value, ['name', 'phone', 'purpose']) && text(value.name)
    && (value.phone === null || phone(value.phone)) && value.purpose === 'visit_logistics';
}

/** Both the API and client reject any unexpected provider fields. */
export function isVisitDetail(value, visitId, revision) {
  if (!exact(value, ['visitId', 'revision', 'fields', 'contactAuthority', 'allergyStatus'])
    || value.visitId !== visitId || value.revision !== revision || !record(value.fields)
    || value.contactAuthority !== 'unknown' || value.allergyStatus !== 'unknown') return false;
  return Object.entries(value.fields).every(([field, detail]) => fields.has(field)
    && (field === 'contact' ? isContact(detail) : text(detail)));
}
