import 'server-only';
import { GoogleGenAI } from '@google/genai';
import { serverEnv } from '@/server/env';
import { fail, GatewayError, ok, readJson } from '@/server/gateway/http';
import { authenticate } from '@/server/supabase';

const MODEL = process.env.SKETCH_IMAGE_MODEL || 'gemini-3.1-flash-image';
const DEADLINE_MS = 60_000;
const ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

const PROMPT = [
  'This is a page of handwriting and drawing from a student, written with a pen on plain white paper.',
  'Continue and complete what they are working on: finish the sentence, equation, derivation, diagram or sketch in the most natural way.',
  'Keep everything they already wrote exactly where it is, unchanged.',
  "Write every addition in the student's own handwriting: the same pen, stroke width, letter shapes, slant, size and spacing, in the same black ink, so the page looks like one person wrote all of it.",
  'Plain white background, no grid, no ruled lines, no paper texture, no shadows, no borders, no typed text.',
].join(' ');

/** The supported aspect ratio closest to the page's own. */
function nearestAspect(width: number, height: number): string {
  const want = Math.log(width / height);
  let best = ASPECTS[0]!;
  for (const a of ASPECTS) {
    const [w, h] = a.split(':').map(Number) as [number, number];
    const [bw, bh] = best.split(':').map(Number) as [number, number];
    if (Math.abs(Math.log(w / h) - want) < Math.abs(Math.log(bw / bh) - want)) best = a;
  }
  return best;
}

/** POST /api/v1/sketch: a picture of the page in, the page completed in the writer's hand out. */
export async function sketchComplete(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    const user = await authenticate(request);
    if (!user) throw new GatewayError(401, 'AUTH_REQUIRED', 'sign in required');
    const key = serverEnv().GEMINI_API_KEY;
    if (!key) throw new GatewayError(503, 'AI_UNAVAILABLE', 'configure GEMINI_API_KEY');
    const raw = (await readJson(request)) as { image?: unknown; width?: unknown; height?: unknown } | null;
    if (!raw || typeof raw.image !== 'string' || typeof raw.width !== 'number' || typeof raw.height !== 'number') {
      throw new GatewayError(400, 'INVALID_REQUEST', 'expected { image, width, height }');
    }
    const client = new GoogleGenAI({ apiKey: key });
    const res = await client.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: raw.image } }, { text: PROMPT }] }],
      config: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: nearestAspect(raw.width, raw.height) },
        abortSignal: AbortSignal.any([request.signal, AbortSignal.timeout(DEADLINE_MS)]),
      },
    });
    const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData?.data) throw new GatewayError(502, 'UPSTREAM_INVALID', 'the model returned no image', true);
    return ok(requestId, { image: part.inlineData.data, mime: part.inlineData.mimeType ?? 'image/png' });
  } catch (e) {
    if (e instanceof GatewayError) return fail(requestId, e);
    const message = e instanceof Error ? e.message : String(e);
    console.error('[sketch] unexpected', message);
    return fail(requestId, new GatewayError(502, 'UPSTREAM_INVALID', message.slice(0, 200), true));
  }
}
