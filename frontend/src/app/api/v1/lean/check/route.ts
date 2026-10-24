import type { NextRequest } from 'next/server';
import { dispatch } from '@/server/gateway';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// ADR 0008: up to three model calls plus Lean checks; one translation of a hard step took 110 s.
// This route exists only for the longer limit: it goes through the same gateway as [...path],
// whose 60 s would cut Lean checks off. The gateway's own Lean deadline is a little shorter.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  return dispatch(request, 'POST', ['lean', 'check']);
}
