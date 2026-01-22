/**
 * FJAPI - Fake JSON API
 * Lightweight read-only, queryable JSON API hosted on GitHub Pages
 * Author: DMAC @ Imagination Driver
 * License: MIT
 */

const params      = new URLSearchParams(location.search);
const tableDelim  = "__";
const errorUse    = "USE clause required. Example: ?use=db&from=posts";
const errorLoad   = "Failed to load ";
const errorSelect = "No matching fields found in the data. Invalid SELECT fields: ";
const dbPath      = "data/";
const darkMode    = 1; // 1 for inclusion of dark mode CSS, 0 to turn it off.
const darkHex     = "#1e1e1e";
const lightHex    = "#f5f5f5";

/**
 * Retrieves a query parameter value from the URL.
 * @param {string} key - The name of the query parameter.
 * @param {string} def - The default value if the parameter is not found.
 * @returns {string} The value of the query parameter or the default value.
 */
const get = (key, def) => params.get(key) ?? def;


/**
 * Parses a WHERE clause into a filter function.
 * Supports multiple conditions with AND/OR operators.
 * Format: "field1=value1 AND field2=value2" or "field1=value1 OR field2=value2"
 * @param {string} whereStr - The WHERE clause string.
 * @returns {Function} A filter function that returns true for matching rows.
 */
function parseWhere(whereStr) {
  if (!whereStr) return () => true;

  let operator = null;
  let conditions = [];
  
  if (whereStr.includes(" AND ")) {
    operator = "AND";
    conditions = whereStr.split(" AND ");
  } else if (whereStr.includes(" OR ")) {
    operator = "OR";
    conditions = whereStr.split(" OR ");
  } else {
    conditions = [whereStr];
  }

  // Parse each condition
  const filters = conditions.map(condition => {
    const condTrim   = condition.trim();
    let col, val, op = "EQ";

    // Detect operator
    const likeMatch    = condTrim.match(/(.+)\s+LIKE\s+(.+)/i);
    const betweenMatch = condTrim.match(/(.+)\s+BETWEEN\s+(.+)/i);
    const inMatch      = condTrim.match(/(.+)\s+IN\s+(.+)/i);

    if (likeMatch) {
      col = likeMatch[1].trim();
      val = likeMatch[2].trim();
      op = "LIKE";
    } else if (betweenMatch) {
      col = betweenMatch[1].trim();
      val = betweenMatch[2].trim().split(",").map(v => v.trim());
      op = "BETWEEN";
    } else if (inMatch) {
      col = inMatch[1].trim();
      val = inMatch[2].trim().split(",").map(v => v.trim());
      op = "IN";
    } else {
      [col, val] = condTrim.split("=");
    }
    
    // evaluate a single condition against a value
    const check = (fieldVal) => {
      if (fieldVal === undefined || fieldVal === null) return false;
      const sVal = String(fieldVal);
      
      if (op === "LIKE") {
        const pattern = "^" + val.replace(/\$/g, ".*") + "$";
        return new RegExp(pattern, "i").test(sVal);
      }
      
      if (op === "BETWEEN") {
        const [low, high] = val;
        // Try numeric comparison if both ends are numbers
        if (!isNaN(fieldVal) && !isNaN(low) && !isNaN(high)) {
          return Number(fieldVal) >= Number(low) && Number(fieldVal) <= Number(high);
        }
        return sVal >= low && sVal <= high;
      }
      
      if (op === "IN") {
        return val.includes(sVal);
      }
      
      return sVal === val;
    };

    if (col.includes(tableDelim)) {
      const [joinTable, joinField] = col.split(tableDelim);
      return row => {
        const joinedObj = row[joinTable];
        return joinedObj && check(joinedObj[joinField]);
      };
    }
    return row => check(row[col]);
  });

  // Combine filters based on operator
  if (operator === "AND") {
    return row => filters.every(filter => filter(row));
  } else if (operator === "OR") {
    return row => filters.some(filter => filter(row));
  } else {
    return filters[0];
  }
}


/**
 * Retrieves the relationships between tables in the database.
 * @param {string} table - The name of the table.
 * @param {Object} DB - The database object.
 * @returns {Object} An object containing the relationships between tables.
 */
function getRelations(table, DB) {
  const firstRow = DB[table]?.[0] ?? {};
  return Object.fromEntries(
    Object.keys(firstRow)
      .filter(key => key.endsWith("_id"))
      .map(key => [key, { table: key.replace(/_id$/, "s"), key: "id" }])
  );
}


