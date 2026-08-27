import {
  decryptJson,
  getStorageConfig,
  hashToken,
  setSecurityHeaders,
  supabaseHeaders
} from './report-utils.js';

export const config = { maxDuration: 15 };

export default async function handler(req, res) {
  setSecurityHeaders(res);

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: '只允許使用 GET 請求。', code: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const configValues = getStorageConfig();
    if (!configValues) {
      return res.status(503).json({ error: '報告服務尚未完成設定。', code: 'REPORT_SERVICE_NOT_CONFIGURED' });
    }
    const token = typeof req.query?.token === 'string' ? req.query.token : '';
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) {
      return res.status(400).json({ error: '報告連結格式不正確。', code: 'INVALID_REPORT_TOKEN' });
    }

    const tokenHash = hashToken(token);
    const response = await fetch(
      `${configValues.supabaseUrl}/rest/v1/diagnoses?select=id,report_encrypted,expires_at&report_token_hash=eq.${tokenHash}&limit=1`,
      { headers: supabaseHeaders(configValues.supabaseServiceKey) }
    );
    const rows = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(rows)) {
      return res.status(502).json({ error: '暫時無法讀取報告，請稍後再試。', code: 'REPORT_READ_FAILED' });
    }
    if (!rows[0] || new Date(rows[0].expires_at).getTime() <= Date.now()) {
      return res.status(404).json({ error: '這份報告不存在或連結已到期。', code: 'REPORT_NOT_FOUND' });
    }

    const report = decryptJson(rows[0].report_encrypted);
    fetch(
      `${configValues.supabaseUrl}/rest/v1/diagnoses?id=eq.${encodeURIComponent(rows[0].id)}&opened_at=is.null`,
      {
        method: 'PATCH',
        headers: supabaseHeaders(configValues.supabaseServiceKey),
        body: JSON.stringify({ opened_at: new Date().toISOString() })
      }
    ).catch(() => {});

    return res.status(200).json({ report, expiresAt: rows[0].expires_at });
  } catch (error) {
    console.error('Read report error', { message: error?.message });
    return res.status(500).json({ error: '讀取報告時發生錯誤，請稍後再試。', code: 'REPORT_SERVER_ERROR' });
  }
}
