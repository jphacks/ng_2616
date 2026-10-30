'use client';

import { graphOf, type GraphPng, type Notebook } from '@mn/contracts';
import { getGraphs } from '@/core/graph/controller';

/**
 * Draws every graph line of an export snapshot, by line id. A graph that cannot be drawn is left
 * out; its PDF block then says so instead of showing a picture.
 */
export async function drawGraphs(nb: Notebook, signal: AbortSignal): Promise<Record<string, GraphPng>> {
  const out: Record<string, GraphPng> = {};
  for (const line of nb.lines) {
    const graph = line.state === 'SETTLED' ? graphOf(line) : undefined;
    if (!graph) continue;
    const image = await getGraphs().render(graph);
    signal.throwIfAborted();
    if (image.ok) out[line.id] = { png: image.png, width: image.width, height: image.height };
  }
  return out;
}
