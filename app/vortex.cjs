'use strict';

const ENDPOINT = 'https://ai.red-xai.com/v1';
const LOCAL_ENDPOINT = 'http://127.0.0.1:18091/v1';
const DEFAULT_MODEL = 'vortex-pro';
const MAX_RESPONSE = 4 * 1024 * 1024;

function normalizeEndpoint(value = ENDPOINT) {
  if (typeof value !== 'string' || value.length > 2048) throw Error('Invalid Vortex API address');
  let url;
  try { url = new URL(value.trim()); } catch { throw Error('Enter a complete Vortex API address'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw Error('Vortex requires HTTPS, except for a local loopback gateway');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw Error('Do not put credentials, query parameters or fragments in the API address');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!url.pathname || url.pathname === '/') url.pathname = '/v1';
  if (/\/(models|chat\/completions)$/.test(url.pathname)) {
    throw Error('Use the API base address ending in /v1, not an individual API operation');
  }
  return url.href.replace(/\/+$/, '');
}

function parseModels(json) {
  if (!Array.isArray(json?.data)) throw Error('The endpoint did not return a Vortex-compatible model list');
  return [...new Set(json.data.map(value => value?.id).filter(value => typeof value === 'string' && value.length > 0 && value.length <= 256))];
}

function validateKey(value) {
  if (typeof value !== 'string') throw Error('Enter a Vortex key or a key for your configured compatible inference server');
  const key = value.trim().replace(/^Bearer[ \t]+/i, '');
  // Credentials are opaque. The service decides their validity, model scopes,
  // admin privileges and expiry; a client prefix guess cannot establish any of
  // those facts. Reject whitespace/control characters before constructing headers.
  if (key.length < 8 || key.length > 4096 || !/^[\x21-\x7e]+$/.test(key)) {
    throw Error('Enter a Vortex key or compatible inference API key: 8–4096 printable characters without embedded whitespace');
  }
  return key;
}

function networkError(error, endpoint) {
  const code = error?.cause?.code || error?.code;
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    return Error(`The Vortex hostname cannot be resolved (${new URL(endpoint).hostname}). This is an address/DNS problem, not an invalid-key result. Choose your working HTTPS endpoint or use the local Vortex gateway.`);
  }
  if (code === 'ECONNREFUSED') return Error('The Vortex gateway is not listening at that address. Start its tunnel/service or choose the correct endpoint.');
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return Error('Vortex timed out. The model may still be starting; check the server and try again.');
  return Error(`Could not reach the configured Vortex gateway${code ? ` (${code})` : ''}. Check its address, TLS certificate and connection.`);
}

async function responseJSON(response) {
  const length = Number(response.headers?.get?.('content-length') || 0);
  if (length > MAX_RESPONSE) throw Error('Vortex response exceeded the 4 MB limit');
  if (!response.body?.getReader) {
    if (typeof response.text === 'function') {
      const text = await response.text();
      if (Buffer.byteLength(text) > MAX_RESPONSE) throw Error('Vortex response exceeded the 4 MB limit');
      try { return JSON.parse(text); } catch { return {nonJSON: true}; }
    }
    return response.json().catch(() => ({nonJSON: true}));
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE) {
        await reader.cancel();
        throw Error('Vortex response exceeded the 4 MB limit');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {nonJSON: true}; }
}

async function request(key, route, body, fetcher = globalThis.fetch, options = {}) {
  key = validateKey(key);
  const endpoint = normalizeEndpoint(options.endpoint || ENDPOINT);
  if (!['/models', '/chat/completions'].includes(route)) throw Error('Unsupported Vortex operation');
  let response;
  try {
    response = await fetcher(endpoint + route, {
      method: body ? 'POST' : 'GET',
      headers: {Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Accept: 'application/json'},
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(body ? 120000 : 20000)
    });
  } catch (error) { throw networkError(error, endpoint); }
  const data = await responseJSON(response);
  const object = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  if (!response.ok) {
    const cloudflare = !!response.headers?.get?.('server')?.toLowerCase().includes('cloudflare');
    const challenge = response.headers?.get?.('cf-mitigated') === 'challenge';
    const html = /text\/html/i.test(response.headers?.get?.('content-type') || '');
    let message;
    // A Cloudflare Server header also appears on genuine upstream API errors.
    // Only report a proxy block when the response actually looks like one.
    if (response.status === 403 && (challenge || (cloudflare && (html || object.nonJSON)))) {
      message = 'The proxy returned an access challenge instead of a Vortex API result. Check the endpoint/server access policy';
    } else {
      message = {
        401: 'Vortex rejected this key: it may be invalid, disabled, revoked, expired, or belong to a different server',
        403: 'This Vortex key is not authorized for the requested model or operation',
        404: 'The requested model or API route is unavailable at this endpoint',
        429: 'Vortex rate limit reached; wait before trying again',
        502: 'Vortex is reachable, but its model/provider is unavailable',
        503: 'Vortex is temporarily unavailable'
      }[response.status] || 'Vortex request failed';
    }
    const retry = response.status === 429 ? response.headers?.get?.('retry-after') : null;
    throw Error(`${message} (HTTP ${response.status})${retry && /^\d{1,6}$/.test(retry) ? `; retry after ${retry}s` : ''}`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('The inference endpoint returned an invalid response object');
  if (object.nonJSON) throw Error('This address returned a web page instead of the Vortex API. Check the API base address.');
  return data;
}

async function models(key, fetcher = globalThis.fetch, options = {}) {
  return parseModels(await request(key, '/models', null, fetcher, options));
}

async function chat(key, messages, model = DEFAULT_MODEL, fetcher = globalThis.fetch, options = {}) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 60) throw Error('Chat history must contain 1–60 messages');
  if (typeof model !== 'string' || !model.trim() || model.length > 256) throw Error('Select an available Vortex model');
  if (messages.some(message => !message || typeof message.content !== 'string')) throw Error('Invalid chat message content');
  const clean = messages.map(message => ({role: message.role, content: message.content}));
  if (clean.some(message => !['user', 'assistant', 'system'].includes(message.role) || message.content.length > 30000)) throw Error('Invalid or oversized chat message');
  if (Buffer.byteLength(JSON.stringify(clean)) > 2 * 1024 * 1024) throw Error('Chat history is too large');
  if (options.maxTokens !== undefined && (!Number.isSafeInteger(options.maxTokens) || options.maxTokens < 1)) throw Error('Token limit must be a positive integer');
  const result = await request(key, '/chat/completions', {
    model: model.trim(), messages: clean, stream: false,
    ...(options.maxTokens ? {max_tokens: Math.min(4096, options.maxTokens)} : {})
  }, fetcher, options);
  const answer = result.choices?.[0]?.message?.content;
  if (typeof answer !== 'string') throw Error('Vortex returned no text reply');
  return answer;
}

module.exports = {ENDPOINT, LOCAL_ENDPOINT, DEFAULT_MODEL, normalizeEndpoint, parseModels, validateKey, request, models, chat, networkError};
