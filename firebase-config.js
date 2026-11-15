// Firebase 設定。留 null 則使用本機模式。
// 管理員(價格更新/編輯菜單/新增店家)用 ?admin 進入;adminHash 產生方式見 README。
// 若要啟用公司密碼,加上 accessEmail: "<Authentication 內共用使用者的 Email>"(見 README)。
export default {
  apiKey: "AIzaSyACMJ8OkqIBD9jfQO5Sjb_i270_SOcwONY",
  authDomain: "c636-drink.firebaseapp.com",
  projectId: "c636-drink",
  storageBucket: "c636-drink.firebasestorage.app",
  messagingSenderId: "398931802870",
  appId: "1:398931802870:web:9c6593b88abc7ff7980ad7",
  adminHash: "f5d496412945e15e4fd1efb147ebcc716d9b3d7a8fab7312891a90c0b97867b3"
};
