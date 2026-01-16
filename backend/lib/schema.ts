// ============================================================================
// Schema Loader and Configuration Manager
// Loads property schemas and provides schema-driven metadata
// ============================================================================

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type {
  SearchConfig,
  PropertySchema,
  PropertyDefinition,
  FilterableField,
  FacetableField,
  SchemaResponse,
  FilterOperator,
} from '../types/index.js';

// Get directory path for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to schema files (inside backend directory for Vercel deployment)
const SCHEMA_DIR = join(__dirname, '../schemas');

// Cached schema data
let searchConfig: SearchConfig | null = null;
let programSchema: PropertySchema | null = null;
let sessionSchema: PropertySchema | null = null;
let companySchema: PropertySchema | null = null;

// ----------------------------------------------------------------------------
// Schema Loading
// ----------------------------------------------------------------------------

function loadJsonFile<T>(filename: string): T {
  const filepath = join(SCHEMA_DIR, filename);
  const content = readFileSync(filepath, 'utf-8');
  return JSON.parse(content) as T;
}

export function loadSchemas(): void {
  try {
    searchConfig = loadJsonFile<SearchConfig>('search-config.json');
    programSchema = loadJsonFile<PropertySchema>('program-properties.json');
    sessionSchema = loadJsonFile<PropertySchema>('session-properties.json');
    companySchema = loadJsonFile<PropertySchema>('company-properties.json');
    console.log('Schemas loaded successfully');
  } catch (error) {
    console.error('Failed to load schemas:', error);
    throw error;
  }
}

export function getSearchConfig(): SearchConfig {
  if (!searchConfig) {
    loadSchemas();
  }
  return searchConfig!;
}

export function getProgramSchema(): PropertySchema {
  if (!programSchema) {
    loadSchemas();
  }
  return programSchema!;
}

export function getSessionSchema(): PropertySchema {
  if (!sessionSchema) {
    loadSchemas();
  }
  return sessionSchema!;
}

export function getCompanySchema(): PropertySchema {
  if (!companySchema) {
    loadSchemas();
  }
  return companySchema!;
}

// ----------------------------------------------------------------------------
// Schema Query Functions
// ----------------------------------------------------------------------------

export function getPropertyDefinition(
  objectType: 'program' | 'session' | 'company',
  propertyName: string
): PropertyDefinition | undefined {
  const schema = objectType === 'program'
    ? getProgramSchema()
    : objectType === 'session'
      ? getSessionSchema()
      : getCompanySchema();

  return schema.properties.find(p => p.name === propertyName);
}

export function getSearchableFields(
  objectType: 'program' | 'session' | 'company'
): PropertyDefinition[] {
  const schema = objectType === 'program'
    ? getProgramSchema()
    : objectType === 'session'
      ? getSessionSchema()
      : getCompanySchema();

  return schema.properties.filter(p => p.searchable);
}

export function getFilterableFieldsForType(
  objectType: 'program' | 'session' | 'company',
  programType?: string
): FilterableField[] {
  const schema = objectType === 'program'
    ? getProgramSchema()
    : objectType === 'session'
      ? getSessionSchema()
      : getCompanySchema();

  return schema.properties
    .filter(p => {
      if (!p.filterable) return false;

      // Check record type applicability for programs
      if (objectType === 'program' && p.applicableRecordTypes && programType) {
        if (!p.applicableRecordTypes.includes('*') &&
            !p.applicableRecordTypes.includes(programType)) {
          return false;
        }
      }

      // Check parent program type applicability for sessions
      if (objectType === 'session' && p.applicableParentProgramTypes && programType) {
        if (!p.applicableParentProgramTypes.includes('*') &&
            !p.applicableParentProgramTypes.includes(programType)) {
          return false;
        }
      }

      return true;
    })
    .map(p => ({
      field: p.name,
      label: p.label,
      objectType,
      type: p.type,
      operators: getOperatorsForField(p),
      options: p.options,
      buckets: p.buckets,
      multiSelect: p.multiSelect,
      applicableRecordTypes: p.applicableRecordTypes,
      applicableParentProgramTypes: p.applicableParentProgramTypes,
    }));
}

