// 1. 載入所需套件
import fetch from 'node-fetch';
import nodemailer from 'nodemailer';
import 'dotenv/config';

// 2. Supabase & Gmail 設定（從環境變數讀取）
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_PASS;

// 3. 查詢尚未寄出的訂單
async function fetchPendingOrders() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/TeamsForm_20250524?has_sent_initial_email=eq.false`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'return=representation'
    }
  });
  return await res.json();
}

// 4. 寄信 function（會用 nodemailer + Gmail SMTP）
async function sendEmail(to, subject, html) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_PASS }
  });

  await transporter.sendMail({
    from: `"你的網站名稱" <${GMAIL_USER}>`,
    to,
    subject,
    html
  });
}

// 5. 更新寄信狀態
async function markAsSent(id) {
  await fetch(`${SUPABASE_URL}/rest/v1/TeamsForm_20250524?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify({ has_sent_initial_email: true })
  });
}

// 6. 主執行程式
(async () => {
  const orders = await fetchPendingOrders();
  console.log("Fetched orders:", orders);
  for (const order of orders) {
    const html = `
      <h2>感謝您的訂單！</h2>
      <p>請於 8 小時內完成匯款至以下帳號：</p>
      <p><b>${order.buyerBankAccount}</b></p>
      <p>完成後系統會自動判斷是否成功。</p>
    `;
    await sendEmail(order.buyerEmail, '【匯款通知】您的訂單已建立', html);
    await markAsSent(order.id);
    console.log(`✅ 寄出：${order.buyerEmail}`);
  }
})();
