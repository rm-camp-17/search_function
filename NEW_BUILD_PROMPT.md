# Fresh Build Prompt Template for HubSpot Camp Search Application

## How to Use This

1. **Extract your schema:**
   ```bash
   cd /home/user/search_function
   HUBSPOT_ACCESS_TOKEN=your_token npx tsx extract-full-schema.ts > schema-dump.json
   ```

2. **Start a new conversation** with Claude and paste the prompt below, along with the schema JSON.

---

## PROMPT TO COPY:

```
I need to build a HubSpot UI Extension for searching camp programs and sessions. I have extracted the complete HubSpot schema below. Please help me build this from scratch with a clean architecture.

## Business Context

This is a search tool for a camp advisory service. The data model is:
- **Companies**: Camp providers/partners (the organizations running camps)
- **Programs**: Individual camp programs offered by companies (e.g., "Adventure Camp", "Arts Camp")
- **Sessions**: Specific instances of programs with dates, pricing, age ranges (e.g., "Week 1 - June 1-7")

**Relationships (via HubSpot associations):**
- Programs are associated with Companies (many programs → one company)
- Sessions are associated with Programs (many sessions → one program)

## Functional Requirements

1. **Search Tabs/Modes:**
   - Company Programs: Search by partner/company name (quick search dropdown)
   - Overnight Camps: Traditional summer camps with filtering
   - Specialty Camps: Niche programs (arts, sports, academic)
   - Teen Trips: Travel programs for teens
   - Other Programs: Catchall for misc programs

2. **Filtering Capabilities:**
   - Program type (the key discriminator for tabs)
   - Date range (start date no earlier than X, end date no later than Y)
   - Age range
   - Location/Region
   - Price range
   - Specialty options (sports, arts, etc.)

3. **Results Display:**
   - Show programs with their associated sessions
   - Display company info when relevant
   - Show session count per program

## Technical Requirements

1. **Backend (Vercel Serverless Functions):**
   - Cache HubSpot data in-memory with hourly refresh
   - Handle HubSpot API rate limits (429 errors) with exponential backoff
   - Use HubSpot associations API (v4) to link programs ↔ sessions ↔ companies
   - Property names must match HubSpot's EXACT internal names (see schema)

2. **Frontend (HubSpot UI Extension with React):**
   - Use @hubspot/ui-extensions library
   - Responsive card-based UI
   - Filter controls that match backend capabilities

3. **Data Fetching Strategy:**
   - Phase 1: Load objects quickly (programs, sessions, companies)
   - Phase 2: Load associations in background (slower due to rate limits)
   - Return results immediately when objects are loaded, even if associations pending

## Key Learnings from Previous Attempts

1. **HubSpot property names are NOT intuitive:**
   - "Program Type" field is internally named `recordtype_name` on Programs
   - Many fields have `__c` suffix (Salesforce migration artifact)
   - Always use the exact internal name, not the label

2. **Association fetching is slow:**
   - Use batch API: `/crm/v4/associations/{from}/{to}/batch/read`
   - Must include `Content-Type: application/json` header
   - Batch size of 50 with 250ms delays avoids rate limits
   - Implement exponential backoff for 429 errors

3. **Cache design matters:**
   - Vercel functions are stateless but share memory within same instance
   - First request may need to wait for cache to populate
   - Background refresh prevents blocking user requests

## HubSpot Schema

[PASTE YOUR schema-dump.json CONTENTS HERE]

---

## Deliverables Requested

1. **Architecture document**: Describe the data flow, caching strategy, and component structure
2. **Backend code**: Vercel serverless functions with proper HubSpot API integration
3. **Frontend code**: React components for the HubSpot UI Extension
4. **Type definitions**: TypeScript interfaces matching the HubSpot schema
5. **Configuration files**: vercel.json, package.json, tsconfig.json

Please start by analyzing the schema and proposing an architecture before writing code.
```

---

## Additional Resources to Reference

When starting the new build, you may want to provide these resources:

1. **HubSpot UI Extensions Documentation:**
   - https://developers.hubspot.com/docs/platform/ui-extensions-overview
   - https://developers.hubspot.com/docs/platform/create-ui-extensions

2. **HubSpot CRM API:**
   - https://developers.hubspot.com/docs/api/crm/objects
   - https://developers.hubspot.com/docs/api/crm/associations

3. **HubSpot UI Components:**
   - https://developers.hubspot.com/docs/platform/ui-extension-components

---

## What Went Wrong in the Current Build

For context, here's what caused issues in the current implementation:

1. **Property name mismatches**: We used `program_type` but HubSpot's internal name is `recordtype_name`
2. **Brittle caching**: Initial load took too long, causing 503 timeouts
3. **Association fetch failures**: Missing Content-Type header caused 415 errors, then rate limits (429)
4. **Frontend/backend mismatch**: Frontend expected different field names than backend provided
5. **No validation**: Schema wasn't validated against actual HubSpot data

## Recommendations for New Build

1. **Schema-first approach**: Generate TypeScript types directly from HubSpot schema
2. **Test endpoints first**: Verify each HubSpot API call works before building full system
3. **Incremental loading**: Show results as soon as objects load, associations can populate later
4. **Logging everywhere**: Add detailed logging to trace data flow
5. **Error boundaries**: Handle partial data gracefully (e.g., programs without sessions)
