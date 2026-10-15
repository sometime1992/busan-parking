export function clean(value) {
  const text = String(value ?? '').trim();
  return !text || ['-', 'null', 'undefined'].includes(text.toLowerCase()) ? null : text;
}
export function count(value) {
  const text = clean(value);
  if (text === null) return null;
  const n = Number(text.replace(/,/g, ''));
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
export function normalizeName(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/공영주차장|공영|도시철도/g, '').replace(/[\s(),，（）]/g, '');
}
