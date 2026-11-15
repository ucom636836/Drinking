// 每週更新 menu-updates.json:依 sources.json 的官方網址取頁面文字,請 Claude 抽出價目表。
// 用法:ANTHROPIC_API_KEY=... node scripts/update-menus.mjs [--dry]
// 輸出:menu-updates.json(就地更新)、pr-body.md(PR 描述)、GITHUB_OUTPUT 的 changed=true|false
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";

const MODEL = "claude-sonnet-5-5";
const MAX_TOKENS = 6000;       // 每家店輸出上限(成本控制)
const MAX_TEXT = 60000;        // 每家店送給模型的頁面文字字元上限
const FLAG_RATIO = 0.3;        // 價格變動超過 30% 只標記,不擋下
const DRY = process.argv.includes("--dry");

const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); // 台北日期
const sources = JSON.parse(readFileSync("sources.json", "utf8"));
const prev = existsSync("menu-updates.json") ? JSON.parse(readFileSync("menu-updates.json", "utf8")) : { stores: {} };
const NOTE = "status: new=本次有更新價格/品項;none=已核對無異動;pending=查無可靠來源或本次失敗,沿用舊資料。updated=該店最後一次成功核對的日期";

const htmlToText = h => h
  .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#?\w+;/g, " ")
  .replace(/\s+/g, " ").trim();

async function fetchPage(url) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (menu-updater)" }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return htmlToText(await r.text());
}

const IMG_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_IMG = 5 * 1024 * 1024, MAX_PDF = 20 * 1024 * 1024;
// 下載價目表圖片/PDF,回傳 Claude 的 content block
async function fetchFile(url) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (menu-updater)" }, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  const type = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const buf = Buffer.from(await r.arrayBuffer());
  const data = buf.toString("base64");
  if (type === "application/pdf" && buf.length <= MAX_PDF) return { type: "document", source: { type: "base64", media_type: type, data } };
  if (IMG_TYPES.includes(type) && buf.length <= MAX_IMG) return { type: "image", source: { type: "base64", media_type: type, data } };
  throw new Error(`不支援或過大的檔案 ${type} ${buf.length}B ${url}`);
}

async function askClaude(store, text, files, oldMenu) {
  const old = oldMenu ? `目前資料(僅供對照品名,價格以頁面為準):\n${JSON.stringify(oldMenu)}\n\n` : "";
  const prompt = `以下是飲料店「${store}」官方網站的價目表(頁面文字和/或附上的圖片、PDF)。請抽出飲料價目表。
規則:
- 只使用來源中明確出現的品項與價格,不可推測或沿用記憶中的價格。
- 每個品項格式 [品名, 中杯價格, 大杯價格];只有一種容量或沒有大杯時大杯填 0。價格為整數(新台幣)。
- 看不清楚、無法確定的品項請略過;若是分地區價格,取北部(台北)價,並排除百貨商場或特殊店型的專屬價;沒有可辨識的價格時,回傳 {"menu":null}。
- 只輸出一個 JSON 物件,格式 {"menu":[[品名,中杯,大杯],...]},不要其他文字。

${old}${text ? "頁面文字:" + text.slice(0, MAX_TEXT) : ""}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, messages: [{ role: "user", content: [...files, { type: "text", text: prompt }] }] }),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) throw new Error(`Claude API ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const out = (await r.json()).content?.map(b => b.text || "").join("") || "";
  const m = out.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("模型回覆不含 JSON");
  return JSON.parse(m[0]).menu;
}

// 驗證:回傳錯誤訊息陣列(空 = 通過)
function validate(menu, text, oldMenu, checkNums) {
  if (!Array.isArray(menu) || !menu.length) return ["沒有品項"];
  const errs = [];
  const nums = new Set((text.match(/\d+/g) || []).map(Number));
  for (const it of menu) {
    if (!Array.isArray(it) || typeof it[0] !== "string" || !it[0].trim()) { errs.push(`格式錯誤:${JSON.stringify(it)}`); continue; }
    const [n, m, l] = it;
    if (!Number.isInteger(m) || m <= 0 || !Number.isInteger(l) || l < 0) errs.push(`${n} 價格不是正整數`);
    else if (l && l < m) errs.push(`${n} 大杯低於中杯`);
    else if (checkNums && !nums.has(m) || (l && !nums.has(l))) errs.push(`${n} 的價格未出現在來源頁面`);
  }
  if (oldMenu && menu.length < oldMenu.length / 2) errs.push(`品項數 ${oldMenu.length} → ${menu.length},減少超過一半`);
  return errs;
}

