// ============================================================================
// Search Engine
// Schema-driven filtering and text search across programs and sessions
// ============================================================================

import Fuse from 'fuse.js';
import type {
  Program,
  Session,
  Company,
  SearchRequest,
  SearchResponse,
  SearchResult,
  Filter,
  FilterGroup,
  FacetResult,
  FacetValue,
  AppliedFilter,
  PropertyDefinition,
} from '../types/index.js';
import {
  getCache,
  getAllPrograms,
  getSessionsForProgram,
  getCompanyForProgram,
  areAssociationsLoaded,
  getCacheStats,
} from './cache.js';
import {
  getPropertyDefinition,
  getSearchableFields,
  getFacetableFieldsForType,
  getOptionLabel,
  getFieldLabel,
  getProgramSchema,
  getSessionSchema,
  getCompanySchema,
} from './schema.js';

// ----------------------------------------------------------------------------
// Main Search Function
// ----------------------------------------------------------------------------

export function executeSearch(request: SearchRequest): SearchResponse {
  const startTime = Date.now();

  const {
    query,
    filters,
    programType,
    sort,
    page = 1,
    pageSize = 20,
    includeEmptyResults = false,
  } = request;

  // Get all programs from cache
  let programs = getAllPrograms();

  // Check association loading status
  const associationsReady = areAssociationsLoaded();
  const stats = getCacheStats();

  console.log(`[Search] Starting search - Total programs in cache: ${programs.length}`);
  console.log(`[Search] Associations loaded: ${associationsReady}, Programs with sessions: ${stats.programsWithSessions}`);
  console.log(`[Search] Request - programType: "${programType}", includeEmptyResults: ${includeEmptyResults}, query: "${query || ''}"`);

  // Step 1: Filter by program type if specified (case-insensitive)
  if (programType) {
    const programTypeLower = programType.toLowerCase();
    const beforeCount = programs.length;
    programs = programs.filter(p => {
      const pType = p.properties.program_type;
      if (!pType) return false;
      return String(pType).toLowerCase() === programTypeLower;
    });
    console.log(`[Search] After program_type filter "${programType}": ${programs.length} programs (was ${beforeCount})`);

    // If nothing matched, log sample of actual program types in data
    if (programs.length === 0 && beforeCount > 0) {
      const allPrograms = getAllPrograms();
      const sampleTypes = new Set<string>();
      for (let i = 0; i < Math.min(50, allPrograms.length); i++) {
        const pt = allPrograms[i].properties.program_type;
        if (pt) sampleTypes.add(String(pt));
      }
      console.log(`[Search] WARNING: No programs matched. Sample program_type values in data: ${Array.from(sampleTypes).join(', ')}`);
    }
  }

  // Step 2: Apply program-level filters
  if (filters && filters.filters.length > 0) {
    const beforeCount = programs.length;
    programs = applyFiltersToPrograms(programs, filters, programType);
    console.log(`[Search] After program filters: ${programs.length} programs (was ${beforeCount})`);
  }

  // Step 3: For each program, get matching sessions and apply company filters
  const results: SearchResult[] = [];
  let programsWithNoSessions = 0;
  let programsWithSessions = 0;
  let totalSessionsFound = 0;

  // Extract company filters if any
  const hasCompanyFilters = filters?.filters.some(f =>
    f.objectType === 'company' || isCompanyField(f.field)
  ) ?? false;

  for (const program of programs) {
    let sessions = getSessionsForProgram(program.id);
    const totalSessionCount = sessions.length;
    totalSessionsFound += totalSessionCount;

    if (totalSessionCount > 0) {
      programsWithSessions++;
    } else {
      programsWithNoSessions++;
    }

    // Apply session-level filters
    if (filters && filters.filters.length > 0) {
      sessions = applyFiltersToSessions(sessions, filters, programType);
    }

    // Skip programs with no matching sessions (unless includeEmptyResults)
    if (sessions.length === 0 && !includeEmptyResults) {
      continue;
    }

    const company = getCompanyForProgram(program.id) || null;

    // Apply company-level filters
    if (hasCompanyFilters && filters) {
      if (!company) {
        // If no company associated and we have company filters, skip this program
        continue;
      }

      const companyMatches = applyFiltersToCompany(company, filters);
      if (!companyMatches) {
        continue;
      }
    }

    results.push({
      program,
      company,
      sessions,
      matchingSessionCount: sessions.length,
      totalSessionCount,
      score: 0, // Will be updated by text search
    });
  }

  console.log(`[Search] Session stats: ${programsWithSessions} programs have sessions, ${programsWithNoSessions} programs have no sessions, ${totalSessionsFound} total sessions found`);

  // Step 4: Apply text search if query provided
  let scoredResults = results;
  if (query && query.trim().length > 0) {
    scoredResults = applyTextSearch(results, query);
  }

  // Step 5: Sort results
  scoredResults = sortResults(scoredResults, sort, query);

  // Step 6: Calculate facets (before pagination)
  const facets = calculateFacets(scoredResults, filters, programType);

  // Step 7: Paginate
  const totalCount = scoredResults.length;
  const totalPages = Math.ceil(totalCount / pageSize);
  const startIndex = (page - 1) * pageSize;
  const paginatedResults = scoredResults.slice(startIndex, startIndex + pageSize);

  // Step 8: Build applied filters summary
  const appliedFilters = buildAppliedFiltersSummary(filters);

  console.log(`[Search] Final results: ${totalCount} total, returning page ${page} with ${paginatedResults.length} results`);

  return {
    results: paginatedResults,
    totalCount,
    page,
    pageSize,
    totalPages,
    facets,
    appliedFilters,
    searchTime: Date.now() - startTime,
  };
}

