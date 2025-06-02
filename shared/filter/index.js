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
  // General handling for non-existent attributes based on xRegistry spec:
  // "A reference to a nonexistent attribute SHOULD NOT generate an error and
  // SHOULD be treated the same as a non-matching situation."
  // This means if attrValue is undefined, it generally won't match most operators,
  // specific logic below handles exceptions like 'name=null' or 'name!=null'.

  if (operator === 'exists') {
    return attrValue !== undefined && attrValue !== null;
  }

  if (operator === '=') {
    const filterValueStr = String(filterValue);

    // Handle 'name=null' (attribute is null or undefined)
    if (filterValueStr.toLowerCase() === 'null') {
      return attrValue === undefined || attrValue === null;
    }

    // If attrValue is undefined or null, it cannot match non-null filterValues
    if (attrValue === undefined || attrValue === null) {
      return false;
    }

    const attrValueStr = String(attrValue);

    // Handle 'name=*' (attribute exists and is not null, can be empty string)
    if (filterValueStr === '*') {
      return true; // Already checked attrValue is not undefined/null
    }

    // Handle wildcards (e.g. name=*foo*, name=foo*bar, name=*foo*)
    if (filterValueStr.includes('*')) {
      // Escape regex special characters in the filterValue, then convert xRegistry '*' to '.*?'
      const regexPattern = '^' + filterValueStr.replace(/[\.\+\?\^\[\]\(\)\{\}\$\-\=\!\|]/g, '\\$&').replace(/\*/g, '.*?') + '$';
      try {
        const regex = new RegExp(regexPattern, 'i'); // case-insensitive
        return regex.test(attrValueStr);
      } catch (e) {
        // Invalid regex pattern, treat as no match
        return false;
      }
    }
    // No wildcards: case-insensitive string comparison
    return attrValueStr.toLowerCase() === filterValueStr.toLowerCase();
  }

  if (operator === '!=' || operator === '<>') {
    const filterValueStr = String(filterValue);

    // Handle 'name!=null' or 'name<>null' (attribute exists and is not null)
    if (filterValueStr.toLowerCase() === 'null') {
      return attrValue !== undefined && attrValue !== null;
    }

    // If attrValue is undefined or null, it *does* match (semantically NOT (attr=VALUE))
    if (attrValue === undefined || attrValue === null) {
      return true;
    }

    const attrValueStr = String(attrValue);

    // Handle 'name!=*' or 'name<>*' (attribute is null or undefined)
    // This is equivalent to NOT (attrValue exists and is not null), so it means attrValue must be null or undefined.
    // However, we already handled (attrValue === undefined || attrValue === null) above, returning true.
    // If attrValue is not null/undefined here, it means it exists, so it should NOT match 'name!=*'
    if (filterValueStr === '*') {
      return false; // attrValue exists and is not null, so it does not satisfy 'not equals *'
    }

    // Handle wildcards (e.g. name!=*foo*)
    if (filterValueStr.includes('*')) {
      const regexPattern = '^' + filterValueStr.replace(/[\.\+\?\^\[\]\(\)\{\}\$\-\=\!\|]/g, '\\$&').replace(/\*/g, '.*?') + '$';
      try {
        const regex = new RegExp(regexPattern, 'i');
        return !regex.test(attrValueStr);
      } catch (e) {
        // Invalid regex pattern, treat as match (as it's a NOT equals)
        // This might be debatable, but if regex is invalid, it can't be definitively 'not equal' to a pattern.
        // For safety, let's say an invalid pattern for != means it doesn't restrict.
        return true;
      }
    }
    // No wildcards: case-insensitive string inequality
    return attrValueStr.toLowerCase() !== filterValueStr.toLowerCase();
  }

  if (['<', '<=', '>', '>='].includes(operator)) {
    // Attribute must exist for comparison
    if (attrValue === undefined || attrValue === null) {
      return false;
    }
    const filterValueStr = String(filterValue);
    // filterValue must not be null for these operators as per spec
    if (filterValueStr.toLowerCase() === 'null') {
      return false; 
    }

    // Try numeric comparison first
    const numAttrValue = Number(attrValue);
    const numFilterValue = Number(filterValueStr); // filterValue is already a string here

    if (!isNaN(numAttrValue) && !isNaN(numFilterValue)) {
      switch (operator) {
        case '<': return numAttrValue < numFilterValue;
        case '<=': return numAttrValue <= numFilterValue;
        case '>': return numAttrValue > numFilterValue;
        case '>=': return numAttrValue >= numFilterValue;
      }
    }
    // If not purely numeric, spec allows for string comparison for these operators (e.g. for versions, timestamps)
    // Using case-insensitive string comparison for this fallback.
    const attrValueStr = String(attrValue);
    switch (operator) {
      case '<': return attrValueStr.toLowerCase() < filterValueStr.toLowerCase();
      case '<=': return attrValueStr.toLowerCase() <= filterValueStr.toLowerCase();
      case '>': return attrValueStr.toLowerCase() > filterValueStr.toLowerCase();
      case '>=': return attrValueStr.toLowerCase() >= filterValueStr.toLowerCase();
    }
  }
  return false;
}