/**
 * Joins rows based on the specified join string.
 * Supports BelongsTo, HasMany, and Many-to-Many relationships.
 * @param {string} table - The name of the table.
 * @param {Array} rows - The array of rows to join.
 * @param {string} joinStr - The join string.
 * @param {Object} DB - The database object.
 * @returns {Array} The joined rows.
 */
function joinRows(table, rows, joinStr, DB) {
  if (!joinStr) return rows;
  const joins = joinStr.split(",").map(j => j.trim());
  const rels  = getRelations(table, DB);
  const sing  = table.replace(/s$/, "");

  return rows.map(row => {
    const newRow = { ...row };
    joins.forEach(key => {
      // 1. BelongsTo (e.g., post has user_id)
      const relCol = Object.keys(rels).find(k => k.replace(/_id$/, "") === key);
      if (relCol) {
        const rel = rels[relCol];
        newRow[key] = DB[rel.table]?.find(r => r[rel.key] === row[relCol]) ?? null;
        return;
      }

      const targetSing = key.replace(/s$/, "");
      const pivot = Object.keys(DB).find(t => t.includes(sing) && t.includes(targetSing));

      if (pivot && pivot !== key) {
        // 2. Many-to-Many (e.g., posts -> post_tags -> tags)
        const pivotRows = DB[pivot].filter(r => r[`${sing}_id`] === row.id);
        newRow[key] = pivotRows.map(pr => 
          DB[key]?.find(tr => tr.id === pr[`${targetSing}_id`])
        ).filter(Boolean);
      } else if (DB[key]) {
        // 3. HasMany (e.g., posts -> comments)
        newRow[key] = DB[key].filter(r => r[`${sing}_id`] === row.id);
      }
    });
    return newRow;
  });
}


/**
 * Selects specific fields from the rows.
 * @param {Array} rows - The array of rows to select from.
 * @param {string} selectStr - The select string.
 * @returns {Array} The selected rows.
 */
function selectFields(rows, selectStr) {
  if (!selectStr) return rows;
  const fields = selectStr.split(",").map(f => f.trim());
  
  const result = rows.map(row => {
    const newRow = {};
    fields.forEach(fieldPart => {
      // Split for alias (e.g., user__first_name=author)
      let [field, alias] = fieldPart.split("=");
      field = field.trim();
      alias = alias ? alias.trim() : null;

      if (field === "*") {
        Object.keys(row).forEach(key => {
          if (typeof row[key] !== "object" || row[key] === null) {
            newRow[key] = row[key];
          }
        });
      } else if (field.startsWith("COUNT__")) {
        const target = field.replace("COUNT__", "");
        if (Array.isArray(row[target])) {
          newRow[alias || `${target}_count`] = row[target].length;
        } else {
          newRow[alias || `${target}_count`] = 0;
        }
      } else if (field.includes(tableDelim)) {
        const [joinTable, joinField] = field.split(tableDelim);
        const joinedObj = row[joinTable];
        if (joinedObj) {
          if (joinField === "*") {
            Object.keys(joinedObj).forEach(key => {
              newRow[key] = joinedObj[key];
            });
          } else if (joinedObj[joinField] !== undefined) {
            // Use alias if provided otherwise use original joinField name
            newRow[alias || joinField] = joinedObj[joinField];
          }
        }
      } else {
        if (row[field] !== undefined) {
          // Use alias otherwise use field name
          newRow[alias || field] = row[field];
        }
      }
    });
    return newRow;
  });
  
  if (result.length > 0 && result.every(row => Object.keys(row).length === 0)) {
    // If we only have aggregations, this check might fail. We'll handle that in serveData.
    const hasAggs = fields.some(f => /^(SUM|AVG|MIN|MAX)__/i.test(f));
    if (!hasAggs) throw new Error(`${errorSelect} ${selectStr}`);
  }
  
  return result;
}


/**
 * Calculates mathematical aggregations on a set of rows.
 * @param {Array} rows - The rows to aggregate.
 * @param {string} selectStr - The select string containing aggregations.
 * @returns {Object} An object containing the aggregated values.
 */
