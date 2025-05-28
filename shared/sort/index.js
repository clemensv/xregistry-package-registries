// Generic xRegistry sort utilities

// Parse sort parameter ATTRIBUTE[=asc|desc]
function parseSortParam(sortStr) {
  if (!sortStr) return { attribute: null, order: 'asc' };
  const [attr, ord] = sortStr.split('=');
  const order = ord && ord.toLowerCase() === 'desc' ? 'desc' : 'asc';
  return { attribute: attr, order };
}

// Get nested attribute value
function getNestedValue(obj, path) {
  if (typeof obj !== 'object' || obj === null) return undefined;
  return path.split('.').reduce((o, key) => (o && key in o ? o[key] : undefined), obj);
}

// Compare two values (string case-insensitive or number)
function compareValues(a, b) {
  if (a == null && b != null) return -1;
  if (a != null && b == null) return 1;
  if (a == null && b == null) return 0;
  const na = typeof a === 'string' ? a.toLowerCase() : a;
  const nb = typeof b === 'string' ? b.toLowerCase() : b;
  if (na < nb) return -1;
  if (na > nb) return 1;
  return 0;
}

// Apply sorting to an array of entities or strings
function applySortFlag(sortStr, items) {
  const { attribute, order } = parseSortParam(sortStr);
  const sorted = [...items];
  sorted.sort((a, b) => {
    let va, vb;
    if (attribute) {
      va = typeof a === 'object' ? getNestedValue(a, attribute) : (attribute === 'name' ? a : undefined);
      vb = typeof b === 'object' ? getNestedValue(b, attribute) : (attribute === 'name' ? b : undefined);
    } else {
      va = typeof a === 'string' ? a : (a.name || a.id);
      vb = typeof b === 'string' ? b : (b.name || b.id);
    }
    let cmp = compareValues(va, vb);
    if (cmp === 0) {
      const ia = typeof a === 'string' ? a : (a.id || a.name);
      const ib = typeof b === 'string' ? b : (b.id || b.name);
      cmp = compareValues(ia, ib);
    }
    return order === 'asc' ? cmp : -cmp;
  });
  return sorted;
}

module.exports = { parseSortParam, applySortFlag };
