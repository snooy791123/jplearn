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

  // 收集多組 API key（額度用完或失效時自動換下一把）
  const apiKeys = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4
  ].filter(Boolean);
  if (apiKeys.length === 0) {
    return res.status(500).json({ error: 'Server missing GEMINI_API_KEY' });
  }
  // 給 TTS 等用：第一把可用的 key
  const apiKey = apiKeys[0];

  // 共用的送出：每把 key 各重試，失敗換下一把
  async function callGemini(payload) {
    let lastErr;
    for (const key of apiKeys) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
      let retries = 2, delay = 700;
      while (retries > 0) {
        try {
          const r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          // 429(額度用完) / 403(key 失效) → 不重試，直接換下一把 key
          if (r.status === 429 || r.status === 403) throw new Error(`KEY_EXHAUSTED ${r.status}`);
          if (!r.ok) throw new Error(`Gemini error: ${r.status}`);
          const data = await r.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) throw new Error('Empty response');
          return text;
        } catch (err) {
          lastErr = err;
          // 額度/權限問題 → 立刻跳出去換下一把 key
          if (String(err.message).startsWith('KEY_EXHAUSTED')) break;
          retries--;
          if (retries > 0) { await new Promise((rs) => setTimeout(rs, delay)); delay *= 2; }
        }
      }
    }
    throw lastErr;
  }

  try {
    const body = req.body || {};
    const mode = body.mode || 'json';

    // ---------- 語音合成模式：用 Gemini TTS 生成高品質語音 ----------
    if (mode === 'tts') {
      const { text, voice } = body;
      if (!text) return res.status(400).json({ error: 'Missing text' });
      const payload = {
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voice || 'Kore' } }
          }
        }
      };
      let lastErr;
      // 每把 key 各試幾次，失敗換下一把
      for (const key of apiKeys) {
        const ttsUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent?key=${key}`;
        let retries = 2, delay = 700;
        while (retries > 0) {
          try {
            const r = await fetch(ttsUrl, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            if (r.status === 429 || r.status === 403) throw new Error(`KEY_EXHAUSTED ${r.status}`);
            if (!r.ok) throw new Error('TTS ' + r.status);
            const data = await r.json();
            const part = data.candidates?.[0]?.content?.parts?.[0];
            const audio = part?.inlineData?.data;
            if (!audio) throw new Error('No audio');
            return res.status(200).json({ ok: true, audio, mimeType: part.inlineData.mimeType || 'audio/L16;rate=24000' });
          } catch (err) {
            lastErr = err;
            if (String(err.message).startsWith('KEY_EXHAUSTED')) break;
            retries--;
            if (retries > 0) { await new Promise((rs) => setTimeout(rs, delay)); delay *= 2; }
          }
        }
      }
      return res.status(502).json({ ok: false, error: 'TTS failed: ' + String(lastErr) });
    }

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
      // 第一階段（快）：只生成 AI 回覆本身 + 讀音 + 翻譯，讓對話即時顯示
      const { systemPrompt, history } = body;
      if (!systemPrompt || !Array.isArray(history)) {
        return res.status(400).json({ error: 'Missing systemPrompt or history' });
      }
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
              reply: { type: 'STRING', description: '角色用目標語言的自然回覆，簡短、難度適中、推進劇情' },
              replyReading: { type: 'STRING', description: '回覆的讀音（日文假名/羅馬拼音，英文音標）' },
              replyTranslation: { type: 'STRING', description: '回覆的繁體中文翻譯' }
            },
            required: ['reply', 'replyTranslation']
          }
        }
      };
      const text = await callGemini(payload);
      return res.status(200).json({ ok: true, text });
    }

    if (mode === 'chatDetail') {
      // 第二階段（背景補）：針對使用者「最後一句」生成 修正/讀音/意思/糾錯
      const { systemPrompt, history } = body;
      if (!systemPrompt || !Array.isArray(history)) {
        return res.status(400).json({ error: 'Missing systemPrompt or history' });
      }
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
              correction: { type: 'STRING', description: '若使用者用目標語言但有錯，指出並給更道地說法；若使用者打中文，這裡簡短說明「你想說的可以這樣講」；都沒問題則空字串' }
            },
            required: ['userTarget']
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