// ----------------------------------------------------------------------------
// Filter Application
// ----------------------------------------------------------------------------

function applyFiltersToPrograms(
  programs: Program[],
  filterGroup: FilterGroup,
  programType?: string
): Program[] {
  // Extract program-level filters
  const programFilters = filterGroup.filters.filter(f =>
    f.objectType === 'program' || isProgramField(f.field)
  );

  if (programFilters.length === 0 && (!filterGroup.groups || filterGroup.groups.length === 0)) {
    return programs;
  }

  return programs.filter(program => {
    return evaluateFilterGroup(
      { ...filterGroup, filters: programFilters },
      program.properties,
      'program',
      programType
    );
  });
}

function applyFiltersToSessions(
  sessions: Session[],
  filterGroup: FilterGroup,
  programType?: string
): Session[] {
  // Extract session-level filters
  const sessionFilters = filterGroup.filters.filter(f =>
    f.objectType === 'session' || isSessionField(f.field)
  );

  if (sessionFilters.length === 0) {
    return sessions;
  }

  return sessions.filter(session => {
    return evaluateFilterGroup(
      { ...filterGroup, filters: sessionFilters },
      session.properties,
      'session',
      programType
    );
  });
}

function applyFiltersToCompany(
  company: Company,
  filterGroup: FilterGroup
): boolean {
  // Extract company-level filters
  const companyFilters = filterGroup.filters.filter(f =>
    f.objectType === 'company' || isCompanyField(f.field)
  );

  if (companyFilters.length === 0) {
    return true;
  }

  return evaluateFilterGroup(
    { ...filterGroup, filters: companyFilters },
    company.properties,
    'company'
  );
}

function evaluateFilterGroup(
  group: FilterGroup,
  properties: Record<string, string | number | boolean | null>,
  objectType: 'program' | 'session' | 'company',
  programType?: string
): boolean {
  const filterResults = group.filters.map(filter =>
    evaluateFilter(filter, properties, objectType, programType)
  );

  // Evaluate nested groups recursively
  const groupResults = (group.groups || []).map(g =>
    evaluateFilterGroup(g, properties, objectType, programType)
  );

  const allResults = [...filterResults, ...groupResults];

  if (allResults.length === 0) {
    return true;
  }

  if (group.operator === 'AND') {
    return allResults.every(r => r);
  } else {
    return allResults.some(r => r);
  }
}

