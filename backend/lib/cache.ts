// ============================================================================
// Data Cache Manager
// Handles hourly refresh and in-memory storage of HubSpot data
// Uses HubSpot associations as the source of truth for relationships
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

// Track if associations are still loading (separate from objects)
let associationsLoading = false;
let associationsLastRefreshed = new Date(0);

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// HubSpot API configuration
const HUBSPOT_API_BASE = 'https://api.hubapi.com';
const PROGRAM_OBJECT_TYPE = '2-50911446';
const SESSION_OBJECT_TYPE = '2-50911450';

// Rate limiting configuration - balance between speed and avoiding 429s
const ASSOCIATION_BATCH_SIZE = 50; // Smaller batches
const ASSOCIATION_BATCH_DELAY_MS = 250; // 250ms between batches (was 500ms)
const ASSOCIATION_RETRY_DELAY_MS = 2000; // 2s initial retry delay
const ASSOCIATION_MAX_RETRIES = 5;

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

export function getCacheStats(): CacheStats & { associationsLoading: boolean; programsWithSessions: number } {
  return {
    companiesCount: cache.companies.size,
    programsCount: cache.programs.size,
    sessionsCount: cache.sessions.size,
    lastRefreshed: cache.lastRefreshed.getTime() > 0
      ? cache.lastRefreshed.toISOString()
      : null,
    refreshInProgress: cache.refreshInProgress,
    cacheAgeMs: Date.now() - cache.lastRefreshed.getTime(),
    associationsLoading,
    programsWithSessions: cache.programToSessions.size,
  };
}

