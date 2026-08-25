export const config = {
  maxDuration: 60
};

const GEMINI_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash'
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);

    return res.status(405).json({
      error: '只允許使用 POST 請求。',
      code: 'METHOD_NOT_ALLOWED'
    });
  }

  try {
    const { category, answers } = req.body || {};

    if (
      !category ||
      typeof category !== 'string' ||
      !Array.isArray(answers) ||
      answers.length !== 10
    ) {
      return res.status(400).json({
        error: '輸入資料格式不正確，請確認已完成全部10題。',
        code: 'INVALID_INPUT'
      });
    }

    const cleanedAnswers = answers.map((answer) => {
      return typeof answer === 'string' ? answer.trim() : '';
    });

    if (cleanedAnswers.some((answer) => !answer)) {
      return res.status(400).json({
        error: '所有題目都必須填寫。',
        code: 'INCOMPLETE_ANSWERS'
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      console.error('Missing GEMINI_API_KEY in Vercel environment variables');

      return res.status(500).json({
        error: '伺服器尚未完成 AI 服務設定。',
        code: 'MISSING_API_KEY'
      });
    }

    const answersText = cleanedAnswers
      .map((answer, index) => {
        return `[第 ${index + 1} 題]\n${answer}`;
      })
      .join('\n\n');

    const prompt = `
你現在是「人生反向設計所」的資深反向設計教練與心智解構專家。

你的任務不是診斷心理疾病，而是根據使用者提供的文字，透過反向思考協助使用者辨識目前的核心矛盾、行動阻力、可運用資源、界線與突破方向。

你的分析風格：

1. 犀利、具體、直指核心。
2. 不說教、不責備、不盲目正能量。
3. 不使用空泛或罐頭式文字。
4. 必須根據使用者實際回答進行分析。
5. 避免進行醫療、精神疾病或心理疾病診斷。
6. 不要斷言使用者具備某種人格或疾病。
7. 透過逆向思維，協助使用者看見行為與內在需求之間的落差。
8. 分析必須讓使用者感覺內容確實回應到他的回答，而不是任何人都能套用。
9. 行動建議必須具體、低成本，並能在短時間內實際執行。

使用者進行的是【${category}】領域的10題深度診斷。

以下是使用者的完整回答：

${answersText}

請只輸出合法 JSON。

不得加入 Markdown、程式碼區塊、前言、結語或任何 JSON 以外的文字。

輸出內容必須完全符合以下結構：

{
  "summary": "免費診斷摘要，約80至120個中文字。請直接指出使用者目前最明顯的核心矛盾，並具體呼應回答內容。",
  "coreBlock": [
    "第一段：分析使用者目前行為、選擇與內在需求之間的衝突根源。",
    "第二段：指出使用者可能尚未察覺的隱性盲點或自我保護模式。",
    "第三段：提出目前最值得優先處理的突破方向。"
  ],
  "resources": "列出2項使用者目前可以調動的資源。每一項獨立一行，並以1.和2.開頭。",
  "boundaries": "列出2項使用者不能再繼續接受、犧牲或忽視的底線。每一項獨立一行，並以1.和2.開頭。",
  "experiments": [
    {
      "title": "實驗一名稱",
      "description": "一個能在3天內完成的低成本具體行動，需包含實際執行方式。"
    },
    {
      "title": "實驗二名稱",
      "description": "一個能在48小時內完成的具體行動，需包含實際執行方式。"
    },
    {
      "title": "實驗三名稱",
      "description": "一個與界線建立或人生反向設計有關的具體練習。"
    }
  ]
}
`;

    const geminiResult = await generateWithFallback({
      apiKey,
      prompt
    });

    if (!geminiResult.success) {
      console.error('All Gemini models failed:', geminiResult.attempts);

      return res.status(geminiResult.status || 503).json({
        error: geminiResult.userMessage,
        code: geminiResult.code || 'AI_SERVICE_UNAVAILABLE'
      });
    }

    const cleanedJsonText = cleanJsonOutput(geminiResult.text);

    let result;

    try {
      result = JSON.parse(cleanedJsonText);
    } catch (parseError) {
      console.error('Gemini JSON Parse Error:', {
        model: geminiResult.model,
        error: parseError.message,
        rawOutput: geminiResult.text
      });

      return res.status(502).json({
        error: 'AI已完成分析，但報告格式暫時異常，請重新嘗試。',
        code: 'INVALID_AI_JSON'
      });
    }

    const validationError = validateReport(result);

    if (validationError) {
      console.error('Incomplete Gemini report:', {
        model: geminiResult.model,
        validationError,
        result
      });

      return res.status(502).json({
        error: 'AI回傳的診斷內容不完整，請重新嘗試。',
        code: 'INCOMPLETE_AI_REPORT'
      });
    }

    console.log('AI report generated successfully:', {
      model: geminiResult.model,
      usedFallback: geminiResult.usedFallback
    });

    return res.status(200).json({
      ...result,
      _meta: {
        model: geminiResult.model,
        usedFallback: geminiResult.usedFallback
      }
    });
  } catch (error) {
    console.error('Vercel Function Error:', {
      name: error?.name,
      message: error?.message,
      stack: error?.stack
    });

    return res.status(500).json({
      error: '伺服器執行時發生錯誤，請稍後再試。',
      code: 'SERVER_ERROR'
    });
  }
}

async function generateWithFallback({ apiKey, prompt }) {
  const attempts = [];

  for (let index = 0; index < GEMINI_MODELS.length; index++) {
    const model = GEMINI_MODELS[index];

    try {
      console.log(`Calling Gemini model: ${model}`);

      const response = await callGemini({
        apiKey,
        model,
        prompt
      });

      let data;

      try {
        data = await response.json();
      } catch (jsonError) {
        attempts.push({
          model,
          status: response.status,
          error: 'Gemini response was not valid JSON'
        });

        console.error('Gemini returned non-JSON response:', {
          model,
          status: response.status
        });

        continue;
      }

      if (!response.ok) {
        const errorMessage =
          data?.error?.message ||
          `Gemini API回傳錯誤，狀態碼：${response.status}`;

        attempts.push({
          model,
          status: response.status,
          error: errorMessage
        });

        console.error('Gemini API Error:', {
          model,
          status: response.status,
          message: errorMessage
        });

        if (shouldTryFallback(response.status)) {
          console.warn(`Switching from ${model} to fallback model`);
          continue;
        }

        return {
          success: false,
          status: response.status,
          code: mapGeminiErrorCode(response.status),
          userMessage: getGeminiUserMessage(response.status),
          attempts
        };
      }

      const textContent = extractGeminiText(data);

      if (!textContent) {
        attempts.push({
          model,
          status: 502,
          error: 'Gemini did not return text content'
        });

        console.error('Unexpected Gemini response:', {
          model,
          data
        });

        continue;
      }

      return {
        success: true,
        text: textContent,
        model,
        usedFallback: index > 0,
        attempts
      };
    } catch (error) {
      const isTimeout =
        error?.name === 'TimeoutError' ||
        error?.name === 'AbortError';

      attempts.push({
        model,
        status: isTimeout ? 504 : 500,
        error: isTimeout
          ? 'Gemini request timed out'
          : error?.message || 'Unknown Gemini request error'
      });

      console.error('Gemini request failed:', {
        model,
        name: error?.name,
        message: error?.message
      });

      console.warn(`Switching from ${model} to fallback model`);
    }
  }

  const hadTimeout = attempts.some((attempt) => attempt.status === 504);
  const hadHighDemand = attempts.some((attempt) => {
    return attempt.status === 429 || attempt.status === 503;
  });

  if (hadTimeout) {
    return {
      success: false,
      status: 504,
      code: 'AI_TIMEOUT',
      userMessage: 'AI分析等待時間較長，請稍後重新送出。',
      attempts
    };
  }

  if (hadHighDemand) {
    return {
      success: false,
      status: 503,
      code: 'AI_HIGH_DEMAND',
      userMessage: '目前AI使用人數較多，請稍候1至2分鐘後重新嘗試。',
      attempts
    };
  }

  return {
    success: false,
    status: 503,
    code: 'AI_SERVICE_UNAVAILABLE',
    userMessage: 'AI服務暫時無法使用，請稍後重新嘗試。',
    attempts
  };
}

async function callGemini({ apiKey, model, prompt }) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  return fetch(url, {
    method: 'POST',

    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },

    signal: AbortSignal.timeout(25000),

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
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;

  if (!Array.isArray(parts)) {
    return null;
  }

  const textParts = parts
    .filter((part) => typeof part?.text === 'string')
    .map((part) => part.text);

  if (textParts.length === 0) {
    return null;
  }

  return textParts.join('').trim();
}

function cleanJsonOutput(text) {
  return text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function validateReport(result) {
  if (!result || typeof result !== 'object') {
    return 'Report is not an object';
  }

  if (
    typeof result.summary !== 'string' ||
    !result.summary.trim()
  ) {
    return 'Missing summary';
  }

  if (
    !Array.isArray(result.coreBlock) ||
    result.coreBlock.length !== 3 ||
    result.coreBlock.some((item) => {
      return typeof item !== 'string' || !item.trim();
    })
  ) {
    return 'Invalid coreBlock';
  }

  if (
    typeof result.resources !== 'string' ||
    !result.resources.trim()
  ) {
    return 'Missing resources';
  }

  if (
    typeof result.boundaries !== 'string' ||
    !result.boundaries.trim()
  ) {
    return 'Missing boundaries';
  }

  if (
    !Array.isArray(result.experiments) ||
    result.experiments.length !== 3
  ) {
    return 'Invalid experiments';
  }

  for (const experiment of result.experiments) {
    if (
      !experiment ||
      typeof experiment.title !== 'string' ||
      !experiment.title.trim() ||
      typeof experiment.description !== 'string' ||
      !experiment.description.trim()
    ) {
      return 'Incomplete experiment';
    }
  }

  return null;
}

function shouldTryFallback(status) {
  return [408, 429, 500, 502, 503, 504].includes(status);
}

function mapGeminiErrorCode(status) {
  const errorCodeMap = {
    400: 'GEMINI_BAD_REQUEST',
    401: 'GEMINI_UNAUTHORIZED',
    403: 'GEMINI_FORBIDDEN',
    404: 'GEMINI_MODEL_NOT_FOUND',
    408: 'GEMINI_TIMEOUT',
    429: 'GEMINI_RATE_LIMIT',
    500: 'GEMINI_SERVER_ERROR',
    502: 'GEMINI_BAD_GATEWAY',
    503: 'GEMINI_HIGH_DEMAND',
    504: 'GEMINI_TIMEOUT'
  };

  return errorCodeMap[status] || 'GEMINI_ERROR';
}

function getGeminiUserMessage(status) {
  const messageMap = {
    400: 'AI請求格式有誤，請重新整理頁面後再試。',
    401: 'AI服務驗證失敗，請聯絡網站管理者。',
    403: 'AI服務目前沒有使用權限，請聯絡網站管理者。',
    404: '目前使用的AI模型無法使用，請聯絡網站管理者。',
    408: 'AI分析等待時間較長，請重新嘗試。',
    429: '目前AI使用人數較多，請稍後重新嘗試。',
    500: 'AI服務暫時發生錯誤，請稍後重新嘗試。',
    502: 'AI服務回應異常，請稍後重新嘗試。',
    503: '目前AI使用人數較多，請稍候1至2分鐘後再試。',
    504: 'AI分析等待時間較長，請重新嘗試。'
  };

  return messageMap[status] || 'AI服務暫時無法使用，請稍後重新嘗試。';
}
