import { makeConfig } from '../config.js';
import { envStr } from '../env.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';

// APMIX: provider yang sudah ada sebelumnya, dipertahankan apa adanya.
export function createApmixProvider() {
  const dialect = envStr('APMIX_API_FORMAT', 'openai').toLowerCase() === 'anthropic' ? 'anthropic' : 'openai';
  return new OpenAICompatibleProvider({
    id: 'apmix',
    label: 'APMIX',
    keyEnvName: 'APMIX_API_KEY',
    publicModels: false,
    includeUsage: false,
    config: makeConfig('APMIX', { baseUrl: 'https://api.apmix.ai/v1', dialect, defaultModel: 'gpt-6-luna-free' }),
  });
}
