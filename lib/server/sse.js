import { readSse } from '../shared/sse-reader.js';
import { ProviderError, abortError, errorFromStreamFrame } from './errors.js';

// Mengubah stream SSE provider (dialek OpenAI atau Anthropic) menjadi event internal Xean:
//   { type: 'delta', text }          potongan jawaban
//   { type: 'reasoning', text }      potongan proses berpikir (bila model menampilkannya)
//   { type: 'tool_call', index, id, name, arguments }   potongan pemanggilan tool
//   { type: 'usage', promptTokens, completionTokens, totalTokens }
//   { type: 'done', finishReason, id, model, created, usage }

const STOP_REASONS = { end_turn: 'stop', stop_sequence: 'stop', max_tokens: 'length', tool_use: 'tool_calls' };

export function normalizeUsage(u) {
  if (!u || typeof u !== 'object') return null;
  const prompt = u.prompt_tokens ?? u.input_tokens ?? null;
  const completion = u.completion_tokens ?? u.output_tokens ?? null;
  const total = u.total_tokens ?? (prompt != null && completion != null ? prompt + completion : null);
  return { promptTokens: prompt, completionTokens: completion, totalTokens: total };
}

export function createOpenAINormalizer(ctx) {
  const st = { id: null, model: null, created: null, finishReason: null, usage: null, done: false };
  return {
    state: st,
    *handle(json) {
      if (json.error) throw errorFromStreamFrame(json.error, ctx);
      st.id ??= json.id ?? null;
      st.model ??= json.model ?? null;
      st.created ??= json.created ?? null;

      // Frame usage punya choices kosong, jadi jangan akses choices[0] tanpa pengecekan.
      const choice = Array.isArray(json.choices) ? json.choices[0] : null;
      const delta = choice?.delta;
      if (delta) {
        const reasoning = delta.reasoning_content ?? delta.reasoning;
        if (typeof reasoning === 'string' && reasoning) yield { type: 'reasoning', text: reasoning };
        if (typeof delta.content === 'string' && delta.content) yield { type: 'delta', text: delta.content };
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            yield {
              type: 'tool_call',
              index: tc.index ?? 0,
              id: tc.id ?? null,
              name: tc.function?.name ?? null,
              arguments: tc.function?.arguments ?? '',
            };
          }
        }
      }
      if (choice?.finish_reason) st.finishReason = choice.finish_reason;
      if (json.usage) {
        st.usage = normalizeUsage(json.usage);
        if (st.usage) yield { type: 'usage', ...st.usage };
      }
    },
    finish: () => ({
      type: 'done',
      finishReason: st.finishReason || 'stop',
      id: st.id,
      model: st.model,
      created: st.created,
      usage: st.usage,
    }),
  };
}

export function createAnthropicNormalizer(ctx) {
  const st = { id: null, model: null, created: null, finishReason: null, usage: null, done: false };
  let inputTokens = null;
  return {
    state: st,
    *handle(json) {
      switch (json.type) {
        case 'message_start':
          st.id = json.message?.id ?? null;
          st.model = json.message?.model ?? null;
          inputTokens = json.message?.usage?.input_tokens ?? null;
          break;
        case 'content_block_start':
          if (json.content_block?.type === 'tool_use') {
            yield { type: 'tool_call', index: json.index ?? 0, id: json.content_block.id ?? null, name: json.content_block.name ?? null, arguments: '' };
          }
          break;
        case 'content_block_delta': {
          const d = json.delta || {};
          if (d.type === 'text_delta' && d.text) yield { type: 'delta', text: d.text };
          else if (d.type === 'thinking_delta' && d.thinking) yield { type: 'reasoning', text: d.thinking };
          else if (d.type === 'input_json_delta') yield { type: 'tool_call', index: json.index ?? 0, id: null, name: null, arguments: d.partial_json ?? '' };
          break;
        }
        case 'message_delta':
          if (json.delta?.stop_reason) st.finishReason = STOP_REASONS[json.delta.stop_reason] || json.delta.stop_reason;
          if (json.usage) {
            st.usage = normalizeUsage({ input_tokens: inputTokens, output_tokens: json.usage.output_tokens });
            if (st.usage) yield { type: 'usage', ...st.usage };
          }
          break;
        case 'message_stop':
          st.done = true;
          break;
        case 'error':
          throw errorFromStreamFrame(json.error || json, ctx);
        default:
          break;
      }
    },
    finish: () => ({
      type: 'done',
      finishReason: st.finishReason || 'stop',
      id: st.id,
      model: st.model,
      created: st.created,
      usage: st.usage,
    }),
  };
}

/**
 * Menjalankan seluruh stream. Stream yang berakhir tanpa terminator ([DONE], message_stop,
 * atau finish_reason) dianggap gagal, bukan jawaban kosong yang sukses (sesuai dokumentasi xKiro).
 */
export async function* streamNormalized(body, { dialect = 'openai', label = 'Provider', secrets = [], signal } = {}) {
  const ctx = { label, secrets };
  const norm = dialect === 'anthropic' ? createAnthropicNormalizer(ctx) : createOpenAINormalizer(ctx);
  let finished = false;

  for await (const ev of readSse(body, { signal })) {
    if (ev.data === '[DONE]') {
      finished = true;
      break;
    }
    let json;
    try {
      json = JSON.parse(ev.data);
    } catch {
      continue; // frame tidak dikenal: abaikan, jangan crash
    }
    yield* norm.handle(json);
    if (norm.state.done) {
      finished = true;
      break;
    }
  }

  if (signal?.aborted) throw abortError();
  if (!finished && !norm.state.finishReason) {
    throw new ProviderError({
      status: 502,
      code: 'stream_interrupted',
      message: `Koneksi ke ${label} terputus sebelum jawaban selesai.`,
      retryable: true,
    });
  }
  yield norm.finish();
}

// Untuk respons non-stream.
export function normalizeCompletion(json, { dialect, provider, model }) {
  if (dialect === 'anthropic') {
    const blocks = Array.isArray(json.content) ? json.content : [];
    return {
      id: json.id ?? null,
      provider,
      model: json.model || model,
      content: blocks.filter((b) => b.type === 'text').map((b) => b.text).join(''),
      reasoning: blocks.filter((b) => b.type === 'thinking').map((b) => b.thinking).join('') || null,
      toolCalls: blocks.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, arguments: JSON.stringify(b.input ?? {}) })),
      usage: normalizeUsage(json.usage),
      finishReason: STOP_REASONS[json.stop_reason] || json.stop_reason || 'stop',
      created: Math.floor(Date.now() / 1000),
    };
  }
  const choice = json.choices?.[0] ?? {};
  const msg = choice.message ?? {};
  return {
    id: json.id ?? null,
    provider,
    model: json.model || model,
    content: typeof msg.content === 'string' ? msg.content : '',
    reasoning: msg.reasoning_content ?? msg.reasoning ?? null,
    toolCalls: (msg.tool_calls ?? []).map((t) => ({ id: t.id, name: t.function?.name, arguments: t.function?.arguments ?? '' })),
    usage: normalizeUsage(json.usage),
    finishReason: choice.finish_reason || 'stop',
    created: json.created ?? Math.floor(Date.now() / 1000),
  };
}
