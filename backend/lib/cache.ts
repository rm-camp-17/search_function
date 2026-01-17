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

    const data = await response.json() as { results?: HubSpotObject[]; paging?: { next?: { after: string } } };
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

  // Process batches with delays to avoid rate limiting
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const url = `${HUBSPOT_API_BASE}/crm/v4/associations/${fromObjectType}/${toObjectType}/batch/read`;

    let retries = 0;
    const maxRetries = 3;
    let success = false;

    while (!success && retries < maxRetries) {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: batch.map(id => ({ id })),
        }),
      });

      if (response.status === 429) {
        // Rate limited - wait and retry with exponential backoff
        retries++;
        const waitTime = Math.pow(2, retries) * 1000; // 2s, 4s, 8s
        console.log(`Rate limited, waiting ${waitTime}ms before retry ${retries}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      if (!response.ok) {
        console.error(`Association fetch failed: ${response.status}`);
        break;
      }

      const data = await response.json() as { results?: Array<{ from?: { id: string }; to?: Array<{ toObjectId: string }> }> };
      for (const result of data.results || []) {
        const fromId = result.from?.id;
        const toIds = (result.to || []).map((t) => t.toObjectId);
        if (fromId && toIds.length > 0) {
          associations.set(fromId, toIds);
        }
      }
      success = true;
    }

    // Add small delay between batches to avoid rate limits (100ms)
    if (i < batches.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
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

    // Fetch associations - do sequentially to avoid rate limits
    const programIds = programs.map(p => p.id);
    console.log(`Fetching associations for ${programIds.length} programs...`);

    // Fetch program -> company associations first
    const programToCompanyAssoc = await fetchAssociations(
      accessToken, PROGRAM_OBJECT_TYPE, 'companies', programIds
    );
    console.log(`Fetched ${programToCompanyAssoc.size} program-company associations`);

    // Then fetch program -> session associations
    const programToSessionAssoc = await fetchAssociations(
      accessToken, PROGRAM_OBJECT_TYPE, SESSION_OBJECT_TYPE, programIds
    );
    console.log(`Fetched ${programToSessionAssoc.size} program-session associations`);

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

    // Process programs first to build lookup maps
    const programIdToHubspotId = new Map<string, string>(); // program_id -> hubspot id
    const programExternalIdToHubspotId = new Map<string, string>(); // provider_id_external_ -> hubspot id

    for (const obj of programs) {
      const companyIds = programToCompanyAssoc.get(obj.id);
      const companyId = companyIds?.[0];

      const parsedProps = parseProgramProperties(obj.properties);

      newPrograms.set(obj.id, {
        id: obj.id,
        properties: parsedProps,
        createdAt: obj.createdAt,
        updatedAt: obj.updatedAt,
        companyId,
      });

      if (companyId) {
        newProgramToCompany.set(obj.id, companyId);
      }

      // Build lookup maps for session linking
      const programId = parsedProps.program_id;
      const externalId = parsedProps.provider_id_external_;
      if (programId && typeof programId === 'string') {
        programIdToHubspotId.set(programId, obj.id);
      }
      if (externalId && typeof externalId === 'string') {
        programExternalIdToHubspotId.set(externalId, obj.id);
      }
    }

    // Process sessions and build program-to-session mapping from BOTH:
    // 1. HubSpot associations (if available)
    // 2. Session properties (program_id__external_ matching program's program_id or provider_id_external_)

    // Start with associations if we have them
    for (const [programId, sessionIds] of programToSessionAssoc.entries()) {
      newProgramToSessions.set(programId, [...sessionIds]);
    }

    // Now also build from session properties as fallback/supplement
    let sessionsLinkedByProperty = 0;
    let sessionsLinkedByAssociation = programToSessionAssoc.size > 0 ?
      Array.from(programToSessionAssoc.values()).reduce((acc, ids) => acc + ids.length, 0) : 0;

    for (const obj of sessions) {
      const parsedProps = parseSessionProperties(obj.properties);

      newSessions.set(obj.id, {
        id: obj.id,
        properties: parsedProps,
        createdAt: obj.createdAt,
        updatedAt: obj.updatedAt,
      });

      // Try to link session to program via properties
      const sessionProgramId = parsedProps.program_id__external_;
      if (sessionProgramId && typeof sessionProgramId === 'string') {
        // Try matching against program_id
        let hubspotProgramId = programIdToHubspotId.get(sessionProgramId);

        // If not found, try matching against provider_id_external_
        if (!hubspotProgramId) {
          hubspotProgramId = programExternalIdToHubspotId.get(sessionProgramId);
        }

        if (hubspotProgramId) {
          const existingSessions = newProgramToSessions.get(hubspotProgramId) || [];
          if (!existingSessions.includes(obj.id)) {
            existingSessions.push(obj.id);
            newProgramToSessions.set(hubspotProgramId, existingSessions);
            sessionsLinkedByProperty++;
          }
        }
      }
    }

    console.log(`Session linking summary:`);
    console.log(`  - Sessions linked by HubSpot associations: ${sessionsLinkedByAssociation}`);
    console.log(`  - Additional sessions linked by property matching: ${sessionsLinkedByProperty}`);
    console.log(`  - Programs with sessions: ${newProgramToSessions.size}`);
    console.log(`  - Total sessions in cache: ${newSessions.size}`);

    // Log program type distribution for debugging
    const programTypeCounts = new Map<string, number>();
    for (const program of newPrograms.values()) {
      const pType = String(program.properties.program_type || 'null');
      programTypeCounts.set(pType, (programTypeCounts.get(pType) || 0) + 1);
    }
    console.log('Program type distribution:', Object.fromEntries(programTypeCounts));

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
    console.log(`Final cache stats: ${newPrograms.size} programs, ${newSessions.size} sessions, ${newProgramToSessions.size} programs with sessions`);
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
