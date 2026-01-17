// ============================================================================
// Camp Experts Program + Session Search
// HubSpot UI Extension - Multi-Tab Referral Builder
// 5 Discrete Search Modes:
//   1. Company Programs - Quick search + Partner dropdown (browse by company)
//   2. Overnight Camp - Region, Gender Structure, Brother-Sister, flexible dates
//   3. Specialty Camp - Camp Type with conditional Sports/Arts/Education options
//   4. Teen Trips / Gap Year - Destination-focused search
//   5. Other Programs - Simple dropdown menu (Family, Day, Specialty)
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
  StatusTag,
  DescriptionList,
  DescriptionListItem,
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
// Tab Configuration - 5 Discrete Search Modes
// ----------------------------------------------------------------------------

type SearchTabId = 'company' | 'overnight' | 'specialty' | 'teen' | 'other';

interface SearchTabConfig {
  id: SearchTabId;
  label: string;
  shortLabel: string;
  description: string;
  programTypes: string[];
  filterCategories: FilterCategoryConfig[];
  // Company tab specific
  isCompanyTab?: boolean;
  showQuickSearch?: boolean;
  showPartnerDropdown?: boolean;
  // Other tab specific - simple dropdown mode
  isDropdownMode?: boolean;
  dropdownOptions?: Array<{ value: string; label: string }>;
}

interface FilterCategoryConfig {
  title: string;
  fields: string[];
  defaultOpen?: boolean;
  conditionalOn?: {
    field: string;
    values: string[];
  };
  // Custom field labels for this category
  fieldLabels?: Record<string, string>;
}

// Company/Partner Tab - Quick search and partner dropdown only
const COMPANY_FILTERS: FilterCategoryConfig[] = [];

// Overnight Camps - Region, Gender Structure, Is Brother-Sister, flexible date range
const OVERNIGHT_FILTERS: FilterCategoryConfig[] = [
  { title: 'Location & Region', fields: ['region'], defaultOpen: true },
  { title: 'Camp Structure', fields: ['gender_structure', 'is_brother_sister'], defaultOpen: true },
  { title: 'Age & Grade', fields: ['age__min_', 'age__max_'], defaultOpen: true },
  {
    title: 'Dates & Duration',
    fields: ['start_date', 'end_date', 'weeks'],
    defaultOpen: true,
    fieldLabels: {
      'start_date': 'Starts no earlier than',
      'end_date': 'Ends no later than',
      'weeks': 'Duration (weeks)'
    }
  },
  { title: 'Tuition & Cost', fields: ['tuition__current_'], defaultOpen: false },
];

// Specialty Camps - Primary Camp Type, conditional activity options (NO region)
const SPECIALTY_FILTERS: FilterCategoryConfig[] = [
  { title: 'Camp Type', fields: ['primary_camp_type'], defaultOpen: true },
  {
    title: 'Sport Options',
    fields: ['sport_options'],
    defaultOpen: true,
    conditionalOn: { field: 'primary_camp_type', values: ['sports'] }
  },
  {
    title: 'Arts Options',
    fields: ['arts_options'],
    defaultOpen: true,
    conditionalOn: { field: 'primary_camp_type', values: ['arts'] }
  },
  {
    title: 'Education Options',
    fields: ['education_options'],
    defaultOpen: true,
    conditionalOn: { field: 'primary_camp_type', values: ['academic', 'education'] }
  },
  { title: 'Age & Grade', fields: ['age__min_', 'age__max_'], defaultOpen: true },
  {
    title: 'Dates & Duration',
    fields: ['start_date', 'end_date', 'weeks'],
    defaultOpen: false,
    fieldLabels: {
      'start_date': 'Starts no earlier than',
      'end_date': 'Ends no later than',
      'weeks': 'Duration (weeks)'
    }
  },
  { title: 'Tuition & Cost', fields: ['tuition__current_'], defaultOpen: false },
];

// Teen Trips & Gap Year - Destination focused (renamed from locations)
const TEEN_FILTERS: FilterCategoryConfig[] = [
  {
    title: 'Destinations',
    fields: ['locations'],
    defaultOpen: true,
    fieldLabels: {
      'locations': 'Destinations'
    }
  },
  { title: 'Age & Grade', fields: ['age__min_', 'age__max_'], defaultOpen: true },
  {
    title: 'Dates & Duration',
    fields: ['start_date', 'end_date', 'weeks'],
    defaultOpen: true,
    fieldLabels: {
      'start_date': 'Starts no earlier than',
      'end_date': 'Ends no later than',
      'weeks': 'Duration (weeks)'
    }
  },
  { title: 'Tuition & Cost', fields: ['tuition__current_'], defaultOpen: false },
  { title: 'Accommodations', fields: ['accommodations'], defaultOpen: false },
];