function aggregateRows(rows, selectStr) {
  if (!selectStr || rows.length === 0) return {};
  const fields = selectStr.split(",").map(f => f.trim());
  const aggs = {};

  fields.forEach(fieldPart => {
    const [fullField, alias] = fieldPart.split("=");
    const match = fullField.match(/^(SUM|AVG|MIN|MAX)__(.+)/i);
    if (!match) return;

    const [_, op, field] = match;
    let values;

    if (field.startsWith("COUNT__")) {
      const target = field.replace("COUNT__", "");
      values = rows.map(r => Array.isArray(r[target]) ? r[target].length : 0);
    } else if (field.includes(tableDelim)) {
      const [joinTable, joinField] = field.split(tableDelim);
      values = rows.map(r => r[joinTable]?.[joinField]).map(Number).filter(v => !isNaN(v));
    } else {
      values = rows.map(r => Number(r[field])).filter(v => !isNaN(v));
    }

    const key = alias || fullField;

    if (values.length === 0) {
      aggs[key] = null;
      return;
    }

    switch (op.toUpperCase()) {
      case "SUM": aggs[key] = values.reduce((s, v) => s + v, 0); break;
      case "AVG": aggs[key] = values.reduce((s, v) => s + v, 0) / values.length; break;
      case "MIN": aggs[key] = Math.min(...values); break;
      case "MAX": aggs[key] = Math.max(...values); break;
    }
  });

  return aggs;
}


/**
 * Sorts rows by a specified field.
 * @param {Array} rows - The array of rows to sort.
 * @param {string} field - The field to sort by.
 * @param {string} direction - The sort direction (ASC or DESC).
 * @returns {Array} The sorted rows.
 */
function orderBy(rows, field, direction = "ASC") {
  if (!field || rows.length === 0) return rows;
  
  direction = direction.toUpperCase();
  
  return [...rows].sort((a, b) => {
    let aVal, bVal;
    
    // Support COUNT__ prefix for sorting by array length
    if (field.startsWith("COUNT__")) {
      const target = field.replace("COUNT__", "");
      const getCount = (row) => Array.isArray(row[target]) ? row[target].length : 0;
      aVal = getCount(a);
      bVal = getCount(b);
    } else if (field.includes(tableDelim)) {
      const [joinTable, joinField] = field.split(tableDelim);
      aVal = a[joinTable]?.[joinField];
      bVal = b[joinTable]?.[joinField];
    } else {
      aVal = a[field];
      bVal = b[field];
    }
    
    // Handle null/undefined
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    
    // Compare values
    if (aVal < bVal) return direction === "ASC" ? -1 : 1;
    if (aVal > bVal) return direction === "ASC" ? 1 : -1;
    return 0;
  });
}


/**
 * Removes duplicate rows from the results.
 * @param {Array} rows - The array of rows to process.
 * @param {string} distinct - Whether to return distinct rows.
 * @returns {Array} The unique rows.
 */
function getDistinct(rows, distinct) {
  if (distinct !== "1" || rows.length === 0) return rows;
  const seen = new Set();
  return rows.filter(row => {
    const stringified = JSON.stringify(row);
    if (seen.has(stringified)) return false;
    seen.add(stringified);
    return true;
  });
}


/**
 * Limits and offsets the number of rows returned.
 * @param {Array} rows - The array of rows to process.
 * @param {string} limit - The maximum number of rows to return.
 * @param {string} offset - The number of rows to skip.
 * @returns {Array} The limited and offset rows.
 */
function limitOffsetRows(rows, limit, offset) {
  if (rows.length === 0) return rows;
  const numLimit = limit ? parseInt(limit, 10) : rows.length;
  const numOffset = offset ? parseInt(offset, 10) : 0;
  
  const start = isNaN(numOffset) ? 0 : numOffset;
  const end = isNaN(numLimit) ? rows.length : start + numLimit;
  
  return rows.slice(start, end);
}


/**
 * Groups rows by a specified field.
 * @param {Array} rows - The array of rows to process.
 * @param {string} field - The field to group by.
 * @param {boolean} isCount - Whether to return counts per group.
 * @returns {Object} The grouped rows or counts.
 */
function groupRows(rows, field, isCount, selectStr, countAlias) {
  if (!field || rows.length === 0) return rows;
  const groups = {};
  rows.forEach(row => {
    let val;
    if (field.includes(tableDelim)) {
      const [table, col] = field.split(tableDelim);
      val = row[table]?.[col] ?? "null";
    } else {
      val = row[field] ?? "null";
    }
    
    if (!groups[val]) groups[val] = [];
    groups[val].push(row);
  });
  
  const hasAggs = selectStr && /^(SUM|AVG|MIN|MAX)__/i.test(selectStr);
  const cKey = countAlias || "count";

  if (isCount || hasAggs) {
    const summary = {};
    for (const key in groups) {
      if (isCount && !hasAggs) {
        summary[key] = groups[key].length;
      } else {
        const aggs = aggregateRows(groups[key], selectStr);
        if (isCount) aggs[cKey] = groups[key].length;
        summary[key] = aggs;
      }
    }
    return summary;
  }
  return groups;
}