// Apply xRegistry filter with name constraint then other conditions
// getEntityValue: optional function to extract comparable value from entity (e.g., string packageName)
async function applyXRegistryFilterWithNameConstraint(filterParams, entities, req, getEntityValue = e => e) {
  // DEPRECATED in favor of applyXRegistryFilters - to be removed later
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

// New function to apply filters according to xRegistry spec with mandatory name filter
// Processes a single filter string (e.g., from one ?filter=name=foo,version>1 query param)
// The OR logic for multiple ?filter params is handled by the caller.
function applyXRegistryFilters(filterQueryString, entities, getEntityNameValue = entity => entity.name) {
  if (!filterQueryString || typeof filterQueryString !== 'string' || filterQueryString.trim() === '') {
    // If no filter string is provided, per current plan, other filters are not effective
    // without a name filter. If name filter is also absent, return all entities.
    // However, the strict plan says "name filter is mandatory".
    // For now, if the whole filter string is empty, we assume no effective filtering intended by THIS function call.
    // The calling server logic must decide if an empty list should be returned if no name filter part is found.
    // This function itself won't error for an empty filterQueryString, it implies no filtering from this string.
    return entities;
  }

  const allExpressions = parseFilterExpression(filterQueryString);
  
  const nameExpressions = allExpressions.filter(e => e.attribute === 'name');
  const otherExpressions = allExpressions.filter(e => e.attribute !== 'name');

  // Mandatory Name Filter Check (as per plan)
  // If there are expressions, but none of them are for 'name', return empty array.
  if (allExpressions.length > 0 && nameExpressions.length === 0) {
    // console.warn("A filter on 'name' is required for other filters to be effective. Returning empty set.");
    return [];
  }
  // If no expressions at all (empty filter string was handled above), or only name expressions, proceed.

  let nameFilteredEntities = entities;
  if (nameExpressions.length > 0) {
    nameFilteredEntities = entities.filter(entity => {
      return nameExpressions.every(expr => {
        const entityName = getEntityNameValue(entity);
        return compareValues(entityName, expr.value, expr.operator);
      });
    });
  }
  // If nameExpressions.length was 0 (but allExpressions was also 0), nameFilteredEntities remains original entities.
  // If nameExpressions.length was 0 (and allExpressions.length > 0), we returned [] above.

  if (otherExpressions.length === 0) {
    return nameFilteredEntities;
  }

  // Phase 2: Refinement Filtering
  const refinedEntities = nameFilteredEntities.filter(entity => {
    return otherExpressions.every(expr => {
      const attrValue = getNestedValue(entity, expr.attribute);
      return compareValues(attrValue, expr.value, expr.operator);
    });
  });

  return refinedEntities;
}

// =============================================================================
// PHASE III: BACKEND OPTIMIZATION
// =============================================================================

/**
 * Enhanced filtering system with indexing and caching for large datasets
 */
class FilterOptimizer {
  constructor(options = {}) {
    this.nameIndex = new Map(); // name -> Set of entity indices  
    this.attributeIndices = new Map(); // attribute -> Map(value -> Set of indices)
    this.filterCache = new Map(); // filterKey -> cached results
    this.cacheSize = options.cacheSize || 1000;
    this.maxCacheAge = options.maxCacheAge || 300000; // 5 minutes
    this.entities = [];
    this.lastIndexUpdate = 0;
    
    // Two-step filtering configuration
    this.enableTwoStepFiltering = options.enableTwoStepFiltering !== false; // Default: enabled
    this.metadataFetcher = options.metadataFetcher || null; // Function to fetch metadata
    this.maxMetadataFetches = options.maxMetadataFetches || 100; // Limit concurrent fetches
  }

  /**
   * Build indices for fast filtering
   */
  buildIndices(entities, getEntityNameValue = entity => entity.name) {
    this.entities = entities;
    this.nameIndex.clear();
    this.attributeIndices.clear();
    this.lastIndexUpdate = Date.now();

    // Build name index for O(1) name lookups
    entities.forEach((entity, index) => {
      const name = getEntityNameValue(entity);
      if (name) {
        const normalizedName = String(name).toLowerCase();
        if (!this.nameIndex.has(normalizedName)) {
          this.nameIndex.set(normalizedName, new Set());
        }
        this.nameIndex.get(normalizedName).add(index);
      }
    });

    // Build attribute indices for common searchable attributes
    const commonAttributes = ['description', 'author', 'license', 'version'];
    commonAttributes.forEach(attr => {
      const attrIndex = new Map();
      entities.forEach((entity, index) => {
        const value = getNestedValue(entity, attr);
        if (value !== undefined && value !== null) {
          const normalizedValue = String(value).toLowerCase();
          if (!attrIndex.has(normalizedValue)) {
            attrIndex.set(normalizedValue, new Set());
          }
          attrIndex.get(normalizedValue).add(index);
        }
      });
      this.attributeIndices.set(attr, attrIndex);
    });
  }

  /**
   * Fast name-based filtering using index
   */
  filterByNameExpression(nameExpr) {
    const { operator, value } = nameExpr;
    const filterValue = String(value).toLowerCase();
    const matchingIndices = new Set();

    if (operator === '=') {
      if (filterValue.includes('*')) {
        // Wildcard matching - need to check all names
        const regexPattern = '^' + filterValue.replace(/[\.\+\?\^\[\]\(\)\{\}\$\-\=\!\|]/g, '\\$&').replace(/\*/g, '.*?') + '$';
        try {
          const regex = new RegExp(regexPattern, 'i');
          for (const [name, indices] of this.nameIndex) {
            if (regex.test(name)) {
              indices.forEach(idx => matchingIndices.add(idx));
            }
          }
        } catch (e) {
          // Invalid regex, return empty set
        }
      } else {
        // Exact match using index
        const indices = this.nameIndex.get(filterValue);
        if (indices) {
          indices.forEach(idx => matchingIndices.add(idx));
        }
      }
    } else if (operator === '!=' || operator === '<>') {
      // NOT equals - add all except matching
      for (let i = 0; i < this.entities.length; i++) {
        matchingIndices.add(i);
      }
      
      if (filterValue.includes('*')) {
        const regexPattern = '^' + filterValue.replace(/[\.\+\?\^\[\]\(\)\{\}\$\-\=\!\|]/g, '\\$&').replace(/\*/g, '.*?') + '$';
        try {
          const regex = new RegExp(regexPattern, 'i');
          for (const [name, indices] of this.nameIndex) {
            if (regex.test(name)) {
              indices.forEach(idx => matchingIndices.delete(idx));
            }
          }
        } catch (e) {
          // Invalid regex, return all
        }
      } else {
        const indices = this.nameIndex.get(filterValue);
        if (indices) {
          indices.forEach(idx => matchingIndices.delete(idx));
        }
      }
    } else if (['<', '<=', '>', '>='].includes(operator)) {
      // Comparison operators - fallback to linear scan
      return this.linearFilterByName(nameExpr);
    }

    return Array.from(matchingIndices).map(idx => this.entities[idx]);
  }

  /**
   * Fallback linear filtering for complex operations
   */
  linearFilterByName(nameExpr, getEntityNameValue = entity => entity.name) {
    return this.entities.filter(entity => {
      const entityName = getEntityNameValue(entity);
      return compareValues(entityName, nameExpr.value, nameExpr.operator);
    });
  }

  /**
   * Two-step filtering: Name first, then metadata
   */
  async twoStepFilter(filterQueryString, getEntityNameValue = entity => entity.name, logger = console) {
    if (!filterQueryString || typeof filterQueryString !== 'string' || filterQueryString.trim() === '') {
      return this.entities;
    }

    const startTime = Date.now();
    const allExpressions = parseFilterExpression(filterQueryString);
    const nameExpressions = allExpressions.filter(e => e.attribute === 'name');
    const metadataExpressions = allExpressions.filter(e => e.attribute !== 'name');

    // Mandatory name filter check
    if (allExpressions.length > 0 && nameExpressions.length === 0) {
      return [];
    }

    // Step 1: Fast name filtering using indices
    let nameFilteredResults = this.entities;
    if (nameExpressions.length > 0) {
      if (nameExpressions.length === 1 && nameExpressions[0].operator === '=') {
        nameFilteredResults = this.filterByNameExpression(nameExpressions[0]);
      } else {
        nameFilteredResults = this.entities.filter(entity => {
          return nameExpressions.every(expr => {
            const entityName = getEntityNameValue(entity);
            return compareValues(entityName, expr.value, expr.operator);
          });
        });
      }
    }

    logger.debug('Two-step filtering: Phase 1 (name) complete', {
      originalCount: this.entities.length,
      nameFilteredCount: nameFilteredResults.length,
      hasMetadataFilters: metadataExpressions.length > 0,
      phase1Duration: Date.now() - startTime
    });

    // Step 2: Metadata filtering (if needed and metadata fetcher available)
    if (metadataExpressions.length === 0) {
      return nameFilteredResults;
    }

    if (!this.metadataFetcher || !this.enableTwoStepFiltering) {
      logger.warn('Two-step filtering: Metadata filters requested but metadata fetcher not available', {
        metadataExpressions: metadataExpressions.map(e => e.attribute)
      });
      return nameFilteredResults;
    }

    // Limit metadata fetches to prevent overwhelming upstream services
    const limitedResults = nameFilteredResults.slice(0, this.maxMetadataFetches);
    if (limitedResults.length < nameFilteredResults.length) {
      logger.warn('Two-step filtering: Limited metadata fetches due to large result set', {
        totalResults: nameFilteredResults.length,
        limitedTo: limitedResults.length,
        maxFetches: this.maxMetadataFetches
      });
    }

    // Fetch metadata and apply filters
    const metadataResults = [];
    const metadataStartTime = Date.now();
    
    for (const entity of limitedResults) {
      try {
        const entityName = getEntityNameValue(entity);
        const metadata = await this.metadataFetcher(entityName);
        
        // Apply metadata filters
        const matchesAllMetadataFilters = metadataExpressions.every(expr => {
          const attrValue = getNestedValue(metadata, expr.attribute);
          return compareValues(attrValue, expr.value, expr.operator);
        });

        if (matchesAllMetadataFilters) {
          // Merge original entity with fetched metadata
          metadataResults.push({
            ...entity,
            ...metadata
          });
        }
      } catch (error) {
        logger.debug('Two-step filtering: Failed to fetch metadata for entity', {
          entityName: getEntityNameValue(entity),
          error: error.message
        });
        // Continue with other entities
      }
    }

    logger.info('Two-step filtering: Complete', {
      originalCount: this.entities.length,
      nameFilteredCount: nameFilteredResults.length,
      metadataFetchedCount: limitedResults.length,
      finalResultCount: metadataResults.length,
      totalDuration: Date.now() - startTime,
      metadataDuration: Date.now() - metadataStartTime
    });

    return metadataResults;
  }

  /**
   * Optimized filtering with caching (enhanced for two-step)
   */
  async optimizedFilter(filterQueryString, getEntityNameValue = entity => entity.name, logger = console) {
    if (!filterQueryString || typeof filterQueryString !== 'string' || filterQueryString.trim() === '') {
      return this.entities;
    }

    // Check if this requires two-step filtering
    const allExpressions = parseFilterExpression(filterQueryString);
    const hasMetadataFilters = allExpressions.some(e => e.attribute !== 'name');

    if (hasMetadataFilters && this.enableTwoStepFiltering && this.metadataFetcher) {
      // Use two-step filtering for metadata queries
      return await this.twoStepFilter(filterQueryString, getEntityNameValue, logger);
    }

    // Use standard optimized filtering for name-only queries
    // Check cache first
    const cacheKey = `${filterQueryString}:${this.lastIndexUpdate}`;
    const cachedResult = this.filterCache.get(cacheKey);
    if (cachedResult && Date.now() - cachedResult.timestamp < this.maxCacheAge) {
      return cachedResult.data;
    }

    const nameExpressions = allExpressions.filter(e => e.attribute === 'name');
    const otherExpressions = allExpressions.filter(e => e.attribute !== 'name');

    // Mandatory name filter check
    if (allExpressions.length > 0 && nameExpressions.length === 0) {
      return [];
    }

    let results = this.entities;

    // Phase 1: Optimized name filtering using index
    if (nameExpressions.length > 0) {
      if (nameExpressions.length === 1 && nameExpressions[0].operator === '=') {
        // Single exact match - use fast index lookup
        results = this.filterByNameExpression(nameExpressions[0]);
      } else {
        // Multiple name expressions or complex operators - use linear scan
        results = this.entities.filter(entity => {
          return nameExpressions.every(expr => {
            const entityName = getEntityNameValue(entity);
            return compareValues(entityName, expr.value, expr.operator);
          });
        });
      }
    }

    // Phase 2: Refinement filtering (for non-metadata attributes)
    if (otherExpressions.length > 0) {
      results = results.filter(entity => {
        return otherExpressions.every(expr => {
          const attrValue = getNestedValue(entity, expr.attribute);
          return compareValues(attrValue, expr.value, expr.operator);
        });
      });
    }

    // Cache the result
    this.cacheResult(cacheKey, results);
    return results;
  }

  /**
   * Set metadata fetcher function for two-step filtering
   */
  setMetadataFetcher(fetcherFunction) {
    this.metadataFetcher = fetcherFunction;
  }

  /**
   * Cache management
   */
  cacheResult(key, data) {
    // Implement LRU cache cleanup if needed
    if (this.filterCache.size >= this.cacheSize) {
      const oldestKey = this.filterCache.keys().next().value;
      this.filterCache.delete(oldestKey);
    }

    this.filterCache.set(key, {
      data: data,
      timestamp: Date.now()
    });
  }

  /**
   * Clear cache (call when data changes)
   */
  clearCache() {
    this.filterCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      cacheSize: this.filterCache.size,
      maxCacheSize: this.cacheSize,
      indexedEntities: this.entities.length,
      nameIndexSize: this.nameIndex.size,
      attributeIndices: this.attributeIndices.size,
      lastIndexUpdate: this.lastIndexUpdate,
      twoStepFilteringEnabled: this.enableTwoStepFiltering,
      hasMetadataFetcher: !!this.metadataFetcher,
      maxMetadataFetches: this.maxMetadataFetches
    };
  }
}

