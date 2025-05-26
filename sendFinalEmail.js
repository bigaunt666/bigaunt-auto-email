// 1. 載入必要模組與環境變數
import fetch from 'node-fetch';
import sgMail from '@sendgrid/mail';
import 'dotenv/config';

// 2. 環境變數設定
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;

sgMail.setApiKey(SENDGRID_API_KEY);

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
  const msg = {
    to,
    from: {
      email: 'bigaunt666@gmail.com',

    },
    subject,
    html
  };

  try {
    await sgMail.send(msg);
  } catch (error) {
    console.error('❌ SendGrid 寄信失敗:', error.response?.body || error.message);
    throw error;
  }
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
        <p>您好，Big Aunt's 團隊敬啟：</p>

<p style="font-size: 16px;">
我們近期注意到，您所參與的活動內容有一部分與預期存在出入，因此特此與您聯繫說明並表達關切。
</p>

<p style="font-size: 16px;">
根據我們的系統記錄，您於近期所提交的表單資料中，有部分欄位可能未完整填寫或產生誤差，
為確保您的後續權益，請您協助確認資訊內容是否正確。
</p>

<p style="font-size: 16px;">
若您對此次流程有任何疑問或需要協助之處，歡迎直接回信與我們聯繫，我們將儘速協助處理。
</p>

<p style="margin-top: 30px; font-size: 14px;">
敬祝 順心如意
<br>— Big Aunt's 團隊 敬上
</p>

        `;
      await sendEmail(order.buyerEmail, '【訂單成功】感謝您完成訂單', html);
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
