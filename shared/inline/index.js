const fs = require('fs');
const path = require('path');

// Parse inline query parameters into array of paths
function parseInlineParams(inlineParam) {
  if (!inlineParam) return [];
  const arr = Array.isArray(inlineParam) ? inlineParam : [inlineParam];
  return arr.reduce((acc, v) => acc.concat(v.split(',')), [])
    .map(s => s.trim())
    .filter(Boolean);
}

// Basic inline handler for xRegistry
function handleInlineFlag(req, data) {
  const paths = parseInlineParams(req.query.inline);
  if (!paths.length) return data;
  const inlineAll = paths.includes('*');
  if (inlineAll || paths.includes('model')) {
    const modelPath = path.join(__dirname, '..', 'npm', 'model.json');
    try { data.model = JSON.parse(fs.readFileSync(modelPath, 'utf8')).model; } catch {};
  }
  if (inlineAll || paths.includes('capabilities')) {
    // capabilities already on data.capabilities
  }
  if (inlineAll || paths.includes('endpoints') || paths.includes('groups')) {
    if (data.groups && typeof data.groups === 'string') {
      try {
        const registryModel = JSON.parse(
          fs.readFileSync(path.join(__dirname, '..', 'npm', 'model.json'), 'utf8')
        ).model;
        data.groups = registryModel.groups;
      } catch {};
    }
  }
  return data;
}

module.exports = { parseInlineParams, handleInlineFlag };