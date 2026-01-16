// ============================================================================
// Cache API Endpoint
// GET /api/cache - Get cache status
// POST /api/cache/refresh - Force cache refresh
// ============================================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { ApiResponse, CacheStats } from '../types/index.js';
import {
  getCacheStats,
  refreshCache,
  isCacheStale,
} from '../lib/cache.js';
import { loadSchemas } from '../lib/schema.js';

// Ensure schemas are loaded
let schemasLoaded = false;

function ensureSchemas(): void {
  if (!schemasLoaded) {
    loadSchemas();
    schemasLoaded = true;
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  const startTime = Date.now();
  const requestId = `cache-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  ensureSchemas();

  if (req.method === 'GET') {
    // Return cache status
    const stats = getCacheStats();
    const response: ApiResponse<CacheStats & { isStale: boolean }> = {
      success: true,
      data: {
        ...stats,
        isStale: isCacheStale(),
      },
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
        processingTimeMs: Date.now() - startTime,
      },
    };
    res.status(200).json(response);
    return;
  }

  if (req.method === 'POST') {
    // Force cache refresh
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

    try {
      await refreshCache(accessToken);
      const stats = getCacheStats();

      const response: ApiResponse<CacheStats> = {
        success: true,
        data: stats,
        meta: {
          requestId,
          timestamp: new Date().toISOString(),
          processingTimeMs: Date.now() - startTime,
        },
      };
      res.status(200).json(response);
    } catch (error) {
      console.error('Cache refresh error:', error);

      const response: ApiResponse<null> = {
        success: false,
        error: {
          code: 'REFRESH_FAILED',
          message: error instanceof Error ? error.message : 'Cache refresh failed',
        },
        meta: {
          requestId,
          timestamp: new Date().toISOString(),
          processingTimeMs: Date.now() - startTime,
        },
      };
      res.status(500).json(response);
    }
    return;
  }

  const response: ApiResponse<null> = {
    success: false,
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: 'Only GET and POST requests are allowed',
    },
    meta: {
      requestId,
      timestamp: new Date().toISOString(),
      processingTimeMs: Date.now() - startTime,
    },
  };
  res.status(405).json(response);
}
