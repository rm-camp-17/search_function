// ============================================================================
// Data Cache Manager
// Handles hourly refresh and in-memory storage of HubSpot data
// ============================================================================

import type {
  CachedData,
  CacheStats,
  Company,
  Program,
  Session,
  HubSpotObject,
} from '../types/index.js';

// In-memory cache singleton
let cache: CachedData = {
  companies: new Map(),
  programs: new Map(),
  sessions: new Map(),
  programToCompany: new Map(),
  programToSessions: new Map(),
  lastRefreshed: new Date(0),
  refreshInProgress: false,
};

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// HubSpot API configuration
const HUBSPOT_API_BASE = 'https://api.hubapi.com';
const PROGRAM_OBJECT_TYPE = '2-50911446';
const SESSION_OBJECT_TYPE = '2-50911450';

// Get access token from environment
export function getAccessToken(): string {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    throw new Error('HUBSPOT_ACCESS_TOKEN environment variable is not set');
  }
  return token;
}

// ----------------------------------------------------------------------------
// Cache Access Functions
// ----------------------------------------------------------------------------

export function getCache(): CachedData {
  return cache;
}

export function getCacheStats(): CacheStats {
  return {
    companiesCount: cache.companies.size,
    programsCount: cache.programs.size,
    sessionsCount: cache.sessions.size,
    lastRefreshed: cache.lastRefreshed.getTime() > 0
      ? cache.lastRefreshed.toISOString()
      : null,
    refreshInProgress: cache.refreshInProgress,
    cacheAgeMs: Date.now() - cache.lastRefreshed.getTime(),
  };
}

export function isCacheStale(): boolean {
  return Date.now() - cache.lastRefreshed.getTime() > CACHE_TTL_MS;
}

export function isCacheEmpty(): boolean {
  return cache.programs.size === 0;
}

// ----------------------------------------------------------------------------
// Data Fetching from HubSpot
// ----------------------------------------------------------------------------

