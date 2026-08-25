export default async function handler(req, res) {
  // 只允許 POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({
      error: '只允許使用 POST 請求'
    });
  }

  try {
    const { category, answers } = req.body || {};

    // 檢查前端送進來的資料
    if (
      !category ||
      typeof category !== 'string' ||
      !Array.isArray(answers) ||
      answers.length !== 10
    ) {
      return res.status(400).json({
        error: '輸入資料格式不正確，請確認已完成全部 10 題。'
      });
    }

    const cleanedAnswers = answers.map((answer) =>
      typeof answer === 'string' ? answer.trim() : ''
    );

    if (cleanedAnswers.some((answer) => !answer)) {
      return res.status(400).json({
        error: '所有題目都必須填寫。'
      });
    }

    // 從 Vercel Environment Variables 取得 API Key
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      console.error('Missing GEMINI_API_KEY');

      return res.status(500).json({
        error: '伺服器尚未設定 Gemini API Key。'
      });
    }

    const answersText = cleanedAnswers
      .map((answer, index) => {
        return `[第 ${index + 1} 題]\n${answer}`;
      })
      .join('\n\n');

    const prompt = `
你現在是「人生反向設計所」的資深反向設計教練與心智解構專家。

你的分析風格：
1. 犀利、具體、直指核心。
2. 不說教、不責備、不盲目正能量。
3. 不使用空泛或罐頭式文字。
4. 必須根據使用者實際回答進行分析。
5. 避免進行醫療或心理疾病診斷。
6. 透過逆向思維，協助使用者辨識內在衝突、盲點、資源與可行突破口。

使用者進行的是【${category}】領域的 10 題深度診斷。

以下是使用者的完整回答：

${answersText}

請只輸出合法 JSON，不要加入 Markdown、程式碼區塊或任何額外說明。

JSON 格式必須完全符合以下結構：

{
  "summary": "免費診斷摘要，約 80 至 120 個中文字。請直指核心矛盾，並具體呼應使用者回答中的內容。",
  "coreBlock": [
    "行為與內在衝突的根源分析",
    "使用者尚未察覺的隱性盲點",
    "目前最關鍵的突破方向"
  ],
  "resources": "列出 2 項使用者目前可以調動的資源，以換行方式呈現。",
  "boundaries": "列出 2 項使用者不能再繼續接受或犧牲的底線，以換行方式呈現。",
  "experiments": [
    {
      "title": "實驗一名稱",
      "description": "一個能在 3 天內完成的低成本具體行動。"
    },
    {
      "title": "實驗二名稱",
      "description": "一個能在 48 小時內完成的具體行動。"
    },
    {
      "title": "實驗三名稱",
      "description": "一個與界線建立或人生反向設計有關的具體練習。"
    }
  ]
}
`;

    const geminiUrl =
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent';

    const geminiResponse = await fetch(geminiUrl, {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },

      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],

        generationConfig: {
          responseMimeType: 'application/json',
          thinkingConfig: {
            thinkingLevel: 'low'
          }
        }
      })
    });

    const geminiData = await geminiResponse.json();

    if (!geminiResponse.ok) {
      const geminiError =
        geminiData?.error?.message ||
        `Gemini API 回傳錯誤，狀態碼：${geminiResponse.status}`;

      console.error('Gemini API Error:', {
        status: geminiResponse.status,
        message: geminiError
      });

      return res.status(geminiResponse.status).json({
        error: geminiError
      });
    }

    const textContent =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!textContent) {
      console.error('Unexpected Gemini response:', geminiData);

      return res.status(502).json({
        error: 'Gemini 沒有回傳可用的分析結果。'
      });
    }

    // 即使模型意外加入 ```json，也先清除再解析
    const cleanedJsonText = textContent
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let result;

    try {
      result = JSON.parse(cleanedJsonText);
    } catch (parseError) {
      console.error('JSON Parse Error:', parseError);
      console.error('Gemini raw output:', textContent);

      return res.status(502).json({
        error: 'AI 已完成分析，但回傳格式不正確，請重新嘗試。'
      });
    }

    // 檢查必要欄位
    if (
      !result.summary ||
      !Array.isArray(result.coreBlock) ||
      !Array.isArray(result.experiments)
    ) {
      console.error('Incomplete Gemini result:', result);

      return res.status(502).json({
        error: 'AI 回傳的診斷內容不完整，請重新嘗試。'
      });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('Vercel Function Error:', error);

    return res.status(500).json({
      error: '伺服器執行時發生錯誤，請稍後再試。'
    });
  }
}
