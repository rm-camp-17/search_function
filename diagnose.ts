#!/usr/bin/env npx ts-node
/**
 * Diagnostic script to troubleshoot search function issues
 * Run with: npx ts-node diagnose.ts
 * Or: npx tsx diagnose.ts
 */

const API_BASE = 'https://camp-experts-search.vercel.app';

interface CacheStats {
  companiesCount: number;
  programsCount: number;
  sessionsCount: number;
  lastRefreshed: string | null;
  refreshInProgress: boolean;
  cacheAgeMs: number;
  associationsLoading: boolean;
  programsWithSessions: number;
  isStale: boolean;
}

interface SearchResult {
  program: {
    id: string;
    properties: Record<string, unknown>;
  };
  sessions: Array<{
    id: string;
    properties: Record<string, unknown>;
  }>;
  company: {
    id: string;
    properties: Record<string, unknown>;
  } | null;
  matchingSessionCount: number;
  totalSessionCount: number;
}

interface SearchResponse {
  success: boolean;
  data?: {
    results: SearchResult[];
    totalCount: number;
    page: number;
    pageSize: number;
    totalPages: number;
    facets: Array<{
      field: string;
      label: string;
      values: Array<{ value: string; label: string; count: number }>;
    }>;
  };
  error?: {
    code: string;
    message: string;
  };
  meta: {
    requestId: string;
    timestamp: string;
    processingTimeMs: number;
  };
}

async function checkCacheStatus(): Promise<CacheStats | null> {
  console.log('\n' + '='.repeat(60));
  console.log('STEP 1: Checking Cache Status');
  console.log('='.repeat(60));

  try {
    const response = await fetch(`${API_BASE}/api/cache`);
    const data = await response.json() as { success: boolean; data: CacheStats };

    if (data.success) {
      console.log('\n✅ Cache Status:');
      console.log(`   - Companies: ${data.data.companiesCount}`);
      console.log(`   - Programs: ${data.data.programsCount}`);
      console.log(`   - Sessions: ${data.data.sessionsCount}`);
      console.log(`   - Programs with Sessions: ${data.data.programsWithSessions}`);
      console.log(`   - Associations Loading: ${data.data.associationsLoading}`);
      console.log(`   - Last Refreshed: ${data.data.lastRefreshed}`);
      console.log(`   - Cache Age: ${Math.round(data.data.cacheAgeMs / 1000)}s`);
      console.log(`   - Is Stale: ${data.data.isStale}`);
      console.log(`   - Refresh In Progress: ${data.data.refreshInProgress}`);

      if (data.data.programsCount === 0) {
        console.log('\n⚠️  WARNING: No programs in cache! Cache may need to be refreshed.');
      }
      if (data.data.programsWithSessions === 0) {
        console.log('\n⚠️  WARNING: No program-session associations! Associations may still be loading.');
      }

      return data.data;
    } else {
      console.log('\n❌ Cache check failed:', data);
      return null;
    }
  } catch (error) {
    console.log('\n❌ Error checking cache:', error);
    return null;
  }
}

