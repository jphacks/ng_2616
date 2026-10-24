import 'server-only';
import { GatewayError } from './http';

/** In-process limits for direct mode (spec §7.2): 2 concurrent LLM calls, 4 unfinished per user, 32 waiting. */
const LLM_CONCURRENCY = 2;
const PER_USER = 4;
const MAX_WAITING = 32;
const QUEUE_WAIT_MS = 30_000;

let running = 0;
const waiting: { resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>; priority: number }[] = [];
const perUser = new Map<string, number>();

function release() {
  running -= 1;
  waiting.sort((a, b) => b.priority - a.priority);
  const nextUp = waiting.shift();
  if (nextUp) {
    clearTimeout(nextUp.timer);
    running += 1;
    nextUp.resolve();
  }
}

async function acquire(priority: number) {
  if (running < LLM_CONCURRENCY) {
    running += 1;
    return;
  }
  if (waiting.length >= MAX_WAITING) throw new GatewayError(429, 'QUEUE_FULL', 'too many requests waiting', true, 2000);
  await new Promise<void>((resolve, reject) => {
    const entry = {
      resolve,
      reject,
      priority,
      timer: setTimeout(() => {
        const i = waiting.indexOf(entry);
        if (i >= 0) waiting.splice(i, 1);
        reject(new GatewayError(429, 'QUEUE_FULL', 'queue wait above 30 s', true, 5000));
      }, QUEUE_WAIT_MS),
    };
    waiting.push(entry);
  });
}

/** Recognition gets priority over background work (suggestions, OCR). */
export async function withLimits<T>(userId: string, kind: string, fn: () => Promise<T>): Promise<T> {
  const mine = perUser.get(userId) ?? 0;
  if (mine >= PER_USER) throw new GatewayError(429, 'RATE_LIMITED', 'four unfinished requests already', true, 1500);
  perUser.set(userId, mine + 1);
  try {
    await acquire(kind === 'recognize' ? 2 : 1);
    try {
      return await fn();
    } finally {
      release();
    }
  } finally {
    const n = (perUser.get(userId) ?? 1) - 1;
    if (n <= 0) perUser.delete(userId);
    else perUser.set(userId, n);
  }
}
