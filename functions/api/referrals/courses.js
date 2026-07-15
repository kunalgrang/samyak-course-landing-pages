import { handleOptions, proxyToAppsScript, reject, requireAllowedOrigin, requireMethod } from './_utils.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleOptions(request, env);

  const originError = requireAllowedOrigin(request, env);
  if (originError) return originError;

  const methodError = requireMethod(request, env, ['GET']);
  if (methodError) return methodError;

  if (request.url.length > 2048) {
    return reject(414, 'URL_TOO_LONG', 'Request URL is too long.', request, env);
  }

  return proxyToAppsScript('courses', {}, request, env, 'public, max-age=300');
}
