import { handleOptions, proxyToAppsScript, reject, requireAllowedOrigin, requireMethod } from './_utils.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleOptions(request, env);

  const methodError = requireMethod(request, env, ['GET']);
  if (methodError) return methodError;

  const origin = request.headers.get('Origin');
  if (origin) {
    const originError = requireAllowedOrigin(request, env);
    if (originError) return originError;
  }

  if (request.url.length > 2048) {
    return reject(414, 'URL_TOO_LONG', 'Request URL is too long.', request, env);
  }

  return proxyToAppsScript('courses', {}, request, env, 'public, max-age=300');
}
