export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: {
        Allow: 'GET, HEAD',
        'Cache-Control': 'no-store'
      }
    });
  }

  const assetUrl = new URL('/r/', request.url);
  const assetRequest = new Request(assetUrl.toString(), request);

  return env.ASSETS.fetch(assetRequest);
}
