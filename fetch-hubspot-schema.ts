#!/usr/bin/env npx ts-node
/**
 * Fetch actual HubSpot schema to see what properties exist
 * Run with: HUBSPOT_ACCESS_TOKEN=your_token npx tsx fetch-hubspot-schema.ts
 */

const HUBSPOT_API_BASE = 'https://api.hubapi.com';
const PROGRAM_OBJECT_TYPE = '2-50911446';
const SESSION_OBJECT_TYPE = '2-50911450';

async function fetchObjectSchema(accessToken: string, objectType: string, objectName: string): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Schema for ${objectName} (${objectType})`);
  console.log('='.repeat(60));

  try {
    // Fetch schema/properties for the object type
    const url = `${HUBSPOT_API_BASE}/crm/v3/properties/${objectType}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      console.log(`❌ Failed to fetch schema: ${response.status} - ${error}`);
      return;
    }

    const data = await response.json() as { results: Array<{ name: string; label: string; type: string; fieldType: string; groupName: string }> };

    console.log(`\nFound ${data.results.length} properties:\n`);

    // Group by groupName
    const groups = new Map<string, typeof data.results>();
    for (const prop of data.results) {
      const group = prop.groupName || 'ungrouped';
      if (!groups.has(group)) {
        groups.set(group, []);
      }
      groups.get(group)!.push(prop);
    }

    for (const [groupName, props] of groups.entries()) {
      console.log(`\n📁 ${groupName}:`);
      for (const prop of props) {
        console.log(`   - ${prop.name} (${prop.type}/${prop.fieldType}): "${prop.label}"`);
      }
    }

    // List all property names for easy copy-paste
    console.log(`\n📋 All property internal names:`);
    const names = data.results.map(p => p.name).sort();
    console.log(names.join(', '));

  } catch (error) {
    console.log(`❌ Error:`, error);
  }
}

async function fetchSampleObjects(accessToken: string, objectType: string, objectName: string): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Sample ${objectName} objects (first 3)`);
  console.log('='.repeat(60));

  try {
    // Fetch a few objects with ALL properties
    const url = `${HUBSPOT_API_BASE}/crm/v3/objects/${objectType}?limit=3&properties=*`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      // Try without the * which might not be supported
      const url2 = `${HUBSPOT_API_BASE}/crm/v3/objects/${objectType}?limit=3`;
      const response2 = await fetch(url2, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response2.ok) {
        const error = await response2.text();
        console.log(`❌ Failed to fetch objects: ${response2.status} - ${error}`);
        return;
      }

      const data = await response2.json() as { results: Array<{ id: string; properties: Record<string, string> }> };
      console.log(`\nFetched ${data.results.length} objects (default properties only):\n`);

      for (const obj of data.results) {
        console.log(`\nObject ID: ${obj.id}`);
        for (const [key, value] of Object.entries(obj.properties)) {
          if (value !== null && value !== '') {
            console.log(`   ${key}: ${value}`);
          }
        }
      }
      return;
    }

    const data = await response.json() as { results: Array<{ id: string; properties: Record<string, string> }> };
    console.log(`\nFetched ${data.results.length} objects:\n`);

    for (const obj of data.results) {
      console.log(`\nObject ID: ${obj.id}`);
      for (const [key, value] of Object.entries(obj.properties)) {
        if (value !== null && value !== '') {
          console.log(`   ${key}: ${value}`);
        }
      }
    }

  } catch (error) {
    console.log(`❌ Error:`, error);
  }
}

async function fetchObjectWithAllProperties(accessToken: string, objectType: string, objectName: string, propertyNames: string[]): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Sample ${objectName} with specific properties`);
  console.log('='.repeat(60));

  try {
    const url = `${HUBSPOT_API_BASE}/crm/v3/objects/${objectType}?limit=3&properties=${propertyNames.join(',')}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      console.log(`❌ Failed to fetch: ${response.status} - ${error}`);
      return;
    }

    const data = await response.json() as { results: Array<{ id: string; properties: Record<string, string> }> };
    console.log(`\nFetched ${data.results.length} objects:\n`);

    for (const obj of data.results) {
      console.log(`\nObject ID: ${obj.id}`);
      const nonEmptyProps: string[] = [];
      const emptyProps: string[] = [];

      for (const [key, value] of Object.entries(obj.properties)) {
        if (value !== null && value !== '') {
          nonEmptyProps.push(`${key}: ${value}`);
        } else {
          emptyProps.push(key);
        }
      }

      console.log('   Non-empty properties:');
      for (const p of nonEmptyProps) {
        console.log(`      ${p}`);
      }

      if (emptyProps.length > 0) {
        console.log(`   Empty/null properties: ${emptyProps.join(', ')}`);
      }
    }

  } catch (error) {
    console.log(`❌ Error:`, error);
  }
}

async function main(): Promise<void> {
  const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;

  if (!accessToken) {
    console.log('❌ HUBSPOT_ACCESS_TOKEN environment variable is required');
    console.log('Run with: HUBSPOT_ACCESS_TOKEN=your_token npx tsx fetch-hubspot-schema.ts');

    // Try to read from .env file if it exists
    try {
      const fs = await import('fs');
      const path = await import('path');
      const envPath = path.join(process.cwd(), 'backend', '.env');
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        const match = envContent.match(/HUBSPOT_ACCESS_TOKEN=(.+)/);
        if (match) {
          console.log('\nFound token in backend/.env, using that...');
          process.env.HUBSPOT_ACCESS_TOKEN = match[1].trim();
          return main();
        }
      }
    } catch (e) {
      // Ignore
    }

    return;
  }

  console.log('🔍 HubSpot Schema Diagnostic Tool');
  console.log('='.repeat(60));

  // Fetch schemas
  await fetchObjectSchema(accessToken, PROGRAM_OBJECT_TYPE, 'Program');
  await fetchObjectSchema(accessToken, SESSION_OBJECT_TYPE, 'Session');
  await fetchObjectSchema(accessToken, 'companies', 'Company');

  // Fetch sample objects
  await fetchSampleObjects(accessToken, PROGRAM_OBJECT_TYPE, 'Program');
  await fetchSampleObjects(accessToken, SESSION_OBJECT_TYPE, 'Session');

  console.log('\n' + '='.repeat(60));
  console.log('DONE');
  console.log('='.repeat(60));
  console.log('\nCompare the property names above with what we use in cache.ts');
  console.log('The internal names must match EXACTLY (case-sensitive)');
}

main().catch(console.error);
