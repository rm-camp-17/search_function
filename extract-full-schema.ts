#!/usr/bin/env npx ts-node
/**
 * Complete HubSpot Schema Extractor
 * Extracts all properties and enumeration options for Companies, Programs, and Sessions
 *
 * Run with: HUBSPOT_ACCESS_TOKEN=your_token npx tsx extract-full-schema.ts > schema-dump.json
 */

const HUBSPOT_API_BASE = 'https://api.hubapi.com';
const PROGRAM_OBJECT_TYPE = '2-50911446';
const SESSION_OBJECT_TYPE = '2-50911450';

interface PropertyOption {
  value: string;
  label: string;
  description?: string;
  displayOrder?: number;
  hidden?: boolean;
}

interface Property {
  name: string;
  label: string;
  type: string;
  fieldType: string;
  groupName: string;
  description?: string;
  options?: PropertyOption[];
  calculated?: boolean;
  hasUniqueValue?: boolean;
  hidden?: boolean;
  modificationMetadata?: {
    readOnlyValue: boolean;
  };
}

interface ObjectSchema {
  objectType: string;
  objectTypeLabel: string;
  properties: Property[];
  propertyCount: number;
  enumerationFields: string[];
  sampleRecords?: Record<string, unknown>[];
}

interface FullSchema {
  extractedAt: string;
  hubspotPortalId?: string;
  objects: {
    company: ObjectSchema;
    program: ObjectSchema;
    session: ObjectSchema;
  };
  associations: {
    programToCompany: string;
    programToSession: string;
  };
}

async function fetchObjectSchema(accessToken: string, objectType: string): Promise<Property[]> {
  const url = `${HUBSPOT_API_BASE}/crm/v3/properties/${objectType}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch schema for ${objectType}: ${response.status}`);
  }

  const data = await response.json() as { results: Property[] };
  return data.results;
}

async function fetchSampleRecords(
  accessToken: string,
  objectType: string,
  properties: string[],
  limit: number = 5
): Promise<Record<string, unknown>[]> {
  const url = new URL(`${HUBSPOT_API_BASE}/crm/v3/objects/${objectType}`);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('properties', properties.join(','));

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    console.error(`Failed to fetch sample records for ${objectType}: ${response.status}`);
    return [];
  }

  const data = await response.json() as { results: Array<{ id: string; properties: Record<string, unknown> }> };
  return data.results.map(r => ({ id: r.id, ...r.properties }));
}

async function fetchAssociationTypes(accessToken: string): Promise<Record<string, unknown>[]> {
  // Get association definitions
  const url = `${HUBSPOT_API_BASE}/crm/v4/associations/${PROGRAM_OBJECT_TYPE}/labels`;
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.ok) {
      const data = await response.json();
      return data.results || [];
    }
  } catch (e) {
    // Ignore
  }
  return [];
}

function buildObjectSchema(
  objectType: string,
  objectTypeLabel: string,
  properties: Property[]
): ObjectSchema {
  const enumerationFields = properties
    .filter(p => p.type === 'enumeration' && p.options && p.options.length > 0)
    .map(p => p.name);

  return {
    objectType,
    objectTypeLabel,
    properties: properties.map(p => ({
      name: p.name,
      label: p.label,
      type: p.type,
      fieldType: p.fieldType,
      groupName: p.groupName,
      description: p.description,
      options: p.options,
      calculated: p.calculated,
      hasUniqueValue: p.hasUniqueValue,
      hidden: p.hidden,
    })),
    propertyCount: properties.length,
    enumerationFields,
  };
}

async function main(): Promise<void> {
  const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;

  if (!accessToken) {
    // Try to read from backend/.env
    try {
      const fs = await import('fs');
      const path = await import('path');
      const envPath = path.join(process.cwd(), 'backend', '.env');
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        const match = envContent.match(/HUBSPOT_ACCESS_TOKEN=(.+)/);
        if (match) {
          process.env.HUBSPOT_ACCESS_TOKEN = match[1].trim();
          return main();
        }
      }
    } catch (e) {
      // Ignore
    }
    console.error('HUBSPOT_ACCESS_TOKEN environment variable is required');
    console.error('Run with: HUBSPOT_ACCESS_TOKEN=your_token npx tsx extract-full-schema.ts');
    process.exit(1);
  }

  console.error('Extracting HubSpot schema...');

  // Fetch all schemas
  console.error('  Fetching Company schema...');
  const companyProps = await fetchObjectSchema(accessToken, 'companies');

  console.error('  Fetching Program schema...');
  const programProps = await fetchObjectSchema(accessToken, PROGRAM_OBJECT_TYPE);

  console.error('  Fetching Session schema...');
  const sessionProps = await fetchObjectSchema(accessToken, SESSION_OBJECT_TYPE);

  // Fetch sample records
  console.error('  Fetching sample Company records...');
  const companyPropNames = companyProps.slice(0, 50).map(p => p.name);
  const companySamples = await fetchSampleRecords(accessToken, 'companies', companyPropNames, 3);

  console.error('  Fetching sample Program records...');
  const programPropNames = programProps.map(p => p.name);
  const programSamples = await fetchSampleRecords(accessToken, PROGRAM_OBJECT_TYPE, programPropNames, 5);

  console.error('  Fetching sample Session records...');
  const sessionPropNames = sessionProps.map(p => p.name);
  const sessionSamples = await fetchSampleRecords(accessToken, SESSION_OBJECT_TYPE, sessionPropNames, 5);

  // Build full schema
  const fullSchema: FullSchema = {
    extractedAt: new Date().toISOString(),
    objects: {
      company: {
        ...buildObjectSchema('companies', 'Company', companyProps),
        sampleRecords: companySamples,
      },
      program: {
        ...buildObjectSchema(PROGRAM_OBJECT_TYPE, 'Program', programProps),
        sampleRecords: programSamples,
      },
      session: {
        ...buildObjectSchema(SESSION_OBJECT_TYPE, 'Session', sessionProps),
        sampleRecords: sessionSamples,
      },
    },
    associations: {
      programToCompany: `${PROGRAM_OBJECT_TYPE} -> companies`,
      programToSession: `${PROGRAM_OBJECT_TYPE} -> ${SESSION_OBJECT_TYPE}`,
    },
  };

  // Output as JSON
  console.log(JSON.stringify(fullSchema, null, 2));

  console.error('\nSchema extraction complete!');
  console.error(`  Companies: ${companyProps.length} properties`);
  console.error(`  Programs: ${programProps.length} properties`);
  console.error(`  Sessions: ${sessionProps.length} properties`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
