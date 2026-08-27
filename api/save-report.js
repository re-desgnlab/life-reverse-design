import {
  createReportToken,
  enforceReportRateLimit,
  encryptJson,
  getDeliveryConfig,
  hashToken,
  isAllowedOrigin,
  normalizeAdultBirthDate,
  normalizeEmail,
  normalizeName,
  sanitizeReport,
  setSecurityHeaders,
  supabaseHeaders,
  validateAnswers
} from './report-utils.js';

export const config = { maxDuration: 30 };

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
    const configValues = getDeliveryConfig();
    if (!configValues) {
      return res.status(503).json({ error: '報告寄送服務尚未完成設定。', code: 'REPORT_SERVICE_NOT_CONFIGURED' });
    }

    const {
      name: rawName,
      birthDate: rawBirthDate,
      email: rawEmail,
      answers,
      report: rawReport,
      consent,
      adultConfirmed,
      marketingOptIn = false,
      source = 'direct'
    } = req.body || {};
    const name = normalizeName(rawName);
    const birthDate = normalizeAdultBirthDate(rawBirthDate);
    const email = normalizeEmail(rawEmail);
    const report = sanitizeReport(rawReport);

    if (!name) {
      return res.status(400).json({ error: '請輸入有效的姓名。', code: 'INVALID_NAME' });
    }
    if (!birthDate || adultConfirmed !== true) {
      return res.status(403).json({
        error: '此測驗與報告寄送目前僅提供已滿18歲者使用。',
        code: 'ADULT_VERIFICATION_REQUIRED'
      });
    }
    if (!email) {
      return res.status(400).json({ error: '請輸入有效的 Email。', code: 'INVALID_EMAIL' });
    }
    if (configValues.reportTestRecipient && email !== configValues.reportTestRecipient) {
      return res.status(403).json({
        error: '目前為測試寄送模式，請使用指定的測試信箱。',
        code: 'TEST_RECIPIENT_ONLY'
      });
    }
    if (consent !== true) {
      return res.status(400).json({ error: '請先確認資料蒐集與報告寄送說明。', code: 'CONSENT_REQUIRED' });
    }
    if (!validateAnswers(answers) || !report) {
      return res.status(400).json({ error: '報告資料不完整，請重新完成分析。', code: 'INVALID_REPORT_DATA' });
    }

    const rateLimit = await enforceReportRateLimit(req);
    if (!rateLimit.success) {
      res.setHeader('Retry-After', String(rateLimit.retryAfter));
      return res.status(429).json({ error: '每小時最多可寄送5份報告，請稍後再試。', code: 'REPORT_RATE_LIMITED' });
    }

    const token = createReportToken();
    const tokenHash = hashToken(token);
    const retentionDays = Math.min(Math.max(Number(process.env.REPORT_RETENTION_DAYS) || 90, 1), 365);
    const expiresAt = new Date(Date.now() + retentionDays * 86400000).toISOString();
    const safeSource = String(source || 'direct').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 80) || 'direct';
    const row = {
      email,
      profile_encrypted: encryptJson({ name, birthDate }),
      answers_encrypted: encryptJson(answers.map((item) => item.trim())),
      report_encrypted: encryptJson(report),
      report_token_hash: tokenHash,
      marketing_opt_in: marketingOptIn === true,
      adult_confirmed: true,
      consent_version: '2026-08-v2',
      source: safeSource,
      expires_at: expiresAt,
      email_status: 'pending'
    };

    const insertResponse = await fetch(
      `${configValues.supabaseUrl}/rest/v1/diagnoses`,
      {
        method: 'POST',
        headers: supabaseHeaders(configValues.supabaseServiceKey, 'return=representation'),
        body: JSON.stringify(row)
      }
    );
    const inserted = await insertResponse.json().catch(() => null);
    if (!insertResponse.ok || !Array.isArray(inserted) || !inserted[0]?.id) {
      console.error('Supabase insert failed', { status: insertResponse.status });
      return res.status(502).json({ error: '報告暫時無法保存，請稍後再試。', code: 'REPORT_SAVE_FAILED' });
    }

    const reportUrl = `${configValues.reportPublicUrl.replace(/\/$/, '')}/report.html?token=${encodeURIComponent(token)}`;
    const emailResponse = await sendReportEmail({
      apiKey: configValues.resendApiKey,
      from: configValues.reportFromEmail,
      to: email,
      name,
      reportUrl,
      expiresAt
    });
    const emailStatus = emailResponse.ok ? 'sent' : 'failed';

    await fetch(
      `${configValues.supabaseUrl}/rest/v1/diagnoses?id=eq.${encodeURIComponent(inserted[0].id)}`,
      {
        method: 'PATCH',
        headers: supabaseHeaders(configValues.supabaseServiceKey),
        body: JSON.stringify({ email_status: emailStatus })
      }
    );

    if (!emailResponse.ok) {
      console.error('Resend email failed', { status: emailResponse.status });
      return res.status(502).json({ error: '報告已保存，但Email暫時寄送失敗，請稍後再試。', code: 'REPORT_EMAIL_FAILED' });
    }

    if (marketingOptIn === true) {
      await addMarketingContact(configValues.resendApiKey, email);
    }

    return res.status(200).json({ success: true, reportUrl, expiresAt });
  } catch (error) {
    console.error('Save report error', { message: error?.message });
    return res.status(500).json({ error: '報告處理時發生錯誤，請稍後再試。', code: 'REPORT_SERVER_ERROR' });
  }
}

async function sendReportEmail({ apiKey, from, to, name, reportUrl, expiresAt }) {
  const expiryDate = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: 'long', day: 'numeric'
  }).format(new Date(expiresAt));
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `report-${hashToken(reportUrl)}`
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: '你的人生核心卡點分析已完成',
      html: `
        <div style="font-family:Arial,'Noto Sans TC',sans-serif;max-width:560px;margin:auto;color:#1e293b;line-height:1.8">
          <h1 style="font-size:22px;color:#0f172a">${escapeHtml(name)}，你的人生核心卡點分析已完成</h1>
          <p>謝謝你完成這次的10題分析。完整報告包含核心卡點、判斷依據、現有資源、需要保護的界線，以及3個低成本實驗。</p>
          <p style="margin:28px 0"><a href="${escapeHtml(reportUrl)}" style="background:#f59e0b;color:#0f172a;text-decoration:none;font-weight:bold;padding:14px 22px;border-radius:12px;display:inline-block">查看我的完整報告</a></p>
          <p style="font-size:13px;color:#64748b">為保護你的資料，連結將於 ${expiryDate} 到期。請勿將私人報告連結轉傳給他人。</p>
          <p style="font-size:13px;color:#64748b">人生反向設計所</p>
        </div>
      `
    })
  });
}

async function addMarketingContact(apiKey, email) {
  const segmentId = process.env.RESEND_SEGMENT_ID;
  const body = { email };
  if (segmentId) body.segments = [{ id: segmentId }];
  try {
    const response = await fetch('https://api.resend.com/contacts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok && response.status !== 409) {
      console.error('Resend contact creation failed', { status: response.status });
    }
  } catch (error) {
    console.error('Resend contact creation error', { message: error?.message });
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}
