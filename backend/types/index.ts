// ============================================================================
// Camp Experts Search Backend Types
// ============================================================================

// Schema Configuration Types
// ----------------------------------------------------------------------------

export interface SearchConfig {
  version: string;
  lastUpdated: string | null;
  refreshIntervalMs: number;
  objects: Record<string, ObjectConfig>;
  associations: Record<string, AssociationConfig>;
  filters: FilterConfig;
}

export interface ObjectConfig {
  objectType: string;
  hubspotObjectType: string;
  displayName: string;
  pluralDisplayName: string;
  primaryDisplayProperty: string;
  searchableFields: string[];
  linkTemplate: string;
}

export interface AssociationConfig {
  fromObject: string;
  toObject: string;
  associationTypeId: number;
  direction: 'forward' | 'backward';
}

export interface FilterConfig {
  primaryFilter: string;
  defaultSort: {
    field: string;
    direction: 'asc' | 'desc';
  };
}

// Property Schema Types
// ----------------------------------------------------------------------------

export interface PropertySchema {
  objectType: string;
  recordTypes?: Record<string, RecordType>;
  displayName?: string;
  properties: PropertyDefinition[];
}

export interface RecordType {
  value: string;
  label: string;
  description: string;
  displayOrder: number;
}

export interface PropertyDefinition {
  name: string;
  label: string;
  type: 'string' | 'number' | 'bool' | 'date' | 'datetime' | 'enumeration';
  fieldType: string;
  description: string;
  searchable: boolean;
  filterable: boolean;
  facetable: boolean;
  displayInResults: boolean;
  displayOrder: number;
  required?: boolean;
  multiSelect?: boolean;
  applicableRecordTypes?: string[];
  applicableParentProgramTypes?: string[];
  options?: PropertyOption[];
  filterOperators?: FilterOperator[];
  buckets?: Bucket[];
  currency?: string;
}

export interface PropertyOption {
  value: string;
  label: string;
  displayOrder: number;
  numericValue?: number;
  hidden?: boolean;
}

export type FilterOperator = 'eq' | 'neq' | 'gte' | 'lte' | 'gt' | 'lt' | 'between' | 'contains' | 'in';

export interface Bucket {
  value: string;
  label: string;
  min: number | null;
  max: number | null;
}

// Data Types
// ----------------------------------------------------------------------------

export interface Company {
  id: string;
  properties: Record<string, string | number | boolean | null>;
  createdAt: string;
  updatedAt: string;
}

export interface Program {
  id: string;
  properties: Record<string, string | number | boolean | null>;
  createdAt: string;
  updatedAt: string;
  companyId?: string;
  company?: Company;
  sessions?: Session[];
}

export interface Session {
  id: string;
  properties: Record<string, string | number | boolean | null>;
  createdAt: string;
  updatedAt: string;
  programId?: string;
}

// Cache Types
// ----------------------------------------------------------------------------

export interface CachedData {
  companies: Map<string, Company>;
  programs: Map<string, Program>;
  sessions: Map<string, Session>;
  programToCompany: Map<string, string>;
  programToSessions: Map<string, string[]>;
  lastRefreshed: Date;
  refreshInProgress: boolean;
}

export interface CacheStats {
  companiesCount: number;
  programsCount: number;
  sessionsCount: number;
  lastRefreshed: string | null;
  refreshInProgress: boolean;
  cacheAgeMs: number;
}

// Search/Filter Types
// ----------------------------------------------------------------------------

export interface SearchRequest {
  query?: string;
  filters?: FilterGroup;
  programType?: string;
  sort?: SortOption;
  page?: number;
  pageSize?: number;
  includeEmptyResults?: boolean;
}

export interface FilterGroup {
  operator: 'AND' | 'OR';
  filters: Filter[];
  groups?: FilterGroup[];
}

export interface Filter {
  field: string;
  operator: FilterOperator;
  value: string | number | boolean | string[] | number[];
  objectType?: 'program' | 'session' | 'company';
}

export interface SortOption {
  field: string;
  direction: 'asc' | 'desc';
  objectType?: 'program' | 'session';
}

export interface SearchResponse {
  results: SearchResult[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  facets: FacetResult[];
  appliedFilters: AppliedFilter[];
  searchTime: number;
}

export interface SearchResult {
  program: Program;
  company: Company | null;
  sessions: Session[];
  matchingSessionCount: number;
  totalSessionCount: number;
  score: number;
}

export interface FacetResult {
  field: string;
  label: string;
  objectType: 'program' | 'session';
  values: FacetValue[];
}

export interface FacetValue {
  value: string;
  label: string;
  count: number;
  selected: boolean;
}

export interface AppliedFilter {
  field: string;
  label: string;
  operator: FilterOperator;
  value: string | number | boolean | string[] | number[];
  displayValue: string;
}

// Schema API Types
// ----------------------------------------------------------------------------

export interface SchemaResponse {
  config: SearchConfig;
  programProperties: PropertySchema;
  sessionProperties: PropertySchema;
  companyProperties: PropertySchema;
  filterableFields: FilterableField[];
  facetableFields: FacetableField[];
}

export interface FilterableField {
  field: string;
  label: string;
  objectType: 'program' | 'session' | 'company';
  type: PropertyDefinition['type'];
  operators: FilterOperator[];
  options?: PropertyOption[];
  buckets?: Bucket[];
  applicableRecordTypes?: string[];
  applicableParentProgramTypes?: string[];
}

export interface FacetableField {
  field: string;
  label: string;
  objectType: 'program' | 'session' | 'company';
  options?: PropertyOption[];
  applicableRecordTypes?: string[];
  applicableParentProgramTypes?: string[];
}

// API Response Types
// ----------------------------------------------------------------------------

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: {
    requestId: string;
    timestamp: string;
    processingTimeMs: number;
  };
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// HubSpot API Types (simplified)
// ----------------------------------------------------------------------------

export interface HubSpotObject {
  id: string;
  properties: Record<string, string | null>;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

export interface HubSpotSearchResponse {
  total: number;
  results: HubSpotObject[];
  paging?: {
    next?: {
      after: string;
    };
  };
}

export interface HubSpotAssociation {
  results: Array<{
    id: string;
    type: string;
  }>;
}
