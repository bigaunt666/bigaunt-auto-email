// 1. 載入必要模組與環境變數
import fetch from 'node-fetch';
import nodemailer from 'nodemailer';
import 'dotenv/config';

// 2. 環境變數設定
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_PASS;

// 3. 查詢目前啟用的表單名稱
async function fetchActiveTableName() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/settings?isActive=eq.true`, {
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
    throw new Error("⚠️ 尚未設定 settings 中的 isActive = true");
  }

  return data[0].activeTable;
}

// 4. 查詢所有尚未寄出最終通知的訂單
async function fetchPendingOrders() {
  const tableName = await fetchActiveTableName();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tableName}?hasSentFinalEmail=eq.false`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'return=representation'
    }
  });
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('取得訂單失敗');
  return data;
}

// 5. 寄信功能
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

// 6. 成功：更新 hasSentFinalEmail 為 true
async function markSuccess(id, tableName) {
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

// 7. 失敗：重置欄位
async function resetOrder(id, tableName) {
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

// 8. 主程式邏輯
(async () => {
  const orders = await fetchPendingOrders();
  const tableName = await fetchActiveTableName();
  let checkDuplicateArr = [];

  for (const order of orders) {
    if (!order.buyerEmail) {
      console.log(`⚠️ 訂單 ID ${order.id} 沒有填 buyerEmail，略過`);
      continue;
    }

    if (checkDuplicateArr.includes(order.groupIdForSentEmail)) {
      if (order.isDone === true) {
        await markSuccess(order.id, tableName);
      } else if (order.isDone === false) {
        await resetOrder(order.id, tableName);
      }
      continue;
    } else {
      checkDuplicateArr.push(order.groupIdForSentEmail);
    }

    if (order.isDone === true) {
      // 🔍 查詢該 groupId 所有隊伍名稱
     const teamRes = await fetch(`${SUPABASE_URL}/rest/v1/${tableName}?groupIdForSentEmail=eq.${order.groupIdForSentEmail}`, {
      headers: {
     apikey: SUPABASE_KEY,
     Authorization: `Bearer ${SUPABASE_KEY}`,
     Prefer: 'return=representation'
     }
     });
     const allTeamOrders = await teamRes.json();
     const teamNames = allTeamOrders.map(o => o.name).join('、');
      const html = `
         <h2>嗨 ${order.buyerName}，感謝您完成匯款！</h2>
         <p>您這次參加的隊伍有：<b>${teamNames}</b>。</p>
         <p>我們已確認您的付款，會在開團後直播開卡，並將卡片安全保留至您申請出貨。</p>
         <p style="margin-top: 20px;">— Big Aunt’s 卡團 團隊 敬上</p>
        `;
      await sendEmail(order.buyerEmail, '【訂單成功】感謝您完成匯款', html);
      await markSuccess(order.id, tableName);
      console.log(`✅ 已寄成功信給 ${order.buyerEmail}`);
    } else if (order.isDone === false) {
      const html = `
        <h2>嗨 ${order.buyerName}，訂單未完成匯款</h2>
        <p>由於您未完成匯款，您的訂單已取消，隊伍已釋出。</p>
      `;
      await sendEmail(order.buyerEmail, '【訂單取消通知】未完成匯款', html);
      await resetOrder(order.id, tableName);
      console.log(`❌ 已寄失敗信並釋出隊伍 ${order.name}`);
    }
  }

  console.log("✅ 所有待處理訂單已完成處理");
})();
