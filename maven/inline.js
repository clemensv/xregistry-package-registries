/**
 * Custom implementation of handleInlineFlag for Maven registry
 * This adds proper error handling and logging
 * 
 * @param {object} req - Express request object
 * @param {object} data - Data object to modify
 * @param {string} resourceType - Optional resource type for special handling
 * @param {object} metaObject - Optional meta object to include
 * @returns {object} Modified data object with inlined content
 */
function handleInlineFlag(req, data, resourceType = null, metaObject = null) {
  const logger = req.logger || console;
  
  // For specific resource types, we have custom handling
  const inlineParam = req.query.inline;
  
  if (resourceType) {
    // Handle inline=true for specific resource types (versions, etc.)
    if (inlineParam === 'true' && data[`${resourceType}url`]) {
      // Currently not implemented - would fetch and include the referenced resource
      // For now, we add a header to indicate this isn't fully supported
      req.res && req.res.set('Warning', '299 - "Inline flag partially supported"');
    }
    
    // Handle meta inlining for resources
    if (inlineParam === 'true' || inlineParam === 'meta') {
      if (metaObject && data.metaurl) {
        // Include meta object
        data.meta = metaObject;
      }
    }
    
    return data;
  }
  
  // Skip if inline is not specified at all
  if (!inlineParam) {
    return data;
  }
  
  // Custom inline handling for all endpoints
  const { parseInlineParams } = require('../shared/inline');
  const path = require('path');
  const fs = require('fs');
  
  const paths = parseInlineParams(inlineParam);
  if (!paths.length) return data;
  
  const inlineAll = paths.includes('*') || paths.includes('true');  if (inlineAll || paths.includes('model')) {
    try {
      // Use Maven's own model.json file
      const modelPath = path.join(__dirname, 'model.json');
      const modelData = fs.readFileSync(modelPath, 'utf8');
      data.model = JSON.parse(modelData).model;
    } catch (error) {
      logger.error("Error loading model for inline", { error: error.message });
    }
  }
    if (inlineAll || paths.includes('meta')) {
    // Add meta information when inline=true or inline=meta
    data.meta = {
      self: `${data.self}/meta`,
      xid: `${data.xid}/meta`,
      createdat: data.createdat,
      modifiedat: data.modifiedat,
      type: "meta"
    };
  }
  
  if (inlineAll || paths.includes('capabilities')) {
    // Add capabilities to response if they don't exist yet
    data.capabilities = {
      "filter": true,
      "sort": true,
      "inline": true,
      "pagination": true
    };
  }
  
  if (inlineAll || paths.includes('endpoints') || paths.includes('groups')) {
    try {
      // Get the full model data for groups
      const modelPath = path.join(__dirname, 'model.json');
      const modelData = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
      
      // When using inline=*, or inline=groups, always include groups
      if (inlineAll || paths.includes('groups')) {
        data.groups = modelData.model.groups;
      }
      // Alternatively check if groupsurl exists
      else if (data.groupsurl && data.groupsurl !== null) {
        data.groups = modelData.model.groups;
      }
    } catch (error) {
      logger.error("Error loading groups for inline", { error: error.message });
    }
  }
  
  return data;
}

module.exports = { handleInlineFlag };
