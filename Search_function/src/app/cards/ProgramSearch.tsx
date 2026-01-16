// ============================================================================
// Camp Experts Program + Session Search
// HubSpot UI Extension - Read-only search experience
// ============================================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  Flex,
  Box,
  Text,
  Input,
  Select,
  Button,
  Link,
  Tag,
  Tile,
  Accordion,
  Divider,
  LoadingSpinner,
  Alert,
  EmptyState,
  TableRow,
  TableCell,
  Table,
  TableBody,
  TableHead,
  TableHeader,
  ToggleGroup,
  NumberInput,
  DateInput,
  MultiSelect,
} from '@hubspot/ui-extensions';
import { hubspot } from '@hubspot/ui-extensions';

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

interface PropertyOption {
  value: string;
  label: string;
}

interface FilterableField {
  field: string;
  label: string;
  objectType: 'program' | 'session' | 'company';
  type: string;
  operators: string[];
  options?: PropertyOption[];
  buckets?: Array<{ value: string; label: string; min: number | null; max: number | null }>;
  applicableRecordTypes?: string[];
  applicableParentProgramTypes?: string[];
  multiSelect?: boolean;
}

interface FacetableField {
  field: string;
  label: string;
  objectType: 'program' | 'session' | 'company';
  options?: PropertyOption[];
}

interface SchemaResponse {
  config: {
    objects: Record<string, {
      linkTemplate: string;
    }>;
  };
  programProperties: {
    recordTypes: Record<string, { value: string; label: string }>;
    properties: Array<{ name: string; label: string; options?: PropertyOption[] }>;
  };
  filterableFields: FilterableField[];
  facetableFields: FacetableField[];
}

interface FacetValue {
  value: string;
  label: string;
  count: number;
  selected: boolean;
}

interface FacetResult {
  field: string;
  label: string;
  objectType: 'program' | 'session' | 'company';
  values: FacetValue[];
}

interface AppliedFilter {
  field: string;
  label: string;
  displayValue: string;
}

interface Session {
  id: string;
  properties: Record<string, string | number | boolean | null>;
}

interface Program {
  id: string;
  properties: Record<string, string | number | boolean | null>;
}

interface Company {
  id: string;
  properties: Record<string, string | number | boolean | null>;
}

interface SearchResult {
  program: Program;
  company: Company | null;
  sessions: Session[];
  matchingSessionCount: number;
  totalSessionCount: number;
}