export function getFacetableFieldsForType(
  objectType: 'program' | 'session' | 'company',
  programType?: string
): FacetableField[] {
  const schema = objectType === 'program'
    ? getProgramSchema()
    : objectType === 'session'
      ? getSessionSchema()
      : getCompanySchema();

  return schema.properties
    .filter(p => {
      if (!p.facetable) return false;

      // Check record type applicability for programs
      if (objectType === 'program' && p.applicableRecordTypes && programType) {
        if (!p.applicableRecordTypes.includes('*') &&
            !p.applicableRecordTypes.includes(programType)) {
          return false;
        }
      }

      // Check parent program type applicability for sessions
      if (objectType === 'session' && p.applicableParentProgramTypes && programType) {
        if (!p.applicableParentProgramTypes.includes('*') &&
            !p.applicableParentProgramTypes.includes(programType)) {
          return false;
        }
      }

      return true;
    })
    .map(p => ({
      field: p.name,
      label: p.label,
      objectType,
      options: p.options,
      applicableRecordTypes: p.applicableRecordTypes,
      applicableParentProgramTypes: p.applicableParentProgramTypes,
    }));
}

function getOperatorsForField(prop: PropertyDefinition): FilterOperator[] {
  // If explicitly defined, use those
  if (prop.filterOperators && prop.filterOperators.length > 0) {
    return prop.filterOperators;
  }

  // Default operators based on type
  switch (prop.type) {
    case 'string':
      return ['eq', 'contains'];
    case 'number':
      return ['eq', 'gte', 'lte', 'between'];
    case 'date':
    case 'datetime':
      return ['eq', 'gte', 'lte', 'between'];
    case 'bool':
      return ['eq'];
    case 'enumeration':
      return prop.multiSelect ? ['in', 'eq'] : ['eq', 'in'];
    default:
      return ['eq'];
  }
}

// ----------------------------------------------------------------------------
// Full Schema Response Builder
// ----------------------------------------------------------------------------

export function buildSchemaResponse(programType?: string): SchemaResponse {
  const config = getSearchConfig();
  const programProps = getProgramSchema();
  const sessionProps = getSessionSchema();
  const companyProps = getCompanySchema();

  // Build filterable fields list
  const filterableFields: FilterableField[] = [
    ...getFilterableFieldsForType('program', programType),
    ...getFilterableFieldsForType('session', programType),
    ...getFilterableFieldsForType('company', programType),
  ];

  // Build facetable fields list
  const facetableFields: FacetableField[] = [
    ...getFacetableFieldsForType('program', programType),
    ...getFacetableFieldsForType('session', programType),
    ...getFacetableFieldsForType('company', programType),
  ];

  return {
    config,
    programProperties: programProps,
    sessionProperties: sessionProps,
    companyProperties: companyProps,
    filterableFields,
    facetableFields,
  };
}

// ----------------------------------------------------------------------------
// Record Type Helpers
// ----------------------------------------------------------------------------

export function getProgramRecordTypes(): Record<string, { value: string; label: string }> {
  const schema = getProgramSchema();
  return schema.recordTypes || {};
}

export function isFieldApplicableToRecordType(
  field: string,
  objectType: 'program' | 'session',
  programType: string
): boolean {
  const prop = getPropertyDefinition(objectType, field);
  if (!prop) return false;

  if (objectType === 'program') {
    if (!prop.applicableRecordTypes) return true;
    return prop.applicableRecordTypes.includes('*') ||
           prop.applicableRecordTypes.includes(programType);
  }

  if (objectType === 'session') {
    if (!prop.applicableParentProgramTypes) return true;
    return prop.applicableParentProgramTypes.includes('*') ||
           prop.applicableParentProgramTypes.includes(programType);
  }

  return true;
}

// ----------------------------------------------------------------------------
// Option Label Lookup
// ----------------------------------------------------------------------------

export function getOptionLabel(
  objectType: 'program' | 'session' | 'company',
  fieldName: string,
  value: string
): string {
  const prop = getPropertyDefinition(objectType, fieldName);
  if (!prop || !prop.options) return value;

  const option = prop.options.find(o => o.value === value);
  return option?.label || value;
}

export function getFieldLabel(
  objectType: 'program' | 'session' | 'company',
  fieldName: string
): string {
  const prop = getPropertyDefinition(objectType, fieldName);
  return prop?.label || fieldName;
}