// Other Programs - Simple dropdown to select type
const OTHER_FILTERS: FilterCategoryConfig[] = [];

// Dropdown options for "Other Programs" tab
const OTHER_PROGRAM_OPTIONS = [
  { value: 'family_camp', label: 'Family Camp' },
  { value: 'day_camp', label: 'Day Camp' },
  { value: 'specialty_program', label: 'Specialty Program' },
];

const SEARCH_TABS: SearchTabConfig[] = [
  {
    id: 'company',
    label: 'Company Programs',
    shortLabel: 'Company',
    description: 'Browse programs by partner company. Select a partner to see all their programs and sessions.',
    programTypes: [],
    filterCategories: COMPANY_FILTERS,
    isCompanyTab: true,
    showQuickSearch: true,
    showPartnerDropdown: true,
  },
  {
    id: 'overnight',
    label: 'Overnight Camp',
    shortLabel: 'Overnight',
    description: 'Traditional sleepaway camps. Filter by region, gender structure, and brother-sister options.',
    programTypes: ['overnight_camp'],
    filterCategories: OVERNIGHT_FILTERS,
  },
  {
    id: 'specialty',
    label: 'Specialty Camp',
    shortLabel: 'Specialty',
    description: 'Focused programs for sports, arts, and education. Select a camp type to see specific activity options.',
    programTypes: ['specialty_program'],
    filterCategories: SPECIALTY_FILTERS,
  },
  {
    id: 'teen',
    label: 'Teen Trips / Gap Year',
    shortLabel: 'Teen/Gap',
    description: 'Travel adventures and gap year programs. Browse by destination.',
    programTypes: ['teen_trip', 'gap_year'],
    filterCategories: TEEN_FILTERS,
  },
  {
    id: 'other',
    label: 'Other Programs',
    shortLabel: 'Other',
    description: 'Family camps, day camps, and other specialized offerings.',
    programTypes: [],
    filterCategories: OTHER_FILTERS,
    isDropdownMode: true,
    dropdownOptions: OTHER_PROGRAM_OPTIONS,
  },
];

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
  const [activeFilters, setActiveFilters] = useState<Filter[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResponse | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [companyOptions, setCompanyOptions] = useState<PropertyOption[]>([]);
  const [activeTab, setActiveTab] = useState<SearchTabId>('company');
  const [selectedProgramType, setSelectedProgramType] = useState<string>('');

  // UI state
  const [expandedPrograms, setExpandedPrograms] = useState<Set<string>>(new Set());

  const portalId = context.portal.id;
  const tabConfig = SEARCH_TABS.find(tab => tab.id === activeTab) || SEARCH_TABS[0];

  // Load schema on mount
  useEffect(() => {
    loadSchema();
  }, []);

  // Re-fetch schema when tab changes (for applicable filters)
  useEffect(() => {
    if (tabConfig.programTypes.length > 0) {
      loadSchema(tabConfig.programTypes[0]);
    } else {
      loadSchema();
    }
  }, [activeTab]);

  // Reset state when tab changes
  useEffect(() => {
    setActiveFilters([]);
    setSelectedCompanies([]);
    setSearchQuery('');
    setSearchResults(null);
    setError(null);
    setExpandedPrograms(new Set());
    setSelectedProgramType('');
  }, [activeTab]);

  const loadSchema = async (programType?: string) => {
    try {
      setLoading(true);
      const url = programType
        ? `${API_BASE_URL}/api/schema?programType=${programType}`
        : `${API_BASE_URL}/api/schema`;

      const response = await hubspot.fetch(url, {
        method: 'GET',
      });

      const rawText = await response.text();

      if (!rawText || rawText.length === 0) {
        setError('Empty response from search service');
        return;
      }

      const data = JSON.parse(rawText);

      if (data.success) {
        setSchema(data.data);
        setError(null);

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

  const loadCompanyOptions = async () => {
    try {
      const response = await hubspot.fetch(`${API_BASE_URL}/api/search`, {
        method: 'POST',
        body: JSON.stringify({
          page: 1,
          pageSize: 20,
          includeEmptyResults: true,
        }) as unknown as Record<string, unknown>,
      });

      const data = await response.json();

      if (data.success) {
        setSearchResults(data.data);

        if (data.data.facets) {
          const companyFacet = data.data.facets.find(
            (f: FacetResult) => f.field === 'name' && f.objectType === 'company'
          );
          if (companyFacet) {
            const options = companyFacet.values.map((v: FacetValue) => ({
              value: v.value,
              label: v.label,
            }));
            options.sort((a: PropertyOption, b: PropertyOption) => a.label.localeCompare(b.label));
            setCompanyOptions(options);
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
      const allFilters: Filter[] = [...activeFilters];

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

      let programTypeFilter: string | undefined = undefined;

      // Handle dropdown mode (Other Programs tab)
      if (tabConfig.isDropdownMode && selectedProgramType) {
        programTypeFilter = selectedProgramType;
      } else if (tabConfig.programTypes.length === 1) {
        programTypeFilter = tabConfig.programTypes[0];
      } else if (tabConfig.programTypes.length > 1) {
        allFilters.push({
          field: 'program_type',
          operator: 'in',
          value: tabConfig.programTypes,
          objectType: 'program',
        });
      }

      const requestBody = {
        query: searchQuery || undefined,
        filters: allFilters.length > 0 ? filterGroup : undefined,
        programType: programTypeFilter,
        page,
        pageSize: 20,
        includeEmptyResults: tabConfig.isCompanyTab, // Show all for company tab
      };

      const response = await hubspot.fetch(`${API_BASE_URL}/api/search`, {
        method: 'POST',
        body: JSON.stringify(requestBody) as unknown as Record<string, unknown>,
      });

      const data = await response.json();

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
  }, [schema, searchQuery, activeFilters, selectedCompanies, tabConfig, selectedProgramType]);

  useEffect(() => {
    if (schema && (selectedCompanies.length > 0 || activeFilters.length > 0 || selectedProgramType)) {
      executeSearch(1);
    }
  }, [selectedCompanies, activeFilters, schema, selectedProgramType]);

  const handleSearch = () => {
    executeSearch(1);
  };

  const addFilter = (field: string, value: string | number | boolean | string[] | number[], operator = 'eq', objectType?: 'program' | 'session' | 'company') => {
    const existingIndex = activeFilters.findIndex(f => f.field === field);
    if (existingIndex >= 0) {
      const newFilters = [...activeFilters];
      newFilters[existingIndex] = { field, operator, value, objectType };
      setActiveFilters(newFilters);
    } else {
      setActiveFilters([...activeFilters, { field, operator, value, objectType }]);
    }
  };

  const removeFilter = (field: string) => {
    setActiveFilters(activeFilters.filter(f => f.field !== field));
  };

  const clearAllFilters = () => {
    setActiveFilters([]);
    setSelectedCompanies([]);
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
      <Flex direction="column" align="center" justify="center" gap="lg">
        <LoadingSpinner label="Loading Camp Search..." size="md" />
        <Text>Preparing your search experience...</Text>
      </Flex>
    );
  }

  // Error state
  if (error && !schema) {
    return (
      <Flex direction="column" gap="md">
        <Alert title="Connection Error" variant="error">
          {error}
        </Alert>
        <Button onClick={() => loadSchema()}>Retry Connection</Button>
      </Flex>
    );
  }

  const totalPrograms = searchResults?.totalCount || 0;
  const totalSessions = searchResults?.results?.reduce((acc, r) => acc + r.matchingSessionCount, 0) || 0;
  const activeFilterCount = activeFilters.length + (selectedCompanies.length > 0 ? 1 : 0);

  return (
    <Flex direction="column" gap="md">
      {/* Header */}
      <Flex direction="row" justify="between" align="center">
        <Text format={{ fontWeight: 'bold' }}>Camp & Program Search</Text>
        {searchResults && (
          <Flex direction="row" gap="md">
            <Tag>{totalPrograms} programs</Tag>
            <Tag>{totalSessions} sessions</Tag>
            {activeFilterCount > 0 && <Tag variant="warning">{activeFilterCount} filters</Tag>}
          </Flex>
        )}
      </Flex>

      <Divider />

      {/* Tab Navigation */}
      <ToggleGroup
        name="searchTab"
        label="Search Mode"
        toggleType="radioButtonList"
        value={activeTab}
        options={SEARCH_TABS.map(tab => ({
          value: tab.id,
          label: tab.label,
        }))}
        onChange={(value: string) => setActiveTab(value as SearchTabId)}
      />

      {/* Tab Content - Rendered separately to avoid serialization issues */}
      <TabContent
        tabConfig={tabConfig}
        schema={schema}
        searchQuery={searchQuery}
        selectedCompanies={selectedCompanies}
        companyOptions={companyOptions}
        activeFilters={activeFilters}
        searchResults={searchResults}
        searching={searching}
        selectedProgramType={selectedProgramType}
        onSearchQueryChange={setSearchQuery}
        onSearchSubmit={handleSearch}
        onCompaniesChange={setSelectedCompanies}
        onAddFilter={addFilter}
        onRemoveFilter={removeFilter}
        onProgramTypeChange={setSelectedProgramType}
      />

      {/* Applied Filters Summary */}
      {(selectedCompanies.length > 0 || activeFilters.length > 0) && (
        <Tile>
          <Flex direction="column" gap="sm">
            <Flex direction="row" justify="between" align="center">
              <Text format={{ fontWeight: 'bold' }}>Active Filters</Text>
              <Button variant="secondary" size="xs" onClick={clearAllFilters}>
                Clear All
              </Button>
            </Flex>
            <Flex direction="row" gap="xs" wrap="wrap">
              {selectedCompanies.length > 0 && (
                <Tag variant="default" onClick={() => setSelectedCompanies([])}>
                  Partners: {selectedCompanies.length} selected
                </Tag>
              )}
              {activeFilters.map((filter, idx) => (
                <Tag
                  key={`${filter.field}-${idx}`}
                  variant="default"
                  onClick={() => removeFilter(filter.field)}
                >
                  {getFilterLabel(schema, filter)}
                </Tag>
              ))}
            </Flex>
          </Flex>
        </Tile>
      )}

      {/* Error Display */}
      {error && (
        <Alert title="Search Error" variant="warning">
          {error}
        </Alert>
      )}

      {/* Loading State */}
      {searching && (
        <Flex direction="column" align="center" justify="center" gap="md">
          <LoadingSpinner label="Searching..." />
        </Flex>
      )}

      {/* Results Section */}
      {!searching && searchResults && searchResults.totalCount > 0 && (
        <SearchResultsPanel
          results={searchResults}
          expandedPrograms={expandedPrograms}
          onToggleExpand={toggleProgramExpanded}
          onPageChange={(page) => executeSearch(page)}
          buildLink={buildHubSpotLink}
          schema={schema}
          tabConfig={tabConfig}
        />
      )}

      {/* Empty State */}
      {!searching && searchResults && searchResults.totalCount === 0 && (
        <EmptyState
          title="No Programs Found"
          layout="vertical"
          reverseOrder={false}
        >
          <Text>
            No programs match your current filters. Try adjusting your search criteria or clearing some filters.
          </Text>
          <Button variant="secondary" onClick={clearAllFilters}>
            Clear All Filters
          </Button>
        </EmptyState>
      )}

      {/* Initial State - No Search Yet */}
      {!searching && !searchResults && !error && (
        <EmptyState
          title={`Search ${tabConfig.label}`}
          layout="vertical"
          reverseOrder={false}
        >
          <Text>
            {tabConfig.description}
          </Text>
          <Text format={{ italic: true }}>
            {tabConfig.isCompanyTab
              ? 'Select a partner from the dropdown or use quick search to begin.'
              : tabConfig.isDropdownMode
                ? 'Select a program type from the dropdown to see available programs.'
                : 'Set filters above to begin your search.'}
          </Text>
        </EmptyState>
      )}
    </Flex>
  );
};

// ----------------------------------------------------------------------------
// Tab Content Component
// ----------------------------------------------------------------------------

interface TabContentProps {
  tabConfig: SearchTabConfig;
  schema: SchemaResponse | null;
  searchQuery: string;
  selectedCompanies: string[];
  companyOptions: PropertyOption[];
  activeFilters: Filter[];
  searchResults: SearchResponse | null;
  searching: boolean;
  selectedProgramType: string;
  onSearchQueryChange: (value: string) => void;
  onSearchSubmit: () => void;
  onCompaniesChange: (companies: string[]) => void;
  onAddFilter: (field: string, value: string | number | boolean | string[] | number[], operator?: string, objectType?: 'program' | 'session' | 'company') => void;
  onRemoveFilter: (field: string) => void;
  onProgramTypeChange: (programType: string) => void;
}

const TabContent: React.FC<TabContentProps> = ({
  tabConfig,
  schema,
  searchQuery,
  selectedCompanies,
  companyOptions,
  activeFilters,
  searchResults,
  searching,
  selectedProgramType,
  onSearchQueryChange,
  onSearchSubmit,
  onCompaniesChange,
  onAddFilter,
  onRemoveFilter,
  onProgramTypeChange,
}) => {
  const isCompanyTab = tabConfig.isCompanyTab;
  const isSpecialtyTab = tabConfig.id === 'specialty';
  const isDropdownMode = tabConfig.isDropdownMode;

  return (
    <Flex direction="column" gap="md">
      {/* Tab Description */}
      <Flex direction="row" align="center" gap="sm">
        <StatusTag variant="info">{tabConfig.shortLabel}</StatusTag>
        <Text>{tabConfig.description}</Text>
      </Flex>

      {/* Company Tab - Quick Search and Partner Dropdown Only */}
      {isCompanyTab && (
        <>
          {/* Quick Search Bar - Only for Company Tab */}
          {tabConfig.showQuickSearch && (
            <Tile>
              <Flex direction="column" gap="sm">
                <Text format={{ fontWeight: 'bold' }}>Quick Search</Text>
                <Flex direction="row" gap="sm" align="end">
                  <Box>
                    <Input
                      name="searchQuery"
                      label="Search by company name, program name, or session..."
                      placeholder="Type to search..."
                      value={searchQuery}
                      onChange={onSearchQueryChange}
                    />
                  </Box>
                  <Button onClick={onSearchSubmit} disabled={searching}>
                    {searching ? 'Searching...' : 'Search'}
                  </Button>
                </Flex>
              </Flex>
            </Tile>
          )}

          {/* Partner Selection Dropdown - Only for Company Tab */}
          {tabConfig.showPartnerDropdown && (
            <Tile>
              <Flex direction="column" gap="sm">
                <Text format={{ fontWeight: 'bold' }}>Select Partner</Text>
                <Select
                  name="companySelect"
                  label="Camp Partner"
                  placeholder="Select a camp partner..."
                  value={selectedCompanies[0] || ''}
                  options={[
                    { value: '', label: 'Select a partner...' },
                    ...companyOptions.map(c => ({ value: c.value, label: c.label }))
                  ]}
                  onChange={(value) => {
                    if (value) {
                      onCompaniesChange([value]);
                    } else {
                      onCompaniesChange([]);
                    }
                  }}
                />
                {selectedCompanies.length > 0 && (
                  <Text format={{ fontWeight: 'demibold' }}>
                    Showing all programs for: {selectedCompanies[0]}
                  </Text>
                )}
              </Flex>
            </Tile>
          )}
        </>
      )}

      {/* Dropdown Mode - Other Programs Tab */}
      {isDropdownMode && tabConfig.dropdownOptions && (
        <Tile>
          <Flex direction="column" gap="sm">
            <Text format={{ fontWeight: 'bold' }}>Select Program Type</Text>
            <Select
              name="programTypeSelect"
              label="Program Type"
              placeholder="Select a program type..."
              value={selectedProgramType}
              options={[
                { value: '', label: 'Select a program type...' },
                ...tabConfig.dropdownOptions.map(o => ({ value: o.value, label: o.label }))
              ]}
              onChange={(value) => onProgramTypeChange(value)}
            />
            {selectedProgramType && (
              <Text format={{ fontWeight: 'demibold' }}>
                Showing all {tabConfig.dropdownOptions.find(o => o.value === selectedProgramType)?.label || selectedProgramType} programs
              </Text>
            )}
          </Flex>
        </Tile>
      )}

      {/* Traditional Filter Tabs (Overnight, Specialty, Teen) */}
      {!isCompanyTab && !isDropdownMode && (
        <>
          {/* Filter Sections */}
          {schema && tabConfig.filterCategories.length > 0 && (
            <Tile>
              <Flex direction="column" gap="sm">
                <Flex direction="row" align="center" gap="xs">
                  <Text format={{ fontWeight: 'bold' }}>Filter Options</Text>
                  {activeFilters.length > 0 && (
                    <Tag variant="warning">{activeFilters.length} active</Tag>
                  )}
                </Flex>

                {/* Specialty tab hint */}
                {isSpecialtyTab && !activeFilters.find(f => f.field === 'primary_camp_type') && (
                  <Alert title="Select a Camp Type" variant="info">
                    Choose a primary camp type (Sports, Arts, or Education) to see specific activity options.
                  </Alert>
                )}

                {tabConfig.filterCategories.map((category, idx) => (
                  <FilterCategory
                    key={`${category.title}-${idx}`}
                    category={category}
                    schema={schema}
                    activeFilters={activeFilters}
                    facets={searchResults?.facets}
                    onAddFilter={onAddFilter}
                    onRemoveFilter={onRemoveFilter}
                    tabProgramTypes={tabConfig.programTypes}
                  />
                ))}
              </Flex>
            </Tile>
          )}
        </>
      )}
    </Flex>
  );
};

// ----------------------------------------------------------------------------
// Filter Category Component
// ----------------------------------------------------------------------------

interface FilterCategoryProps {
  category: FilterCategoryConfig;
  schema: SchemaResponse;
  activeFilters: Filter[];
  facets?: FacetResult[];
  onAddFilter: (field: string, value: string | number | boolean | string[] | number[], operator?: string, objectType?: 'program' | 'session' | 'company') => void;
  onRemoveFilter: (field: string) => void;
  tabProgramTypes: string[];
}

const FilterCategory: React.FC<FilterCategoryProps> = ({
  category,
  schema,
  activeFilters,
  facets,
  onAddFilter,
  onRemoveFilter,
  tabProgramTypes,
}) => {
  // Check conditional visibility for category
  if (category.conditionalOn) {
    const conditionFilter = activeFilters.find(f => f.field === category.conditionalOn!.field);
    if (!conditionFilter) return null;

    const filterValue = Array.isArray(conditionFilter.value)
      ? conditionFilter.value
      : [String(conditionFilter.value)];

    const hasMatchingValue = filterValue.some(v =>
      category.conditionalOn!.values.includes(String(v).toLowerCase())
    );

    if (!hasMatchingValue) return null;
  }

  const categoryFields = schema.filterableFields.filter(f => {
    if (!category.fields.includes(f.field)) return false;

    if (f.field === 'program_type' && !category.fields.includes('program_type')) {
      return false;
    }

    if (f.applicableRecordTypes && tabProgramTypes.length > 0) {
      const hasMatch = tabProgramTypes.some(pt =>
        f.applicableRecordTypes!.includes('*') || f.applicableRecordTypes!.includes(pt)
      );
      if (!hasMatch) return false;
    }

    if (f.applicableParentProgramTypes && tabProgramTypes.length > 0) {
      const hasMatch = tabProgramTypes.some(pt =>
        f.applicableParentProgramTypes!.includes('*') || f.applicableParentProgramTypes!.includes(pt)
      );
      if (!hasMatch) return false;
    }

    return true;
  });

  if (categoryFields.length === 0) return null;

  const activeCount = activeFilters.filter(f => category.fields.includes(f.field)).length;
  const titleWithCount = activeCount > 0
    ? `${category.title} (${activeCount} active)`
    : category.title;

  return (
    <Accordion title={titleWithCount} defaultOpen={category.defaultOpen}>
      <Flex direction="row" gap="sm" wrap="wrap">
        {categoryFields.map(field => {
          // Apply custom label if specified in category config
          const customLabel = category.fieldLabels?.[field.field];
          const fieldWithCustomLabel = customLabel
            ? { ...field, label: customLabel }
            : field;

          return (
            <FilterControl
              key={field.field}
              field={fieldWithCustomLabel}
              activeFilters={activeFilters}
              facets={facets}
              onAddFilter={onAddFilter}
              onRemoveFilter={onRemoveFilter}
            />
          );
        })}
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

  const options = facet?.values?.map(v => ({
    value: v.value,
    label: `${v.label} (${v.count})`,
  })) || field.options || [];

  switch (field.type) {
    case 'enumeration':
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

      return (
        <Box>
          <NumberInput
            name={field.field}
            label={field.label}
            value={currentFilter?.value as number || undefined}
            onChange={(value) => {
              if (value !== undefined && value !== null) {
                let operator = 'eq';
                if (field.field.includes('min') || field.field === 'age__min_' || field.field === 'grade_range_min') {
                  operator = 'lte';
                } else if (field.field.includes('max') || field.field === 'age__max_' || field.field === 'grade_range_max') {
                  operator = 'gte';
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
            value={typeof currentFilter?.value === 'string' ? {
              year: parseInt(currentFilter.value.slice(0, 4)),
              month: parseInt(currentFilter.value.slice(5, 7)),
              date: parseInt(currentFilter.value.slice(8, 10))
            } : undefined}
            onChange={(payload: { year?: number; month?: number; date?: number } | null) => {
              if (payload && payload.year && payload.month && payload.date) {
                let operator = 'gte';
                if (field.field === 'end_date' || field.field.includes('end')) {
                  operator = 'lte';
                }
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
  tabConfig: SearchTabConfig;
}

const SearchResultsPanel: React.FC<SearchResultsPanelProps> = ({
  results,
  expandedPrograms,
  onToggleExpand,
  onPageChange,
  buildLink,
  schema,
  tabConfig,
}) => {
  return (
    <Flex direction="column" gap="md">
      {/* Results Header */}
      <Tile>
        <Flex direction="row" justify="between" align="center">
          <Flex direction="column" gap="xs">
            <Text format={{ fontWeight: 'bold' }}>
              Step 3: Review Results
            </Text>
            <Text>
              Found {results.totalCount} programs with matching sessions
              {results.searchTime > 0 && ` (${results.searchTime}ms)`}
            </Text>
          </Flex>
          <Flex direction="row" align="center" gap="sm">
            <StatusTag variant="info">{tabConfig.shortLabel}</StatusTag>
            <Text>Page {results.page} of {results.totalPages}</Text>
          </Flex>
        </Flex>
      </Tile>

      {/* Results List */}
      {results.results.map((result) => (
        <ProgramResultCard
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
        <Tile>
          <Flex direction="row" justify="center" align="center" gap="md">
            <Button
              variant="secondary"
              size="sm"
              disabled={results.page <= 1}
              onClick={() => onPageChange(results.page - 1)}
            >
              Previous
            </Button>
            <Text format={{ fontWeight: 'demibold' }}>
              Page {results.page} of {results.totalPages}
            </Text>
            <Button
              variant="secondary"
              size="sm"
              disabled={results.page >= results.totalPages}
              onClick={() => onPageChange(results.page + 1)}
            >
              Next
            </Button>
          </Flex>
        </Tile>
      )}
    </Flex>
  );
};

// ----------------------------------------------------------------------------
// Program Result Card
// ----------------------------------------------------------------------------

interface ProgramResultCardProps {
  result: SearchResult;
  isExpanded: boolean;
  onToggleExpand: () => void;
  buildLink: (objectType: 'program' | 'session' | 'company', objectId: string) => string;
  schema: SchemaResponse | null;
}

const ProgramResultCard: React.FC<ProgramResultCardProps> = ({
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

  const programRegion = program.properties.region ? String(program.properties.region) : '';
  const primaryCampType = program.properties.primary_camp_type ? String(program.properties.primary_camp_type) : '';
  const genderStructure = program.properties.gender_structure
    ? getOptionDisplayLabel(schema, 'program', 'gender_structure', String(program.properties.gender_structure))
    : '';
  const isBrotherSister = program.properties.is_brother_sister === true;

  const companyState = company?.properties.us_state ? String(company.properties.us_state) : '';
  const companyCountry = company?.properties.country_hq ? String(company.properties.country_hq) : '';
  const companyLocation = [companyState, companyCountry].filter(Boolean).join(', ');
  const partnerStatus = company?.properties.lifecyclestage ? String(company.properties.lifecyclestage) : '';

  const firstSession = sessions[0];
  const sessionAgeRange = firstSession
    ? `${firstSession.properties.age__min_ || '?'}-${firstSession.properties.age__max_ || '?'} years`
    : '';
  const sessionTuitionRange = sessions.length > 0
    ? formatCurrencyRange(sessions.map(s => Number(s.properties.tuition__current_) || 0))
    : '';

  return (
    <Tile>
      <Flex direction="column" gap="sm">
        {/* Header Row */}
        <Flex direction="row" justify="between" align="start">
          <Flex direction="column" gap="xs">
            <Flex direction="row" gap="sm" align="center">
              <Link href={buildLink('program', program.id)}>
                <Text format={{ fontWeight: 'bold' }}>{programName}</Text>
              </Link>
              {programTypeLabel && (
                <StatusTag variant="info">{formatMultiValue(programTypeLabel)}</StatusTag>
              )}
            </Flex>

            <Flex direction="row" gap="sm" align="center">
              {company && (
                <>
                  <Link href={buildLink('company', company.id)}>
                    <Text format={{ fontWeight: 'demibold' }}>{companyName}</Text>
                  </Link>
                  {companyLocation && <Text>| {companyLocation}</Text>}
                  {partnerStatus === 'customer' && (
                    <Tag variant="success">Active Partner</Tag>
                  )}
                </>
              )}
            </Flex>
          </Flex>

          <Flex direction="column" align="end" gap="xs">
            <Tag variant="default">
              {matchingSessionCount} of {totalSessionCount} sessions
            </Tag>
            <Button variant="secondary" size="xs" onClick={onToggleExpand}>
              {isExpanded ? 'Hide Details' : 'Show Details'}
            </Button>
          </Flex>
        </Flex>

        {/* Program Attributes */}
        <Flex direction="row" gap="xs" wrap="wrap">
          {programRegion && <Tag>{formatMultiValue(programRegion)}</Tag>}
          {primaryCampType && <Tag>{formatMultiValue(primaryCampType)}</Tag>}
          {genderStructure && genderStructure !== 'none' && <Tag>{genderStructure}</Tag>}
          {isBrotherSister && <Tag variant="warning">Brother/Sister</Tag>}
          {sessionAgeRange && <Tag variant="default">Ages: {sessionAgeRange}</Tag>}
          {sessionTuitionRange && <Tag variant="default">{sessionTuitionRange}</Tag>}
        </Flex>

        {/* Expanded Details */}
        {isExpanded && (
          <>
            <Divider />

            <DescriptionList direction="row">
              {programRegion && (
                <DescriptionListItem label="Region">
                  <Text>{formatMultiValue(programRegion)}</Text>
                </DescriptionListItem>
              )}
              {primaryCampType && (
                <DescriptionListItem label="Camp Type">
                  <Text>{formatMultiValue(primaryCampType)}</Text>
                </DescriptionListItem>
              )}
              {genderStructure && (
                <DescriptionListItem label="Gender">
                  <Text>{genderStructure}</Text>
                </DescriptionListItem>
              )}
              {program.properties.programming_philosophy && (
                <DescriptionListItem label="Philosophy">
                  <Text>{formatMultiValue(String(program.properties.programming_philosophy))}</Text>
                </DescriptionListItem>
              )}
            </DescriptionList>

            {sessions.length > 0 && (
              <Box>
                <Text format={{ fontWeight: 'demibold' }}>Matching Sessions:</Text>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeader>Session</TableHeader>
                      <TableHeader>Dates</TableHeader>
                      <TableHeader>Ages</TableHeader>
                      <TableHeader>Duration</TableHeader>
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
                  <Text format={{ italic: true }}>
                    Showing 10 of {sessions.length} sessions.{' '}
                    <Link href={buildLink('program', program.id)}>View all in HubSpot</Link>
                  </Text>
                )}
              </Box>
            )}
          </>
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
                   ageMax ? `up to ${ageMax}` : '-';

  const tuition = props.tuition__current_ ? formatCurrency(Number(props.tuition__current_)) : '-';
  const weeks = props.weeks ? `${props.weeks} wks` : '-';

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
  if (value.includes(';')) {
    return value.split(';').map(v => v.trim()).join(', ');
  }
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

function formatCurrencyRange(amounts: number[]): string {
  const validAmounts = amounts.filter(a => a > 0);
  if (validAmounts.length === 0) return '';

  const min = Math.min(...validAmounts);
  const max = Math.max(...validAmounts);

  if (min === max) {
    return formatCurrency(min);
  }
  return `${formatCurrency(min)} - ${formatCurrency(max)}`;
}

function getFilterLabel(schema: SchemaResponse | null, filter: Filter): string {
  if (!schema) return `${filter.field}: ${filter.value}`;

  const field = schema.filterableFields.find(f => f.field === filter.field);
  const fieldLabel = field?.label || filter.field;

  let valueLabel = String(filter.value);
  if (Array.isArray(filter.value)) {
    valueLabel = filter.value.length + ' selected';
  } else if (field?.options) {
    const option = field.options.find(o => o.value === String(filter.value));
    if (option) {
      valueLabel = option.label;
    }
  }

  return `${fieldLabel}: ${valueLabel}`;
}

export default ProgramSearchCard;