async function testSearch(
  programType: string | null,
  includeEmptyResults: boolean,
  description: string
): Promise<SearchResponse | null> {
  console.log(`\n   Testing: ${description}`);
  console.log(`   Request: programType="${programType}", includeEmptyResults=${includeEmptyResults}`);

  const body = {
    programType,
    includeEmptyResults,
    page: 1,
    pageSize: 10,
    filters: { operator: 'AND', filters: [] },
  };

  try {
    const response = await fetch(`${API_BASE}/api/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json() as SearchResponse;

    if (data.success && data.data) {
      console.log(`   ✅ Result: ${data.data.totalCount} total results, ${data.data.results.length} returned`);

      if (data.data.results.length > 0) {
        const firstResult = data.data.results[0];
        console.log(`   First result: "${firstResult.program.properties.program_name}" (${firstResult.matchingSessionCount} sessions)`);
      }

      // Show facets summary
      if (data.data.facets && data.data.facets.length > 0) {
        console.log(`   Facets: ${data.data.facets.map(f => f.field).join(', ')}`);
      }
    } else {
      console.log(`   ❌ Error: ${data.error?.code} - ${data.error?.message}`);
    }

    return data;
  } catch (error) {
    console.log(`   ❌ Request failed:`, error);
    return null;
  }
}

async function runSearchTests(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('STEP 2: Testing Search API');
  console.log('='.repeat(60));

  // Test 1: No filter, include empty results
  await testSearch(null, true, 'All programs (no filter, include empty)');

  // Test 2: No filter, exclude empty results
  await testSearch(null, false, 'All programs (no filter, exclude empty)');

  // Test 3: Overnight Camp
  await testSearch('Overnight Camp', true, 'Overnight Camp (include empty)');
  await testSearch('overnight camp', true, 'overnight camp lowercase (include empty)');

  // Test 4: Other program types
  await testSearch('Specialty Camp', true, 'Specialty Camp (include empty)');
  await testSearch('Teen Trip', true, 'Teen Trip (include empty)');
  await testSearch('Other', true, 'Other (include empty)');

  // Test 5: Company Programs (no programType filter)
  await testSearch(null, true, 'Company Programs style (no type, include empty)');
}

async function analyzeFirstResult(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('STEP 3: Analyzing First Result in Detail');
  console.log('='.repeat(60));

  const body = {
    programType: null,
    includeEmptyResults: true,
    page: 1,
    pageSize: 1,
    filters: { operator: 'AND', filters: [] },
  };

  try {
    const response = await fetch(`${API_BASE}/api/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json() as SearchResponse;

    if (data.success && data.data && data.data.results.length > 0) {
      const result = data.data.results[0];

      console.log('\n📋 Program Details:');
      console.log(`   ID: ${result.program.id}`);
      console.log(`   Name: ${result.program.properties.program_name}`);
      console.log(`   Type: ${result.program.properties.program_type}`);
      console.log(`   Primary Camp Type: ${result.program.properties.primary_camp_type}`);

      console.log('\n📋 Session Info:');
      console.log(`   Total Sessions: ${result.totalSessionCount}`);
      console.log(`   Matching Sessions: ${result.matchingSessionCount}`);

      if (result.sessions.length > 0) {
        console.log('\n   First Session:');
        const session = result.sessions[0];
        console.log(`     ID: ${session.id}`);
        console.log(`     Name: ${session.properties.session_name}`);
        console.log(`     Start: ${session.properties.start_date}`);
        console.log(`     End: ${session.properties.end_date}`);
      }

      if (result.company) {
        console.log('\n📋 Company Info:');
        console.log(`   ID: ${result.company.id}`);
        console.log(`   Name: ${result.company.properties.name}`);
      } else {
        console.log('\n⚠️  No company associated with this program');
      }

      // Show all program properties
      console.log('\n📋 All Program Properties:');
      for (const [key, value] of Object.entries(result.program.properties)) {
        if (value !== null && value !== '') {
          console.log(`   ${key}: ${JSON.stringify(value)}`);
        }
      }
    } else {
      console.log('\n❌ No results to analyze');
      if (data.error) {
        console.log(`   Error: ${data.error.code} - ${data.error.message}`);
      }
    }
  } catch (error) {
    console.log('\n❌ Error:', error);
  }
}

async function getProgramTypeDistribution(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('STEP 4: Program Type Distribution');
  console.log('='.repeat(60));

  const body = {
    programType: null,
    includeEmptyResults: true,
    page: 1,
    pageSize: 100,
    filters: { operator: 'AND', filters: [] },
  };

  try {
    const response = await fetch(`${API_BASE}/api/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json() as SearchResponse;

    if (data.success && data.data) {
      const typeCounts = new Map<string, number>();
      const typeSessionCounts = new Map<string, number>();

      for (const result of data.data.results) {
        const pType = String(result.program.properties.program_type || 'null');
        typeCounts.set(pType, (typeCounts.get(pType) || 0) + 1);
        typeSessionCounts.set(pType, (typeSessionCounts.get(pType) || 0) + result.totalSessionCount);
      }

      console.log('\nProgram types in search results:');
      for (const [type, count] of typeCounts.entries()) {
        const sessions = typeSessionCounts.get(type) || 0;
        console.log(`   "${type}": ${count} programs, ${sessions} sessions`);
      }

      console.log(`\nTotal in this page: ${data.data.results.length}`);
      console.log(`Total across all pages: ${data.data.totalCount}`);

      // Check for program_type facet
      const programTypeFacet = data.data.facets?.find(f => f.field === 'program_type');
      if (programTypeFacet) {
        console.log('\nProgram Type Facet Values:');
        for (const v of programTypeFacet.values) {
          console.log(`   "${v.value}": ${v.count} (label: ${v.label})`);
        }
      }
    }
  } catch (error) {
    console.log('\n❌ Error:', error);
  }
}

async function testFrontendRequest(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('STEP 5: Simulating Frontend Requests');
  console.log('='.repeat(60));

  // This simulates what the HubSpot UI Extension might be sending
  const frontendRequests = [
    {
      name: 'Company Tab (initial load)',
      body: {
        query: '',
        programType: null,
        includeEmptyResults: true,
        page: 1,
        pageSize: 20,
        filters: { operator: 'AND', filters: [] },
      },
    },
    {
      name: 'Overnight Camp Tab',
      body: {
        query: '',
        programType: 'Overnight Camp',
        includeEmptyResults: true,
        page: 1,
        pageSize: 20,
        filters: { operator: 'AND', filters: [] },
      },
    },
    {
      name: 'Specialty Camp Tab',
      body: {
        query: '',
        programType: 'Specialty Camp',
        includeEmptyResults: true,
        page: 1,
        pageSize: 20,
        filters: { operator: 'AND', filters: [] },
      },
    },
  ];

  for (const req of frontendRequests) {
    console.log(`\n🔍 ${req.name}:`);
    console.log(`   Request body: ${JSON.stringify(req.body)}`);

    try {
      const response = await fetch(`${API_BASE}/api/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(req.body),
      });

      const data = await response.json() as SearchResponse;

      console.log(`   HTTP Status: ${response.status}`);
      console.log(`   Success: ${data.success}`);

      if (data.success && data.data) {
        console.log(`   Results: ${data.data.totalCount} total, ${data.data.results.length} returned`);
        console.log(`   Processing Time: ${data.meta.processingTimeMs}ms`);

        // Show first 3 results
        if (data.data.results.length > 0) {
          console.log('   First results:');
          for (let i = 0; i < Math.min(3, data.data.results.length); i++) {
            const r = data.data.results[i];
            console.log(`     ${i + 1}. "${r.program.properties.program_name}" (${r.matchingSessionCount} sessions)`);
          }
        }
      } else if (data.error) {
        console.log(`   Error: ${data.error.code} - ${data.error.message}`);
      }
    } catch (error) {
      console.log(`   ❌ Request failed:`, error);
    }
  }
}

