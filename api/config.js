export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(200).json({
    // Site key本來就是公開值；Secret key只存在後端環境變數。
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || null
  });
}