// 與舊菜單比較,回傳說明列與是否有變動
function diff(oldMenu, menu) {
  const lines = [], o = new Map((oldMenu || []).map(x => [x[0], x])), n = new Map(menu.map(x => [x[0], x]));
  for (const [k, v] of n) {
    const p = o.get(k);
    if (!p) { lines.push(`+ 新增 ${k} ${v[1]}/${v[2] || "-"}`); continue; }
    if (p[1] !== v[1] || p[2] !== v[2]) {
      const big = [[p[1], v[1]], [p[2], v[2]]].some(([a, b]) => a && b && Math.abs(b - a) / a > FLAG_RATIO);
      lines.push(`~ ${k} ${p[1]}/${p[2] || "-"} → ${v[1]}/${v[2] || "-"}${big ? " ⚠️ 變動超過 30%" : ""}`);
    }
  }
  for (const k of o.keys()) if (!n.has(k)) lines.push(`- 移除 ${k}`);
  return lines;
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("缺少 ANTHROPIC_API_KEY:請到 GitHub Settings → Secrets and variables → Actions 新增 Repository secret(名稱全大寫)。");
  process.exit(1);
}

const result = { date: today, note: NOTE, stores: {} };
const report = [], failed = [];
let changed = 0;

for (const [store, src] of Object.entries(sources)) {
  const old = prev.stores?.[store] || {};
  const keep = (why) => {
    // 失敗或無來源:沿用舊資料與舊日期
    result.stores[store] = { status: "pending", ...(old.updated ? { updated: old.updated } : {}), ...(old.source ? { source: old.source } : {}), ...(old.menu ? { menu: old.menu } : {}) };
    failed.push(`- ${store}:${why}`);
  };
  if (!src.urls?.length && !src.files?.length) { keep("無官方來源網址"); continue; }
  try {
    let text = "", used = "";
    const files = [];
    for (const u of src.urls || []) { try { text += " " + await fetchPage(u); used ||= u; } catch (e) { console.warn(store, e.message); } }
    for (const u of src.files || []) { try { files.push(await fetchFile(u)); used ||= u; } catch (e) { console.warn(store, e.message); } }
    if (!used) throw new Error("所有來源網址都無法讀取");
    const menu = await askClaude(store, text.trim(), files, old.menu);
    // 純文字來源可檢查價格是否出現在頁面;含圖片/PDF 時無法比對,改靠格式與異常檢查
    const errs = validate(menu, text, old.menu, files.length === 0);
    if (errs.length) throw new Error("驗證未通過:" + errs.slice(0, 5).join(";"));
    const lines = diff(old.menu, menu);
    result.stores[store] = { status: lines.length ? "new" : "none", updated: today, source: used, menu };
    if (lines.length) { changed++; report.push(`### ${store}\n來源:${used}\n\n${lines.slice(0, 40).map(l => "- " + l).join("\n")}${lines.length > 40 ? "\n- …另有 " + (lines.length - 40) + " 項變動" : ""}`); }
  } catch (e) {
    console.warn(store, "失敗:", e.message);
    keep(e.message);
  }
}

// 輸出:每個品項一行,避免 diff 過長
const fmtMenu = m => "[\n" + m.map(x => "    " + JSON.stringify(x)).join(",\n") + "\n   ]";
const body = Object.entries(result.stores).map(([k, v]) => {
  const f = [`"status": ${JSON.stringify(v.status)}`];
  if (v.updated) f.push(`"updated": ${JSON.stringify(v.updated)}`);
  if (v.source) f.push(`"source": ${JSON.stringify(v.source)}`);
  if (v.menu) f.push(`"menu": ${fmtMenu(v.menu)}`);
  return `  ${JSON.stringify(k)}: {\n   ${f.join(",\n   ")}\n  }`;
}).join(",\n");
const json = `{\n "date": ${JSON.stringify(today)},\n "note": ${JSON.stringify(NOTE)},\n "stores": {\n${body}\n }\n}\n`;
JSON.parse(json); // 自我檢查

const pr = `## 每週價目表更新(${today})\n\n有變動 ${changed} 家;失敗/待確認 ${failed.length} 家。價格由 AI 依官方網址頁面抽出,**合併前請抽查來源**。\n\n` +
  (report.length ? report.join("\n\n") : "_沒有價格變動_") +
  (failed.length ? `\n\n## 失敗 / 待確認(沿用舊資料)\n${failed.join("\n")}` : "");

if (!DRY) { writeFileSync("menu-updates.json", json); writeFileSync("pr-body.md", pr); }
else console.log(pr);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed > 0}\n`);
console.log(`完成:變動 ${changed} 家,失敗 ${failed.length} 家`);
// 有來源的店家全部失敗(例如 API key 無效)時讓流程失敗,GitHub 才會寄失敗通知
const tried = Object.values(sources).filter(s => s.urls?.length || s.files?.length).length;
const triedFailed = failed.filter(f => !f.endsWith("無官方來源網址")).length;
if (tried && triedFailed === tried) {
  console.error(`有來源的 ${tried} 家店全部失敗,視為整體失敗。`);
  process.exit(1);
}