async function checkSchemaEndpoint(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('STEP 6: Checking Schema Endpoint');
  console.log('='.repeat(60));

  try {
    const response = await fetch(`${API_BASE}/api/schema`);
    console.log(`   HTTP Status: ${response.status}`);

    if (response.ok) {
      const data = await response.json();
      console.log('   ✅ Schema endpoint working');
      if (data.data) {
        console.log(`   Program properties: ${data.data.program?.properties?.length || 0}`);
        console.log(`   Session properties: ${data.data.session?.properties?.length || 0}`);
        console.log(`   Company properties: ${data.data.company?.properties?.length || 0}`);
      }
    } else {
      const text = await response.text();
      console.log(`   ❌ Schema endpoint failed: ${text}`);
    }
  } catch (error) {
    console.log(`   ❌ Error:`, error);
  }
}

async function main(): Promise<void> {
  console.log('🔍 Search Function Diagnostic Tool');
  console.log('='.repeat(60));
  console.log(`API Base: ${API_BASE}`);
  console.log(`Time: ${new Date().toISOString()}`);

  await checkCacheStatus();
  await runSearchTests();
  await analyzeFirstResult();
  await getProgramTypeDistribution();
  await testFrontendRequest();
  await checkSchemaEndpoint();

  console.log('\n' + '='.repeat(60));
  console.log('DIAGNOSTIC COMPLETE');
  console.log('='.repeat(60));
  console.log('\nNext steps based on results:');
  console.log('1. If cache shows 0 programs → Run: curl -X POST ' + API_BASE + '/api/cache?full=true');
  console.log('2. If programs exist but 0 sessions → Wait for associations or check HubSpot associations');
  console.log('3. If API returns data but UI shows nothing → Check frontend code and network tab');
  console.log('4. If program_type values don\'t match → Update frontend to use exact values from API');
}

main().catch(console.error);
