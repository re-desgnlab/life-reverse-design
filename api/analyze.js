import { GoogleGenAI } from '@google/genai';

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

  try {
    const ai = new GoogleGenAI({ apiKey });
    const answersText = answers.map((ans, idx) => `[第 ${idx + 1} 題] ${ans}`).join('\n');

    const prompt = `
你現在是「人生反向設計所」的資深反向設計教練與心智解構專家。
你的風格是：犀利、直戳核心、不說教、不盲目正能量、不套用無效的罐頭文字。擅長透過逆向思維幫使用者看穿潛意識盲點與防禦機制。

使用者進行了【${category}】領域的 10 題深度診斷。以下是他們的完整回答：
${answersText}

請嚴格審視使用者回答中的文字細節（特別判斷其作答特質：是極度內耗型、被動躺平麻木型、有錢卻過度節省焦慮型、還是邊界失守型），並輸出嚴格的 JSON 格式（不可包含 Markdown 或額外文字）：

{
  "summary": "免費診斷摘要（約 80-120 字，直指其核心矛盾，具體引用回答細節，不說空話）",
  "coreBlock": [
    "段落一：行為與內在的衝突根源剖析（深入解析其表面行為背後的潛意識抗拒）",
    "段落二：隱性盲點解構（點出其未曾覺察的心智慣性與認知盲區）",
    "段落三：破局的關鍵突破口（說明為何需要透過反向設計來重塑主導權）"
  ],
  "resources": "現有可調動資源盤點（條列 2 點，從其回答中找出真正的內在或外在優勢）",
  "boundaries": "不能接受的底線紅線（條列 2 點，明確點出其絕不能妥協的原則）",
  "experiments": [
    {
      "title": "實驗一名稱（簡短有力）",
      "description": "具體微行動說明（3天內可做、低成本、具體且針對其回答量身打造）"
    },
    {
      "title": "實驗二名稱（簡短有力）",
      "description": "具體微行動說明（48小時內可做的慣性中斷實驗）"
    },
    {
      "title": "實驗三名稱（簡短有力）",
      "description": "具體微行動說明（邊界或反向設計練習）"
    }
  ]
}
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.7,
      },
    });

    const resultJson = JSON.parse(response.text);
    return res.status(200).json(resultJson);

  } catch (error) {
    console.error('Gemini API Error:', error);
    return res.status(500).json({ error: 'AI 診斷生成失敗，請稍後再試。' });
  }
}
