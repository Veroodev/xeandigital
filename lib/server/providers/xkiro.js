import { makeConfig } from '../config.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';

// xKiro: OpenAI-compatible. GET /v1/models bersifat publik (tanpa key); chat memakai
// Authorization: Bearer ${XKIRO_API_KEY}. ID model selalu vendor/model.
export function createXkiroProvider() {
  return new OpenAICompatibleProvider({
    id: 'xkiro',
    label: 'xKiro',
    keyEnvName: 'XKIRO_API_KEY',
    publicModels: true,
    includeUsage: true,
    config: makeConfig('XKIRO', { baseUrl: 'https://api.xkiro.com/v1', dialect: 'openai' }),
  });
}
