import { ProviderError, redact } from '../errors.js';
import { fetchWithRetry } from '../http.js';
import { normalizeModel, normalizeModelList } from '../normalize.js';
import { findModel } from '../registry.js';
import { normalizeCompletion, streamNormalized } from '../sse.js';
import { SYSTEM_PROMPT } from '../system-prompt.js';

/**
 * Antarmuka provider (semua provider di Xean mengikuti bentuk ini):
 *   isConfigured()                         -> boolean
 *   fetchModels()                          -> NormalizedModel[]   (dipanggil registry, jangan langsung dari route)
 *   fallbackModels()                       -> NormalizedModel[]   (hanya bila katalog tak terjangkau dan tidak ada cache)
 *   getCapabilities(modelId)               -> capabilities | null
 *   sendMessage({ model, messages, options, signal })    -> respons ternormalisasi
 *   streamMessage({ model, messages, options, signal })  -> async generator event ternormalisasi
 *   healthCheck({ signal })                -> { online, latencyMs, status, ... }
 */
export class OpenAICompatibleProvider {
  constructor({ id, label, config, publicModels = false, includeUsage = false, keyEnvName }) {
    this.id = id;
    this.label = label;
    this.config = config;
    this.publicModels = publicModels; // katalog tidak butuh API key (xKiro)
    this.includeUsage = includeUsage; // minta frame usage saat streaming
    this.keyEnvName = keyEnvName;
  }

  get secrets() {
    return [this.config.apiKey];
  }

  isConfigured() {
    return Boolean(this.config.apiKey);
  }

  authHeaders() {
    return this.config.dialect === 'anthropic'
      ? { 'x-api-key': this.config.apiKey, 'anthropic-version': '2023-06-01' }
      : { Authorization: `Bearer ${this.config.apiKey}` };
  }

  notConfigured() {
    return new ProviderError({
      status: 503,
      code: 'not_configured',
      message: `API key ${this.label} belum diatur di server (${this.keyEnvName}).`,
    });
  }

  common(signal, extra = {}) {
    return { label: this.label, secrets: this.secrets, signal, retry: this.config.retry, ...extra };
  }

  async fetchModels() {
    if (!this.publicModels && !this.isConfigured()) throw this.notConfigured();
    const res = await fetchWithRetry(
      this.config.modelsUrl,
      { method: 'GET', headers: { Accept: 'application/json', ...(this.publicModels ? {} : this.authHeaders()) } },
      this.common(undefined, { idempotent: true, timeoutMs: this.config.modelsTimeoutMs })
    );
    let json;
    try {
      json = await res.json();
    } catch {
      throw new ProviderError({ status: 502, code: 'invalid_catalog', message: `Katalog model ${this.label} tidak bisa dibaca.`, retryable: true });
    }
    const models = normalizeModelList(json, this.id);
    if (!models.length) {
      throw new ProviderError({ status: 502, code: 'empty_catalog', message: `Katalog model ${this.label} kosong.`, retryable: true });
    }
    return models;
  }

  fallbackModels() {
    const ids = [...new Set([...this.config.fallbackModels, this.config.defaultModel].filter(Boolean))];
    return ids.map((id) => normalizeModel(id, this.id));
  }

  async getCapabilities(modelId) {
    const { model } = await findModel(this, modelId);
    if (!model) return null;
    return {
      ...model.capabilities,
      reasoningEfforts: model.reasoningEfforts,
      contextLength: model.contextLength,
      maxOutputTokens: model.maxOutputTokens,
    };
  }

  buildPayload({ model, messages, stream, options = {} }) {
    if (this.config.dialect === 'anthropic') {
      return {
        model,
        system: SYSTEM_PROMPT,
        messages,
        max_tokens: options.maxTokens ?? 8192,
        stream,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      };
    }
    return {
      model, // selalu ID lengkap vendor/model
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      stream,
      ...(stream && this.includeUsage ? { stream_options: { include_usage: true } } : {}),
      ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
      ...(options.tools ? { tools: options.tools } : {}),
      ...(options.toolChoice !== undefined ? { tool_choice: options.toolChoice } : {}),
    };
  }

  post(payload, { signal, timeoutMs }) {
    if (!this.isConfigured()) throw this.notConfigured();
    return fetchWithRetry(
      this.config.chatUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: payload.stream ? 'text/event-stream' : 'application/json',
          ...this.authHeaders(),
        },
        body: JSON.stringify(payload),
      },
      this.common(signal, { idempotent: false, timeoutMs })
    );
  }

  async sendMessage({ model, messages, options, signal }) {
    const res = await this.post(this.buildPayload({ model, messages, stream: false, options }), {
      signal,
      timeoutMs: this.config.requestTimeoutMs,
    });
    let json;
    try {
      json = await res.json();
    } catch {
      throw new ProviderError({ status: 502, code: 'invalid_response', message: `Respons ${this.label} tidak bisa dibaca.`, retryable: true });
    }
    return normalizeCompletion(json, { dialect: this.config.dialect, provider: this.id, model });
  }

  async *streamMessage({ model, messages, options, signal }) {
    const res = await this.post(this.buildPayload({ model, messages, stream: true, options }), {
      signal,
      timeoutMs: this.config.connectTimeoutMs,
    });
    if (!res.body) {
      throw new ProviderError({ status: 502, code: 'no_stream', message: `${this.label} tidak mengirim stream.`, retryable: true });
    }
    yield* streamNormalized(res.body, { dialect: this.config.dialect, label: this.label, secrets: this.secrets, signal });
  }

  // Memakai endpoint katalog (publik, murah). Tanpa retry: health check harus cepat dan jujur.
  async healthCheck({ signal } = {}) {
    const started = Date.now();
    try {
      const res = await fetchWithRetry(
        this.config.modelsUrl,
        { method: 'GET', headers: { Accept: 'application/json', ...(this.publicModels || !this.isConfigured() ? {} : this.authHeaders()) } },
        this.common(signal, { idempotent: true, timeoutMs: 5000, retry: { max: 0 } })
      );
      await res.body?.cancel();
      return { online: true, latencyMs: Date.now() - started, status: res.status, keyConfigured: this.isConfigured() };
    } catch (err) {
      return {
        online: false,
        latencyMs: null,
        status: err.status ?? null,
        code: err.code ?? 'error',
        message: redact(err.message ?? '', this.secrets),
        keyConfigured: this.isConfigured(),
      };
    }
  }
}
