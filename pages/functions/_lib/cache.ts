export async function fetchCached(url: string, ttlSeconds: number, init?: RequestInit): Promise<Response> {
  const cache = caches.default;
  const req = new Request(url);
  let res = await cache.match(req);
  if (res) return res;

  res = await fetch(url, init);
  if (res.ok) {
    const cached = new Response(res.clone().body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
    cached.headers.set('Cache-Control', `public, max-age=${ttlSeconds}`);
    cache.put(req, cached);
  }
  return res;
}
