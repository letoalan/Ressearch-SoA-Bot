import {
  baseUrl,
  getBaseUrlFromSettings,
  type Provider,
  type Settings,
} from '../config';

export interface Msg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatDetailedResult {
  content: string;
  durationMs: number;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface ExtendedRequestInit extends RequestInit {
  targetAddressSpace?: 'loopback' | 'local' | 'public';
}

function resolveConfig(target: Provider | Settings): { url: string; apiKey?: string } {
  if (typeof target === 'string') {
    return { url: baseUrl(target) };
  }
  return {
    url: getBaseUrlFromSettings(target),
    apiKey: target.apiKey?.trim(),
  };
}

function getHeaders(apiKey?: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    h['Authorization'] = `Bearer ${apiKey}`;
  }
  return h;
}

/**
 * Prépare les options de requête fetch.
 * Pour les cibles localhost / 127.0.0.1 depuis une origine publique (ex: GitHub Pages),
 * ajoute targetAddressSpace: 'loopback' pour respecter la spécification W3C Local Network Access (Chromium).
 */
function buildFetchInit(url: string, init: ExtendedRequestInit): RequestInit {
  const isLoopback = url.includes('localhost') || url.includes('127.0.0.1');
  if (isLoopback) {
    return {
      ...init,
      targetAddressSpace: 'loopback',
    } as RequestInit;
  }
  return init as RequestInit;
}

/** Récupère la liste des modèles disponibles sur le serveur */
export async function listModels(target: Provider | Settings): Promise<string[]> {
  const { url, apiKey } = resolveConfig(target);
  if (!url) return [];

  const r = await fetch(
    `${url}/models`,
    buildFetchInit(url, {
      headers: getHeaders(apiKey),
    })
  );

  if (!r.ok) {
    throw new Error(`Serveur LLM injoignable (${r.status} ${r.statusText})`);
  }
  const j = await r.json();
  return (j.data ?? []).map((m: { id: string }) => m.id);
}

/** Réponse complète avec métriques détaillées de timing et usage de tokens */
export async function chatDetailed(
  target: Provider | Settings,
  model: string,
  messages: Msg[],
  temperature = 0.25,
  json = false,
  signal?: AbortSignal,
  max_tokens?: number
): Promise<ChatDetailedResult> {
  const { url, apiKey } = resolveConfig(target);
  const isOllama = typeof target === 'string' ? target === 'ollama' : target.provider === 'ollama';

  const t0 = performance.now();
  const r = await fetch(
    `${url}/chat/completions`,
    buildFetchInit(url, {
      method: 'POST',
      headers: getHeaders(apiKey),
      signal,
      body: JSON.stringify({
        model,
        messages,
        temperature,
        stream: false,
        ...(max_tokens ? { max_tokens } : {}),
        ...(json && isOllama ? { response_format: { type: 'json_object' } } : {}),
      }),
    })
  );

  const durationMs = performance.now() - t0;
  if (!r.ok) {
    throw new Error(`Erreur LLM ${r.status}: ${await r.text()}`);
  }
  const j = await r.json();
  return {
    content: j.choices?.[0]?.message?.content ?? '',
    durationMs,
    usage: j.usage,
  };
}

/** Réponse complète (non streamée, rétrocompatible) */
export async function chat(
  target: Provider | Settings,
  model: string,
  messages: Msg[],
  temperature = 0.25,
  json = false,
  signal?: AbortSignal,
  max_tokens?: number
): Promise<string> {
  const res = await chatDetailed(target, model, messages, temperature, json, signal, max_tokens);
  return res.content;
}

export interface StreamMetrics {
  durationMs: number;
  ttftMs: number;
  tokenCount: number;
}

/** Streaming SSE (format compatible OpenAI) avec mesure du TTFT et du débit */
export async function* chatStream(
  target: Provider | Settings,
  model: string,
  messages: Msg[],
  temperature = 0.25,
  signal?: AbortSignal,
  max_tokens?: number,
  onComplete?: (metrics: StreamMetrics) => void
): AsyncGenerator<string, void, unknown> {
  const { url, apiKey } = resolveConfig(target);

  const t0 = performance.now();
  let firstTokenTime: number | null = null;
  let tokenCount = 0;

  const r = await fetch(
    `${url}/chat/completions`,
    buildFetchInit(url, {
      method: 'POST',
      headers: getHeaders(apiKey),
      signal,
      body: JSON.stringify({
        model,
        messages,
        temperature,
        stream: true,
        ...(max_tokens ? { max_tokens } : {}),
      }),
    })
  );

  if (!r.ok || !r.body) {
    throw new Error(`Erreur LLM ${r.status}: ${await r.text()}`);
  }

  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';

      for (const line of lines) {
        const l = line.trim();
        if (!l.startsWith('data:')) continue;
        const data = l.slice(5).trim();
        if (data === '[DONE]') {
          if (onComplete) {
            const totalMs = performance.now() - t0;
            const ttftMs = firstTokenTime ? firstTokenTime - t0 : 0;
            onComplete({ durationMs: totalMs, ttftMs, tokenCount });
          }
          return;
        }
        try {
          const d = JSON.parse(data).choices?.[0]?.delta?.content;
          if (d) {
            if (firstTokenTime === null) {
              firstTokenTime = performance.now();
            }
            tokenCount++;
            yield d as string;
          }
        } catch {
          // Ligne partielle ou en cours
        }
      }
    }
    if (onComplete) {
      const totalMs = performance.now() - t0;
      const ttftMs = firstTokenTime ? firstTokenTime - t0 : 0;
      onComplete({ durationMs: totalMs, ttftMs, tokenCount });
    }
  } finally {
    reader.releaseLock();
  }
}
