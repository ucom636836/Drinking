# C636飲料訂購

靜態頁面(`index.html`),可部署到 GitHub Pages。未設定 Firebase 時為本機模式;設定後為多人即時共用。

## 功能
- 多店家菜單、購物車、文字/圖片匯出
- 收單與截止時間(截止後無法新增/刪除品項,可手動重新開放)
- 付款追蹤(每人勾選已付款,顯示已收/未收)
- 歷史紀錄與統計(每人累計、熱門品項、訂單列表)
- 個人常點:輸入姓名後顯示常點組合,一鍵加入

> 截止/收單為前端控管,屬於君子協定;不是資料庫層級的強制限制。

## 啟用共用資料庫(Firebase Firestore)
1. 到 <https://console.firebase.google.com> 建立專案。
2. 建置 → Firestore Database → 建立資料庫(正式版模式即可)。
3. Firestore → 規則:貼上 `firestore.rules` 內容並發布(預設為驗證版,需完成下方「限制存取」;若不設密碼,改成 `if true;`)。
4. 專案設定 → 一般 → 新增 Web 應用程式,複製 `firebaseConfig`。
5. 把設定貼進 `firebase-config.js`(取代 `null`),部署即可。

> 注意:ES module 需透過 http(s) 開啟(GitHub Pages 或 `python3 -m http.server`),直接雙擊開啟 `file://` 會使用本機模式。
> apiKey 本來就會公開在前端,安全性由 Firestore 規則決定,所以建議使用上面的驗證版規則。

## 限制存取(公司共用密碼,選用)
1. Firebase 主控台 → Authentication → 開始使用 → 登入方式 → 啟用「電子郵件/密碼」。
2. Authentication → 使用者 → 新增使用者:Email 填任意共用信箱(如 `team@your-company.example`,不必真實存在),密碼即「公司訂餐密碼」。
3. 在 `firebase-config.js` 加上 `accessEmail: "<同一個 Email>"`。
4. 規則使用驗證版(`request.auth != null`)。

開啟頁面時會要求輸入密碼,登入狀態保留在該瀏覽器。密碼不會寫在程式或儲存庫裡;要換密碼就在 Firebase 後台改。

## 資料結構
- `orders/{id}`:`date`、`store`、`items[]`、`created`、`locked`(收單)、`deadline`(截止時間)、`paid[]`(已付款姓名)
- `stores/{encodedName}`:`name`、`items`(JSON 字串)、`custom`

## 管理員模式(只有你看得到設定)
「價格更新」「編輯此店菜單 / 價格」「新增自訂店家」預設隱藏。
1. 開 `https://<你的網址>/?admin`,尚未設定時會請你輸入新密碼,並顯示一串雜湊。
2. 把雜湊貼到 `firebase-config.js` 的 `adminHash: "..."` 後部署。
3. 之後開 `?admin` 輸入該密碼才會顯示這些設定。

> 這只是隱藏介面,不是真正的存取控制;若要擋住寫入,需另外用 Firebase 驗證與 Firestore 規則。
