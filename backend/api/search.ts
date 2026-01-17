// ============================================================================
// Search API Endpoint
// POST /api/search - Execute program/session search
// ============================================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SearchRequest, ApiResponse, SearchResponse } from '../types/index.js';
import { executeSearch } from '../lib/search.js';
import {
  isCacheEmpty,
  isCacheStale,
  refreshCache,
  getAccessToken,
} from '../lib/cache.js';
import { loadSchemas } from '../lib/schema.js';

// Ensure schemas are loaded
let schemasLoaded = false;
let refreshPromise: Promise<void> | null = null;

async function ensureInitialized(): Promise<{ ready: boolean; message?: string }> {
  if (!schemasLoaded) {
    loadSchemas();
    schemasLoaded = true;
  }

  const cacheEmpty = isCacheEmpty();
  const cacheStale = isCacheStale();

  // If cache has data (even if stale), use it and refresh in background
  if (!cacheEmpty && cacheStale && !refreshPromise) {
    console.log('Cache stale but has data - refreshing in background');
    const accessToken = getAccessToken();
    refreshPromise = refreshCache(accessToken).finally(() => {
      refreshPromise = null;
    });
    return { ready: true };
  }

  // If cache is empty, we need to wait for initial load
  if (cacheEmpty) {
    if (!refreshPromise) {
      console.log('Cache empty - starting initial load');
      const accessToken = getAccessToken();
      refreshPromise = refreshCache(accessToken).finally(() => {
        refreshPromise = null;
      });
    }
    // Wait for refresh with a timeout
    try {
      await Promise.race([
        refreshPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Cache initialization timeout')), 12000)
        ),
      ]);
      return { ready: true };
    } catch (error) {
      // If still empty after timeout, return not ready
      if (isCacheEmpty()) {
        return {
          ready: false,
          message: 'Cache is still loading. Please try again in a few seconds.'
        };
      }
      return { ready: true };
    }
  }

  return { ready: true };
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  const startTime = Date.now();
  const requestId = `search-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    const response: ApiResponse<null> = {
      success: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Only POST requests are allowed',
      },
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
        processingTimeMs: Date.now() - startTime,
      },
    };
    res.status(405).json(response);
    return;
  }

  try {
    // Initialize cache if needed (uses HUBSPOT_ACCESS_TOKEN env var)
    console.log(`[${requestId}] Starting search request`);
    const initResult = await ensureInitialized();

    if (!initResult.ready) {
      const response: ApiResponse<null> = {
        success: false,
        error: {
          code: 'CACHE_LOADING',
          message: initResult.message || 'Cache is loading. Please try again.',
        },
        meta: {
          requestId,
          timestamp: new Date().toISOString(),
          processingTimeMs: Date.now() - startTime,
        },
      };
      res.status(503).json(response);
      return;
    }

    // Parse and validate request body
    const searchRequest = req.body as SearchRequest;
    console.log(`[${requestId}] Search request:`, JSON.stringify({
      query: searchRequest.query,
      programType: searchRequest.programType,
      filterCount: searchRequest.filters?.filters?.length || 0,
      page: searchRequest.page,
      pageSize: searchRequest.pageSize,
    }));

    // Execute search
    const searchResponse = executeSearch(searchRequest);
    console.log(`[${requestId}] Search completed: ${searchResponse.totalCount} results, ${searchResponse.facets?.length || 0} facets`);

    const response: ApiResponse<SearchResponse> = {
      success: true,
      data: searchResponse,
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
        processingTimeMs: Date.now() - startTime,
      },
    };

    res.status(200).json(response);
  } catch (error) {
    console.error(`[${requestId}] Search error:`, error);

    const response: ApiResponse<null> = {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'An unexpected error occurred',
      },
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
        processingTimeMs: Date.now() - startTime,
      },
    };

    res.status(500).json(response);
  }
}
