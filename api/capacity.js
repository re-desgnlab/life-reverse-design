const MAX_TEST_USERS = 50;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).json({ error: '只允許使用 GET 請求。' });
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(200).json({ full: false, remaining: MAX_TEST_USERS });
  try {
    const response = await fetch(`${url}/rest/v1/diagnoses?select=id`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact', Range: '0-0' }
    });
    if (!response.ok) throw new Error(`Capacity check failed: ${response.status}`);
    const count = Number((response.headers.get('content-range') || '').split('/')[1]);
    const safeCount = Number.isFinite(count) ? count : 0;
    return res.status(200).json({ full: safeCount >= MAX_TEST_USERS, remaining: Math.max(0, MAX_TEST_USERS - safeCount) });
  } catch (error) {
    console.error('Capacity endpoint error', error);
    return res.status(503).json({ error: '目前無法確認測試名額，請稍後再試。' });
  }
}