function evaluateFilter(
  filter: Filter,
  properties: Record<string, string | number | boolean | null>,
  objectType: 'program' | 'session' | 'company',
  programType?: string
): boolean {
  const { field, operator, value } = filter;
  const propValue = properties[field];

  // Get property definition for type-aware comparison
  const propDef = getPropertyDefinition(objectType, field);
  const isDateField = propDef?.type === 'date' || propDef?.type === 'datetime' ||
                      field === 'start_date' || field === 'end_date';

  // Handle null/undefined values gracefully
  // For "contains any" type searches, null should not match
  // For "does not contain" or exclusion, null should be handled appropriately
  if (propValue === null || propValue === undefined) {
    // For gte/lte on age filters, null means "no restriction" - should match
    if ((field === 'age__min_' && operator === 'lte') ||
        (field === 'age__max_' && operator === 'gte')) {
      return true;
    }
    // For date filters with null values, be lenient - include the session
    // This means: if a session has no start_date, it could start anytime
    // If a session has no end_date, it could end anytime
    if (isDateField && (operator === 'gte' || operator === 'lte')) {
      return true;
    }
    // For other cases, null doesn't match unless we're checking for null
    if (operator === 'eq' && value === null) {
      return true;
    }
    return false;
  }

  // For date fields, use string comparison (ISO dates compare correctly)
  if (isDateField) {
    const propDateStr = String(propValue).slice(0, 10); // Get YYYY-MM-DD part
    const filterDateStr = String(value).slice(0, 10);

    switch (operator) {
      case 'eq':
        return propDateStr === filterDateStr;
      case 'neq':
        return propDateStr !== filterDateStr;
      case 'gte':
        // Session start_date >= filter value means "starts no earlier than"
        return propDateStr >= filterDateStr;
      case 'lte':
        // Session end_date <= filter value means "ends no later than"
        return propDateStr <= filterDateStr;
      case 'gt':
        return propDateStr > filterDateStr;
      case 'lt':
        return propDateStr < filterDateStr;
      case 'between': {
        const [minDate, maxDate] = value as [string, string];
        return propDateStr >= String(minDate).slice(0, 10) &&
               propDateStr <= String(maxDate).slice(0, 10);
      }
      default:
        break;
    }
  }

  switch (operator) {
    case 'eq':
      return propValue === value;

    case 'neq':
      return propValue !== value;

    case 'gte':
      return Number(propValue) >= Number(value);

    case 'lte':
      return Number(propValue) <= Number(value);

    case 'gt':
      return Number(propValue) > Number(value);

    case 'lt':
      return Number(propValue) < Number(value);

    case 'between': {
      const [min, max] = value as [number, number];
      const numValue = Number(propValue);
      return numValue >= min && numValue <= max;
    }

    case 'contains':
      return String(propValue).toLowerCase().includes(String(value).toLowerCase());

    case 'in': {
      const valueArray = Array.isArray(value) ? value : [value];
      // For multi-select fields (semicolon-separated values)
      if (propDef?.multiSelect && typeof propValue === 'string') {
        const propValues = propValue.split(';').map(v => v.trim());
        return valueArray.some(v => propValues.includes(String(v)));
      }
      return valueArray.includes(propValue);
    }

    default:
      console.warn(`Unknown filter operator: ${operator}`);
      return true;
  }
}

function isProgramField(field: string): boolean {
  const schema = getProgramSchema();
  return schema.properties.some(p => p.name === field);
}

function isSessionField(field: string): boolean {
  const schema = getSessionSchema();
  return schema.properties.some(p => p.name === field);
}

function isCompanyField(field: string): boolean {
  const schema = getCompanySchema();
  return schema.properties.some(p => p.name === field);
}

// ----------------------------------------------------------------------------
// Text Search
// ----------------------------------------------------------------------------

