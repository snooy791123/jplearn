// Vercel Serverless Function：在伺服器端代打 Gemini，API key 藏在環境變數
// 前端只會打 /api/generate，永遠看不到 key
//
// 部署前要在 Vercel 專案設定 → Environment Variables 加：
//   GEMINI_API_KEY = 你的新金鑰
//
// 支援兩種模式：
//   1. 單字/故事生成（mode 省略或 'json'）：帶 promptText + responseSchema，回傳結構化 JSON
//   2. 對話練習（mode 'chat'）：帶 systemPrompt + history，回傳對話 JSON（角色回覆 + 糾錯）

const GEMINI_MODEL = 'gemini-3.5-flash';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server missing GEMINI_API_KEY' });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  // 共用的帶重試送出
  async function callGemini(payload) {
    let retries = 3, delay = 800, lastErr;
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
        return text;
      } catch (err) {
        lastErr = err; retries--;
        if (retries > 0) { await new Promise((rs) => setTimeout(rs, delay)); delay *= 2; }
      }
    }
    throw lastErr;
  }

  try {
    const body = req.body || {};
    const mode = body.mode || 'json';

    // ---------- 新聞模式：抓 NHK RSS，解析成 JSON ----------
    if (mode === 'news') {
      const NHK_RSS = 'https://www3.nhk.or.jp/rss/news/cat0.xml';
      try {
        const r = await fetch(NHK_RSS, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!r.ok) throw new Error('NHK ' + r.status);
        const xml = await r.text();

        // 簡單解析 <item>，取 title / link / description / pubDate
        const items = [];
        const itemBlocks = xml.split('<item>').slice(1);
        const pick = (block, tag) => {
          // 支援 CDATA 與一般文字
          const re = new RegExp('<' + tag + '>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</' + tag + '>');
          const m = block.match(re);
          return m ? m[1].trim() : '';
        };
        for (const block of itemBlocks) {
          const title = pick(block, 'title');
          if (!title) continue;
          items.push({
            title,
            link: pick(block, 'link'),
            description: pick(block, 'description'),
            pubDate: pick(block, 'pubDate')
          });
          if (items.length >= 12) break;
        }
        return res.status(200).json({ ok: true, items });
      } catch (err) {
        return res.status(502).json({ ok: false, error: 'NHK fetch failed: ' + String(err) });
      }
    }

    // ---------- 對話模式 ----------
    if (mode === 'chat') {
      const { systemPrompt, history } = body;
      if (!systemPrompt || !Array.isArray(history)) {
        return res.status(400).json({ error: 'Missing systemPrompt or history' });
      }
      // 把前端的 [{role:'user'|'model', text}] 轉成 Gemini 的 contents 格式
      const contents = history.map((m) => ({
        role: m.role === 'model' ? 'model' : 'user',
        parts: [{ text: m.text }]
      }));

      const payload = {
        contents,
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              userTarget: { type: 'STRING', description: '使用者上一句「翻成目標語言」的自然說法。若使用者本來就用目標語言講且正確，原樣放這；若使用者打的是中文，這裡放對應的目標語言說法。沒有使用者發言則空字串。' },
              userReading: { type: 'STRING', description: 'userTarget 的讀音（日文假名/羅馬拼音，英文音標）。沒有則空字串。' },
              userMeaning: { type: 'STRING', description: '使用者那句話的繁體中文意思。沒有則空字串。' },
              reply: { type: 'STRING', description: '角色用目標語言的自然回覆' },
              replyReading: { type: 'STRING', description: '回覆的讀音（日文假名/羅馬拼音，英文音標）' },
              replyTranslation: { type: 'STRING', description: '回覆的繁體中文翻譯' },
              correction: { type: 'STRING', description: '若使用者用目標語言但有錯，指出並給更道地說法；若使用者打中文，這裡簡短說明「你想說的可以這樣講」；都沒問題則空字串' }
            },
            required: ['reply', 'replyTranslation']
          }
        }
      };
      const text = await callGemini(payload);
      return res.status(200).json({ ok: true, text });
    }

    // ---------- 單字/故事生成（原本的，向後相容） ----------
    const { promptText, responseSchema } = body;
    if (!promptText || !responseSchema) {
      return res.status(400).json({ error: 'Missing promptText or responseSchema' });
    }
    const payload = {
      contents: [{ parts: [{ text: promptText }] }],
      systemInstruction: { parts: [{ text: '你是專業的語言教學助理。嚴格輸出符合要求的 JSON，不含任何 markdown 標籤或說明文字。' }] },
      generationConfig: { responseMimeType: 'application/json', responseSchema }
    };
    const text = await callGemini(payload);
    return res.status(200).json({ ok: true, text });

  } catch (err) {
    return res.status(502).json({ ok: false, error: String(err) });
  }
}