/**
 * Filters grouped results based on a condition (SQL-like HAVING).
 * count > N, count < N, count = N, etc.
 * @param {Object} groups - The grouped results object.
 * @param {string} havingStr - The HAVING clause string.
 * @param {string} countAlias - The alias used for the count field.
 * @returns {Object} The filtered groups.
 */
function applyHaving(groups, havingStr, countAlias) {
  if (!havingStr) return groups;

  const match = havingStr.match(/count\s*([><=]+)\s*(\d+)/i);
  if (!match) return groups;

  const [_, operator, value] = match;
  const numValue = parseInt(value, 10);
  const filtered = {};
  const cKey = countAlias || "count";

  for (const key in groups) {
    let count;
    if (Array.isArray(groups[key])) {
      count = groups[key].length;
    } else if (typeof groups[key] === "object" && groups[key][cKey] !== undefined) {
      count = groups[key][cKey];
    } else {
      count = groups[key];
    }
    
    let keep = false;
    switch (operator) {
      case ">":  keep = count > numValue; break;
      case "<":  keep = count < numValue; break;
      case "=":  keep = count === numValue; break;
      case "==": keep = count === numValue; break;
      case ">=": keep = count >= numValue; break;
      case "<=": keep = count <= numValue; break;
    }
    
    if (keep) {
      filtered[key] = groups[key];
    }
  }
  return filtered;
}


/**
 * Safely outputs JSON to the document body.
 * @param {Object|Array} data - The data to output as JSON.
 */
function outputJSON(data) {
  document.body.innerHTML = "";
  document.body.textContent = JSON.stringify(data, null, 2);
  document.body.style.whiteSpace = "pre";
  if(darkMode){
    document.body.style.backgroundColor = darkHex;
    document.body.style.color = lightHex;
  }
}


/**
 * Serves the data from the "database".
 * @returns {Promise<void>} A promise that resolves when the data is served.
 */
async function serveData() {
  try {
    const use = get("use", "");
    
    if (!use) {
      outputJSON({ error: errorUse });
      return;
    }
    
    const dataFile = `${dbPath}${use}.json`;
    const result   = await fetch(dataFile);

    if (!result.ok) throw new Error(`${errorLoad}${dataFile}`);

    const DB       = await result.json();
    const table    = get("from", "posts");
    const join     = get("join", "");
    const whereFn  = parseWhere(get("where", ""));
    const select   = get("select", "");
    const orderby  = get("orderby", "");
    const sortby   = get("sortby", "ASC");
    const distinct = get("distinct", "0");
    const limit    = get("limit", "");
    const offset   = get("offset", "");
    const groupby  = get("groupby", "");
    const having   = get("having", "");
    const countRaw = get("count", "0");
    const [isCount, countAlias] = countRaw.split("=");

    // Join -> Filter -> Sort
    const data      = DB[table] ?? [];
    const joined    = joinRows(table, data, join, DB);
    const filtered  = joined.filter(whereFn);
    const sorted    = orderBy(filtered, orderby, sortby);

    const hasAggs = select && /^(SUM|AVG|MIN|MAX)__/i.test(select);

    if (groupby) {
      // Use original fields for math, then group
      const unique    = getDistinct(sorted, distinct);
      const limited   = limitOffsetRows(unique, limit, offset);
      const groups    = groupRows(limited, groupby, isCount === "1", select, countAlias);
      outputJSON(applyHaving(groups, having, countAlias));
    } else if (hasAggs) {
      // Global aggregations use original fields for math
      const unique    = getDistinct(sorted, distinct);
      const limited   = limitOffsetRows(unique, limit, offset);
      const aggs      = aggregateRows(limited, select);
      if (isCount === "1") aggs[countAlias || "count"] = limited.length;
      outputJSON(aggs);
    } else if (isCount === "1") {
      const unique    = getDistinct(sorted, distinct);
      const limited   = limitOffsetRows(unique, limit, offset);
      const result    = {};
      result[countAlias || "count"] = limited.length;
      outputJSON(result);
    } else {
      // Standard lists use selectFields to shape output and apply aliases
      const selected  = selectFields(sorted, select);
      const unique    = getDistinct(selected, distinct);
      const limited   = limitOffsetRows(unique, limit, offset);
      if (isCount === "1") {
        const result = {};
        result[countAlias || "count"] = limited.length;
        outputJSON(result);
      } else {
        outputJSON(limited);
      }
    }
  } catch (err) {
    outputJSON({ error: err.message });
  }
}

// Wait for DOM to be ready before executing
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', serveData);
} else {
  serveData();
}