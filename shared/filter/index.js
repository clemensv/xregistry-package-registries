// Generic xRegistry filter utilities

// Parse filter expressions like ATTRIBUTE, ATTRIBUTE=VALUE, ATTRIBUTE<VALUE, etc.
function parseFilterExpression(filterStr) {
  const expressions = [];
  const parts = filterStr.split(',');
  for (const part of parts) {
    const match = part.match(/^(.+?)(!=|<>|>=|<=|=|<|>)(.*)$/);
    if (match) {
      const [, attribute, operator, value] = match;
      expressions.push({ attribute, operator, value });
    } else {
      expressions.push({ attribute: part, operator: 'exists', value: null });
    }
  }
  return expressions;
}

// Get nested attribute value by path (e.g. labels.stage)
function getNestedValue(obj, path) {
  return path.split('.').reduce((o, key) => (o && key in o ? o[key] : undefined), obj);
}

// Compare attribute value against filter value with operator
function compareValues(attrValue, filterValue, operator) {
  if (operator === 'exists') {
    return attrValue != null;
  }
  if (operator === '=') {
    return String(attrValue).toLowerCase() === String(filterValue).toLowerCase();
  }
  if (operator === '!=' || operator === '<>') {
    return String(attrValue).toLowerCase() !== String(filterValue).toLowerCase();
  }
  if (['<','<=','>','>='].includes(operator)) {
    const a = typeof attrValue === 'number' ? attrValue : Number(attrValue);
    const b = Number(filterValue);
    if (isNaN(a) || isNaN(b)) return false;
    switch (operator) {
      case '<': return a < b;
      case '<=': return a <= b;
      case '>': return a > b;
      case '>=': return a >= b;
    }
  }
  return false;
}

// Apply xRegistry filter with name constraint then other conditions
// getEntityValue: optional function to extract comparable value from entity (e.g., string packageName)
async function applyXRegistryFilterWithNameConstraint(filterParams, entities, req, getEntityValue = e => e) {
  const filterArray = Array.isArray(filterParams) ? filterParams : [filterParams];
  let results = [];
  for (const filterParam of filterArray) {
    const expressions = parseFilterExpression(filterParam);
    const nameExpr = expressions.filter(e => e.attribute === 'name');
    // Use getEntityValue for name comparison
    let subset = entities.filter(e => nameExpr.every(expr =>
      compareValues(getEntityValue(e), expr.value, expr.operator)
    ));
    const otherExpr = expressions.filter(e => e.attribute !== 'name');
    if (otherExpr.length) {
      subset = subset.filter(entity => otherExpr.every(expr => {
        const val = getNestedValue(entity, expr.attribute);
        return compareValues(val, expr.value, expr.operator);
      }));
    }
    results = results.concat(subset);
  }
  return Array.from(new Set(results));
}

module.exports = { parseFilterExpression, getNestedValue, compareValues, applyXRegistryFilterWithNameConstraint };