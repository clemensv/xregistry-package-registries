const fs = require('fs');
const path = require('path');

/**
 * Parse inline query parameters into array of paths
 * @param {string|string[]} inlineParam - Inline parameter value from query string
 * @returns {string[]} Array of paths to inline
 */
function parseInlineParams(inlineParam) {
  if (!inlineParam) return [];
  const arr = Array.isArray(inlineParam) ? inlineParam : [inlineParam];
  return arr.reduce((acc, v) => acc.concat(v.split(',')), [])
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Basic inline handler for xRegistry - replaced with registry-specific implementations
 * This is only used as a fallback - each registry should implement its own handleInlineFlag
 * to avoid hardcoded paths and allow for proper error handling
 * 
 * @param {object} req - Express request object
 * @param {object} data - Data object to modify
 * @param {string} registryType - Type of registry (npm, nuget, pypi, maven, oci)
 * @param {object} logger - Logger instance for error reporting
 * @returns {object} Modified data object with inlined content
 */
function handleInlineFlag(req, data, registryType = 'npm', logger = console) {
  const paths = parseInlineParams(req.query.inline);
  if (!paths.length) return data;
  const inlineAll = paths.includes('*');
  
  // Load model if requested
  if (inlineAll || paths.includes('model')) {
    try {
      // Use registry-specific model path if provided, otherwise use npm as fallback
      const modelDir = registryType || 'npm';
      const modelPath = path.join(__dirname, '..', modelDir, 'model.json');
      data.model = JSON.parse(fs.readFileSync(modelPath, 'utf8')).model;
    } catch (error) {
      logger.error ? logger.error("Error loading model for inline", { error: error.message }) : 
                    logger.log("Error loading model for inline: " + error.message);
    }
  }
  
  // Add capabilities if requested (should be provided by the registry)
  if (inlineAll || paths.includes('capabilities')) {
    // Each registry should handle capabilities in their implementation
  }
  
  // Include groups if requested
  if (inlineAll || paths.includes('endpoints') || paths.includes('groups')) {
    if (data.groups && typeof data.groups === 'string') {
      try {
        const registryDir = registryType || 'npm';
        const registryModel = JSON.parse(
          fs.readFileSync(path.join(__dirname, '..', registryDir, 'model.json'), 'utf8')
        ).model;
        data.groups = registryModel.groups;
      } catch (error) {
        logger.error ? logger.error("Error loading groups for inline", { error: error.message }) : 
                       logger.log("Error loading groups for inline: " + error.message);
      }
    }
  }
  
  return data;
}

module.exports = { parseInlineParams, handleInlineFlag };