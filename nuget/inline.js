/**
 * Custom implementation of handleInlineFlag for NuGet registry
 * This replaces the shared implementation with proper error handling and logging
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
      if (req.res) {
        try {
          req.res.set('Warning', '299 - "Inline flag partially supported"');
        } catch (error) {
          logger.error("Error setting response header", { error: error.message });
        }
      }
    }
    
    // Handle meta inlining for resources
    if (inlineParam === 'true' || inlineParam === 'meta') {
      if (metaObject && data.metaurl) {
        try {
          // Include meta object
          data.meta = metaObject;
        } catch (error) {
          logger.error("Error inlining meta object", { error: error.message });
        }
      }
    }
    
    return data;
  }
  
  // Custom inline handling for all endpoints
  const { parseInlineParams } = require('../shared/inline');
  const path = require('path');
  const fs = require('fs');
  
  try {
    const paths = parseInlineParams(req.query.inline);
    if (!paths.length) return data;
    
    const inlineAll = paths.includes('*');
    if (inlineAll || paths.includes('model')) {
      try {
        // Use NuGet's own model.json file
        const modelPath = path.join(__dirname, 'model.json');
        const modelData = fs.readFileSync(modelPath, 'utf8');
        data.model = JSON.parse(modelData).model;
      } catch (error) {
        logger.error("Error loading model for inline", { error: error.message });
      }
    }
    
    if (inlineAll || paths.includes('schema')) {
      try {
        // Load schema.json file
        const schemaPath = path.join(__dirname, 'schema.json');
        const schemaData = fs.readFileSync(schemaPath, 'utf8');
        data.schema = JSON.parse(schemaData);
      } catch (error) {
        logger.error("Error loading schema for inline", { error: error.message });
      }
    }
    
    if (inlineAll || paths.includes('capabilities')) {
      try {
        // Add capabilities to response if they don't exist yet
        data.capabilities = {
          "filter": true,
          "sort": true,
          "inline": true,
          "pagination": true
        };
      } catch (error) {
        logger.error("Error adding capabilities for inline", { error: error.message });
      }
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
  } catch (error) {
    logger.error("Error processing inline parameters", { error: error.message });
  }
  
  return data;
}

module.exports = {
  handleInlineFlag
};
