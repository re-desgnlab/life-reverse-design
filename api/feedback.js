import {
  getStorageConfig,
  hashToken,
  isAllowedOrigin,
  setSecurityHeaders,
  supabaseHeaders
} from './report-utils.js';

const HELPFUL_LABELS = {
  helpful: '有幫助',
  partly: '部分有幫助',
  not_yet: '目前沒有幫助'
};

export default async function handler(req, res) {
  setSecurityHeaders(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: '只允許使用 POST 請求。', code: 'METHOD_NOT_ALLOWED' });
  }
  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ error: '此請求來源不被允許。', code: 'ORIGIN_NOT_ALLOWED' });
  }

  try {
    const storage = getStorageConfig();
    if (!storage) return res.status(503).json({ error: '回饋服務尚未完成設定。', code: 'FEEDBACK_NOT_CONFIGURED' });
    const token = clean(req.body?.token, 80);
    const helpful = clean(req.body?.helpful, 20);
    const nextProblem = clean(req.body?.nextProblem, 1200);
    const contentRequest = clean(req.body?.contentRequest, 1200);
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token) || !Object.hasOwn(HELPFUL_LABELS, helpful)) {
      return res.status(400).json({ error: '請選擇這份分析對你的幫助程度。', code: 'INVALID_FEEDBACK' });
    }
    if (req.body?.consent !== true) {
      return res.status(400).json({ error: '請先同意使用去識別回饋改善工具與內容。', code: 'FEEDBACK_CONSENT_REQUIRED' });
    }

    const diagnosisResponse = await fetch(
      `${storage.supabaseUrl}/rest/v1/diagnoses?select=id,expires_at&report_token_hash=eq.${hashToken(token)}&limit=1`,
      { headers: supabaseHeaders(storage.supabaseServiceKey) }
    );
    const diagnoses = await diagnosisResponse.json().catch(() => null);
    if (!diagnosisResponse.ok || !Array.isArray(diagnoses)) throw new Error(`Diagnosis read failed: ${diagnosisResponse.status}`);
    if (!diagnoses[0] || new Date(diagnoses[0].expires_at).getTime() <= Date.now()) {
      return res.status(404).json({ error: '這份報告不存在或連結已到期。', code: 'REPORT_NOT_FOUND' });
    }

    const diagnosisId = diagnoses[0].id;
    const lines = [`幫助程度：${HELPFUL_LABELS[helpful]}`];
    if (nextProblem) lines.push(`最想先解決：${nextProblem}`);
    if (contentRequest) lines.push(`希望看到的內容：${contentRequest}`);
    const row = {
      source_type: 'product_feedback',
      source_label: '卡點分析器使用後回饋',
      raw_text: lines.join('\n'),
      category: '卡點分析器產品體驗',
      category_origin: 'source',
      keywords: [HELPFUL_LABELS[helpful], ...(contentRequest ? ['內容需求'] : [])],
      occurred_at: new Date().toISOString(),
      source_record_id: diagnosisId,
      metadata: { helpful },
      archived_at: null,
      updated_at: new Date().toISOString()
    };
    const existingResponse = await fetch(
      `${storage.supabaseUrl}/rest/v1/external_feedback?select=id&source_type=eq.product_feedback&source_record_id=eq.${encodeURIComponent(diagnosisId)}&limit=1`,
      { headers: supabaseHeaders(storage.supabaseServiceKey) }
    );
    const existing = await existingResponse.json().catch(() => null);
    if (!existingResponse.ok || !Array.isArray(existing)) throw new Error(`Feedback lookup failed: ${existingResponse.status}`);

    const path = existing[0]?.id
      ? `external_feedback?id=eq.${encodeURIComponent(existing[0].id)}`
      : 'external_feedback';
    const saveResponse = await fetch(`${storage.supabaseUrl}/rest/v1/${path}`, {
      method: existing[0]?.id ? 'PATCH' : 'POST',
      headers: supabaseHeaders(storage.supabaseServiceKey, 'return=representation'),
      body: JSON.stringify(row)
    });
    if (!saveResponse.ok) throw new Error(`Feedback save failed: ${saveResponse.status}`);
    return res.status(existing[0]?.id ? 200 : 201).json({ success: true, updated: Boolean(existing[0]?.id) });
  } catch (error) {
    console.error('Feedback error', { message: error?.message });
    return res.status(502).json({ error: '回饋暫時無法儲存，請稍後再試。', code: 'FEEDBACK_SAVE_FAILED' });
  }
}

function clean(value, maxLength) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/<[^>]*>/g, '')
    .trim()
    .slice(0, maxLength);
}
