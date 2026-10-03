// Aturan kecocokan model vs permintaan, berdasarkan metadata API (bukan tebakan dari nama model).

export function hasImage(messages) {
  return messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'));
}

export function checkModelRules(model, { messages, options }) {
  const next = { ...options };
  const dropped = [];

  if (model) {
    if (hasImage(messages) && model.capabilities.vision === false) {
      return { ok: false, status: 400, code: 'unsupported_vision', message: 'Model ini tidak mendukung input gambar.' };
    }
    if (next.tools?.length && model.capabilities.tools === false) {
      return { ok: false, status: 400, code: 'unsupported_tools', message: 'Model ini tidak mendukung tool calling.' };
    }
  }

  // Parameter reasoning hanya dikirim bila model mendeklarasikan level tersebut.
  if (next.reasoningEffort) {
    const levels = model?.reasoningEfforts?.levels;
    if (!levels || !levels.includes(next.reasoningEffort)) {
      delete next.reasoningEffort;
      dropped.push('reasoning_effort');
    }
  }

  // Batas output mengikuti max_output_tokens dari API; tidak pernah dinaikkan.
  if (next.maxTokens && model?.maxOutputTokens && next.maxTokens > model.maxOutputTokens) {
    next.maxTokens = model.maxOutputTokens;
  }
  return { ok: true, options: next, dropped };
}