function applyTextSearch(
  results: SearchResult[],
  query: string
): SearchResult[] {
  // Build searchable documents combining program, company, and session data
  const documents = results.map((result, index) => {
    const programFields = getSearchableFields('program');
    const sessionFields = getSearchableFields('session');
    const companyFields = getSearchableFields('company');

    // Collect all searchable text
    const searchableText: string[] = [];

    // Add program fields
    for (const field of programFields) {
      const value = result.program.properties[field.name];
      if (value && typeof value === 'string') {
        searchableText.push(value);
      }
    }

    // Add company fields
    if (result.company) {
      for (const field of companyFields) {
        const value = result.company.properties[field.name];
        if (value && typeof value === 'string') {
          searchableText.push(value);
        }
      }
    }

    // Add session fields
    for (const session of result.sessions) {
      for (const field of sessionFields) {
        const value = session.properties[field.name];
        if (value && typeof value === 'string') {
          searchableText.push(value);
        }
      }
    }

    return {
      index,
      text: searchableText.join(' '),
      programName: String(result.program.properties.program_name || ''),
      companyName: String(result.company?.properties.name || ''),
    };
  });

  // Configure Fuse.js for fuzzy search
  const fuse = new Fuse(documents, {
    keys: [
      { name: 'programName', weight: 2 },
      { name: 'companyName', weight: 1.5 },
      { name: 'text', weight: 1 },
    ],
    threshold: 0.4,
    includeScore: true,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });

  const searchResults = fuse.search(query);

  // Map back to original results with scores
  return searchResults.map(sr => ({
    ...results[sr.item.index],
    score: 1 - (sr.score || 0), // Convert to 0-1 where 1 is best match
  }));
}

// ----------------------------------------------------------------------------
// Sorting
// ----------------------------------------------------------------------------

function sortResults(
  results: SearchResult[],
  sort?: { field: string; direction: 'asc' | 'desc'; objectType?: 'program' | 'session' },
  hasQuery?: string
): SearchResult[] {
  // If text search was performed, default to relevance sort
  if (hasQuery && !sort) {
    return results.sort((a, b) => b.score - a.score);
  }

  // Default sort by session start date
  const sortField = sort?.field || 'session_start_date';
  const sortDir = sort?.direction || 'asc';
  const objectType = sort?.objectType || 'session';

  return results.sort((a, b) => {
    let aValue: string | number | null = null;
    let bValue: string | number | null = null;

    if (objectType === 'session') {
      // Get earliest session date for comparison
      const aDates = a.sessions
        .map(s => s.properties[sortField])
        .filter(v => v !== null) as (string | number)[];
      const bDates = b.sessions
        .map(s => s.properties[sortField])
        .filter(v => v !== null) as (string | number)[];

      aValue = aDates.length > 0 ? aDates.sort()[0] : null;
      bValue = bDates.length > 0 ? bDates.sort()[0] : null;
    } else {
      aValue = a.program.properties[sortField] as string | number | null;
      bValue = b.program.properties[sortField] as string | number | null;
    }

    // Handle nulls - push to end
    if (aValue === null && bValue === null) return 0;
    if (aValue === null) return 1;
    if (bValue === null) return -1;

    // Compare values
    let comparison = 0;
    if (typeof aValue === 'string' && typeof bValue === 'string') {
      comparison = aValue.localeCompare(bValue);
    } else {
      comparison = Number(aValue) - Number(bValue);
    }

    return sortDir === 'asc' ? comparison : -comparison;
  });
}

// ----------------------------------------------------------------------------
// Facet Calculation
// ----------------------------------------------------------------------------

function calculateFacets(
  results: SearchResult[],
  currentFilters?: FilterGroup,
  programType?: string
): FacetResult[] {
  const facets: FacetResult[] = [];

  // Get facetable fields for companies (Partners)
  const companyFacetFields = getFacetableFieldsForType('company', programType);
  for (const field of companyFacetFields) {
    const values = calculateFacetValues(
      results,
      field.field,
      'company',
      field.options || [],
      currentFilters
    );
    if (values.length > 0) {
      facets.push({
        field: field.field,
        label: field.label,
        objectType: 'company',
        values,
      });
    }
  }

  // Get facetable fields for programs
  const programFacetFields = getFacetableFieldsForType('program', programType);
  for (const field of programFacetFields) {
    const values = calculateFacetValues(
      results,
      field.field,
      'program',
      field.options || [],
      currentFilters
    );
    if (values.length > 0) {
      facets.push({
        field: field.field,
        label: field.label,
        objectType: 'program',
        values,
      });
    }
  }

  // Get facetable fields for sessions
  const sessionFacetFields = getFacetableFieldsForType('session', programType);
  for (const field of sessionFacetFields) {
    const values = calculateFacetValues(
      results,
      field.field,
      'session',
      field.options || [],
      currentFilters
    );
    if (values.length > 0) {
      facets.push({
        field: field.field,
        label: field.label,
        objectType: 'session',
        values,
      });
    }
  }

  return facets;
}