export function areAssociationsLoaded(): boolean {
  return associationsLastRefreshed.getTime() > 0 && !associationsLoading;
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

  // Use smaller batches to avoid rate limits
  const batches: string[][] = [];
  for (let i = 0; i < objectIds.length; i += ASSOCIATION_BATCH_SIZE) {
    batches.push(objectIds.slice(i, i + ASSOCIATION_BATCH_SIZE));
  }

  console.log(`Fetching associations in ${batches.length} batches of ${ASSOCIATION_BATCH_SIZE}...`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const url = `${HUBSPOT_API_BASE}/crm/v4/associations/${fromObjectType}/${toObjectType}/batch/read`;

    let retries = 0;
    let success = false;

    while (!success && retries < ASSOCIATION_MAX_RETRIES) {
      try {
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
          // Rate limited - wait with exponential backoff
          retries++;
          const waitTime = ASSOCIATION_RETRY_DELAY_MS * Math.pow(2, retries - 1);
          console.log(`Rate limited on batch ${i + 1}/${batches.length}, waiting ${waitTime}ms (retry ${retries}/${ASSOCIATION_MAX_RETRIES})`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Association fetch failed for batch ${i + 1}: ${response.status} - ${errorText}`);
          retries++;
          await new Promise(resolve => setTimeout(resolve, ASSOCIATION_RETRY_DELAY_MS));
          continue;
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

        // Log progress every 10 batches
        if ((i + 1) % 10 === 0) {
          console.log(`  Processed ${i + 1}/${batches.length} batches, ${associations.size} associations found so far`);
        }
      } catch (error) {
        console.error(`Error fetching associations batch ${i + 1}:`, error);
        retries++;
        await new Promise(resolve => setTimeout(resolve, ASSOCIATION_RETRY_DELAY_MS));
      }
    }

    if (!success) {
      console.error(`Failed to fetch associations for batch ${i + 1} after ${ASSOCIATION_MAX_RETRIES} retries`);
    }

    // Delay between batches to avoid rate limits
    if (i < batches.length - 1) {
      await new Promise(resolve => setTimeout(resolve, ASSOCIATION_BATCH_DELAY_MS));
    }
  }

  return associations;
}

// ----------------------------------------------------------------------------
// Cache Refresh Logic - Two-Phase Approach
// Phase 1: Load objects (fast, ~5s) - makes cache usable for search
// Phase 2: Load associations (slow, ~30-60s) - runs in background
// ----------------------------------------------------------------------------

// Company properties - using EXACT HubSpot internal names
const companyProperties = [
  'name',
  'short_program_name',
  'domain',
  'email',
  'phone',
  'phone_2',
  'country_hq',
  'us_state',
  'four_sentence_summary_for_parents',
  'highlights_and_any_concerns_expressed',
  'programming',
  'religious_structure',
  'vibe',
  'territory',
  'commission_rate',
  'commission_type',
  'commission_basis',
  'commission_structure___summary',
  'programid',                 // "CompanyId" - note: HubSpot internal name is 'programid'
  'provider_ext_id_salesforce',
  'website_for_recommendation_entry',
  'tfs_weeks',
  'session_weeks',
  'lifecyclestage',
];

// Program properties - using EXACT HubSpot internal names
const programProperties = [
  'program_name',
  'program_id',
  'recordtype_name',           // "Program Type" - this is the key field for filtering!
  'description__c',            // "Description"
  'primary_camp_type__c',      // "Primary Camp Type"
  'camp_subtype__c',           // "Camp Subtype"
  'experience_subtype',        // "Experience Subtype"
  'specialty_subtype',         // "Specialty Subtype"
  'region__c',                 // "Region"
  'gender_structure_subtype__c', // "Gender Structure"
  'brother_sister_conditional_on_gender__c', // "Brother - Sister"
  'is_brother__sister',        // "Is Brother - Sister?"
  'programming_philosophy__c', // "Programming Philosophy"
  'accommodations__c',         // "Accommodations"
  'provider_id',               // "Provider ID (External)"
];

// Session properties - using EXACT HubSpot internal names
const sessionProperties = [
  'session_name',
  'session_id',
  'start_date__c',             // "Start Date"
  'end_date__c',               // "End Date"
  'weeks',                     // "Weeks" (calculation)
  'age_range_min__c',          // "Age (Min)"
  'age_range_max__c',          // "Age (Max)"
  'grade_range_min',           // "Grade Range Min"
  'grade_range_max',           // "Grade Range Max"
  'tuition_current',           // "Tuition (Current)"
  'currencyisocode',           // "Tuition Currency"
  'program_type',              // "Program Type"
  'primary_camp_type',         // "Primary Camp Type"
  'experience_subtype',        // "Experience Subtype"
  'specialty_subtype',         // "Specialty Subtype"
  'locations_traveled__c',     // "Locations"
  'sport_options__c',          // "Sport Options"
  'arts_options__c',           // "Arts Options"
  'education_options__c',      // "Education Options"
  'itinerary__c',              // "Itinerary"
  'notes__c',                  // "Notes__c"
  'program_id',                // "Program ID (External)" - for linking
];

// Phase 1: Load objects only (fast)
async function loadObjects(accessToken: string): Promise<{
  companies: HubSpotObject[];
  programs: HubSpotObject[];
  sessions: HubSpotObject[];
}> {
  console.log('Phase 1: Fetching objects from HubSpot...');
  const [companies, programs, sessions] = await Promise.all([
    fetchHubSpotObjects(accessToken, 'companies', companyProperties),
    fetchHubSpotObjects(accessToken, PROGRAM_OBJECT_TYPE, programProperties),
    fetchHubSpotObjects(accessToken, SESSION_OBJECT_TYPE, sessionProperties),
  ]);
  console.log(`Phase 1 complete: ${companies.length} companies, ${programs.length} programs, ${sessions.length} sessions`);
  return { companies, programs, sessions };
}

// Phase 2: Load associations (slow, runs in background)
async function loadAssociations(accessToken: string, programIds: string[]): Promise<void> {
  if (associationsLoading) {
    console.log('Associations already loading, skipping...');
    return;
  }

  associationsLoading = true;
  console.log(`Phase 2: Fetching associations for ${programIds.length} programs...`);

  try {
    // Fetch program -> company associations
    console.log('Fetching program-company associations...');
    const programToCompanyAssoc = await fetchAssociations(
      accessToken, PROGRAM_OBJECT_TYPE, 'companies', programIds
    );
    console.log(`Fetched ${programToCompanyAssoc.size} program-company associations`);

    // Apply company associations immediately
    for (const [programId, companyIds] of programToCompanyAssoc.entries()) {
      if (companyIds.length > 0) {
        cache.programToCompany.set(programId, companyIds[0]);
        const program = cache.programs.get(programId);
        if (program) {
          program.companyId = companyIds[0];
        }
      }
    }

    // Fetch program -> session associations
    console.log('Fetching program-session associations...');
    const programToSessionAssoc = await fetchAssociations(
      accessToken, PROGRAM_OBJECT_TYPE, SESSION_OBJECT_TYPE, programIds
    );
    console.log(`Fetched ${programToSessionAssoc.size} program-session associations`);

    // Apply session associations
    for (const [programId, sessionIds] of programToSessionAssoc.entries()) {
      if (sessionIds.length > 0) {
        cache.programToSessions.set(programId, sessionIds);
      }
    }

    // Count how many sessions are linked
    const totalLinkedSessions = Array.from(cache.programToSessions.values())
      .reduce((acc, ids) => acc + ids.length, 0);

    console.log(`Phase 2 complete - Association summary:`);
    console.log(`  - Programs with company: ${cache.programToCompany.size}`);
    console.log(`  - Programs with sessions: ${cache.programToSessions.size}`);
    console.log(`  - Total session links: ${totalLinkedSessions}`);

    associationsLastRefreshed = new Date();
  } catch (error) {
    console.error('Association loading failed:', error);
  } finally {
    associationsLoading = false;
  }
}

export async function refreshCache(accessToken: string): Promise<void> {
  if (cache.refreshInProgress) {
    console.log('Cache refresh already in progress, skipping...');
    return;
  }

  cache.refreshInProgress = true;
  console.log('Starting cache refresh (two-phase approach)...');

  try {
    // Phase 1: Load objects (fast, ~5s)
    const { companies, programs, sessions } = await loadObjects(accessToken);

    // Build cache maps for objects
    const newCompanies = new Map<string, Company>();
    const newPrograms = new Map<string, Program>();
    const newSessions = new Map<string, Session>();

    for (const obj of companies) {
      newCompanies.set(obj.id, {
        id: obj.id,
        properties: obj.properties as Record<string, string | number | boolean | null>,
        createdAt: obj.createdAt,
        updatedAt: obj.updatedAt,
      });
    }

    for (const obj of sessions) {
      newSessions.set(obj.id, {
        id: obj.id,
        properties: parseSessionProperties(obj.properties),
        createdAt: obj.createdAt,
        updatedAt: obj.updatedAt,
      });
    }

    for (const obj of programs) {
      newPrograms.set(obj.id, {
        id: obj.id,
        properties: parseProgramProperties(obj.properties),
        createdAt: obj.createdAt,
        updatedAt: obj.updatedAt,
      });
    }

    // Log program type distribution
    const programTypeCounts = new Map<string, number>();
    for (const program of newPrograms.values()) {
      const pType = String(program.properties.program_type || 'null');
      programTypeCounts.set(pType, (programTypeCounts.get(pType) || 0) + 1);
    }
    console.log('Program type distribution:', Object.fromEntries(programTypeCounts));

    // Update cache with objects (makes cache usable immediately)
    // Preserve existing associations if we have them
    cache = {
      companies: newCompanies,
      programs: newPrograms,
      sessions: newSessions,
      programToCompany: cache.programToCompany.size > 0 ? cache.programToCompany : new Map(),
      programToSessions: cache.programToSessions.size > 0 ? cache.programToSessions : new Map(),
      lastRefreshed: new Date(),
      refreshInProgress: false,
    };

    console.log(`Phase 1 cache update complete: ${newPrograms.size} programs, ${newSessions.size} sessions`);
    console.log(`Existing associations preserved: ${cache.programToSessions.size} programs with sessions`);

    // Phase 2: Load associations in background (don't await)
    const programIds = programs.map(p => p.id);
    loadAssociations(accessToken, programIds).catch(err => {
      console.error('Background association loading failed:', err);
    });

  } catch (error) {
    console.error('Cache refresh failed:', error);
    cache.refreshInProgress = false;
    throw error;
  }
}

// Full refresh that waits for associations (use for cron/manual refresh)
export async function refreshCacheFull(accessToken: string): Promise<void> {
  if (cache.refreshInProgress || associationsLoading) {
    console.log('Cache refresh already in progress, skipping...');
    return;
  }

  cache.refreshInProgress = true;
  console.log('Starting full cache refresh...');

  try {
    // Phase 1: Load objects
    const { companies, programs, sessions } = await loadObjects(accessToken);

    // Build cache maps
    const newCompanies = new Map<string, Company>();
    const newPrograms = new Map<string, Program>();
    const newSessions = new Map<string, Session>();

    for (const obj of companies) {
      newCompanies.set(obj.id, {
        id: obj.id,
        properties: obj.properties as Record<string, string | number | boolean | null>,
        createdAt: obj.createdAt,
        updatedAt: obj.updatedAt,
      });
    }

    for (const obj of sessions) {
      newSessions.set(obj.id, {
        id: obj.id,
        properties: parseSessionProperties(obj.properties),
        createdAt: obj.createdAt,
        updatedAt: obj.updatedAt,
      });
    }

    for (const obj of programs) {
      newPrograms.set(obj.id, {
        id: obj.id,
        properties: parseProgramProperties(obj.properties),
        createdAt: obj.createdAt,
        updatedAt: obj.updatedAt,
      });
    }

    // Update cache with objects
    cache = {
      companies: newCompanies,
      programs: newPrograms,
      sessions: newSessions,
      programToCompany: new Map(),
      programToSessions: new Map(),
      lastRefreshed: new Date(),
      refreshInProgress: false,
    };

    // Phase 2: Load associations (wait for completion)
    const programIds = programs.map(p => p.id);
    await loadAssociations(accessToken, programIds);

    console.log('Full cache refresh complete');
    console.log(`Final stats: ${cache.programs.size} programs, ${cache.sessions.size} sessions, ${cache.programToSessions.size} with linked sessions`);

  } catch (error) {
    console.error('Full cache refresh failed:', error);
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

  // Map HubSpot property names to our internal names
  const propertyMapping: Record<string, string> = {
    'recordtype_name': 'program_type',
    'description__c': 'description',
    'primary_camp_type__c': 'primary_camp_type',
    'camp_subtype__c': 'camp_subtype',
    'region__c': 'region',
    'gender_structure_subtype__c': 'gender_structure',
    'brother_sister_conditional_on_gender__c': 'brother_sister',
    'is_brother__sister': 'is_brother_sister',
    'programming_philosophy__c': 'programming_philosophy',
    'accommodations__c': 'accommodations',
    'provider_id': 'provider_id_external_',
  };

  for (const [key, value] of Object.entries(props)) {
    // Use mapped name if available, otherwise use original
    const mappedKey = propertyMapping[key] || key;

    if (value === null || value === '') {
      parsed[mappedKey] = null;
      continue;
    }

    // Handle boolean fields
    if (mappedKey === 'is_brother_sister') {
      parsed[mappedKey] = value === 'true' || value === 'yes' || value === '1';
      continue;
    }

    parsed[mappedKey] = value;
  }

  return parsed;
}

function parseSessionProperties(
  props: Record<string, string | null>
): Record<string, string | number | boolean | null> {
  const parsed: Record<string, string | number | boolean | null> = {};

  // Map HubSpot property names to our internal names
  const propertyMapping: Record<string, string> = {
    'start_date__c': 'start_date',
    'end_date__c': 'end_date',
    'age_range_min__c': 'age__min_',
    'age_range_max__c': 'age__max_',
    'tuition_current': 'tuition__current_',
    'currencyisocode': 'tuition_currency',
    'locations_traveled__c': 'locations',
    'sport_options__c': 'sport_options',
    'arts_options__c': 'arts_options',
    'education_options__c': 'education_options',
    'itinerary__c': 'itinerary',
  };

  const numericFields = [
    'weeks', 'age__min_', 'age__max_', 'grade_range_min', 'grade_range_max',
    'tuition__current_',
  ];

  for (const [key, value] of Object.entries(props)) {
    // Use mapped name if available, otherwise use original
    const mappedKey = propertyMapping[key] || key;

    if (value === null || value === '') {
      parsed[mappedKey] = null;
      continue;
    }

    // Parse numeric fields
    if (numericFields.includes(mappedKey)) {
      const num = parseFloat(value);
      parsed[mappedKey] = isNaN(num) ? null : num;
      continue;
    }

    // Parse date fields (keep as ISO strings)
    if (['start_date', 'end_date'].includes(mappedKey)) {
      parsed[mappedKey] = value;
      continue;
    }

    parsed[mappedKey] = value;
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