interface SearchResponse {
  results: SearchResult[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  facets: FacetResult[];
  appliedFilters: AppliedFilter[];
  searchTime: number;
}

interface Filter {
  field: string;
  operator: string;
  value: string | number | boolean | string[] | number[];
  objectType?: 'program' | 'session' | 'company';
}

interface FilterGroup {
  operator: 'AND' | 'OR';
  filters: Filter[];
}

// ----------------------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------------------

const API_BASE_URL = 'https://camp-experts-search.vercel.app';
const PORTAL_ID_PLACEHOLDER = '{portalId}';

// ----------------------------------------------------------------------------
// Main Extension Component
// ----------------------------------------------------------------------------

hubspot.extend<'crm.record.tab'>(({ context, actions }) => (
  <ProgramSearchCard context={context} actions={actions} />
));

interface ExtensionProps {
  context: {
    portal: { id: number };
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actions: any;
}

const ProgramSearchCard: React.FC<ExtensionProps> = ({ context, actions }) => {
  // State
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [selectedProgramType, setSelectedProgramType] = useState<string>('');
  const [activeFilters, setActiveFilters] = useState<Filter[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResponse | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [companyOptions, setCompanyOptions] = useState<PropertyOption[]>([]);

  // UI state
  const [expandedPrograms, setExpandedPrograms] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(true);

  const portalId = context.portal.id;

  // Load schema on mount
  useEffect(() => {
    loadSchema();
  }, []);

  // Re-fetch schema when program type changes (for applicable filters)
  useEffect(() => {
    if (selectedProgramType) {
      loadSchema(selectedProgramType);
    }
  }, [selectedProgramType]);

  const loadSchema = async (programType?: string) => {
    try {
      setLoading(true);
      const url = programType
        ? `${API_BASE_URL}/api/schema?programType=${programType}`
        : `${API_BASE_URL}/api/schema`;

      console.log('Fetching schema from:', url);

      const response = await hubspot.fetch(url, {
        method: 'GET',
      });

      console.log('Schema response status:', response.status);

      // Get raw text first to debug
      const rawText = await response.text();
      console.log('Schema raw response length:', rawText.length);
      console.log('Schema raw response preview:', rawText.substring(0, 200));

      if (!rawText || rawText.length === 0) {
        setError('Empty response from search service');
        return;
      }

      const data = JSON.parse(rawText);
      console.log('Schema parsed successfully:', data.success);

      if (data.success) {
        setSchema(data.data);
        setError(null);

        // Trigger initial search to get company facets
        if (!programType) {
          loadCompanyOptions();
        }
      } else {
        setError(data.error?.message || 'Failed to load schema');
      }
    } catch (err) {
      setError('Failed to connect to search service');
      console.error('Schema load error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Load company options and initial facets from search
  const loadCompanyOptions = async () => {
    try {
      const response = await hubspot.fetch(`${API_BASE_URL}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: {
          page: 1,
          pageSize: 20,
          includeEmptyResults: true,
        },
      });

      const data = await response.json();
      console.log('Initial search response:', data.success ? 'success' : 'failed');

      if (data.success) {
        // Set search results to make facets available to filter controls
        setSearchResults(data.data);

        if (data.data.facets) {
          // Find company name facet
          const companyFacet = data.data.facets.find(
            (f: FacetResult) => f.field === 'name' && f.objectType === 'company'
          );
          if (companyFacet) {
            const options = companyFacet.values.map((v: FacetValue) => ({
              value: v.value,
              label: v.label,
            }));
            // Sort alphabetically
            options.sort((a: PropertyOption, b: PropertyOption) => a.label.localeCompare(b.label));
            setCompanyOptions(options);
            console.log('Loaded', options.length, 'company options');
          }
        }
      }
    } catch (err) {
      console.error('Failed to load company options:', err);
    }
  };

  const executeSearch = useCallback(async (page = 1) => {
    if (!schema) return;

    setSearching(true);
    setCurrentPage(page);

    try {
      // Build filters including company selection
      const allFilters: Filter[] = [...activeFilters];

      // Add company filter if companies are selected
      if (selectedCompanies.length > 0) {
        allFilters.push({
          field: 'name',
          operator: 'in',
          value: selectedCompanies,
          objectType: 'company',
        });
      }

      const filterGroup: FilterGroup = {
        operator: 'AND',
        filters: allFilters,
      };

      const requestBody = {
        query: searchQuery || undefined,
        filters: allFilters.length > 0 ? filterGroup : undefined,
        programType: selectedProgramType || undefined,
        page,
        pageSize: 20,
        includeEmptyResults: false,
      };

      console.log('Search request:', JSON.stringify(requestBody, null, 2));

      const response = await hubspot.fetch(`${API_BASE_URL}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody as Record<string, unknown>,
      });

      const data = await response.json();
      console.log('Search response:', data.success ? 'success' : 'failed', data.data?.totalCount || 0, 'results');

      if (data.success) {
        setSearchResults(data.data);
        setError(null);
      } else {
        setError(data.error?.message || 'Search failed');
      }
    } catch (err) {
      setError('Search request failed');
      console.error('Search error:', err);
    } finally {
      setSearching(false);
    }
  }, [schema, searchQuery, selectedProgramType, activeFilters, selectedCompanies]);

  // Auto-search when filters change
  useEffect(() => {
    if (schema && (selectedCompanies.length > 0 || selectedProgramType || activeFilters.length > 0)) {
      executeSearch(1);
    }
  }, [selectedCompanies, selectedProgramType, activeFilters, schema]);

  const handleSearch = () => {
    executeSearch(1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const addFilter = (field: string, value: string | number | boolean | string[] | number[], operator = 'eq', objectType?: 'program' | 'session' | 'company') => {
    const existingIndex = activeFilters.findIndex(f => f.field === field);
    if (existingIndex >= 0) {
      // Update existing filter
      const newFilters = [...activeFilters];
      newFilters[existingIndex] = { field, operator, value, objectType };
      setActiveFilters(newFilters);
    } else {
      // Add new filter
      setActiveFilters([...activeFilters, { field, operator, value, objectType }]);
    }
  };

  const removeFilter = (field: string) => {
    setActiveFilters(activeFilters.filter(f => f.field !== field));
  };

  const clearAllFilters = () => {
    setActiveFilters([]);
    setSelectedCompanies([]);
    setSelectedProgramType('');
    setSearchQuery('');
    setSearchResults(null);
  };

  const toggleProgramExpanded = (programId: string) => {
    const newExpanded = new Set(expandedPrograms);
    if (newExpanded.has(programId)) {
      newExpanded.delete(programId);
    } else {
      newExpanded.add(programId);
    }
    setExpandedPrograms(newExpanded);
  };

  const buildHubSpotLink = (objectType: 'program' | 'session' | 'company', objectId: string): string => {
    if (!schema) return '#';
    const template = schema.config.objects[objectType]?.linkTemplate || '';
    return template
      .replace(PORTAL_ID_PLACEHOLDER, String(portalId))
      .replace('{objectId}', objectId);
  };

  // Loading state
  if (loading) {
    return (
      <Flex direction="column" align="center" justify="center" gap="md">
        <LoadingSpinner label="Loading search..." />
      </Flex>
    );
  }

  // Error state
  if (error && !schema) {
    return (
      <Alert title="Error" variant="error">
        {error}
      </Alert>
    );
  }

  const programTypes: Array<{ value: string; label: string }> = schema?.programProperties?.recordTypes
    ? Object.values(schema.programProperties.recordTypes)
    : [];

  return (
    <Flex direction="column" gap="md">
      {/* Header */}
      <Flex direction="row" justify="between" align="center">
        <Text format={{ fontWeight: 'bold' }}>Program & Session Search</Text>
        <Button
          variant="secondary"
          size="xs"
          onClick={() => setShowFilters(!showFilters)}
        >
          {showFilters ? 'Hide Filters' : 'Show Filters'}
        </Button>
      </Flex>

      {/* Step 1: Company Selection - Primary Filter */}
      <Box>
        <Text format={{ fontWeight: 'demibold' }}>Step 1: Select Companies (Partners)</Text>
        <MultiSelect
          name="companySelect"
          label="Companies"
          placeholder="Select one or more companies..."
          value={selectedCompanies}
          options={companyOptions.map(c => ({ value: c.value, label: c.label }))}
          onChange={(values) => setSelectedCompanies(values as string[])}
        />
        {selectedCompanies.length > 0 && (
          <Flex direction="row" gap="xs" wrap="wrap">
            <Text>Selected: </Text>
            {selectedCompanies.map(companyName => (
              <Tag key={companyName}>{companyName}</Tag>
            ))}
          </Flex>
        )}
      </Box>

      {/* Step 2: Program Type Selection */}
      <Box>
        <ToggleGroup
          toggleType="radioButtonList"
          name="programType"
          label="Step 2: Select Program Type"
          value={selectedProgramType}
          options={[
            { label: 'All Types', value: '' },
            ...programTypes.map(pt => ({ label: pt.label, value: pt.value }))
          ]}
          onChange={(value: string) => setSelectedProgramType(value)}
        />
      </Box>

      {/* Search Input */}
      <Flex direction="row" gap="sm" align="end">
        <Box>
          <Input
            name="searchQuery"
            label="Search"
            placeholder="Search programs, sessions, partners..."
            value={searchQuery}
            onChange={(value) => setSearchQuery(value)}
          />
        </Box>
        <Button onClick={handleSearch} disabled={searching}>
          {searching ? 'Searching...' : 'Search'}
        </Button>
      </Flex>

      {/* Filters Panel */}
      {showFilters && schema && (
        <FilterPanel
          schema={schema}
          programType={selectedProgramType}
          activeFilters={activeFilters}
          onAddFilter={addFilter}
          onRemoveFilter={removeFilter}
          onClearAll={clearAllFilters}
          facets={searchResults?.facets}
        />
      )}

      {/* Applied Filters Tags */}
      {(selectedCompanies.length > 0 || activeFilters.length > 0) && (
        <Flex direction="row" gap="xs" wrap="wrap">
          <Text format={{ fontWeight: 'demibold' }}>Active Filters:</Text>
          {selectedCompanies.length > 0 && (
            <Tag>Companies: {selectedCompanies.length} selected</Tag>
          )}
          {activeFilters.map((filter, idx) => (
            <Tag key={`${filter.field}-${idx}`}>
              {getFilterLabel(schema, filter)}
            </Tag>
          ))}
          <Button variant="secondary" size="xs" onClick={clearAllFilters}>
            Clear All
          </Button>
        </Flex>
      )}

      <Divider />

      {/* Results */}
      {error && (
        <Alert title="Search Error" variant="warning">
          {error}
        </Alert>
      )}

      {searching && (
        <Flex direction="column" align="center" justify="center" gap="md">
          <LoadingSpinner label="Searching..." />
        </Flex>
      )}

      {!searching && searchResults && (
        <SearchResultsPanel
          results={searchResults}
          expandedPrograms={expandedPrograms}
          onToggleExpand={toggleProgramExpanded}
          onPageChange={(page) => executeSearch(page)}
          buildLink={buildHubSpotLink}
          schema={schema}
        />
      )}

      {!searching && !searchResults && !error && (
        <EmptyState
          title="Start Searching"
          layout="vertical"
        >
          <Text>
            Select a program type or enter search terms to find programs and sessions.
          </Text>
        </EmptyState>
      )}
    </Flex>
  );
};

// ----------------------------------------------------------------------------
// Filter Panel Component
// ----------------------------------------------------------------------------

interface FilterPanelProps {
  schema: SchemaResponse;
  programType: string;
  activeFilters: Filter[];
  onAddFilter: (field: string, value: string | number | boolean | string[] | number[], operator?: string, objectType?: 'program' | 'session' | 'company') => void;
  onRemoveFilter: (field: string) => void;
  onClearAll: () => void;
  facets?: FacetResult[];
}

const FilterPanel: React.FC<FilterPanelProps> = ({
  schema,
  programType,
  activeFilters,
  onAddFilter,
  onRemoveFilter,
  facets,
}) => {
  // Get applicable filterable fields
  const filterableFields = schema.filterableFields.filter(f => {
    // Skip program_type - handled separately
    if (f.field === 'program_type') return false;

    // Check record type applicability
    if (f.applicableRecordTypes && programType) {
      if (!f.applicableRecordTypes.includes('*') &&
          !f.applicableRecordTypes.includes(programType)) {
        return false;
      }
    }
    if (f.applicableParentProgramTypes && programType) {
      if (!f.applicableParentProgramTypes.includes('*') &&
          !f.applicableParentProgramTypes.includes(programType)) {
        return false;
      }
    }
    return true;
  });

  // Note: Company filters are now handled via the company multi-select at the top
  // We don't show company filters in the filter panel anymore
  const programFilters = filterableFields.filter(f => f.objectType === 'program');
  const sessionFilters = filterableFields.filter(f => f.objectType === 'session');

  // Organize into logical filter categories for progressive refinement workflows
  // Category 1: Location/Geography - only program and session location fields
  // (company location filters removed - company selection is handled separately)
  const locationFields = ['region', 'locations'];
  const locationFilters = filterableFields.filter(f => locationFields.includes(f.field));

  // Category 2: Program Characteristics (type-specific attributes)
  const programCharFields = ['primary_camp_type', 'camp_subtype', 'experience_subtype', 'specialty_subtype', 'gender_structure', 'is_brother_sister', 'programming_philosophy', 'accommodations'];
  const programCharFilters = filterableFields.filter(f => programCharFields.includes(f.field));

  // Category 3: Dates & Duration
  const dateFields = ['start_date', 'end_date', 'weeks'];
  const dateFilters = filterableFields.filter(f => dateFields.includes(f.field));

  // Category 4: Age & Grade (eligibility)
  const eligibilityFields = ['age__min_', 'age__max_', 'grade_range_min', 'grade_range_max'];
  const eligibilityFilters = filterableFields.filter(f => eligibilityFields.includes(f.field));

  // Category 5: Price & Financial
  const priceFields = ['tuition__current_', 'tuition_currency'];
  const priceFilters = filterableFields.filter(f => priceFields.includes(f.field));

  // Category 6: Activities & Options
  const featureFields = ['sport_options', 'arts_options', 'education_options'];
  const featureFilters = filterableFields.filter(f => featureFields.includes(f.field));

  return (
    <Accordion title="Step 3: Additional Filters" defaultOpen={true}>
      <Flex direction="column" gap="md">
        {/* Location & Geography */}
        {locationFilters.length > 0 && (
          <Box>
            <Text format={{ fontWeight: 'demibold' }}>Location & Destinations</Text>
            <Flex direction="row" gap="sm" wrap="wrap">
              {locationFilters.map(field => (
                <FilterControl
                  key={field.field}
                  field={field}
                  activeFilters={activeFilters}
                  facets={facets}
                  onAddFilter={onAddFilter}
                  onRemoveFilter={onRemoveFilter}
                />
              ))}
            </Flex>
          </Box>
        )}

        {/* Program Characteristics */}
        {programCharFilters.length > 0 && (
          <Box>
            <Text format={{ fontWeight: 'demibold' }}>Program Characteristics</Text>
            <Flex direction="row" gap="sm" wrap="wrap">
              {programCharFilters.map(field => (
                <FilterControl
                  key={field.field}
                  field={field}
                  activeFilters={activeFilters}
                  facets={facets}
                  onAddFilter={onAddFilter}
                  onRemoveFilter={onRemoveFilter}
                />
              ))}
            </Flex>
          </Box>
        )}

        {/* Dates & Duration */}
        {dateFilters.length > 0 && (
          <Box>
            <Text format={{ fontWeight: 'demibold' }}>Dates & Duration</Text>
            <Flex direction="row" gap="sm" wrap="wrap">
              {dateFilters.map(field => (
                <FilterControl
                  key={field.field}
                  field={field}
                  activeFilters={activeFilters}
                  facets={facets}
                  onAddFilter={onAddFilter}
                  onRemoveFilter={onRemoveFilter}
                />
              ))}
            </Flex>
          </Box>
        )}

        {/* Age & Grade Eligibility */}
        {eligibilityFilters.length > 0 && (
          <Box>
            <Text format={{ fontWeight: 'demibold' }}>Age & Grade Eligibility</Text>
            <Flex direction="row" gap="sm" wrap="wrap">
              {eligibilityFilters.map(field => (
                <FilterControl
                  key={field.field}
                  field={field}
                  activeFilters={activeFilters}
                  facets={facets}
                  onAddFilter={onAddFilter}
                  onRemoveFilter={onRemoveFilter}
                />
              ))}
            </Flex>
          </Box>
        )}

        {/* Price & Tuition */}
        {priceFilters.length > 0 && (
          <Box>
            <Text format={{ fontWeight: 'demibold' }}>Price & Tuition</Text>
            <Flex direction="row" gap="sm" wrap="wrap">
              {priceFilters.map(field => (
                <FilterControl
                  key={field.field}
                  field={field}
                  activeFilters={activeFilters}
                  facets={facets}
                  onAddFilter={onAddFilter}
                  onRemoveFilter={onRemoveFilter}
                />
              ))}
            </Flex>
          </Box>
        )}

        {/* Activities & Options */}
        {featureFilters.length > 0 && (
          <Box>
            <Text format={{ fontWeight: 'demibold' }}>Activities & Options</Text>
            <Flex direction="row" gap="sm" wrap="wrap">
              {featureFilters.map(field => (
                <FilterControl
                  key={field.field}
                  field={field}
                  activeFilters={activeFilters}
                  facets={facets}
                  onAddFilter={onAddFilter}
                  onRemoveFilter={onRemoveFilter}
                />
              ))}
            </Flex>
          </Box>
        )}
      </Flex>
    </Accordion>
  );
};

// ----------------------------------------------------------------------------
// Filter Control Component
// ----------------------------------------------------------------------------

interface FilterControlProps {
  field: FilterableField;
  activeFilters: Filter[];
  facets?: FacetResult[];
  onAddFilter: (field: string, value: string | number | boolean | string[] | number[], operator?: string, objectType?: 'program' | 'session' | 'company') => void;
  onRemoveFilter: (field: string) => void;
}

const FilterControl: React.FC<FilterControlProps> = ({
  field,
  activeFilters,
  facets,
  onAddFilter,
  onRemoveFilter,
}) => {
  const currentFilter = activeFilters.find(f => f.field === field.field);
  const facet = facets?.find(f => f.field === field.field);

  // Get options - prefer facet values if available for counts
  const options = facet?.values?.map(v => ({
    value: v.value,
    label: `${v.label} (${v.count})`,
  })) || field.options || [];

  switch (field.type) {
    case 'enumeration':
      // Use MultiSelect for multi-select fields
      if (field.multiSelect) {
        const currentValues = Array.isArray(currentFilter?.value)
          ? currentFilter.value as string[]
          : currentFilter?.value ? [String(currentFilter.value)] : [];

        return (
          <Box>
            <MultiSelect
              name={field.field}
              label={field.label}
              placeholder={`Select ${field.label}...`}
              value={currentValues}
              options={options.map(o => ({ value: o.value, label: o.label }))}
              onChange={(values) => {
                if (values && values.length > 0) {
                  onAddFilter(field.field, values as string[], 'in', field.objectType);
                } else {
                  onRemoveFilter(field.field);
                }
              }}
            />
          </Box>
        );
      }

      // Regular single-select dropdown
      return (
        <Box>
          <Select
            name={field.field}
            label={field.label}
            value={currentFilter?.value as string || ''}
            options={[
              { value: '', label: `Any ${field.label}` },
              ...options.map(o => ({ value: o.value, label: o.label }))
            ]}
            onChange={(value) => {
              if (value) {
                onAddFilter(field.field, value, 'eq', field.objectType);
              } else {
                onRemoveFilter(field.field);
              }
            }}
          />
        </Box>
      );

    case 'bool':
      return (
        <Box>
          <Select
            name={field.field}
            label={field.label}
            value={currentFilter?.value?.toString() || ''}
            options={[
              { value: '', label: `Any` },
              { value: 'true', label: 'Yes' },
              { value: 'false', label: 'No' },
            ]}
            onChange={(value) => {
              if (value) {
                onAddFilter(field.field, value === 'true', 'eq', field.objectType);
              } else {
                onRemoveFilter(field.field);
              }
            }}
          />
        </Box>
      );

    case 'number':
      // For numeric fields with buckets, show as select
      if (field.buckets && field.buckets.length > 0) {
        return (
          <Box>
            <Select
              name={field.field}
              label={field.label}
              value={currentFilter?.value as string || ''}
              options={[
                { value: '', label: `Any ${field.label}` },
                ...field.buckets.map(b => ({ value: b.value, label: b.label }))
              ]}
              onChange={(value) => {
                if (value) {
                  const bucket = field.buckets?.find(b => b.value === value);
                  if (bucket) {
                    if (bucket.max === null) {
                      onAddFilter(field.field, bucket.min!, 'gte', field.objectType);
                    } else if (bucket.min === null) {
                      onAddFilter(field.field, bucket.max, 'lte', field.objectType);
                    } else {
                      onAddFilter(field.field, [bucket.min, bucket.max], 'between', field.objectType);
                    }
                  }
                } else {
                  onRemoveFilter(field.field);
                }
              }}
            />
          </Box>
        );
      }

      // Default number input
      return (
        <Box>
          <NumberInput
            name={field.field}
            label={field.label}
            value={currentFilter?.value as number || undefined}
            onChange={(value) => {
              if (value !== undefined && value !== null) {
                // Determine operator based on field name
                let operator = 'eq';
                if (field.field.includes('min') || field.field === 'age__min_' || field.field === 'grade_range_min') {
                  operator = 'lte'; // User's child age must be >= session min age
                } else if (field.field.includes('max') || field.field === 'age__max_' || field.field === 'grade_range_max') {
                  operator = 'gte'; // User's child age must be <= session max age
                }
                onAddFilter(field.field, value, operator, field.objectType);
              } else {
                onRemoveFilter(field.field);
              }
            }}
          />
        </Box>
      );

    case 'date':
    case 'datetime':
      return (
        <Box>
          <DateInput
            name={field.field}
            label={field.label}
            value={typeof currentFilter?.value === 'string' ? { year: parseInt(currentFilter.value.slice(0, 4)), month: parseInt(currentFilter.value.slice(5, 7)), date: parseInt(currentFilter.value.slice(8, 10)) } : undefined}
            onChange={(payload: { year?: number; month?: number; date?: number } | null) => {
              if (payload && payload.year && payload.month && payload.date) {
                // Determine operator based on field name
                let operator = 'gte';
                if (field.field === 'end_date' || field.field.includes('end')) {
                  operator = 'lte';
                }
                // Convert to ISO date string for filter value
                const dateValue = `${payload.year}-${String(payload.month).padStart(2, '0')}-${String(payload.date).padStart(2, '0')}`;
                onAddFilter(field.field, dateValue, operator, field.objectType);
              } else {
                onRemoveFilter(field.field);
              }
            }}
          />
        </Box>
      );

    default:
      return null;
  }
};

// ----------------------------------------------------------------------------
// Search Results Panel
// ----------------------------------------------------------------------------

interface SearchResultsPanelProps {
  results: SearchResponse;
  expandedPrograms: Set<string>;
  onToggleExpand: (programId: string) => void;
  onPageChange: (page: number) => void;
  buildLink: (objectType: 'program' | 'session' | 'company', objectId: string) => string;
  schema: SchemaResponse | null;
}

const SearchResultsPanel: React.FC<SearchResultsPanelProps> = ({
  results,
  expandedPrograms,
  onToggleExpand,
  onPageChange,
  buildLink,
  schema,
}) => {
  if (results.totalCount === 0) {
    return (
      <EmptyState
        title="No Results Found"
        layout="vertical"
      >
        <Text>
          Try adjusting your filters or search terms.
        </Text>
      </EmptyState>
    );
  }

  return (
    <Flex direction="column" gap="md">
      {/* Results Summary */}
      <Flex direction="row" justify="between" align="center">
        <Text>
          Found {results.totalCount} programs with matching sessions
          {results.searchTime > 0 && ` (${results.searchTime}ms)`}
        </Text>
        <Text>
          Page {results.page} of {results.totalPages}
        </Text>
      </Flex>

      {/* Results List */}
      {results.results.map((result) => (
        <ProgramResultTile
          key={result.program.id}
          result={result}
          isExpanded={expandedPrograms.has(result.program.id)}
          onToggleExpand={() => onToggleExpand(result.program.id)}
          buildLink={buildLink}
          schema={schema}
        />
      ))}

      {/* Pagination */}
      {results.totalPages > 1 && (
        <Flex direction="row" justify="center" gap="sm">
          <Button
            variant="secondary"
            size="sm"
            disabled={results.page <= 1}
            onClick={() => onPageChange(results.page - 1)}
          >
            Previous
          </Button>
          <Text>Page {results.page} of {results.totalPages}</Text>
          <Button
            variant="secondary"
            size="sm"
            disabled={results.page >= results.totalPages}
            onClick={() => onPageChange(results.page + 1)}
          >
            Next
          </Button>
        </Flex>
      )}
    </Flex>
  );
};

// ----------------------------------------------------------------------------
// Program Result Tile
// ----------------------------------------------------------------------------

interface ProgramResultTileProps {
  result: SearchResult;
  isExpanded: boolean;
  onToggleExpand: () => void;
  buildLink: (objectType: 'program' | 'session' | 'company', objectId: string) => string;
  schema: SchemaResponse | null;
}

const ProgramResultTile: React.FC<ProgramResultTileProps> = ({
  result,
  isExpanded,
  onToggleExpand,
  buildLink,
  schema,
}) => {
  const { program, company, sessions, matchingSessionCount, totalSessionCount } = result;

  const programName = String(program.properties.program_name || 'Unnamed Program');
  const programType = String(program.properties.program_type || '');
  const programTypeLabel = schema?.programProperties?.recordTypes?.[programType]?.label || programType;
  const companyName = company?.properties.name ? String(company.properties.name) : 'Unknown Partner';
  const shortProgramName = company?.properties.short_program_name ? String(company.properties.short_program_name) : '';

  // Program location (region)
  const programRegion = program.properties.region ? String(program.properties.region) : '';

  // Company (Partner) location info
  const companyState = company?.properties.us_state ? String(company.properties.us_state) : '';
  const companyCountry = company?.properties.country_hq ? String(company.properties.country_hq) : '';
  const companyLocation = [companyState, companyCountry].filter(Boolean).join(', ');

  // Partner status
  const partnerStatus = company?.properties.lifecyclestage ? String(company.properties.lifecyclestage) : '';

  // Program-type specific attributes
  const primaryCampType = program.properties.primary_camp_type ? String(program.properties.primary_camp_type) : '';
  const campSubtype = program.properties.camp_subtype ? String(program.properties.camp_subtype) : '';
  const experienceSubtype = program.properties.experience_subtype ? String(program.properties.experience_subtype) : '';
  const specialtySubtype = program.properties.specialty_subtype ? String(program.properties.specialty_subtype) : '';
  const programSubtype = campSubtype || experienceSubtype || specialtySubtype || '';

  // Get label for gender structure
  const genderStructure = program.properties.gender_structure ? getOptionDisplayLabel(schema, 'program', 'gender_structure', String(program.properties.gender_structure)) : '';
  const isBrotherSister = program.properties.is_brother_sister === true;

  return (
    <Tile>
      <Flex direction="column" gap="sm">
        {/* Program Header */}
        <Flex direction="row" justify="between" align="start">
          <Flex direction="column" gap="xs">
            <Flex direction="row" gap="sm" align="center">
              <Link href={buildLink('program', program.id)}>
                <Text format={{ fontWeight: 'bold' }}>{programName}</Text>
              </Link>
              {programTypeLabel && <Tag>{programTypeLabel}</Tag>}
              {program.properties.program_status === 'active' && <Tag variant="success">Active</Tag>}
              {program.properties.program_status === 'coming_soon' && <Tag variant="warning">Coming Soon</Tag>}
            </Flex>

            {/* Company/Partner Info with deep-link */}
            <Flex direction="row" gap="sm" align="center">
              {company && (
                <>
                  <Text format={{ fontWeight: 'demibold' }}>Partner:</Text>
                  <Link href={buildLink('company', company.id)}>
                    <Text>{companyName}</Text>
                  </Link>
                  {companyLocation && <Text>({companyLocation})</Text>}
                  {partnerStatus === 'customer' && <Tag variant="success">Active Partner</Tag>}
                </>
              )}
            </Flex>

            {/* Program Location */}
            {programRegion && (
              <Flex direction="row" gap="sm">
                <Text>Region: {formatMultiValue(programRegion)}</Text>
              </Flex>
            )}
          </Flex>

          <Flex direction="column" align="end">
            <Text>
              {matchingSessionCount} of {totalSessionCount} sessions match
            </Text>
            <Button
              variant="secondary"
              size="xs"
              onClick={onToggleExpand}
            >
              {isExpanded ? 'Hide Sessions' : 'Show Sessions'}
            </Button>
          </Flex>
        </Flex>

        {/* Program Attributes */}
        <Flex direction="row" gap="sm" wrap="wrap">
          {primaryCampType && <Tag>{formatMultiValue(primaryCampType)}</Tag>}
          {programSubtype && <Tag>{formatMultiValue(programSubtype)}</Tag>}
          {genderStructure && genderStructure !== 'none' && <Tag>{genderStructure}</Tag>}
          {isBrotherSister && <Tag>Brother/Sister Camp</Tag>}
          {program.properties.programming_philosophy && <Tag variant="info">{formatMultiValue(String(program.properties.programming_philosophy))}</Tag>}
        </Flex>

        {/* Sessions Table (expanded) */}
        {isExpanded && sessions.length > 0 && (
          <Box>
            <Divider />
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeader>Session</TableHeader>
                  <TableHeader>Dates</TableHeader>
                  <TableHeader>Ages</TableHeader>
                  <TableHeader>Weeks</TableHeader>
                  <TableHeader>Tuition</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {sessions.slice(0, 10).map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    buildLink={buildLink}
                  />
                ))}
              </TableBody>
            </Table>
            {sessions.length > 10 && (
              <Text>
                Showing 10 of {sessions.length} sessions.{' '}
                <Link href={buildLink('program', program.id)}>View all in HubSpot</Link>
              </Text>
            )}
          </Box>
        )}
      </Flex>
    </Tile>
  );
};

// ----------------------------------------------------------------------------
// Session Row Component
// ----------------------------------------------------------------------------

interface SessionRowProps {
  session: Session;
  buildLink: (objectType: 'program' | 'session' | 'company', objectId: string) => string;
}

const SessionRow: React.FC<SessionRowProps> = ({ session, buildLink }) => {
  const props = session.properties;

  const sessionName = String(props.session_name || 'Unnamed Session');
  const startDate = props.start_date ? formatDate(String(props.start_date)) : '';
  const endDate = props.end_date ? formatDate(String(props.end_date)) : '';
  const dateRange = startDate && endDate ? `${startDate} - ${endDate}` : startDate || endDate || 'TBD';

  const ageMin = props.age__min_;
  const ageMax = props.age__max_;
  const ageRange = ageMin && ageMax ? `${ageMin}-${ageMax}` :
                   ageMin ? `${ageMin}+` :
                   ageMax ? `up to ${ageMax}` : '';

  const tuition = props.tuition__current_ ? formatCurrency(Number(props.tuition__current_)) : '';
  const weeks = props.weeks ? `${props.weeks} wks` : '';

  return (
    <TableRow>
      <TableCell>
        <Link href={buildLink('session', session.id)}>
          {sessionName}
        </Link>
      </TableCell>
      <TableCell>{dateRange}</TableCell>
      <TableCell>{ageRange}</TableCell>
      <TableCell>{weeks}</TableCell>
      <TableCell>{tuition}</TableCell>
    </TableRow>
  );
};

// ----------------------------------------------------------------------------
// Helper Functions
// ----------------------------------------------------------------------------

function formatDate(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return isoDate;
  }
}

function getOptionDisplayLabel(
  schema: SchemaResponse | null,
  objectType: 'program' | 'session' | 'company',
  fieldName: string,
  value: string
): string {
  if (!schema) return value;

  // Find the field in filterable fields
  const field = schema.filterableFields.find(
    f => f.field === fieldName && f.objectType === objectType
  );

  if (field?.options) {
    const option = field.options.find(o => o.value === value);
    return option?.label || value;
  }

  return value;
}

function formatMultiValue(value: string): string {
  // Handle semicolon-separated multi-values
  if (value.includes(';')) {
    return value.split(';').map(v => v.trim()).join(', ');
  }
  // Convert snake_case to Title Case
  return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function getFilterLabel(schema: SchemaResponse | null, filter: Filter): string {
  if (!schema) return `${filter.field}: ${filter.value}`;

  const field = schema.filterableFields.find(f => f.field === filter.field);
  const fieldLabel = field?.label || filter.field;

  let valueLabel = String(filter.value);
  if (field?.options) {
    const option = field.options.find(o => o.value === String(filter.value));
    if (option) {
      valueLabel = option.label;
    }
  }

  return `${fieldLabel}: ${valueLabel}`;
}

export default ProgramSearchCard;