function calculateFacetValues(
  results: SearchResult[],
  field: string,
  objectType: 'program' | 'session' | 'company',
  schemaOptions: { value: string; label: string }[],
  currentFilters?: FilterGroup
): FacetValue[] {
  const valueCounts = new Map<string, number>();

  // Check if this field is currently filtered
  const selectedValues = new Set<string>();
  if (currentFilters) {
    for (const filter of currentFilters.filters) {
      if (filter.field === field) {
        if (Array.isArray(filter.value)) {
          filter.value.forEach(v => selectedValues.add(String(v)));
        } else {
          selectedValues.add(String(filter.value));
        }
      }
    }
  }

  // Count values
  for (const result of results) {
    if (objectType === 'company') {
      if (result.company) {
        const value = result.company.properties[field];
        countFacetValue(valueCounts, value);
      }
    } else if (objectType === 'program') {
      const value = result.program.properties[field];
      countFacetValue(valueCounts, value);
    } else {
      for (const session of result.sessions) {
        const value = session.properties[field];
        countFacetValue(valueCounts, value);
      }
    }
  }

  // Build facet values list
  const facetValues: FacetValue[] = [];

  if (schemaOptions.length > 0) {
    // Use schema-defined options for order and labels
    for (const option of schemaOptions) {
      const count = valueCounts.get(option.value) || 0;
      // Include options that have counts OR are currently selected
      if (count > 0 || selectedValues.has(option.value)) {
        facetValues.push({
          value: option.value,
          label: option.label,
          count,
          selected: selectedValues.has(option.value),
        });
      }
    }
  } else {
    // Dynamic values (for non-enum fields)
    for (const [value, count] of valueCounts.entries()) {
      facetValues.push({
        value,
        label: value,
        count,
        selected: selectedValues.has(value),
      });
    }
    // Sort by count descending
    facetValues.sort((a, b) => b.count - a.count);
  }

  return facetValues;
}

function countFacetValue(
  counts: Map<string, number>,
  value: string | number | boolean | null
): void {
  if (value === null || value === undefined || value === '') {
    return;
  }

  // Handle multi-select values (semicolon-separated)
  const stringValue = String(value);
  if (stringValue.includes(';')) {
    const values = stringValue.split(';').map(v => v.trim());
    for (const v of values) {
      counts.set(v, (counts.get(v) || 0) + 1);
    }
  } else {
    counts.set(stringValue, (counts.get(stringValue) || 0) + 1);
  }
}

// ----------------------------------------------------------------------------
// Applied Filters Summary
// ----------------------------------------------------------------------------

function buildAppliedFiltersSummary(filters?: FilterGroup): AppliedFilter[] {
  if (!filters) return [];

  const applied: AppliedFilter[] = [];

  for (const filter of filters.filters) {
    let objectType: 'program' | 'session' | 'company';
    if (filter.objectType) {
      objectType = filter.objectType as 'program' | 'session' | 'company';
    } else if (isCompanyField(filter.field)) {
      objectType = 'company';
    } else if (isProgramField(filter.field)) {
      objectType = 'program';
    } else {
      objectType = 'session';
    }

    const displayValue = formatFilterDisplayValue(filter, objectType);

    applied.push({
      field: filter.field,
      label: getFieldLabel(objectType, filter.field),
      operator: filter.operator,
      value: filter.value,
      displayValue,
    });
  }

  return applied;
}

function formatFilterDisplayValue(
  filter: Filter,
  objectType: 'program' | 'session' | 'company'
): string {
  const { field, operator, value } = filter;

  if (Array.isArray(value)) {
    const labels = value.map(v =>
      getOptionLabel(objectType, field, String(v))
    );
    return labels.join(', ');
  }

  const label = getOptionLabel(objectType, field, String(value));

  switch (operator) {
    case 'gte':
      return `≥ ${label}`;
    case 'lte':
      return `≤ ${label}`;
    case 'between': {
      const range = value as unknown as [number, number];
      return `${range[0]} - ${range[1]}`;
    }
    case 'contains':
      return `contains "${label}"`;
    default:
      return label;
  }
}
