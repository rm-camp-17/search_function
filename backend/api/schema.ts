// ============================================================================
// Schema API Endpoint
// GET /api/schema - Get search schema and configuration
// ============================================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { ApiResponse, SchemaResponse } from '../types/index.js';
import { buildSchemaResponse, loadSchemas } from '../lib/schema.js';

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
  const requestId = `schema-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    const response: ApiResponse<null> = {
      success: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Only GET requests are allowed',
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
    ensureSchemas();

    // Get optional program type filter from query string
    const programType = req.query.programType as string | undefined;

    // Build schema response
    const schemaResponse = buildSchemaResponse(programType);

    const response: ApiResponse<SchemaResponse> = {
      success: true,
      data: schemaResponse,
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
        processingTimeMs: Date.now() - startTime,
      },
    };

    // Cache schema responses for 1 hour
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(200).json(response);
  } catch (error) {
    console.error('Schema error:', error);

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
