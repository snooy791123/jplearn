// Vercel Serverless Function：在伺服器端代打 Gemini，API key 藏在環境變數
// 前端只會打 /api/generate，永遠看不到 key
//
// 部署前要在 Vercel 專案設定 → Environment Variables 加：
//   GEMINI_API_KEY = 你的新金鑰
//
// 模型可選 gemini-3.5-flash（預設）或更省的 gemini-3.1-flash-lite

const GEMINI_MODEL = 'gemini-3.5-flash';

export default async function handler(req, res) {
  // 只允許 POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server missing GEMINI_API_KEY' });
  }

  try {
    const { promptText, responseSchema } = req.body || {};
    if (!promptText || !responseSchema) {
      return res.status(400).json({ error: 'Missing promptText or responseSchema' });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const payload = {
      contents: [{ parts: [{ text: promptText }] }],
      systemInstruction: {
        parts: [{ text: '你是專業的語言教學助理。嚴格輸出符合要求的 JSON，不含任何 markdown 標籤或說明文字。' }]
      },
      generationConfig: { responseMimeType: 'application/json', responseSchema }
    };

    // 伺服器端帶指數退避重試
    let retries = 3;
    let delay = 800;
    let lastErr;
    while (retries > 0) {
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!r.ok) throw new Error(`Gemini error: ${r.status}`);
        const data = await r.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('Empty response');
        // 直接把 Gemini 的 JSON 字串回傳，前端自己 parse
        return res.status(200).json({ ok: true, text });
      } catch (err) {
        lastErr = err;
        retries--;
        if (retries > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2;
        }
      }
    }
    return res.status(502).json({ ok: false, error: String(lastErr) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
}
