const ALLOWED_ORIGINS = new Set([
  'https://go.samyaksion.com',
  'https://refer.samyaksion.com',
  'https://www.samyaksion.com',
  'https://samyaksion.com'
]);

function isLocalOrigin(origin) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
}

export function corsHeaders(request, env, cacheControl) {
  const origin = request.headers.get('Origin') || '';
  const allowLocal = env.ENVIRONMENT === 'development';
  const allowed = ALLOWED_ORIGINS.has(origin) || (allowLocal && isLocalOrigin(origin));
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'https://go.samyaksion.com',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cacheControl || 'no-store'
  };
}

export function handleOptions(request, env) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env, 'no-store') });
}

export function reject(status, code, message, request, env, cacheControl) {
  return json({ success: false, code, message }, status, request, env, cacheControl);
}

export function json(data, status, request, env, cacheControl) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(request, env, cacheControl)
  });
}

export function requireAllowedOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (ALLOWED_ORIGINS.has(origin)) return null;
  if (env.ENVIRONMENT === 'development' && isLocalOrigin(origin)) return null;
  return reject(403, 'FORBIDDEN_ORIGIN', 'This request is not allowed.', request, env);
}

export function requireMethod(request, env, allowedMethods) {
  if (allowedMethods.includes(request.method)) return null;
  return reject(405, 'METHOD_NOT_ALLOWED', 'This request method is not allowed.', request, env);
}

export function requireJsonContent(request, env) {
  const contentType = request.headers.get('Content-Type') || '';
  if (contentType.toLowerCase().includes('application/json')) return null;
  return reject(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send JSON with Content-Type: application/json.', request, env);
}

export async function readJson(request, env, maxBytes = 4096) {
  const text = await request.text();
  if (text.length > maxBytes) {
    return { error: reject(413, 'PAYLOAD_TOO_LARGE', 'The request is too large.', request, env) };
  }
  try {
    return { data: JSON.parse(text || '{}') };
  } catch (_error) {
    return { error: reject(400, 'INVALID_JSON', 'Invalid JSON request body.', request, env) };
  }
}

export function validateShortText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

export function validateToken(value) {
  const token = validateShortText(value, 80);
  return /^[A-Za-z0-9_-]{12,80}$/.test(token) ? token : '';
}

export function validateMobile(value) {
  return validateShortText(value, 40);
}

export function validateEmail(value) {
  return validateShortText(value || '', 150);
}

export function validateCourseId(value) {
  const courseId = validateShortText(value, 80);
  return /^[A-Z0-9_-]{2,80}$/.test(courseId) ? courseId : '';
}

export function requireConfig(env, request) {
  if (!env.APPS_SCRIPT_URL || !env.REFERRAL_API_SECRET) {
    return reject(500, 'SERVER_CONFIGURATION_ERROR', 'Referral service is not configured.', request, env);
  }
  return null;
}

export async function callAppsScript(action, payload, env) {
  const response = await fetch(env.APPS_SCRIPT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      secret: env.REFERRAL_API_SECRET,
      action,
      payload: payload || {}
    })
  });

  if (!response.ok) {
    throw new Error('Apps Script request failed');
  }
  return response.json();
}

export async function proxyToAppsScript(action, payload, request, env, cacheControl) {
  const configError = requireConfig(env, request);
  if (configError) return configError;
  try {
    const data = await callAppsScript(action, payload, env);
    return json(data, 200, request, env, cacheControl);
  } catch (_error) {
    return reject(502, 'REFERRAL_SERVICE_UNAVAILABLE', 'Referral service is temporarily unavailable.', request, env, 'no-store');
  }
}