async function fetchHubSpotObjects(
  accessToken: string,
  objectType: string,
  properties: string[]
): Promise<HubSpotObject[]> {
  const allObjects: HubSpotObject[] = [];
  let after: string | undefined;
  const limit = 100;

  do {
    const url = new URL(`${HUBSPOT_API_BASE}/crm/v3/objects/${objectType}`);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('properties', properties.join(','));
    if (after) {
      url.searchParams.set('after', after);
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HubSpot API error (${response.status}): ${error}`);
    }

    const data = await response.json();
    allObjects.push(...(data.results || []));
    after = data.paging?.next?.after;
  } while (after);

  return allObjects;
}

async function fetchAssociations(
  accessToken: string,
  fromObjectType: string,
  toObjectType: string,
  objectIds: string[]
): Promise<Map<string, string[]>> {
  const associations = new Map<string, string[]>();

  if (objectIds.length === 0) return associations;

  // Batch requests (max 100 at a time)
  const batches: string[][] = [];
  for (let i = 0; i < objectIds.length; i += 100) {
    batches.push(objectIds.slice(i, i + 100));
  }

  for (const batch of batches) {
    const url = `${HUBSPOT_API_BASE}/crm/v4/associations/${fromObjectType}/${toObjectType}/batch/read`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        inputs: batch.map(id => ({ id })),
      }),
    });

    if (!response.ok) {
      console.error(`Association fetch failed: ${response.status}`);
      continue;
    }

    const data = await response.json();
    for (const result of data.results || []) {
      const fromId = result.from?.id;
      const toIds = (result.to || []).map((t: { toObjectId: string }) => t.toObjectId);
      if (fromId && toIds.length > 0) {
        associations.set(fromId, toIds);
      }
    }
  }

  return associations;
}

// ----------------------------------------------------------------------------
// Cache Refresh Logic
// ----------------------------------------------------------------------------

export async function refreshCache(accessToken: string): Promise<void> {
  if (cache.refreshInProgress) {
    console.log('Cache refresh already in progress, skipping...');
    return;
  }

  cache.refreshInProgress = true;
  console.log('Starting cache refresh...');

  try {
    // Define properties to fetch for each object type
    // These match the actual HubSpot schema properties
    const companyProperties = [
      'name', 'short_program_name', 'domain', 'email', 'phone', 'phone_2',
      'country_hq', 'us_state', 'four_sentence_summary_for_parents',
      'highlights_and_any_concerns_expressed', 'programming', 'religious_structure',
      'vibe', 'territory', 'commission_rate', 'commission_type', 'commission_basis',
      'commission_structure___summary', 'companyid', 'provider_ext_id_salesforce',
      'website_for_recommendation_entry', 'tfs_weeks', 'session_weeks', 'lifecyclestage',
    ];

    const programProperties = [
      'program_name', 'program_id', 'program_type', 'description',
      'primary_camp_type', 'camp_subtype', 'experience_subtype', 'specialty_subtype',
      'region', 'gender_structure', 'brother_sister', 'is_brother_sister',
      'programming_philosophy', 'accommodations', 'provider_id_external_',
    ];

    const sessionProperties = [
      'session_name', 'session_id', 'start_date', 'end_date', 'weeks',
      'age__min_', 'age__max_', 'grade_range_min', 'grade_range_max',
      'tuition__current_', 'tuition_currency', 'program_type', 'primary_camp_type',
      'experience_subtype', 'specialty_subtype', 'locations', 'sport_options',
      'arts_options', 'education_options', 'itinerary', 'notes__c', 'program_id__external_',
    ];

    // Fetch all data in parallel
    const [companies, programs, sessions] = await Promise.all([
      fetchHubSpotObjects(accessToken, 'companies', companyProperties),
      fetchHubSpotObjects(accessToken, PROGRAM_OBJECT_TYPE, programProperties),
      fetchHubSpotObjects(accessToken, SESSION_OBJECT_TYPE, sessionProperties),
    ]);

    console.log(`Fetched ${companies.length} companies, ${programs.length} programs, ${sessions.length} sessions`);

    // Fetch associations
    const programIds = programs.map(p => p.id);

    const [programToCompanyAssoc, programToSessionAssoc] = await Promise.all([
      fetchAssociations(accessToken, PROGRAM_OBJECT_TYPE, 'companies', programIds),
      fetchAssociations(accessToken, PROGRAM_OBJECT_TYPE, SESSION_OBJECT_TYPE, programIds),
    ]);

    // Build new cache
    const newCompanies = new Map<string, Company>();
    const newPrograms = new Map<string, Program>();
    const newSessions = new Map<string, Session>();
    const newProgramToCompany = new Map<string, string>();
    const newProgramToSessions = new Map<string, string[]>();

    // Process companies
    for (const obj of companies) {
      newCompanies.set(obj.id, {
        id: obj.id,
        properties: obj.properties as Record<string, string | number | boolean | null>,
        createdAt: obj.createdAt,
        updatedAt: obj.updatedAt,
      });
    }

    // Process sessions
    for (const obj of sessions) {
      newSessions.set(obj.id, {
        id: obj.id,
        properties: parseSessionProperties(obj.properties),
        createdAt: obj.createdAt,
        updatedAt: obj.updatedAt,
      });
    }

    // Process programs with associations
    for (const obj of programs) {
      const companyIds = programToCompanyAssoc.get(obj.id);
      const sessionIds = programToSessionAssoc.get(obj.id) || [];

      const companyId = companyIds?.[0]; // Take first associated company

      newPrograms.set(obj.id, {
        id: obj.id,
        properties: parseProgramProperties(obj.properties),
        createdAt: obj.createdAt,
        updatedAt: obj.updatedAt,
        companyId,
      });

      if (companyId) {
        newProgramToCompany.set(obj.id, companyId);
      }
      if (sessionIds.length > 0) {
        newProgramToSessions.set(obj.id, sessionIds);
      }
    }

    // Update cache atomically
    cache = {
      companies: newCompanies,
      programs: newPrograms,
      sessions: newSessions,
      programToCompany: newProgramToCompany,
      programToSessions: newProgramToSessions,
      lastRefreshed: new Date(),
      refreshInProgress: false,
    };

    console.log('Cache refresh complete');
  } catch (error) {
    console.error('Cache refresh failed:', error);
    cache.refreshInProgress = false;
    throw error;
  }
}

// ----------------------------------------------------------------------------
// Property Parsing Helpers
// ----------------------------------------------------------------------------

function parseProgramProperties(
  props: Record<string, string | null>
): Record<string, string | number | boolean | null> {
  const parsed: Record<string, string | number | boolean | null> = {};

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === '') {
      parsed[key] = null;
      continue;
    }

    // Handle boolean fields
    if (['is_brother_sister'].includes(key)) {
      parsed[key] = value === 'true' || value === 'yes' || value === '1';
      continue;
    }

    parsed[key] = value;
  }

  return parsed;
}

function parseSessionProperties(
  props: Record<string, string | null>
): Record<string, string | number | boolean | null> {
  const parsed: Record<string, string | number | boolean | null> = {};

  const numericFields = [
    'weeks', 'age__min_', 'age__max_', 'grade_range_min', 'grade_range_max',
    'tuition__current_',
  ];

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === '') {
      parsed[key] = null;
      continue;
    }

    // Parse numeric fields
    if (numericFields.includes(key)) {
      const num = parseFloat(value);
      parsed[key] = isNaN(num) ? null : num;
      continue;
    }

    // Parse date fields (keep as ISO strings)
    if (['start_date', 'end_date'].includes(key)) {
      parsed[key] = value;
      continue;
    }

    parsed[key] = value;
  }

  return parsed;
}

// ----------------------------------------------------------------------------
// Cache Access by ID
// ----------------------------------------------------------------------------

export function getCompany(id: string): Company | undefined {
  return cache.companies.get(id);
}

export function getProgram(id: string): Program | undefined {
  return cache.programs.get(id);
}

export function getSession(id: string): Session | undefined {
  return cache.sessions.get(id);
}

export function getSessionsForProgram(programId: string): Session[] {
  const sessionIds = cache.programToSessions.get(programId) || [];
  return sessionIds
    .map(id => cache.sessions.get(id))
    .filter((s): s is Session => s !== undefined);
}

export function getCompanyForProgram(programId: string): Company | undefined {
  const companyId = cache.programToCompany.get(programId);
  return companyId ? cache.companies.get(companyId) : undefined;
}

export function getAllPrograms(): Program[] {
  return Array.from(cache.programs.values());
}

export function getAllSessions(): Session[] {
  return Array.from(cache.sessions.values());
}

export function getAllCompanies(): Company[] {
  return Array.from(cache.companies.values());
}