/**
 * Pagination optimizer to avoid loading full result sets
 */
function optimizedPagination(entities, offset, limit, sortParams = null, getNestedValue = getNestedValue) {
  // For small datasets, use simple slicing
  if (entities.length <= 10000) {
    let sortedEntities = entities;
    
    if (sortParams && sortParams.length > 0) {
      sortedEntities = [...entities].sort((a, b) => {
        for (const { attribute, direction } of sortParams) {
          const aVal = getNestedValue(a, attribute);
          const bVal = getNestedValue(b, attribute);
          
          let comparison = 0;
          if (aVal < bVal) comparison = -1;
          else if (aVal > bVal) comparison = 1;
          
          if (comparison !== 0) {
            return direction === 'desc' ? -comparison : comparison;
          }
        }
        return 0;
      });
    }
    
    return {
      items: sortedEntities.slice(offset, offset + limit),
      totalCount: entities.length,
      hasMore: offset + limit < entities.length
    };
  }

  // For large datasets, implement streaming pagination
  // This would be more complex and depend on specific backend capabilities
  return {
    items: entities.slice(offset, offset + limit),
    totalCount: entities.length,
    hasMore: offset + limit < entities.length
  };
}

module.exports = { 
  parseFilterExpression, 
  getNestedValue, 
  compareValues, 
  applyXRegistryFilterWithNameConstraint, 
  applyXRegistryFilters,
  FilterOptimizer,
  optimizedPagination
};