# 公司飲料訂購

靜態頁面(`index.html`),可部署到 GitHub Pages。未設定 Firebase 時為本機模式;設定後為多人即時共用。

## 啟用共用資料庫(Firebase Firestore)
1. 到 <https://console.firebase.google.com> 建立專案。
2. 建置 → Firestore Database → 建立資料庫(正式版模式即可)。
3. Firestore → 規則:貼上 `firestore.rules` 內容並發布。
4. 專案設定 → 一般 → 新增 Web 應用程式,複製 `firebaseConfig`。
5. 把設定貼進 `firebase-config.js`(取代 `null`),部署即可。

> 注意:ES module 需透過 http(s) 開啟(GitHub Pages 或 `python3 -m http.server`),直接雙擊開啟 `file://` 會使用本機模式。
> 規則為「知道網址者可讀寫」,適合公司內部小工具;apiKey 本來就會公開在前端,安全性由規則決定。若需限制,可加 Firebase Auth 或 App Check。

## 資料結構
- `orders/{id}`:`date`、`store`、`items[]`、`created`
- `stores/{encodedName}`:`name`、`items`(JSON 字串)、`custom`
