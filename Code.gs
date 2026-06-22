/**
 * LinguaMode 單字資料庫後端 (Google Apps Script)
 *
 * 設定步驟：
 * 1. 開一張新的 Google 試算表
 * 2. 擴充功能 → Apps Script，把預設內容刪光，貼上這整段
 * 3. 上方按「部署」→「新增部署作業」→ 類型選「網頁應用程式」
 *    - 執行身分：我自己
 *    - 誰可以存取：「任何人」(這樣前端才打得到；存取的是這張表，不是你的帳號)
 * 4. 部署後會給你一個 https://script.google.com/macros/s/.../exec 網址
 * 5. 把那個網址貼到 React 的 SHEET_API_URL 常數
 *
 * 資料表會自動建立，欄位：
 * id | category | lang | word | reading | translation | sentence | sentenceReading | sentenceTranslation | createdAt
 */

var SHEET_NAME = 'vocab';
var HEADERS = ['id', 'category', 'lang', 'word', 'reading', 'translation', 'sentence', 'sentenceReading', 'sentenceTranslation', 'createdAt'];

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// 讀取：GET 回傳全部單字（前端啟動時撈一次）
function doGet(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet_();
    var values = sheet.getDataRange().getValues();
    var rows = [];
    for (var i = 1; i < values.length; i++) {
      var obj = {};
      for (var c = 0; c < HEADERS.length; c++) {
        obj[HEADERS[c]] = values[i][c];
      }
      rows.push(obj);
    }
    return json_({ ok: true, count: rows.length, data: rows });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// 寫入：POST 一批單字，自動去重（同 word + category 不重複寫）
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var body = JSON.parse(e.postData.contents);
    var items = body.items || [];
    var sheet = getSheet_();

    // 既有的 word|category 集合，用來去重
    var existing = {};
    var values = sheet.getDataRange().getValues();
    var wordCol = HEADERS.indexOf('word');
    var catCol = HEADERS.indexOf('category');
    for (var i = 1; i < values.length; i++) {
      existing[values[i][wordCol] + '||' + values[i][catCol]] = true;
    }

    var added = 0;
    var now = new Date().toISOString();
    var newRows = [];
    for (var j = 0; j < items.length; j++) {
      var it = items[j];
      var key = it.word + '||' + (it.category || '');
      if (existing[key]) continue;
      existing[key] = true;
      newRows.push([
        it.id || (Date.now() + '-' + j),
        it.category || '',
        it.lang || '',
        it.word || '',
        it.reading || '',
        it.translation || '',
        it.sentence || '',
        it.sentenceReading || '',
        it.sentenceTranslation || '',
        now
      ]);
      added++;
    }
    if (newRows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, HEADERS.length).setValues(newRows);
    }
    return json_({ ok: true, added: added });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
