# LinguaMode 部署說明

手機可開的單字卡 app。API key 藏在 Vercel 後端，前端與 GitHub 都看不到。

## 檔案結構

```
linguamode/
├── index.html        前端（手機開的就是這個）
├── api/
│   └── generate.js   Vercel 後端，代打 Gemini，key 藏這
├── vercel.json       Vercel 設定
├── .gitignore
└── README.md
```

## 運作原理

手機開 index.html → 要生單字時打自己的 `/api/generate` → 後端用環境變數裡的 key 打 Gemini → 回傳結果。
key 只活在 Vercel 伺服器，永遠不進瀏覽器、不進 GitHub。

---

## 部署步驟

### 第 1 步：放上 GitHub

1. 在 GitHub 開一個新 repo（public 也安全，因為 key 不在程式碼裡）
2. 把 `linguamode` 資料夾裡的全部檔案上傳上去

> 不會用 git 指令也沒關係：GitHub 網頁可以直接拖檔案上傳。
> 注意 `api` 資料夾要保留，裡面的 `generate.js` 是後端。

### 第 2 步：接上 Vercel

1. 到 https://vercel.com 用 GitHub 帳號登入
2. 按 **Add New → Project**，選你剛建的 repo
3. 框架（Framework Preset）選 **Other**，其他不用改，按 Deploy

### 第 3 步：設定 API key（最重要）

1. 部署完成後，進該專案 → **Settings → Environment Variables**
2. 新增一筆：
   - Name：`GEMINI_API_KEY`
   - Value：你的 Gemini 金鑰
3. 存檔後到 **Deployments**，對最新一筆按 **Redeploy**（讓環境變數生效）

完成後，Vercel 會給你一個網址（像 `https://linguamode-xxx.vercel.app`），
手機瀏覽器打開就能用。可以「加入主畫面」當成 app 圖示。

---

## 雲端字庫（選用）

想把生成的單字同步到 Google 試算表：

1. 照 `Code.gs`（另一個檔案）的說明部署 Apps Script
2. 把拿到的 Web App 網址，填進 `index.html` 裡的 `SHEET_API_URL`
3. 重新上傳 index.html、Vercel 會自動重新部署

留空的話 app 照常運作，只用瀏覽器本機快取，不同步雲端。

---

## 安全檢查清單

- [x] key 設在 Vercel 環境變數，不在程式碼裡
- [x] `.gitignore` 已排除 `.env`
- [x] 前端只打 `/api/generate`，看不到 key
- [ ] 建議仍到 Google AI Studio 幫這把 key 設每日配額上限（多一層保險）

## 常見問題

**Q：手機打開白畫面？**
用的是 CDN 載 React，第一次載入需要網路。確認手機有連網、重新整理。

**Q：按生成沒反應、跳錯誤？**
多半是環境變數沒設好或沒 redeploy。回第 3 步檢查 `GEMINI_API_KEY` 拼字，並重新部署。

**Q：日文不會發音？**
瀏覽器內建語音功能依賴裝置的語音包。部分 Android／Windows 沒裝日文語音就不會出聲，這是裝置限制，跟程式無關。
