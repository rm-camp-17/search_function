// ============================================================================
// Search API Endpoint
// POST /api/search - Execute program/session search
// ============================================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { SearchRequest, ApiResponse, SearchResponse } from '../types/index.js';
import { executeSearch } from '../lib/search.js';
import {
  getCache,
  isCacheEmpty,
  isCacheStale,
  refreshCache,
  getCacheStats,
} from '../lib/cache.js';
import { loadSchemas } from '../lib/schema.js';

// Ensure schemas are loaded
let schemasLoaded = false;

async function ensureInitialized(accessToken: string): Promise<void> {
  if (!schemasLoaded) {
    loadSchemas();
    schemasLoaded = true;
  }

  if (isCacheEmpty() || isCacheStale()) {
    await refreshCache(accessToken);
  }
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
    // Get access token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      const response: ApiResponse<null> = {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing or invalid Authorization header',
        },
        meta: {
          requestId,
          timestamp: new Date().toISOString(),
          processingTimeMs: Date.now() - startTime,
        },
      };
      res.status(401).json(response);
      return;
    }

    const accessToken = authHeader.slice(7);

    // Initialize cache if needed
    await ensureInitialized(accessToken);

    // Parse and validate request body
    const searchRequest = req.body as SearchRequest;

    // Execute search
    const searchResponse = executeSearch(searchRequest);

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
    console.error('Search error:', error);

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
