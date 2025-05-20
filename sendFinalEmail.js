// 1. 載入必要模組與環境變數
import fetch from 'node-fetch';
import nodemailer from 'nodemailer';
import 'dotenv/config';

// 2. 環境變數設定
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_PASS;

// 3. 查詢所有尚未寄出最終通知的訂單
async function fetchPendingOrders() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tableName}?hasSentFinalEmail=eq.false`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'return=representation'
    }
  });
  return await res.json();
}

// 4. 寄信功能
async function sendEmail(to, subject, html) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_PASS }
  });

  await transporter.sendMail({
    from: `"Big Aunt's 團隊" <${GMAIL_USER}>`,
    to,
    subject,
    html
  });
}

// 5. 成功：更新 hasSentFinalEmail 為 true
async function markSuccess(id) {
  await fetch(`${SUPABASE_URL}/rest/v1/${tableName}?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify({ hasSentFinalEmail: true })
  });
}

// 6. 失敗：重置欄位
async function resetOrder(id) {
  const resetPayload = {
    buyerName: '',
    buyerPhone: '',
    buyerBankAccount: '',
    "711Name": '',
    submitTaiwanTime: '',
    buyerEmail: '',
    groupIdForSentEmail: '',
    submitTime: null,
    isDone: null,
    isLock: null,
    hasSentFinalEmail: null
  };

  await fetch(`${SUPABASE_URL}/rest/v1/${tableName}?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify(resetPayload)
  });
}

// 7. 主程式邏輯

async function fetchActiveTableName() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/activeTable?isActive=eq.true`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error('查詢 activeTable 失敗: ' + text);
  }

  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("⚠️ 尚未設定 activeTable 中的 isActive");
  }

  return data[0].activeTable;
}


(async () => {
  const orders = await fetchPendingOrders();

  let checkDuplicateArr = [];

  for (const order of orders) {
    if (!order.buyerEmail) {
      console.log(`⚠️ 訂單 ID ${order.id} 沒有填 buyerEmail，略過`);
      continue;
    }

    if (!!~checkDuplicateArr.indexOf(order.groupIdForSentEmail)) {
      if (order.isDone === true) {
        // 重複購買人不再次發信 但在這邊標記此隊伍 hasSentFinalEmail欄位
        await markSuccess(order.id);
      } else if (order.isDone === false) {
        // 重複購買人不再次發信 但在這邊把此隊伍reset
        await resetOrder(order.id);
      }
      continue;
    } else checkDuplicateArr.push(order.groupIdForSentEmail)

    if (order.isDone === true) {
      // 寄成功信
      const html = `
        <h2>感謝您完成匯款</h2>
        <p>您的訂單已確認成功，我們將安排處理。</p>
      `;
      await sendEmail(order.buyerEmail, '【訂單成功】感謝您完成匯款', html);
      await markSuccess(order.id);
      console.log(`✅ 已寄成功信給 ${order.buyerEmail}`);
    } else if (order.isDone === false) {
      // 寄失敗信
      const html = `
        <h2>訂單未完成匯款</h2>
        <p>由於您未完成匯款，您的訂單已取消，隊伍已釋出。</p>
      `;
      await sendEmail(order.buyerEmail, '【訂單取消通知】未完成匯款', html);
      await resetOrder(order.id);
      console.log(`❌ 已寄失敗信並釋出隊伍 ${order.name}`);
    }
  }

  console.log("✅ 所有待處理訂單已完成處理");
})();
