# Camp Experts Program & Session Search

A read-only internal search experience for Camp Experts built as a HubSpot UI extension with a Vercel backend.

## Overview

This application provides a powerful search interface for finding Programs and Sessions within HubSpot, supporting:

- **Multiple entry points**: Start searches by Program Type, dates, geography, or text search
- **Progressive refinement**: Faceted filtering that adapts to your selections
- **Schema-driven**: All filters, fields, and options are driven by JSON configuration files
- **Deep links**: Direct links to HubSpot record pages for Companies, Programs, and Sessions
- **Hourly caching**: Data is cached server-side for fast interactive searches

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      HubSpot UI Extension                       │
│                    (ProgramSearch.tsx)                          │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │ Program     │  │ Filter      │  │ Results Panel           │ │
│  │ Type        │  │ Panel       │  │ • Program tiles         │ │
│  │ Selector    │  │ • Dynamic   │  │ • Nested sessions       │ │
│  │             │  │ • Schema-   │  │ • Deep links            │ │
│  │             │  │   driven    │  │ • Pagination            │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ hubspot.fetch()
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Vercel Backend                             │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │ /api/schema │  │ /api/search │  │ /api/cache              │ │
│  │             │  │             │  │                         │ │
│  │ Returns     │  │ Executes    │  │ Cache status &          │ │
│  │ config &    │  │ filtered    │  │ manual refresh          │ │
│  │ filters     │  │ search      │  │                         │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
│                             │                                   │
│  ┌──────────────────────────▼──────────────────────────────┐   │
│  │                    In-Memory Cache                       │   │
│  │  Companies | Programs | Sessions | Associations          │   │
│  │  (Refreshed hourly from HubSpot)                        │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Project Structure

```
search_function/
├── Search_function/              # HubSpot Project
│   ├── hsproject.json           # HubSpot project config
│   ├── schemas/                 # Source of truth for schema
│   │   ├── search-config.json   # Main configuration
│   │   ├── program-properties.json
│   │   ├── session-properties.json
│   │   └── company-properties.json
│   └── src/
│       └── app/
│           ├── app-hsmeta.json  # App configuration
│           └── cards/
│               ├── ProgramSearch.tsx    # Main search UI
│               └── search-hsmeta.json   # Card config
│
└── backend/                     # Vercel Backend
    ├── vercel.json             # Vercel deployment config
    ├── package.json
    ├── api/
    │   ├── search.ts           # Search API endpoint
    │   ├── schema.ts           # Schema API endpoint
    │   └── cache.ts            # Cache management endpoint
    ├── lib/
    │   ├── cache.ts            # Data caching layer
    │   ├── schema.ts           # Schema loading
    │   └── search.ts           # Search engine
    └── types/
        └── index.ts            # TypeScript types
```

## Data Model

### Hierarchy

```
Company (HubSpot Companies)
    └── Program (Custom Object)
            └── Session (Custom Object)
```

### Program Record Types

- **Overnight Camp**: Traditional sleepaway camps
- **Day Camp**: Day programs without overnight stays
- **Teen Trip**: Travel programs for teenagers
- **Gap Year**: Gap year programs
- **Family Camp**: Programs for entire families
- **Specialty Program**: Specialized programs (arts, sports, academic)
- **International Program**: Programs based outside the US

### Field Applicability

Fields are conditionally shown based on Program Type. For example:
- `program_state` applies to: Overnight Camp, Day Camp, Specialty Program
- `trip_type` applies to: Teen Trip, Gap Year
- `destinations` applies to: Teen Trip, Gap Year, International

## Schema Configuration

### Adding a New Field

1. Add the field definition to the appropriate schema file:

```json
// schemas/program-properties.json
{
  "name": "new_field",
  "label": "New Field",
  "type": "enumeration",
  "fieldType": "select",
  "searchable": false,
  "filterable": true,
  "facetable": true,
  "displayInResults": true,
  "applicableRecordTypes": ["overnight_camp", "day_camp"],
  "options": [
    {"value": "option1", "label": "Option 1", "displayOrder": 1}
  ]
}
```

2. Wait for the next hourly cache refresh (or trigger manual refresh)

3. The field will automatically appear in:
   - Filter panel (if `filterable: true`)
   - Facet counts (if `facetable: true`)
   - Search results (if `displayInResults: true`)
   - Text search (if `searchable: true`)

### Field Properties

| Property | Description |
|----------|-------------|
| `searchable` | Include in full-text search |
| `filterable` | Show as filter control |
| `facetable` | Show with counts in facet panel |
| `displayInResults` | Show in result cards |
| `applicableRecordTypes` | Which Program types this applies to |
| `applicableParentProgramTypes` | (Sessions) Which parent Program types |
| `multiSelect` | Allow multiple values |
| `buckets` | Range groupings for numeric fields |

## API Endpoints

### GET /api/schema

Returns the full schema configuration including filterable and facetable fields.

Query params:
- `programType` (optional): Filter applicable fields for a specific program type

### POST /api/search

Execute a search request.

Request body:
```json
{
  "query": "search text",
  "filters": {
    "operator": "AND",
    "filters": [
      {"field": "program_type", "operator": "eq", "value": "overnight_camp"},
      {"field": "age_min", "operator": "lte", "value": 10}
    ]
  },
  "programType": "overnight_camp",
  "page": 1,
  "pageSize": 20
}
```

### GET /api/cache

Returns cache status (counts, last refresh time, etc.)

### POST /api/cache

Force cache refresh (requires Bearer token authorization).

## Development

### Prerequisites

- Node.js 18+
- HubSpot CLI (`npm install -g @hubspot/cli`)
- Vercel CLI (`npm install -g vercel`)

### Local Development

1. **Backend**:
```bash
cd backend
npm install
vercel dev
```

2. **HubSpot Extension**:
```bash
cd Search_function
cp src/app/local.json.example src/app/local.json
hs project dev
```

3. The local.json proxies requests from the production URL to localhost.

### Deployment

1. **Deploy Backend to Vercel**:
```bash
cd backend
vercel --prod
```

2. **Deploy HubSpot Extension**:
```bash
cd Search_function
hs project upload
hs project deploy
```

## Filter Semantics

### AND/OR Behavior

- **Within a field**: Multiple values use OR (e.g., selecting "Overnight Camp" and "Day Camp" matches either)
- **Across fields**: Different fields use AND (e.g., Program Type + Region filters both must match)

### Age Filtering

Age filtering uses "child can attend" semantics:
- `age_min` filter: Sessions where `session.age_min <= child_age`
- `age_max` filter: Sessions where `session.age_max >= child_age`

### Null Handling

- Missing/null values do NOT match filters (except for age ranges where null means "no restriction")
- Programs with no matching sessions are excluded from results

## Search Features

### Text Search

Full-text search across:
- Program name, description, highlights
- Company name
- Session names

Uses Fuse.js for fuzzy matching with relevance scoring.

### Facets

Dynamic facet counts update based on current filter selections, showing how many results match each option.

### Sorting

- Default: Session start date (ascending)
- With search query: Relevance score (descending)

## Non-Goals (Explicit)

This application is **read-only search only**. It does NOT include:

- Adding sessions/programs to deals
- Creating/cloning/publishing recommendations
- Sending emails
- Updating deals
- Triggering workflows

These features are out of scope by design.
