import type { NextRequest } from 'next/server';
import { dispatch } from '@/server/gateway';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// recognition ≤ 20 s and suggestions ≤ 60 s per spec; the gateway enforces per-task deadlines
export const maxDuration = 60;

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  return dispatch(request, 'GET', (await ctx.params).path);
}

export async function POST(request: NextRequest, ctx: Ctx) {
  return dispatch(request, 'POST', (await ctx.params).path);
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  return dispatch(request, 'DELETE', (await ctx.params).path);
}
