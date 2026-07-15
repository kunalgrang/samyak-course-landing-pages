import {
  handleOptions,
  proxyToAppsScript,
  readJson,
  reject,
  requireAllowedOrigin,
  requireJsonContent,
  requireMethod,
  validateCourseId,
  validateEmail,
  validateMobile,
  validateShortText,
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

  const parsed = await readJson(request, env, 4096);
  if (parsed.error) return parsed.error;

  const payload = {
    token: validateToken(parsed.data.token),
    name: validateShortText(parsed.data.name, 100),
    mobile: validateMobile(parsed.data.mobile),
    email: validateEmail(parsed.data.email),
    courseId: validateCourseId(parsed.data.courseId),
    consent: parsed.data.consent === true,
    source: parsed.data.source === 'Physical' ? 'Physical' : 'Online'
  };

  if (!payload.token) return reject(400, 'INVALID_TOKEN', 'Referral token is invalid.', request, env);
  if (!payload.name) return reject(400, 'MISSING_NAME', 'Prospect name is required.', request, env);
  if (!payload.mobile) return reject(400, 'MISSING_MOBILE', 'Mobile number is required.', request, env);
  if (!payload.courseId) return reject(400, 'INVALID_COURSE', 'Course is invalid.', request, env);
  if (!payload.consent) return reject(400, 'CONSENT_REQUIRED', 'Contact consent is required.', request, env);

  return proxyToAppsScript('submit', payload, request, env, 'no-store');
}
