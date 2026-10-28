'use strict';

// Public inference API only. This module never connects to the administrative port,
// follows redirects with credentials, or logs keys or provider response bodies.
const ENDPOINT = 'https://ai.red-xai.com/v1';
const DEFAULT_MODEL = 'vortex-pro';

class VortexError extends Error {
  constructor(message, code, status = 0, retryAfter = null) {
    super(message);
    this.name = 'VortexError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function normalizeEndpoint(value = ENDPOINT) {
  if (typeof value !== 'string' || value.length > 2048) throw new VortexError('Enter a valid Vortex API base URL.', 'ENDPOINT');
  let url;
  try { url = new URL(value.trim()); } catch { throw new VortexError('Enter an HTTPS API base URL, such as https://ai.red-xai.com/v1.', 'ENDPOINT'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new VortexError('Remote APIs require HTTPS. Plain HTTP is allowed only for a local loopback gateway.', 'ENDPOINT');
  }
  if (url.username || url.password || url.search || url.hash) throw new VortexError('API URLs must not contain credentials, query parameters, or fragments.', 'ENDPOINT');
  let pathname = url.pathname.replace(/\/+$/, '').replace(/\/(models|chat\/completions)$/, '');
  if (!pathname) pathname = '/v1';
  if (!pathname.endsWith('/v1')) throw new VortexError('Use the inference API base ending in /v1, not a website page or an admin address.', 'ENDPOINT');
  return url.origin + pathname;
}

function validateKey(value) {
  // Keys are opaque credentials. Prefix guesses must not reject legitimate keys.
  // The inference server, not a client-side regex, determines scopes and validity.
  if (typeof value !== 'string') throw new VortexError('Enter your Vortex inference API key.', 'KEY');
  const key = value.trim();
  if (key.length < 8 || key.length > 4096 || !/^[\x21-\x7e]+$/.test(key)) {
    throw new VortexError('The API key must be 8–4096 printable characters without embedded whitespace.', 'KEY');
  }
  return key;
}

function parseModels(value) {
  if (!Array.isArray(value?.data)) throw new VortexError('The server did not return a Vortex/OpenAI-compatible model list. Check the API base URL.', 'INVALID_RESPONSE');
  return [...new Set(value.data.map(item => item?.id).filter(id => typeof id === 'string' && id.length > 0 && id.length < 256))];
}

function networkError(error, endpoint) {
  const code = error?.cause?.code || error?.code || '';
  const host = new URL(endpoint).host;
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) return new VortexError(`Cannot resolve ${host}. Check the server address or DNS. Your key has not been rejected.`, 'DNS');
  if (['ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code)) return new VortexError(`Cannot reach ${host}. Start the local gateway or check the server connection.`, 'OFFLINE');
  if (/CERT|TLS|SSL/.test(code)) return new VortexError(`The TLS certificate for ${host} could not be verified. Certificate validation has not been disabled.`, 'TLS');
  if (['TimeoutError', 'AbortError'].includes(error?.name) || code === 'ETIMEDOUT') return new VortexError('The Vortex request timed out. The endpoint or model may be unavailable.', 'TIMEOUT');
  return new VortexError(`Could not connect to ${host}. Verify the API URL, network, and TLS configuration. Redirects carrying API credentials are not followed.`, 'NETWORK');
}

async function request(key, route, body, fetcher = globalThis.fetch, endpoint = ENDPOINT) {
  const credential = validateKey(key);
  const base = normalizeEndpoint(endpoint);
  if (!['/models', '/chat/completions'].includes(route)) throw new VortexError('Unsupported public API operation.', 'ENDPOINT');
  let response;
  try {
    response = await fetcher(base + route, {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      headers: {Authorization: 'Bearer ' + credential, 'Content-Type': 'application/json', Accept: 'application/json'},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60000)
    });
  } catch (error) { throw networkError(error, base); }
  const contentType = response.headers?.get?.('content-type') || '';
  const isHTML = /text\/html/i.test(contentType);
  const retryAfter = response.headers?.get?.('retry-after') || null;
  if (!response.ok) {
    const messages = {
      401: 'The inference API rejected this key. Check whether it was revoked or is a server-administration key rather than a model-access key.',
      403: 'This key is not authorized for the requested model or API scope. Pro is not silently replaced with another model.',
      404: 'The API route or requested model was not found. Check the /v1 endpoint and model ID.',
      429: 'Vortex rate limit reached. Retry after the server’s indicated delay.',
      502: 'The Vortex gateway is reachable, but its model provider is unavailable.',
      503: 'The Vortex service is temporarily unavailable.'
    };
    const message = isHTML ? 'The address returned a website/proxy error rather than an API response. Check the API endpoint and server access rules.' : (messages[response.status] || 'The Vortex API request failed.');
    throw new VortexError(`${message} (HTTP ${response.status})`, 'HTTP_' + response.status, response.status, retryAfter);
  }
  if (isHTML) throw new VortexError('This URL serves a website instead of the inference API. Set the correct /v1 base address.', 'INVALID_RESPONSE');
  let data;
  try { data = await response.json(); } catch { throw new VortexError('Vortex returned an invalid JSON response. Check the API address.', 'INVALID_RESPONSE'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new VortexError('Unexpected Vortex response format.', 'INVALID_RESPONSE');
  return data;
}

async function models(key, fetcher, endpoint = ENDPOINT) {
  return parseModels(await request(key, '/models', null, fetcher, endpoint));
}

async function chat(key, messages, model = DEFAULT_MODEL, fetcher, endpoint = ENDPOINT) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 60) throw new VortexError('Chat history must contain 1–60 messages. Start a new chat for a longer conversation.', 'MESSAGES');
  if (typeof model !== 'string' || !model.trim() || model.length > 256) throw new VortexError('Select an allowed model.', 'MODEL');
  const clean = messages.map(item => {
    if (!item || !['user', 'assistant', 'system'].includes(item.role) || typeof item.content !== 'string' || item.content.length > 30000) {
      throw new VortexError('Invalid chat message or content exceeds 30,000 characters.', 'MESSAGES');
    }
    return {role: item.role, content: item.content};
  });
  const data = await request(key, '/chat/completions', {model: model.trim(), messages: clean, stream: false}, fetcher, endpoint);
  const answer = data.choices?.[0]?.message?.content;
  if (typeof answer !== 'string') throw new VortexError('Vortex returned no text reply.', 'INVALID_RESPONSE');
  return answer;
}

module.exports = {ENDPOINT, DEFAULT_MODEL, VortexError, normalizeEndpoint, validateKey, parseModels, request, models, chat, networkError};
