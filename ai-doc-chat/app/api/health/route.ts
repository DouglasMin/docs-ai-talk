/**
 * Health Check Endpoint for ECS
 * Used by ALB target group health checks
 */

import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'ai-doc-chat-webapp',
  });
}

