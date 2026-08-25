export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { category, answers } = req.body;

  if (!category || !answers || !Array.isArray(answers)) {
    return res.status(400).json({ error: '無效的輸入資料' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: '未設定 GEMINI_API_KEY 環境變數' });
  }

  const answersText = answers.map((ans, idx) => `[第 ${idx + 1} 題]${ans}`).join('\n');

  const prompt = `
你現在是「人生反向設計所」的資深反向設計教練與心智解構專家。
你的風格是：犀利、直戳核心、不說教、不盲目正能量、不套用無效的罐頭文字。擅長透過逆向思維幫使用者看穿潛意識盲點與防禦機制。

使用者進行了【${category}】領域的 10 題深度診斷。以下是他們的完整回答：
${answersText}

請嚴格審視使用者回答中的文字細節，並輸出嚴格的 JSON 格式（不可包含 Markdown 或額外文字，也不要使用 ```json 程式碼區塊）：

{
  "summary": "免費診斷摘要（約 80-120 字，直指其核心矛盾，具體引用回答細節，不說空話）",
  "coreBlock": [
    "段落一：行為與內在的衝突根源剖析",
    "段落二：隱性盲點解構",
    "段落三：破局的關鍵突破口"
  ],
  "resources": "現有可調動資源盤點（條列 2 點）",
  "boundaries": "不能接受的底線紅線（條列 2 點）",
  "experiments": [
    {
      "title": "實驗一名稱",
      "description": "具體微行動說明（3天內可做、低成本）"
    },
    {
      "title": "實驗二名稱",
      "description": "具體微行動說明（48小時內可做）"
    },
    {
      "title": "實驗三名稱",
      "description": "具體微行動說明（邊界或反向設計練習）"
    }
  ]
}
`;

  try {
    const response = await fetch(`[https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=$](https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=$){apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.7
        }
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error('Gemini API Error Response:', data);
      return res.status(500).json({ error: data.error?.message || 'AI 診斷生成失敗' });
    }

    const textContent = data.candidates[0].content.parts[0].text;
    const resultJson = JSON.parse(textContent);
    
    return res.status(200).json(resultJson);

  } catch (error) {
    console.error('Server Execution Error:', error);
    return res.status(500).json({ error: '伺服器執行錯誤，請稍後再試。' });
  }
}
