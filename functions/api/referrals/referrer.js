import {
  handleOptions,
  proxyToAppsScript,
  readJson,
  reject,
  requireAllowedOrigin,
  requireJsonContent,
  requireMethod,
  validateToken
} from './_utils.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleOptions(request, env);

  const originError = requireAllowedOrigin(request, env);
  if (originError) return originError;

  const methodError = requireMethod(request, env, ['POST']);
  if (methodError) return methodError;

  const contentError = requireJsonContent(request, env);
  if (contentError) return contentError;

  const parsed = await readJson(request, env, 1024);
  if (parsed.error) return parsed.error;

  const token = validateToken(parsed.data.token);
  if (!token) {
    return reject(400, 'INVALID_TOKEN', 'Referral token is invalid.', request, env);
  }

  return proxyToAppsScript('referrer', { token }, request, env, 'no-store');
}
