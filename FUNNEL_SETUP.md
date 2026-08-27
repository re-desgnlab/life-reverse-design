# B 版 Email 報告漏斗設定

## 資料流程

1. 使用者完成十題並取得免費摘要。
2. 使用者在開始前確認已滿18歲；取得摘要後輸入姓名、生日與 Email，再勾選必要的報告保存同意；行銷通知為獨立選填。
3. 後端重新依生日驗證成年資格，並將姓名、生日、十題回答與完整報告使用 AES-256-GCM 加密後存入 Supabase。
4. Resend 寄出一組隨機私人連結；資料庫只保存 Token 雜湊，不保存原始 Token。
5. 私人報告 90 天後失效，Supabase Cron 每日刪除到期資料。

## Supabase

在 Supabase SQL Editor 執行 `supabase-schema.sql`。資料表已啟用 RLS，瀏覽器端沒有讀寫權限，只有 Vercel Serverless Function 的 service role 可以存取；到期清除由 Supabase Cron 執行。

## Vercel 環境變數

只設定在 B 版使用的正式 Vercel 專案，並套用 Production：

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `REPORT_FROM_EMAIL`，例如 `人生反向設計所 <report@your-domain.com>`
- `REPORT_PUBLIC_URL`，B 版正式公開網址，不含結尾斜線
- `REPORT_ENCRYPTION_KEY`，32 個隨機位元組的 Base64 字串
- `REPORT_RETENTION_DAYS=90`
- `REPORT_TEST_RECIPIENT`，沒有自訂網域時填入 Resend 帳號的 Email；設定後只允許寄到這個信箱。正式上線前移除此變數
- `RESEND_SEGMENT_ID`，選填；設定後，只有勾選行銷同意的使用者會加入此名單
- `ALLOWED_ORIGINS`，如另有自訂網域再加入；多個來源以逗號分隔

既有的 `GEMINI_API_KEY`、Turnstile 與 Upstash 變數維持不變。所有 Secret 都只能放在 Vercel，不得寫入 GitHub。

## Resend

正式寄給所有使用者前，必須驗證自有網域。寄送完整報告屬交易信；行銷同意只用來建立聯絡人，後續行銷信仍須包含取消訂閱方式。

沒有自訂網域時，可先使用 Resend 測試寄件者 `onboarding@resend.dev`，並設定 `REPORT_TEST_RECIPIENT` 為 Resend 帳號 Email。此模式只供本人測試，不能寄給其他使用者。

## 驗證

```bash
npm test
node --check api/analyze.js
git diff --check
```

部署後需驗證：未勾成年確認、未成年自述攔截、未成年生日、正常寄送、未勾必要同意、錯誤 Email、重複送出、私人連結、到期連結與手機版畫面。
