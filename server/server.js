require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const TelegramBot = require('node-telegram-bot-api');
const { registerLoyaltyRoutes } = require('./loyalty');

const app = express();
const PORT = process.env.PORT || 3001;
const MINI_APP_URL = process.env.MINI_APP_URL || 'https://faraserebrostudio.tilda.ws/page132509366.html';

// ============================================
// TELEGRAM BOT INITIALIZATION
// ============================================

let bot = null;
const GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID;

if (process.env.TELEGRAM_BOT_TOKEN && GROUP_CHAT_ID) {
  try {
    const isProduction = process.env.NODE_ENV === 'production';
    const webhookUrl = process.env.RENDER_EXTERNAL_URL || process.env.WEBHOOK_URL;
    
    if (isProduction && webhookUrl) {
      console.log('🌐 Запуск в Production режиме (Webhook)');
      bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
      
      const webhook = `${webhookUrl}/telegram-webhook`;
      bot.setWebHook(webhook).then(() => {
        console.log('✅ Telegram Webhook установлен:', webhook);
      }).catch(err => {
        console.error('❌ Ошибка установки Webhook:', err.message);
      });
      
    } else {
      console.log('💻 Запуск в Development режиме (Polling)');
      bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { 
        polling: {
          interval: 300,
          autoStart: true,
          params: { timeout: 10 }
        }
      });
      
      bot.on('polling_error', (error) => {
        console.error('❌ Polling ошибка:', error.code);
      });
      
      console.log('✅ Telegram Bot подключен (Polling)');
    }
    
  } catch (error) {
    console.error('❌ Ошибка подключения Telegram Bot:', error);
  }
} else {
  console.warn('⚠️ Telegram Bot не настроен (отсутствуют TOKEN или CHAT_ID)');
}

// ============================================
// MIDDLEWARE
// ============================================

app.use(express.json());
app.use('/miniapp', express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, X-Telegram-Init-Data, X-Demo-Telegram-Id, X-Demo-Telegram-Username, X-Demo-First-Name, X-Demo-Last-Name');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});

// ============================================
// TELEGRAM WEBHOOK ENDPOINT
// ============================================

if (bot && process.env.NODE_ENV === 'production') {
  app.post('/telegram-webhook', (req, res) => {
    try {
      bot.processUpdate(req.body);
      res.sendStatus(200);
    } catch (error) {
      console.error('❌ Ошибка обработки webhook:', error);
      res.sendStatus(500);
    }
  });
  
  console.log('✅ Telegram Webhook endpoint зарегистрирован: /telegram-webhook');
}

// ============================================
// ПОДКЛЮЧЕНИЕ К POSTGRESQL
// ============================================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

registerLoyaltyRoutes(app, pool);

// ============================================
// TELEGRAM HELPER FUNCTIONS
// ============================================

async function sendTelegramNotification(message, options = {}) {
  if (!bot || !GROUP_CHAT_ID) {
    console.warn('⚠️ Telegram не настроен, сообщение не отправлено');
    return;
  }
  
  try {
    const sentMessage = await bot.sendMessage(GROUP_CHAT_ID, message, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      disable_notification: false,
      ...options
    });
    console.log('✅ Telegram уведомление отправлено');
    return sentMessage;
  } catch (error) {
    console.error('❌ Ошибка отправки в Telegram:', error.message);
    return null;
  }
}

function getStatusEmoji(status) {
  const emojis = {
    'pending': '🟡',
    'waiting_confirmation': '🟠',
    'confirmed': '🟢',
    'completed': '✅',
    'cancelled': '🔴',
    'no_show': '⚫'
  };
  return emojis[status] || '⚪';
}

function getStatusText(status) {
  const texts = {
    'pending': 'Ожидает подтверждения',
    'waiting_confirmation': 'Ожидает подтверждения прихода',
    'confirmed': 'Подтверждено',
    'completed': 'Завершено',
    'cancelled': 'Отменено',
    'no_show': 'Не пришёл'
  };
  return texts[status] || status;
}

// ============================================
// TELEGRAM BOT COMMANDS
// ============================================

if (bot) {
  bot.onText(/\/start|\/help/, (msg) => {
    const chatId = msg.chat.id;
    
    const helpMessage = `
🤖 <b>Не Усложняй | Система лояльности</b>

<i>твой любимый хука спот • Брянск</i>

<b>📋 Что здесь можно делать:</b>

/app — Открыть mini app лояльности
/help — Эта справка

<b>Для команды доступны служебные команды:</b>

/today — Брони на сегодня
/tomorrow — Брони на завтра
/stats — Статистика за день
/awaiting — Ожидают подтверждения прихода
/table [номер] — Брони по конкретному столу

<b>🔔 Автоматические уведомления:</b>

• 🎉 Новая бронь создана
• ⚠️ Требуется подтверждение прихода (15 мин)
• ⚫ Автоотмена (no-show)
• ✅ Бронь завершена

Используйте кнопки для быстрых действий!
    `.trim();
    
    bot.sendMessage(chatId, helpMessage, { parse_mode: 'HTML' });
  });
  
  bot.onText(/\/today/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
      const now = new Date();
      const mskOffset = 3 * 60;
      const nowMSK = new Date(now.getTime() + mskOffset * 60 * 1000);
      const today = nowMSK.toISOString().split('T')[0];
      
      const result = await pool.query(`
        SELECT 
          b.*,
          t.table_number,
          t.capacity,
          h.name as hall_name
        FROM bookings b
        JOIN tables t ON b.table_id = t.id
        JOIN halls h ON t.hall_id = h.id
        WHERE b.booking_date = $1
          AND b.status IN ('pending', 'waiting_confirmation', 'confirmed')
        ORDER BY b.start_time
      `, [today]);
      
      if (result.rows.length === 0) {
        bot.sendMessage(chatId, '📅 На сегодня нет активных бронирований.');
        return;
      }
      
      let message = `<b>📅 Брони на сегодня (${new Date(today).toLocaleDateString('ru-RU')})</b>\n\n`;
      
      result.rows.forEach((booking, index) => {
        const statusEmoji = getStatusEmoji(booking.status);
        const endTime = booking.end_time ? booking.end_time.substring(0, 5) : 'По факту';
        
        message += `${index + 1}. ${statusEmoji} <b>Бронь #${booking.id}</b>\n`;
        message += `   ⏰ ${booking.start_time.substring(0, 5)} - ${endTime}\n`;
        message += `   🪑 Стол ${booking.table_number} (${booking.hall_name})\n`;
        message += `   👤 ${booking.customer_name}\n`;
        message += `   📞 ${booking.customer_phone}\n`;
        message += `   👥 ${booking.guests_count} гост${booking.guests_count === 1 ? 'ь' : booking.guests_count < 5 ? 'я' : 'ей'}\n\n`;
      });
      
      bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
      
    } catch (error) {
      console.error('❌ Ошибка /today:', error);
      bot.sendMessage(chatId, '❌ Ошибка загрузки данных');
    }
  });
  
  bot.onText(/\/tomorrow/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
      const now = new Date();
      const mskOffset = 3 * 60;
      const nowMSK = new Date(now.getTime() + mskOffset * 60 * 1000);
      const tomorrow = new Date(nowMSK.getTime() + 24 * 60 * 60 * 1000);
      const tomorrowDate = tomorrow.toISOString().split('T')[0];
      
      const result = await pool.query(`
        SELECT 
          b.*,
          t.table_number,
          t.capacity,
          h.name as hall_name
        FROM bookings b
        JOIN tables t ON b.table_id = t.id
        JOIN halls h ON t.hall_id = h.id
        WHERE b.booking_date = $1
          AND b.status IN ('pending', 'waiting_confirmation', 'confirmed')
        ORDER BY b.start_time
      `, [tomorrowDate]);
      
      if (result.rows.length === 0) {
        bot.sendMessage(chatId, '📅 На завтра нет бронирований.');
        return;
      }
      
      let message = `<b>📅 Брони на завтра (${new Date(tomorrowDate).toLocaleDateString('ru-RU')})</b>\n\n`;
      
      result.rows.forEach((booking, index) => {
        const statusEmoji = getStatusEmoji(booking.status);
        const endTime = booking.end_time ? booking.end_time.substring(0, 5) : 'По факту';
        
        message += `${index + 1}. ${statusEmoji} <b>Бронь #${booking.id}</b>\n`;
        message += `   ⏰ ${booking.start_time.substring(0, 5)} - ${endTime}\n`;
        message += `   🪑 Стол ${booking.table_number} (${booking.hall_name})\n`;
        message += `   👤 ${booking.customer_name}\n`;
        message += `   📞 ${booking.customer_phone}\n`;
        message += `   👥 ${booking.guests_count} гост${booking.guests_count === 1 ? 'ь' : booking.guests_count < 5 ? 'я' : 'ей'}\n\n`;
      });
      
      bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
      
    } catch (error) {
      console.error('❌ Ошибка /tomorrow:', error);
      bot.sendMessage(chatId, '❌ Ошибка загрузки данных');
    }
  });
  
  bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
      const now = new Date();
      const mskOffset = 3 * 60;
      const nowMSK = new Date(now.getTime() + mskOffset * 60 * 1000);
      const today = nowMSK.toISOString().split('T')[0];
      
      const result = await pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
          COUNT(CASE WHEN status = 'waiting_confirmation' THEN 1 END) as waiting,
          COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled,
          COUNT(CASE WHEN status = 'no_show' THEN 1 END) as no_show,
          SUM(guests_count) as total_guests
        FROM bookings
        WHERE booking_date = $1
      `, [today]);
      
      const stats = result.rows[0];
      const successfulBookings = parseInt(stats.confirmed) + parseInt(stats.completed);
      
      const message = `
<b>📊 Статистика за сегодня</b>
<b>(${new Date(today).toLocaleDateString('ru-RU')})</b>

📈 <b>Всего бронирований:</b> ${stats.total}
✅ <b>Успешных:</b> ${successfulBookings} (${stats.confirmed} активных + ${stats.completed} завершённых)
🟡 <b>Ожидает:</b> ${stats.pending}
🟠 <b>Требуют подтверждения:</b> ${stats.waiting}
🔴 <b>Отменено:</b> ${stats.cancelled}
⚫ <b>No-show:</b> ${stats.no_show}

👥 <b>Всего гостей:</b> ${stats.total_guests || 0}
      `.trim();
      
      bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
      
    } catch (error) {
      console.error('❌ Ошибка /stats:', error);
      bot.sendMessage(chatId, '❌ Ошибка загрузки статистики');
    }
  });
  
  bot.onText(/\/awaiting/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
      const now = new Date();
      const mskOffset = 3 * 60;
      const nowMSK = new Date(now.getTime() + mskOffset * 60 * 1000);
      const currentDateTimeMSK = nowMSK.toISOString().replace('T', ' ').substring(0, 19);
      
      const result = await pool.query(`
        SELECT 
          b.*,
          t.table_number,
          t.capacity,
          h.name as hall_name,
          EXTRACT(EPOCH FROM (b.confirmation_deadline - $1::TIMESTAMP)) as seconds_remaining
        FROM bookings b
        JOIN tables t ON b.table_id = t.id
        JOIN halls h ON t.hall_id = h.id
        WHERE b.status = 'waiting_confirmation'
          AND b.confirmation_deadline > $1::TIMESTAMP
        ORDER BY b.confirmation_deadline ASC
      `, [currentDateTimeMSK]);
      
      if (result.rows.length === 0) {
        bot.sendMessage(chatId, '✅ Нет броней, ожидающих подтверждения.');
        return;
      }
      
      let message = `<b>⚠️ Ожидают подтверждения прихода: ${result.rows.length}</b>\n\n`;
      
      result.rows.forEach((booking, index) => {
        const minutes = Math.floor(booking.seconds_remaining / 60);
        const seconds = Math.floor(booking.seconds_remaining % 60);
        
        message += `${index + 1}. <b>Бронь #${booking.id}</b>\n`;
        message += `   ⏰ ${booking.start_time.substring(0, 5)} | 🪑 Стол ${booking.table_number}\n`;
        message += `   👤 ${booking.customer_name}\n`;
        message += `   📞 ${booking.customer_phone}\n`;
        message += `   ⏱️ Осталось: <b>${minutes}:${String(seconds).padStart(2, '0')}</b>\n\n`;
      });
      
      bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
      
    } catch (error) {
      console.error('❌ Ошибка /awaiting:', error);
      bot.sendMessage(chatId, '❌ Ошибка загрузки данных');
    }
  });
  
  bot.onText(/\/table(?:\s+(\d+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const tableNumber = match[1];
    
    if (!tableNumber) {
      bot.sendMessage(chatId, '📝 Укажите номер стола: /table 6');
      return;
    }
    
    try {
      const now = new Date();
      const mskOffset = 3 * 60;
      const nowMSK = new Date(now.getTime() + mskOffset * 60 * 1000);
      const today = nowMSK.toISOString().split('T')[0];
      
      const result = await pool.query(`
        SELECT 
          b.*,
          t.table_number,
          t.capacity,
          h.name as hall_name
        FROM bookings b
        JOIN tables t ON b.table_id = t.id
        JOIN halls h ON t.hall_id = h.id
        WHERE t.table_number = $1
          AND b.booking_date >= $2
          AND b.status IN ('pending', 'waiting_confirmation', 'confirmed')
        ORDER BY b.booking_date, b.start_time
        LIMIT 10
      `, [tableNumber, today]);
      
      if (result.rows.length === 0) {
        bot.sendMessage(chatId, `🪑 На столе ${tableNumber} нет активных бронирований.`);
        return;
      }
      
      let message = `<b>🪑 Брони на столе ${tableNumber}</b>\n\n`;
      
      result.rows.forEach((booking, index) => {
        const statusEmoji = getStatusEmoji(booking.status);
        const endTime = booking.end_time ? booking.end_time.substring(0, 5) : 'По факту';
        const date = new Date(booking.booking_date).toLocaleDateString('ru-RU');
        
        message += `${index + 1}. ${statusEmoji} <b>Бронь #${booking.id}</b>\n`;
        message += `   📅 ${date}\n`;
        message += `   ⏰ ${booking.start_time.substring(0, 5)} - ${endTime}\n`;
        message += `   👤 ${booking.customer_name}\n`;
        message += `   📞 ${booking.customer_phone}\n\n`;
      });
      
      bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
      
    } catch (error) {
      console.error('❌ Ошибка /table:', error);
      bot.sendMessage(chatId, '❌ Ошибка загрузки данных');
    }
  });
  
  bot.onText(/\/app/, (msg) => {
    const chatId = msg.chat.id;
    
    bot.sendMessage(chatId, 
      '📱 <b>Панель управления</b>\n\n' +
      `Временный адрес Mini App:\n${MINI_APP_URL}\n\n` +
      'Нажмите кнопку меню (≡) внизу слева для открытия Mini App.',
      { parse_mode: 'HTML' }
    );
  });
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;
    
    try {
      const parts = data.split('_');
      const action = parts[0];
      const bookingId = parts[1];
      
      if (action === 'confirm') {
        const result = await pool.query(`
          UPDATE bookings
          SET 
            status = 'confirmed',
            arrival_confirmed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING *
        `, [bookingId]);
        
        if (result.rows.length > 0) {
          bot.answerCallbackQuery(query.id, { text: '✅ Бронь подтверждена!' });
          bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
            chat_id: chatId,
            message_id: messageId
          });
          bot.sendMessage(chatId, `✅ <b>Бронь #${bookingId} подтверждена!</b>`, { parse_mode: 'HTML' });
        }
        
      } else if (action === 'cancel') {
        const result = await pool.query(`
          UPDATE bookings
          SET 
            status = 'cancelled',
            cancellation_reason = 'Отменено администратором через Telegram',
            cancelled_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING *
        `, [bookingId]);
        
        if (result.rows.length > 0) {
          bot.answerCallbackQuery(query.id, { text: '❌ Бронь отменена' });
          bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
            chat_id: chatId,
            message_id: messageId
          });
          bot.sendMessage(chatId, `❌ <b>Бронь #${bookingId} отменена</b>`, { parse_mode: 'HTML' });
        }
        
      } else if (action === 'noshow') {
        const result = await pool.query(`
          UPDATE bookings
          SET 
            status = 'cancelled',
            cancellation_reason = 'Гость не пришёл (no-show)',
            no_show_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING *
        `, [bookingId]);
        
        if (result.rows.length > 0) {
          bot.answerCallbackQuery(query.id, { text: '⚫ Отмечено как no-show' });
          bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
            chat_id: chatId,
            message_id: messageId
          });
          bot.sendMessage(chatId, `⚫ <b>Бронь #${bookingId} отмечена как no-show</b>`, { parse_mode: 'HTML' });
        }
        
      } else if (action === 'arrived') {
        const result = await pool.query(`
          UPDATE bookings
          SET 
            status = 'confirmed',
            arrival_confirmed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING *
        `, [bookingId]);
        
        if (result.rows.length > 0) {
          bot.answerCallbackQuery(query.id, { text: '✅ Приход подтверждён!' });
          bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
            chat_id: chatId,
            message_id: messageId
          });
          bot.sendMessage(chatId, `✅ <b>Приход гостя подтверждён</b> (Бронь #${bookingId})`, { parse_mode: 'HTML' });
        }
        
      } else if (action === 'stillsitting') {
        // Обработка кнопки "Столик сидит" для "По факту"
        const result = await pool.query(`
          UPDATE bookings
          SET 
            reminder_response = 'still_sitting',
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING *
        `, [bookingId]);
        
        if (result.rows.length > 0) {
          bot.answerCallbackQuery(query.id, { text: '🪑 Понял, автозавершение через 6 часов' });
          bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
            chat_id: chatId,
            message_id: messageId
          });
          bot.sendMessage(chatId, 
            `✅ <b>Бронь #${bookingId}</b>\n\n` +
            `🪑 Столик продолжает сидеть\n` +
            `⏰ Автозавершение через 6 часов от начала брони`,
            { parse_mode: 'HTML' }
          );
        }
        
      } else if (action === 'complete') {
        // Обработка кнопки "Завершить бронь"
        const now = new Date();
        const mskOffset = 3 * 60;
        const nowMSK = new Date(now.getTime() + mskOffset * 60 * 1000);
        const currentTimeMSK = `${String(nowMSK.getUTCHours()).padStart(2, '0')}:${String(nowMSK.getUTCMinutes()).padStart(2, '0')}`;
        
        const result = await pool.query(`
          UPDATE bookings
          SET 
            status = 'completed',
            actual_end_time = $1::TIME,
            completed_at = CURRENT_TIMESTAMP,
            completed_reason = 'manual',
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
          RETURNING *, 
            (SELECT table_number FROM tables WHERE id = bookings.table_id) as table_number
        `, [currentTimeMSK, bookingId]);
        
        if (result.rows.length > 0) {
          const booking = result.rows[0];
          const startTime = booking.start_time.substring(0, 5);
          const endTime = booking.actual_end_time.substring(0, 5);
          
          // Вычисление длительности
          const [startH, startM] = startTime.split(':').map(Number);
          const [endH, endM] = endTime.split(':').map(Number);
          const durationMinutes = (endH * 60 + endM) - (startH * 60 + startM);
          const hours = Math.floor(durationMinutes / 60);
          const minutes = durationMinutes % 60;
          
          bot.answerCallbackQuery(query.id, { text: '✅ Бронь завершена!' });
          bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
            chat_id: chatId,
            message_id: messageId
          });
          
          const completionMessage = `
✅ <b>Бронь #${bookingId} завершена</b>

📅 ${new Date(booking.booking_date).toLocaleDateString('ru-RU')}
⏰ ${startTime} - ${endTime}
⏱️ Длительность: ${hours}ч ${minutes}мин
🪑 Стол ${booking.table_number}
👤 ${booking.customer_name}

Стол освобождён
          `.trim();
          
          bot.sendMessage(chatId, completionMessage, { parse_mode: 'HTML' });
          
          // Логирование в историю
          await pool.query(`
            INSERT INTO booking_history (booking_id, action, details, created_at)
            VALUES ($1, 'completed', $2, CURRENT_TIMESTAMP)
          `, [bookingId, `Завершено вручную через Telegram. Длительность: ${hours}ч ${minutes}мин`]);
        }
      }
      
    } catch (error) {
      console.error('❌ Ошибка обработки callback:', error);
      bot.answerCallbackQuery(query.id, { text: '❌ Ошибка обработки' });
    }
  });
}

// ============================================
// АВТОИНИЦИАЛИЗАЦИЯ БД ПРИ СТАРТЕ
// ============================================

pool.connect(async (err, client, release) => {
  if (err) {
    console.error('❌ Ошибка подключения к БД:', err.stack);
    return;
  }
  
  console.log('✅ БД подключена');
  
  try {
    // ============================================
    // 1. ОБНОВЛЕНИЕ CONSTRAINT ДЛЯ СТАТУСОВ (+ completed)
    // ============================================
    try {
      console.log('🔧 Обновление constraint для статусов бронирований...');
      
      await client.query(`
        ALTER TABLE bookings 
        DROP CONSTRAINT IF EXISTS bookings_status_check
      `);
      
      console.log('  ✅ Старый constraint удалён');
      
      await client.query(`
        ALTER TABLE bookings 
        ADD CONSTRAINT bookings_status_check 
        CHECK (status::text = ANY (ARRAY[
          'pending'::text, 
          'waiting_confirmation'::text, 
          'confirmed'::text, 
          'completed'::text,
          'cancelled'::text, 
          'no_show'::text
        ]))
      `);
      
      console.log('  ✅ Новый constraint создан (6 статусов: + completed)');
      
    } catch (constraintError) {
      console.warn('⚠️ Ошибка обновления constraint:', constraintError.message);
    }
    
    // ============================================
    // 2. ДОБАВЛЕНИЕ ПОЛЕЙ ДЛЯ ПОДТВЕРЖДЕНИЯ ПРИХОДА
    // ============================================
    try {
      console.log('🔧 Добавление полей для подтверждения прихода...');
      
      await client.query(`
        ALTER TABLE bookings 
        ADD COLUMN IF NOT EXISTS arrival_confirmed_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS confirmation_deadline TIMESTAMP,
        ADD COLUMN IF NOT EXISTS no_show_at TIMESTAMP
      `);
      
      console.log('✅ Поля для подтверждения добавлены');
    } catch (alterError) {
      console.warn('⚠️ Ошибка миграции:', alterError.message);
    }
    
    // ============================================
    // 3. ДОБАВЛЕНИЕ НОВЫХ ПОЛЕЙ ДЛЯ COMPLETED
    // ============================================
    try {
      console.log('🔧 Добавление полей для завершения броней...');
      
      await client.query(`
        ALTER TABLE bookings 
        ADD COLUMN IF NOT EXISTS actual_end_time TIME,
        ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS completed_reason VARCHAR(50),
        ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS reminder_response VARCHAR(20),
        ADD COLUMN IF NOT EXISTS reminder_message_id INTEGER,
        ADD COLUMN IF NOT EXISTS second_reminder_sent_at TIMESTAMP
      `);
      
      console.log('✅ Поля для завершения броней добавлены:');
      console.log('   - actual_end_time (фактическое время ухода)');
      console.log('   - completed_at (timestamp завершения)');
      console.log('   - completed_reason (причина завершения)');
      console.log('   - reminder_sent_at (время первого напоминания)');
      console.log('   - reminder_response (ответ на напоминание)');
      console.log('   - reminder_message_id (ID сообщения Telegram)');
      console.log('   - second_reminder_sent_at (время второго напоминания)');
      
    } catch (alterError) {
      console.warn('⚠️ Ошибка добавления полей:', alterError.message);
    }

    // ============================================
    // 3.2. СОВМЕСТИМОСТЬ СО СТАРОЙ СХЕМОЙ BOOKINGS
    // ============================================
    try {
      console.log('🔧 Приведение bookings к новой схеме времени...');
      
      await client.query(`
        ALTER TABLE bookings
        ADD COLUMN IF NOT EXISTS start_time TIME,
        ADD COLUMN IF NOT EXISTS end_time TIME
      `);

      await client.query(`
        UPDATE bookings
        SET start_time = booking_time
        WHERE start_time IS NULL
          AND booking_time IS NOT NULL
      `);

      await client.query(`
        UPDATE bookings
        SET end_time = (booking_time + (COALESCE(duration, 120) || ' minutes')::INTERVAL)::TIME
        WHERE end_time IS NULL
          AND booking_time IS NOT NULL
      `);

      console.log('✅ Поля start_time и end_time готовы');
    } catch (timeSchemaError) {
      console.warn('⚠️ Ошибка приведения схемы bookings:', timeSchemaError.message);
    }

    // ============================================
    // 3.5. МЕТАДАННЫЕ СТОЛОВ ДЛЯ КАРТЫ И ГОСТЕВОЙ ВЕРСИИ
    // ============================================
    try {
      console.log('🔧 Добавление метаданных столов...');
      
      await client.query(`
        ALTER TABLE tables
        ADD COLUMN IF NOT EXISTS public_label VARCHAR(100),
        ADD COLUMN IF NOT EXISTS furniture_description TEXT,
        ADD COLUMN IF NOT EXISTS features TEXT,
        ADD COLUMN IF NOT EXISTS has_playstation BOOLEAN DEFAULT false
      `);
      
      console.log('✅ Метаданные столов добавлены');
    } catch (tableMetaError) {
      console.warn('⚠️ Ошибка добавления метаданных столов:', tableMetaError.message);
    }
    
    // ============================================
    // 4. СОЗДАНИЕ ТАБЛИЦЫ ИСТОРИИ ДЕЙСТВИЙ
    // ============================================
    try {
      console.log('🔧 Создание таблицы истории действий...');
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS booking_history (
          id SERIAL PRIMARY KEY,
          booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
          action VARCHAR(50) NOT NULL,
          details TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      console.log('✅ Таблица booking_history создана');
      
      // Индекс для быстрого поиска по booking_id
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_booking_history_booking_id 
        ON booking_history(booking_id)
      `);
      
      console.log('✅ Индекс для booking_history создан');
      
    } catch (historyError) {
      console.warn('⚠️ Ошибка создания таблицы истории:', historyError.message);
    }
    
    // ============================================
    // 5. ПРОВЕРКА ТИПА table_number
    // ============================================
    try {
      await client.query(`
        ALTER TABLE tables 
        ALTER COLUMN table_number TYPE INTEGER 
        USING table_number::INTEGER
      `);
      console.log('✅ Тип table_number: INTEGER');
    } catch (typeError) {
      if (typeError.message.includes('type integer')) {
        console.log('ℹ️ table_number уже INTEGER');
      }
    }
    
    // ============================================
    // 5.5. РАЗРЕШЕНИЕ NULL ДЛЯ END_TIME (НОВОЕ!)
    // ============================================
    try {
      console.log('🔧 Изменение constraint для end_time (разрешение NULL)...');
      
      await client.query(`
        ALTER TABLE bookings 
        ALTER COLUMN end_time DROP NOT NULL
      `);
      
      console.log('✅ Колонка end_time теперь может быть NULL (для "По факту")');
      
    } catch (endTimeError) {
      console.warn('⚠️ Ошибка изменения end_time:', endTimeError.message);
    }
    
    // ============================================
    // 6. ПРОВЕРКА И ИНИЦИАЛИЗАЦИЯ СТОЛОВ
    // ============================================
    await client.query(`
      INSERT INTO halls (id, name, description, capacity)
      VALUES (1, 'Общий зал', 'Общий зал hookah spot "Не Усложняй" в Брянске', 24)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        capacity = EXCLUDED.capacity,
        is_active = true
    `);
    
    await client.query(`
      DELETE FROM working_hours;

      INSERT INTO working_hours (day_of_week, open_time, close_time, is_working, time_slot_duration) VALUES
      (0, '14:00', '02:00', true, 30),
      (1, '14:00', '02:00', true, 30),
      (2, '14:00', '02:00', true, 30),
      (3, '14:00', '02:00', true, 30),
      (4, '14:00', '02:00', true, 30),
      (5, '14:00', '03:00', true, 30),
      (6, '14:00', '03:00', true, 30)
    `);
    
    const countResult = await client.query('SELECT COUNT(*) FROM tables');
    const tableCount = parseInt(countResult.rows[0].count);
    
    console.log(`🪑 Столов в БД: ${tableCount}`);
    
    if (tableCount !== 7) {
      console.log('🔄 Запуск автоинициализации столов для "Не Усложняй"...');
      
      await client.query('DELETE FROM bookings');
      await client.query('DELETE FROM tables');
      await client.query('DELETE FROM halls WHERE id <> 1');
      
      console.log('🗑️ Старые данные удалены');
      
      await client.query(`
        INSERT INTO tables (
          table_number, hall_id, public_label, capacity, min_capacity, furniture_description,
          features, has_playstation, position_x, position_y, width, height, shape, is_active
        ) VALUES
        (1, 1, 'Трехместный стол', 3, 1, 'Двухместный диван и кресло', 'Уютная смешанная посадка', false, 90, 165, 120, 90, 'sofa-mixed', true),
        (2, 1, 'Трехместный стол с PlayStation', 3, 1, 'Трехместный диван', 'PlayStation', true, 95, 315, 140, 90, 'sofa-ps', true),
        (3, 1, 'Четырехместный стол', 4, 2, 'Два двухместных дивана', 'Подходит для компании', false, 335, 325, 165, 90, 'sofa-double', true),
        (4, 1, 'Четырехместный стол', 4, 2, 'Два двухместных дивана', 'Подходит для компании', false, 565, 325, 165, 90, 'sofa-double', true),
        (5, 1, 'Двухместный стол', 2, 1, 'Два кресла', 'Компактная посадка', false, 880, 330, 95, 95, 'chairs', true),
        (6, 1, 'Четырехместный стол', 4, 2, 'Два двухместных дивана', 'Спокойная зона у стены', false, 855, 165, 165, 90, 'sofa-double', true),
        (7, 1, 'Четырехместный стол', 4, 2, 'Два двухместных дивана', 'Зона рядом с баром', false, 660, 165, 165, 90, 'sofa-double', true)
      `);
      
      console.log('✅ Все 7 столов добавлены!');
    }
    
    release();
    
    console.log('');
    console.log('==================================================');
    console.log('✅ ИНИЦИАЛИЗАЦИЯ БД ЗАВЕРШЕНА');
    console.log('==================================================');
    console.log('');
    
  } catch (error) {
    console.error('❌ Ошибка инициализации:', error);
    release();
  }
});

// ============================================
// АВТОПРОВЕРКА БРОНЕЙ (каждые 5 минут)
// ============================================

setInterval(async () => {
  await checkBookingsAutomation();
}, 5 * 60 * 1000); // 5 минут

async function checkBookingsAutomation() {
  try {
    const now = new Date();
    const mskOffset = 3 * 60;
    const nowMSK = new Date(now.getTime() + mskOffset * 60 * 1000);
    
    const currentDateTimeMSK = nowMSK.toISOString().replace('T', ' ').substring(0, 19);
    const currentTimeMSK = `${String(nowMSK.getUTCHours()).padStart(2, '0')}:${String(nowMSK.getUTCMinutes()).padStart(2, '0')}`;
    
    // ============================================
    // 1. ПЕРЕВОД В ОЖИДАНИЕ ПОДТВЕРЖДЕНИЯ (15 МИН)
    // ============================================
    const toConfirmResult = await pool.query(`
      UPDATE bookings
      SET 
        status = 'waiting_confirmation',
        confirmation_deadline = (booking_date || ' ' || start_time)::TIMESTAMP + INTERVAL '15 minutes',
        updated_at = CURRENT_TIMESTAMP
      WHERE status = 'pending'
        AND (booking_date || ' ' || start_time)::TIMESTAMP <= $1::TIMESTAMP
      RETURNING id, table_id, customer_name, customer_phone, start_time, booking_date, guests_count
    `, [currentDateTimeMSK]);
    
    if (toConfirmResult.rows.length > 0) {
      console.log(`⏰ Переведено в ожидание подтверждения: ${toConfirmResult.rows.length} броней`);
      
      for (const booking of toConfirmResult.rows) {
        console.log(`   - Бронь #${booking.id} (Стол ${booking.table_id}, ${booking.customer_name}, ${booking.start_time})`);
        
        // Логирование в историю
        await pool.query(`
          INSERT INTO booking_history (booking_id, action, details, created_at)
          VALUES ($1, 'waiting_confirmation', 'Переведено в ожидание подтверждения прихода (15 минут)', CURRENT_TIMESTAMP)
        `, [booking.id]);
        
        if (bot && GROUP_CHAT_ID) {
          const tableResult = await pool.query(`
            SELECT t.table_number, h.name as hall_name
            FROM tables t
            JOIN halls h ON t.hall_id = h.id
            WHERE t.id = $1
          `, [booking.table_id]);
          
          if (tableResult.rows.length > 0) {
            const table = tableResult.rows[0];
            
            const message = `
⚠️ <b>ТРЕБУЕТСЯ ПОДТВЕРЖДЕНИЕ ПРИХОДА!</b>

<b>Бронь #${booking.id}</b>
📅 ${new Date(booking.booking_date).toLocaleDateString('ru-RU')}
⏰ ${booking.start_time.substring(0, 5)}
🪑 Стол ${table.table_number} (${table.hall_name})
👤 ${booking.customer_name}
📞 ${booking.customer_phone}
👥 ${booking.guests_count} гост${booking.guests_count === 1 ? 'ь' : booking.guests_count < 5 ? 'я' : 'ей'}

⏱️ <b>15 минут на подтверждение!</b>
            `.trim();
            
            await bot.sendMessage(GROUP_CHAT_ID, message, {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [[
                  { text: '✅ Гость пришёл', callback_data: `arrived_${booking.id}` },
                  { text: '❌ Не пришёл', callback_data: `noshow_${booking.id}` }
                ]]
              }
            });
          }
        }
      }
    }
    
    // ============================================
    // 2. АВТООТМЕНА NO-SHOW (15 МИНУТ ИСТЕКЛО)
    // ============================================
    const noShowResult = await pool.query(`
      UPDATE bookings
      SET 
        status = 'cancelled',
        no_show_at = CURRENT_TIMESTAMP,
        cancellation_reason = 'Гость не пришёл в течение 15 минут',
        updated_at = CURRENT_TIMESTAMP
      WHERE status = 'waiting_confirmation'
        AND confirmation_deadline < $1::TIMESTAMP
      RETURNING id, table_id, customer_name, start_time
    `, [currentDateTimeMSK]);
    
    if (noShowResult.rows.length > 0) {
      console.log(`🚫 Автоотмена ${noShowResult.rows.length} броней (no-show):`);
      noShowResult.rows.forEach(b => {
        console.log(`   - Бронь #${b.id} (Стол ${b.table_id}, ${b.customer_name}, ${b.start_time})`);
      });
      
      // Логирование в историю
      for (const booking of noShowResult.rows) {
        await pool.query(`
          INSERT INTO booking_history (booking_id, action, details, created_at)
          VALUES ($1, 'no_show', 'Автоотмена: гость не пришёл в течение 15 минут', CURRENT_TIMESTAMP)
        `, [booking.id]);
      }
      
      if (bot && GROUP_CHAT_ID && noShowResult.rows.length > 0) {
        const message = `⚫ <b>Автоотмена ${noShowResult.rows.length} брон${noShowResult.rows.length === 1 ? 'и' : 'ей'} (no-show)</b>\n\n` +
          noShowResult.rows.map(b => `• Бронь #${b.id} - ${b.customer_name}`).join('\n');
        
        await sendTelegramNotification(message);
      }
    }
    
    // ============================================
    // 3. АВТОЗАВЕРШЕНИЕ ОБЫЧНЫХ БРОНЕЙ (END_TIME ИСТЁК)
    // ============================================
    const autoCompleteResult = await pool.query(`
      UPDATE bookings
      SET 
        status = 'completed',
        actual_end_time = end_time,
        completed_at = CURRENT_TIMESTAMP,
        completed_reason = 'auto_time_expired',
        updated_at = CURRENT_TIMESTAMP
      WHERE status = 'confirmed'
        AND end_time IS NOT NULL
        AND booking_date = $1
        AND end_time < $2::TIME
      RETURNING id, table_id, customer_name, start_time, end_time, booking_date
    `, [nowMSK.toISOString().split('T')[0], currentTimeMSK]);
    
    if (autoCompleteResult.rows.length > 0) {
      console.log(`✅ Автозавершено ${autoCompleteResult.rows.length} броней (время истекло):`);
      
      for (const booking of autoCompleteResult.rows) {
        console.log(`   - Бронь #${booking.id} (${booking.start_time} - ${booking.end_time})`);
        
        // Логирование в историю
        await pool.query(`
          INSERT INTO booking_history (booking_id, action, details, created_at)
          VALUES ($1, 'completed', 'Автозавершение: время брони истекло', CURRENT_TIMESTAMP)
        `, [booking.id]);
        
        // Уведомление в Telegram
        if (bot && GROUP_CHAT_ID) {
          const tableResult = await pool.query(`
            SELECT t.table_number, h.name as hall_name
            FROM tables t
            JOIN halls h ON t.hall_id = h.id
            WHERE t.id = $1
          `, [booking.table_id]);
          
          if (tableResult.rows.length > 0) {
            const table = tableResult.rows[0];
            
            const message = `
✅ <b>Бронь #${booking.id} автоматически завершена</b>

📅 ${new Date(booking.booking_date).toLocaleDateString('ru-RU')}
⏰ ${booking.start_time.substring(0, 5)} - ${booking.end_time.substring(0, 5)}
🪑 Стол ${table.table_number} (${table.hall_name})
👤 ${booking.customer_name}

Стол освобождён (время истекло)
            `.trim();
            
            await sendTelegramNotification(message);
          }
        }
      }
    }
    
    // ============================================
    // 4. ПЕРВОЕ НАПОМИНАНИЕ "ПО ФАКТУ" (ЧЕРЕЗ 2 ЧАСА)
    // ============================================
    const reminderResult = await pool.query(`
      SELECT 
        b.*,
        t.table_number,
        h.name as hall_name
      FROM bookings b
      JOIN tables t ON b.table_id = t.id
      JOIN halls h ON t.hall_id = h.id
      WHERE b.status = 'confirmed'
        AND b.end_time IS NULL
        AND b.reminder_sent_at IS NULL
        AND b.booking_date = $1
        AND (b.booking_date || ' ' || b.start_time)::TIMESTAMP + INTERVAL '2 hours' <= $2::TIMESTAMP
    `, [nowMSK.toISOString().split('T')[0], currentDateTimeMSK]);
    
    if (reminderResult.rows.length > 0) {
      console.log(`⏰ Отправка первых напоминаний "По факту": ${reminderResult.rows.length}`);
      
      for (const booking of reminderResult.rows) {
        const message = `
⚠️ <b>НАПОМИНАНИЕ: Бронь #${booking.id}</b>

📅 ${new Date(booking.booking_date).toLocaleDateString('ru-RU')}
⏰ ${booking.start_time.substring(0, 5)} - По факту
🪑 Стол ${booking.table_number} (${booking.hall_name})
👤 ${booking.customer_name}
📞 ${booking.customer_phone}

🕐 Гости сидят уже 2 часа

Гости всё ещё сидят?
        `.trim();
        
        if (bot && GROUP_CHAT_ID) {
          const sentMessage = await bot.sendMessage(GROUP_CHAT_ID, message, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[
                { text: '🪑 Столик сидит', callback_data: `stillsitting_${booking.id}` },
                { text: '✅ Завершить бронь', callback_data: `complete_${booking.id}` }
              ]]
            }
          });
          
          // Сохранение ID сообщения и времени отправки
          await pool.query(`
            UPDATE bookings
            SET 
              reminder_sent_at = CURRENT_TIMESTAMP,
              reminder_message_id = $1,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
          `, [sentMessage.message_id, booking.id]);
          
          // Логирование
          await pool.query(`
            INSERT INTO booking_history (booking_id, action, details, created_at)
            VALUES ($1, 'reminder_sent', 'Отправлено первое напоминание (2 часа)', CURRENT_TIMESTAMP)
          `, [booking.id]);
          
          console.log(`   - Напоминание отправлено для брони #${booking.id}`);
        }
      }
    }
    
    // ============================================
    // 5. ВТОРОЕ НАПОМИНАНИЕ "ПО ФАКТУ" (ЧЕРЕЗ 4 ЧАСА)
    // ============================================
    const secondReminderResult = await pool.query(`
      SELECT 
        b.*,
        t.table_number,
        h.name as hall_name
      FROM bookings b
      JOIN tables t ON b.table_id = t.id
      JOIN halls h ON t.hall_id = h.id
      WHERE b.status = 'confirmed'
        AND b.end_time IS NULL
        AND b.reminder_sent_at IS NOT NULL
        AND b.second_reminder_sent_at IS NULL
        AND b.reminder_response = 'still_sitting'
        AND b.booking_date = $1
        AND (b.booking_date || ' ' || b.start_time)::TIMESTAMP + INTERVAL '4 hours' <= $2::TIMESTAMP
    `, [nowMSK.toISOString().split('T')[0], currentDateTimeMSK]);
    
    if (secondReminderResult.rows.length > 0) {
      console.log(`⏰ Отправка вторых напоминаний "По факту": ${secondReminderResult.rows.length}`);
      
      for (const booking of secondReminderResult.rows) {
        const message = `
⚠️ <b>ПОВТОРНОЕ НАПОМИНАНИЕ: Бронь #${booking.id}</b>

📅 ${new Date(booking.booking_date).toLocaleDateString('ru-RU')}
⏰ ${booking.start_time.substring(0, 5)} - По факту
🪑 Стол ${booking.table_number} (${booking.hall_name})
👤 ${booking.customer_name}

🕐 Гости сидят уже 4 часа

⏱️ Автозавершение через 2 часа (в 6 часов от начала)

Завершить бронь сейчас?
        `.trim();
        
        if (bot && GROUP_CHAT_ID) {
          await bot.sendMessage(GROUP_CHAT_ID, message, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ Завершить бронь', callback_data: `complete_${booking.id}` }
              ]]
            }
          });
          
          await pool.query(`
            UPDATE bookings
            SET 
              second_reminder_sent_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
          `, [booking.id]);
          
          await pool.query(`
            INSERT INTO booking_history (booking_id, action, details, created_at)
            VALUES ($1, 'second_reminder_sent', 'Отправлено второе напоминание (4 часа)', CURRENT_TIMESTAMP)
          `, [booking.id]);
          
          console.log(`   - Второе напоминание отправлено для брони #${booking.id}`);
        }
      }
    }
    
    // ============================================
    // 6. АВТОЗАВЕРШЕНИЕ "ПО ФАКТУ" (ЧЕРЕЗ 6 ЧАСОВ)
    // ============================================
    const autoComplete6hResult = await pool.query(`
      UPDATE bookings
      SET 
        status = 'completed',
        actual_end_time = $1::TIME,
        completed_at = CURRENT_TIMESTAMP,
        completed_reason = CASE 
          WHEN reminder_response = 'still_sitting' THEN 'still_sitting_6h'
          WHEN reminder_sent_at IS NOT NULL THEN 'auto_6h_timeout'
          ELSE 'auto_6h_no_reminder'
        END,
        updated_at = CURRENT_TIMESTAMP
      WHERE status = 'confirmed'
        AND end_time IS NULL
        AND booking_date = $2
        AND (booking_date || ' ' || start_time)::TIMESTAMP + INTERVAL '6 hours' <= $3::TIMESTAMP
      RETURNING id, table_id, customer_name, start_time, booking_date, completed_reason
    `, [currentTimeMSK, nowMSK.toISOString().split('T')[0], currentDateTimeMSK]);
    
    if (autoComplete6hResult.rows.length > 0) {
      console.log(`✅ Автозавершено "По факту" ${autoComplete6hResult.rows.length} броней (6 часов):`);
      
      for (const booking of autoComplete6hResult.rows) {
        console.log(`   - Бронь #${booking.id} (причина: ${booking.completed_reason})`);
        
        await pool.query(`
          INSERT INTO booking_history (booking_id, action, details, created_at)
          VALUES ($1, 'completed', $2, CURRENT_TIMESTAMP)
        `, [booking.id, `Автозавершение: 6 часов от начала брони (${booking.completed_reason})`]);
        
        if (bot && GROUP_CHAT_ID) {
          const tableResult = await pool.query(`
            SELECT t.table_number, h.name as hall_name
            FROM tables t
            JOIN halls h ON t.hall_id = h.id
            WHERE t.id = $1
          `, [booking.table_id]);
          
          if (tableResult.rows.length > 0) {
            const table = tableResult.rows[0];
            
            const reasonText = booking.completed_reason === 'still_sitting_6h' 
              ? '(выбрано "Столик сидит")' 
              : booking.completed_reason === 'auto_6h_timeout'
              ? '(напоминание проигнорировано)'
              : '';
            
            const message = `
⚠️ <b>Бронь #${booking.id} автоматически завершена</b>

📅 ${new Date(booking.booking_date).toLocaleDateString('ru-RU')}
⏰ ${booking.start_time.substring(0, 5)} - ${currentTimeMSK}
⏱️ Длительность: 6 часов
🪑 Стол ${table.table_number} (${table.hall_name})
👤 ${booking.customer_name}

Стол освобождён ${reasonText}
            `.trim();
            
            await sendTelegramNotification(message);
          }
        }
      }
    }
    
    // ============================================
    // 7. УВЕДОМЛЕНИЕ О БЛИЗКОМ АВТОЗАВЕРШЕНИИ (ЗА 15 МИН)
    // ============================================
    const preCompleteWarningResult = await pool.query(`
      SELECT 
        b.*,
        t.table_number,
        h.name as hall_name
      FROM bookings b
      JOIN tables t ON b.table_id = t.id
      JOIN halls h ON t.hall_id = h.id
      WHERE b.status = 'confirmed'
        AND b.end_time IS NULL
        AND b.booking_date = $1
        AND (b.booking_date || ' ' || b.start_time)::TIMESTAMP + INTERVAL '5 hours 45 minutes' <= $2::TIMESTAMP
        AND (b.booking_date || ' ' || b.start_time)::TIMESTAMP + INTERVAL '6 hours' > $2::TIMESTAMP
        AND NOT EXISTS (
          SELECT 1 FROM booking_history 
          WHERE booking_id = b.id 
          AND action = 'pre_complete_warning'
        )
    `, [nowMSK.toISOString().split('T')[0], currentDateTimeMSK]);
    
    if (preCompleteWarningResult.rows.length > 0) {
      console.log(`⏰ Отправка предупреждений о близком автозавершении: ${preCompleteWarningResult.rows.length}`);
      
      for (const booking of preCompleteWarningResult.rows) {
        const message = `
⏰ <b>ВНИМАНИЕ: Бронь #${booking.id}</b>

📅 ${new Date(booking.booking_date).toLocaleDateString('ru-RU')}
⏰ ${booking.start_time.substring(0, 5)} - По факту
🪑 Стол ${booking.table_number} (${booking.hall_name})
👤 ${booking.customer_name}

⚠️ <b>Автозавершение через 15 минут!</b>

Завершить сейчас или продлить?
        `.trim();
        
        if (bot && GROUP_CHAT_ID) {
          await bot.sendMessage(GROUP_CHAT_ID, message, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ Завершить сейчас', callback_data: `complete_${booking.id}` }
              ]]
            }
          });
          
          await pool.query(`
            INSERT INTO booking_history (booking_id, action, details, created_at)
            VALUES ($1, 'pre_complete_warning', 'Отправлено предупреждение о близком автозавершении (15 мин)', CURRENT_TIMESTAMP)
          `, [booking.id]);
          
          console.log(`   - Предупреждение отправлено для брони #${booking.id}`);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Ошибка автопроверки броней:', error);
  }
}

// Запуск первой проверки через 10 секунд после старта
setTimeout(checkBookingsAutomation, 10000);
// ============================================
// ГЛАВНАЯ СТРАНИЦА API
// ============================================

app.get('/', (req, res) => {
  res.json({
    message: '🎉 Не Усложняй Booking API',
    status: 'online',
    version: '7.0.0 - Не Усложняй / Guest-ready layout metadata',
    telegram_bot: bot ? '✅ Connected' : '❌ Not configured',
    telegram_mode: process.env.NODE_ENV === 'production' ? 'Webhook' : 'Polling',
    telegram_group: GROUP_CHAT_ID ? '✅ Configured' : '❌ Not configured',
    features: [
      'Telegram Bot (Webhook/Polling)',
      'Group chat support',
      'Inline buttons',
      'Arrival confirmation (15 min)',
      'Auto no-show detection',
      '✨ NEW: Completed status',
      '✨ NEW: Actual end time tracking',
      '✨ NEW: Auto-completion (by end_time)',
      '✨ NEW: "By fact" reminders (2h, 4h)',
      '✨ NEW: Auto-completion after 6h',
      '✨ NEW: Pre-completion warning (15 min)',
      '✨ NEW: Booking history logging',
      'MSK timezone',
      'Analytics & Statistics',
      'Excel export',
      'Full booking edit',
      'Mini App integration',
      'Guest map metadata',
      'Open public table map support'
    ],
    new_statuses: [
      'pending',
      'waiting_confirmation',
      'confirmed',
      '✨ completed (NEW)',
      'cancelled',
      'no_show'
    ],
    new_fields: [
      'actual_end_time',
      'completed_at',
      'completed_reason',
      'reminder_sent_at',
      'reminder_response',
      'reminder_message_id',
      'second_reminder_sent_at'
    ]
  });
});

// ============================================
// API ENDPOINTS
// ============================================

app.get('/api/tables', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        t.*,
        h.name as hall_name
      FROM tables t
      LEFT JOIN halls h ON t.hall_id = h.id
      WHERE t.is_active = true
      ORDER BY t.table_number
    `);
    
    console.log(`✅ Запрос столов: ${result.rows.length} записей`);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Ошибка получения столов:', error);
    res.status(500).json({ error: 'Ошибка получения данных' });
  }
});

app.get('/api/halls', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM halls 
      WHERE is_active = true
      ORDER BY id
    `);
    
    console.log(`✅ Запрос залов: ${result.rows.length} записей`);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Ошибка получения залов:', error);
    res.status(500).json({ error: 'Ошибка получения данных' });
  }
});

app.get('/api/bookings', async (req, res) => {
  try {
    const { date, table_id, status } = req.query;
    
    let query = `
      SELECT 
        b.*,
        t.table_number,
        t.public_label,
        t.capacity,
        t.furniture_description,
        t.features,
        t.has_playstation,
        h.name as hall_name
      FROM bookings b
      JOIN tables t ON b.table_id = t.id
      JOIN halls h ON t.hall_id = h.id
      WHERE 1=1
    `;
    
    const params = [];
    let paramCount = 1;
    
    if (date) {
      query += ` AND b.booking_date = $${paramCount}`;
      params.push(date);
      paramCount++;
    }
    
    if (table_id) {
      query += ` AND b.table_id = $${paramCount}`;
      params.push(table_id);
      paramCount++;
    }
    
    if (status) {
      query += ` AND b.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }
    
    query += ' ORDER BY b.booking_date DESC, b.start_time DESC';
    
    const result = await pool.query(query, params);
    
    console.log(`✅ Получено бронирований: ${result.rows.length}`);
    res.json(result.rows);
    
  } catch (error) {
    console.error('❌ Ошибка получения бронирований:', error);
    res.status(500).json({ error: 'Ошибка получения данных' });
  }
});

app.get('/api/bookings/awaiting-confirmation', async (req, res) => {
  try {
    const now = new Date();
    const mskOffset = 3 * 60;
    const nowMSK = new Date(now.getTime() + mskOffset * 60 * 1000);
    const currentDateTimeMSK = nowMSK.toISOString().replace('T', ' ').substring(0, 19);
    
    const result = await pool.query(`
      SELECT 
        b.*,
        t.table_number,
        t.public_label,
        t.capacity,
        t.furniture_description,
        t.features,
        t.has_playstation,
        h.name as hall_name,
        EXTRACT(EPOCH FROM (b.confirmation_deadline - $1::TIMESTAMP)) as seconds_remaining
      FROM bookings b
      JOIN tables t ON b.table_id = t.id
      JOIN halls h ON t.hall_id = h.id
      WHERE b.status = 'waiting_confirmation'
        AND b.confirmation_deadline > $1::TIMESTAMP
      ORDER BY b.confirmation_deadline ASC
    `, [currentDateTimeMSK]);
    
    console.log(`⏰ Броней ожидающих подтверждения: ${result.rows.length}`);
    
    res.json({
      count: result.rows.length,
      bookings: result.rows,
      currentTime: currentDateTimeMSK
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения броней:', error);
    res.status(500).json({ error: 'Ошибка получения данных' });
  }
});

app.get('/api/bookings/:id', async (req, res) => {
  const { id } = req.params;
  
  console.log(`🔍 Запрос бронирования #${id}`);
  
  try {
    const result = await pool.query(
      `SELECT 
        b.*,
        t.table_number,
        t.public_label,
        t.capacity,
        t.furniture_description,
        t.features,
        t.has_playstation,
        h.name as hall_name
      FROM bookings b
      JOIN tables t ON b.table_id = t.id
      JOIN halls h ON t.hall_id = h.id
      WHERE b.id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Бронирование не найдено' });
    }
    
    console.log('✅ Бронирование найдено');
    res.json(result.rows[0]);
    
  } catch (error) {
    console.error('❌ Ошибка получения бронирования:', error);
    res.status(500).json({ error: 'Ошибка получения данных' });
  }
});

// ============================================
// НОВЫЙ ENDPOINT: ИСТОРИЯ БРОНИ
// ============================================

app.get('/api/bookings/:id/history', async (req, res) => {
  const { id } = req.params;
  
  console.log(`📜 Запрос истории брони #${id}`);
  
  try {
    const result = await pool.query(
      `SELECT * FROM booking_history 
       WHERE booking_id = $1 
       ORDER BY created_at DESC`,
      [id]
    );
    
    console.log(`✅ История брони #${id}: ${result.rows.length} записей`);
    res.json(result.rows);
    
  } catch (error) {
    console.error('❌ Ошибка получения истории:', error);
    res.status(500).json({ error: 'Ошибка получения истории' });
  }
});

app.post('/api/bookings', async (req, res) => {
  console.log('📥 Получен запрос на создание бронирования:', req.body);
  
  try {
    const {
      table_id,
      customer_name,
      customer_phone,
      booking_date,
      start_time,
      end_time,
      guests_count
    } = req.body;

    if (!table_id || !customer_name || !customer_phone || !booking_date || !start_time || !guests_count) {
      console.log('❌ Не все поля заполнены');
      return res.status(400).json({
        error: 'Все поля обязательны для заполнения'
      });
    }

    const tableCheck = await pool.query(
      'SELECT * FROM tables WHERE id = $1',
      [table_id]
    );

    if (tableCheck.rows.length === 0) {
      console.log('❌ Стол не найден:', table_id);
      return res.status(404).json({
        error: 'Стол не найден'
      });
    }

    let finalEndTime = end_time;
    
    if (!end_time || end_time === 'by_fact') {
      console.log('ℹ️ Время окончания: По факту');
      finalEndTime = null;
    } else if (end_time === 'auto') {
      const [hours, minutes] = start_time.split(':');
      const endHours = (parseInt(hours) + 2) % 24;
      finalEndTime = `${String(endHours).padStart(2, '0')}:${minutes}`;
      console.log(`ℹ️ Время окончания (авто): ${finalEndTime}`);
    } else {
      console.log(`ℹ️ Время окончания (выбрано): ${end_time}`);
    }

    if (finalEndTime) {
      const conflictCheck = await pool.query(
        `SELECT * FROM bookings 
         WHERE table_id = $1 
         AND booking_date = $2 
         AND status IN ('pending', 'confirmed', 'waiting_confirmation')
         AND (
           (start_time < $3::time AND end_time > $3::time)
           OR (start_time < $4::time AND end_time > $4::time)
           OR (start_time >= $3::time AND end_time <= $4::time)
         )`,
        [table_id, booking_date, start_time, finalEndTime]
      );

      if (conflictCheck.rows.length > 0) {
        console.log('❌ Стол занят в это время');
        return res.status(409).json({
          error: 'Этот стол уже забронирован на выбранное время'
        });
      }
    }

    const result = await pool.query(
      `INSERT INTO bookings (
        table_id, 
        customer_name, 
        customer_phone, 
        booking_date, 
        start_time, 
        end_time,
        guests_count,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
      RETURNING *`,
      [
        table_id,
        customer_name,
        customer_phone,
        booking_date,
        start_time,
        finalEndTime,
        guests_count,
        'pending'
      ]
    );

    const newBooking = result.rows[0];
    
    console.log('✅ Бронирование создано:', newBooking);

    // Логирование в историю
    await pool.query(`
      INSERT INTO booking_history (booking_id, action, details, created_at)
      VALUES ($1, 'created', $2, CURRENT_TIMESTAMP)
    `, [newBooking.id, `Создано через ${req.headers['user-agent']?.includes('Mini') ? 'Mini App' : 'API'}`]);

    if (bot && GROUP_CHAT_ID) {
      const table = tableCheck.rows[0];
      
      const endTimeText = finalEndTime ? finalEndTime.substring(0, 5) : 'По факту';
      
      const message = `
🎉 <b>НОВОЕ БРОНИРОВАНИЕ #${newBooking.id}</b>

📅 <b>Дата:</b> ${new Date(booking_date).toLocaleDateString('ru-RU')}
⏰ <b>Время:</b> ${start_time} - ${endTimeText}
🪑 <b>Стол:</b> ${table.table_number}
👥 <b>Гостей:</b> ${guests_count}

👤 <b>Клиент:</b> ${customer_name}
📞 <b>Телефон:</b> ${customer_phone}

🟡 <b>Статус:</b> Ожидает подтверждения
      `.trim();
      
      await bot.sendMessage(GROUP_CHAT_ID, message, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Подтвердить', callback_data: `confirm_${newBooking.id}` },
            { text: '❌ Отменить', callback_data: `cancel_${newBooking.id}` }
          ]]
        }
      });
      
      console.log('✅ Уведомление отправлено в Telegram');
    }

    res.status(201).json({
      success: true,
      message: 'Бронирование успешно создано',
      booking: newBooking
    });

  } catch (error) {
    console.error('🔴 Ошибка создания бронирования:', error);
    res.status(500).json({
      error: 'Ошибка сервера при создании бронирования',
      details: error.message
    });
  }
});

app.put('/api/bookings/:id/confirm-arrival', async (req, res) => {
  const { id } = req.params;
  
  console.log(`✅ Подтверждение прихода гостя для брони #${id}`);
  
  try {
    const result = await pool.query(`
      UPDATE bookings
      SET 
        status = 'confirmed',
        arrival_confirmed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
        AND status IN ('pending', 'waiting_confirmation')
      RETURNING *
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Бронирование не найдено или уже подтверждено'
      });
    }
    
    // Логирование
    await pool.query(`
      INSERT INTO booking_history (booking_id, action, details, created_at)
      VALUES ($1, 'arrival_confirmed', 'Приход гостя подтверждён', CURRENT_TIMESTAMP)
    `, [id]);
    
    console.log(`✅ Бронь #${id} подтверждена`);
    
    res.json({
      success: true,
      message: 'Приход гостя подтверждён',
      booking: result.rows[0]
    });
    
  } catch (error) {
    console.error('❌ Ошибка подтверждения:', error);
    res.status(500).json({
      success: false,
      message: 'Ошибка сервера',
      error: error.message
    });
  }
});

// ============================================
// НОВЫЙ ENDPOINT: ЗАВЕРШЕНИЕ БРОНИ
// ============================================

app.put('/api/bookings/:id/complete', async (req, res) => {
  const { id } = req.params;
  
  console.log(`✅ Завершение брони #${id}`);
  
  try {
    const now = new Date();
    const mskOffset = 3 * 60;
    const nowMSK = new Date(now.getTime() + mskOffset * 60 * 1000);
    const currentTimeMSK = `${String(nowMSK.getUTCHours()).padStart(2, '0')}:${String(nowMSK.getUTCMinutes()).padStart(2, '0')}`;
    
    const result = await pool.query(`
      UPDATE bookings
      SET 
        status = 'completed',
        actual_end_time = $1::TIME,
        completed_at = CURRENT_TIMESTAMP,
        completed_reason = 'manual',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
        AND status = 'confirmed'
      RETURNING *
    `, [currentTimeMSK, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Бронирование не найдено или не в статусе confirmed'
      });
    }
    
    const booking = result.rows[0];
    
    // Вычисление длительности
    const startTime = booking.start_time.substring(0, 5);
    const endTime = booking.actual_end_time.substring(0, 5);
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    const durationMinutes = (endH * 60 + endM) - (startH * 60 + startM);
    const hours = Math.floor(durationMinutes / 60);
    const minutes = durationMinutes % 60;
    
    // Логирование
    await pool.query(`
      INSERT INTO booking_history (booking_id, action, details, created_at)
      VALUES ($1, 'completed', $2, CURRENT_TIMESTAMP)
    `, [id, `Завершено вручную. Длительность: ${hours}ч ${minutes}мин`]);
    
    console.log(`✅ Бронь #${id} завершена`);
    
    res.json({
      success: true,
      message: 'Бронирование завершено',
      booking: result.rows[0],
      duration: {
        hours,
        minutes,
        total_minutes: durationMinutes
      }
    });
    
  } catch (error) {
    console.error('❌ Ошибка завершения:', error);
    res.status(500).json({
      success: false,
      message: 'Ошибка сервера',
      error: error.message
    });
  }
});

app.put('/api/bookings/:id', async (req, res) => {
  const { id } = req.params;
  const { 
    status, 
    cancellation_reason, 
    start_time, 
    end_time,
    customer_name,
    customer_phone,
    booking_date,
    table_id,
    guests_count
  } = req.body;
  
  console.log(`📝 Обновление бронирования #${id}:`, req.body);
  
  try {
    const checkResult = await pool.query(
      'SELECT * FROM bookings WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      console.log('❌ Бронирование не найдено:', id);
      return res.status(404).json({ error: 'Бронирование не найдено' });
    }

    const oldBooking = checkResult.rows[0];
    let result;
    let historyDetails = [];
    
    if (customer_name || customer_phone || booking_date || table_id || guests_count) {
      console.log('✏️ Полное редактирование брони');
      
      const updateFields = [];
      const params = [];
      let paramCount = 1;
      
      if (customer_name && customer_name !== oldBooking.customer_name) {
        updateFields.push(`customer_name = $${paramCount}`);
        params.push(customer_name);
        paramCount++;
        historyDetails.push(`Имя: ${oldBooking.customer_name} → ${customer_name}`);
      }
      
      if (customer_phone && customer_phone !== oldBooking.customer_phone) {
        updateFields.push(`customer_phone = $${paramCount}`);
        params.push(customer_phone);
        paramCount++;
        historyDetails.push(`Телефон: ${oldBooking.customer_phone} → ${customer_phone}`);
      }
      
      if (booking_date && booking_date !== oldBooking.booking_date) {
        updateFields.push(`booking_date = $${paramCount}`);
        params.push(booking_date);
        paramCount++;
        historyDetails.push(`Дата: ${oldBooking.booking_date} → ${booking_date}`);
      }
      
      if (table_id && table_id !== oldBooking.table_id) {
        updateFields.push(`table_id = $${paramCount}`);
        params.push(table_id);
        paramCount++;
        historyDetails.push(`Стол изменён`);
      }
      
      if (guests_count && guests_count !== oldBooking.guests_count) {
        updateFields.push(`guests_count = $${paramCount}`);
        params.push(guests_count);
        paramCount++;
        historyDetails.push(`Гостей: ${oldBooking.guests_count} → ${guests_count}`);
      }
      
      if (start_time && start_time !== oldBooking.start_time) {
        updateFields.push(`start_time = $${paramCount}::TIME`);
        params.push(start_time);
        paramCount++;
        historyDetails.push(`Время начала: ${oldBooking.start_time} → ${start_time}`);
      }
      
      if (end_time !== undefined) {
        if (end_time === 'by_fact' || end_time === null || end_time === '') {
          updateFields.push(`end_time = NULL`);
          historyDetails.push(`Время окончания: По факту`);
        } else if (end_time !== oldBooking.end_time) {
          updateFields.push(`end_time = $${paramCount}::TIME`);
          params.push(end_time);
          paramCount++;
          historyDetails.push(`Время окончания: ${oldBooking.end_time || 'По факту'} → ${end_time}`);
        }
      }
      
      if (status && status !== oldBooking.status) {
        updateFields.push(`status = $${paramCount}::VARCHAR`);
        params.push(status);
        paramCount++;
        historyDetails.push(`Статус: ${oldBooking.status} → ${status}`);
      }
      
      if (updateFields.length > 0) {
        updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
        
        params.push(id);
        
        const query = `UPDATE bookings SET ${updateFields.join(', ')} WHERE id = $${paramCount} RETURNING *`;
        
        result = await pool.query(query, params);
        
        // Логирование изменений
        if (historyDetails.length > 0) {
          await pool.query(`
            INSERT INTO booking_history (booking_id, action, details, created_at)
            VALUES ($1, 'updated', $2, CURRENT_TIMESTAMP)
          `, [id, historyDetails.join('; ')]);
        }
      } else {
        result = { rows: [oldBooking] };
      }
      
    } else if (status === 'cancelled') {
      console.log('🗑 Отмена бронирования с причиной:', cancellation_reason);
      
      result = await pool.query(
        `UPDATE bookings 
         SET status = $1::VARCHAR, 
             cancellation_reason = $2,
             cancelled_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3
         RETURNING *`,
        [status, cancellation_reason || 'Отменено администратором', id]
      );
      
      // Логирование
      await pool.query(`
        INSERT INTO booking_history (booking_id, action, details, created_at)
        VALUES ($1, 'cancelled', $2, CURRENT_TIMESTAMP)
      `, [id, cancellation_reason || 'Отменено администратором']);
      
    } else if (start_time || end_time !== undefined) {
      console.log('⏰ Редактирование времени брони');
      
      let updateQuery = 'UPDATE bookings SET updated_at = CURRENT_TIMESTAMP';
      const params = [];
      let paramCount = 1;
      
      if (start_time) {
        updateQuery += `, start_time = $${paramCount}::TIME`;
        params.push(start_time);
        paramCount++;
        historyDetails.push(`Время начала: ${oldBooking.start_time} → ${start_time}`);
      }
      
      if (end_time !== undefined) {
        if (end_time === 'by_fact' || end_time === null || end_time === '') {
          updateQuery += `, end_time = NULL`;
          historyDetails.push(`Время окончания: По факту`);
        } else {
          updateQuery += `, end_time = $${paramCount}::TIME`;
          params.push(end_time);
          paramCount++;
          historyDetails.push(`Время окончания: ${end_time}`);
        }
      }
      
      if (status) {
        updateQuery += `, status = $${paramCount}::VARCHAR`;
        params.push(status);
        paramCount++;
        historyDetails.push(`Статус: ${status}`);
      }
      
      updateQuery += ` WHERE id = $${paramCount} RETURNING *`;
      params.push(id);
      
      result = await pool.query(updateQuery, params);
      
      // Логирование
      if (historyDetails.length > 0) {
        await pool.query(`
          INSERT INTO booking_history (booking_id, action, details, created_at)
          VALUES ($1, 'updated', $2, CURRENT_TIMESTAMP)
        `, [id, historyDetails.join('; ')]);
      }
      
    } else if (status) {
      console.log('✓ Изменение статуса на:', status);
      
      result = await pool.query(
        `UPDATE bookings 
         SET status = $1::VARCHAR,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING *`,
        [status, id]
      );
      
      // Логирование
      await pool.query(`
        INSERT INTO booking_history (booking_id, action, details, created_at)
        VALUES ($1, 'status_changed', $2, CURRENT_TIMESTAMP)
      `, [id, `Статус изменён на: ${status}`]);
    }
    
    console.log('✅ Бронирование обновлено:', result.rows[0]);
    
    res.json({
      success: true,
      message: 'Бронирование обновлено',
      booking: result.rows[0]
    });
    
  } catch (error) {
    console.error('🔴 Ошибка обновления:', error);
    res.status(500).json({ 
      error: 'Ошибка сервера при обновлении',
      details: error.message
    });
  }
});

app.delete('/api/bookings/:id', async (req, res) => {
  const { id } = req.params;
  
  console.log(`🗑️ Удаление бронирования #${id}`);
  
  try {
    const result = await pool.query(
      'DELETE FROM bookings WHERE id = $1 RETURNING *',
      [id]
    );
    
    if (result.rows.length === 0) {
      console.log('❌ Бронирование не найдено:', id);
      return res.status(404).json({ error: 'Бронирование не найдено' });
    }
    
    console.log('✅ Бронирование удалено:', result.rows[0]);
    
    res.json({ 
      success: true, 
      message: 'Бронирование удалено',
      deleted: result.rows[0]
    });
    
  } catch (error) {
    console.error('🔴 Ошибка удаления:', error);
    res.status(500).json({ 
      error: 'Ошибка сервера при удалении',
      details: error.message
    });
  }
});
app.get('/api/tables/:tableId/availability', async (req, res) => {
  const { tableId } = req.params;
  const { date } = req.query;
  
  console.log(`🔍 Проверка доступности стола #${tableId} на дату ${date}`);
  
  try {
    const bookings = await pool.query(
      `SELECT 
        id,
        start_time,
        end_time,
        status,
        customer_name,
        actual_end_time,
        completed_at
      FROM bookings 
      WHERE table_id = $1 
        AND booking_date = $2 
        AND status IN ('pending', 'confirmed', 'waiting_confirmation')
      ORDER BY start_time`,
      [tableId, date]
    );
    
    const tableInfo = await pool.query(
      `SELECT 
        t.*,
        h.name as hall_name
      FROM tables t
      LEFT JOIN halls h ON t.hall_id = h.id
      WHERE t.id = $1`,
      [tableId]
    );
    
    if (tableInfo.rows.length === 0) {
      return res.status(404).json({ error: 'Стол не найден' });
    }
    
    const now = new Date();
    const mskOffset = 3 * 60;
    const nowMSK = new Date(now.getTime() + mskOffset * 60 * 1000);
    const currentDateMSK = nowMSK.toISOString().split('T')[0];
    const currentTimeMSK = `${String(nowMSK.getUTCHours()).padStart(2, '0')}:${String(nowMSK.getUTCMinutes()).padStart(2, '0')}`;
    
    const isToday = date === currentDateMSK;
    
    console.log(`✅ Найдено бронирований: ${bookings.rows.length}`);
    
    res.json({
      table: tableInfo.rows[0],
      bookings: bookings.rows,
      isToday: isToday,
      currentTime: isToday ? currentTimeMSK : null
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения доступности:', error);
    res.status(500).json({ error: 'Ошибка получения данных' });
  }
});

app.get('/api/tables/status/:date', async (req, res) => {
  const { date } = req.params;
  
  console.log(`🔍 Получение статусов всех столов на ${date}`);
  
  try {
    const result = await pool.query(
      `SELECT 
        t.id,
        t.table_number,
        t.public_label,
        t.capacity,
        t.furniture_description,
        t.features,
        t.has_playstation,
        t.hall_id,
        h.name as hall_name,
        COALESCE(
          json_agg(
            json_build_object(
              'id', b.id,
              'start_time', b.start_time,
              'end_time', b.end_time,
              'status', b.status,
              'customer_name', b.customer_name,
              'confirmation_deadline', b.confirmation_deadline,
              'arrival_confirmed_at', b.arrival_confirmed_at,
              'actual_end_time', b.actual_end_time,
              'completed_at', b.completed_at
            ) 
            ORDER BY b.start_time
          ) FILTER (WHERE b.id IS NOT NULL),
          '[]'
        ) as bookings
      FROM tables t
      LEFT JOIN halls h ON t.hall_id = h.id
      LEFT JOIN bookings b ON t.id = b.table_id 
        AND b.booking_date = $1 
        AND b.status IN ('pending', 'confirmed', 'waiting_confirmation')
      WHERE t.is_active = true
      GROUP BY t.id, h.id
      ORDER BY t.table_number`,
      [date]
    );
    
    const now = new Date();
    const mskOffset = 3 * 60;
    const nowMSK = new Date(now.getTime() + mskOffset * 60 * 1000);
    const currentDateMSK = nowMSK.toISOString().split('T')[0];
    const currentTimeMSK = `${String(nowMSK.getUTCHours()).padStart(2, '0')}:${String(nowMSK.getUTCMinutes()).padStart(2, '0')}`;
    
    const isToday = date === currentDateMSK;
    
    const tablesWithStatus = result.rows.map(table => {
      const bookings = table.bookings;
      
      let status = 'available';
      let currentBooking = null;
      let nextAvailableTime = null;
      
      if (isToday && bookings.length > 0) {
        const [currH, currM] = currentTimeMSK.split(':').map(Number);
        const currentInMinutes = currH * 60 + currM;
        
        for (const booking of bookings) {
          const startTime = booking.start_time.substring(0, 5);
          const endTime = booking.end_time ? booking.end_time.substring(0, 5) : null;
          
          const [startH, startM] = startTime.split(':').map(Number);
          const startInMinutes = startH * 60 + startM;
          
          if (!endTime) {
            const endInMinutes = startInMinutes + 180;
            
            if (currentInMinutes >= startInMinutes && currentInMinutes < endInMinutes) {
              status = 'occupied';
              currentBooking = booking;
              break;
            }
          } else {
            const [endH, endM] = endTime.split(':').map(Number);
            const endInMinutes = endH * 60 + endM;
            
            if (currentInMinutes >= startInMinutes && currentInMinutes < endInMinutes) {
              status = 'occupied';
              currentBooking = booking;
              nextAvailableTime = endTime;
              break;
            }
          }
        }
        
        if (status === 'available') {
          const futureBookings = bookings.filter(b => {
            const startTime = b.start_time.substring(0, 5);
            const [startH, startM] = startTime.split(':').map(Number);
            const startInMinutes = startH * 60 + startM;
            return startInMinutes > currentInMinutes;
          });
          
          if (futureBookings.length > 0) {
            status = 'partially-booked';
            nextAvailableTime = futureBookings[0].start_time.substring(0, 5);
          }
        }
      } else if (bookings.length > 0) {
        status = 'partially-booked';
      }
      
      return {
        ...table,
        status,
        currentBooking,
        nextAvailableTime,
        isToday
      };
    });
    
    console.log(`✅ Обработано столов: ${tablesWithStatus.length}`);
    
    res.json({
      date,
      isToday,
      currentTime: isToday ? currentTimeMSK : null,
      tables: tablesWithStatus
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения статусов столов:', error);
    res.status(500).json({ error: 'Ошибка получения данных' });
  }
});

// ============================================
// АНАЛИТИКА И СТАТИСТИКА (ОБНОВЛЁННАЯ)
// ============================================

app.get('/api/analytics', async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    const endDate = end_date || new Date().toISOString().split('T')[0];
    const startDate = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    console.log(`📊 Запрос аналитики: ${startDate} - ${endDate}`);
    
    // Общая статистика (с учётом completed)
    const overallStats = await pool.query(`
      SELECT 
        COUNT(*) as total_bookings,
        COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed_count,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_count,
        COUNT(CASE WHEN status = 'no_show' THEN 1 END) as no_show_count,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
        COUNT(CASE WHEN status IN ('confirmed', 'completed') THEN 1 END) as successful_count,
        ROUND(COUNT(CASE WHEN status IN ('confirmed', 'completed') THEN 1 END)::numeric / NULLIF(COUNT(*), 0) * 100, 2) as conversion_rate,
        SUM(guests_count) as total_guests,
        ROUND(AVG(guests_count), 2) as avg_guests_per_booking
      FROM bookings
      WHERE booking_date BETWEEN $1 AND $2
    `, [startDate, endDate]);
    
    // Популярные столы
    const popularTables = await pool.query(`
      SELECT 
        t.table_number,
        t.capacity,
        h.name as hall_name,
        COUNT(b.id) as booking_count,
        COUNT(CASE WHEN b.status IN ('confirmed', 'completed') THEN 1 END) as successful_count,
        ROUND(COUNT(b.id)::numeric / NULLIF((
          SELECT COUNT(*) FROM bookings 
          WHERE booking_date BETWEEN $1 AND $2
        ), 0) * 100, 2) as popularity_percent
      FROM bookings b
      JOIN tables t ON b.table_id = t.id
      JOIN halls h ON t.hall_id = h.id
      WHERE b.booking_date BETWEEN $1 AND $2
      GROUP BY t.id, h.name
      ORDER BY booking_count DESC
      LIMIT 10
    `, [startDate, endDate]);
    
    // Популярные времена
    const popularTimes = await pool.query(`
      SELECT 
        EXTRACT(HOUR FROM start_time) as hour,
        COUNT(*) as booking_count,
        COUNT(CASE WHEN status IN ('confirmed', 'completed') THEN 1 END) as successful_count,
        ROUND(AVG(guests_count), 1) as avg_guests
      FROM bookings
      WHERE booking_date BETWEEN $1 AND $2
        AND status IN ('confirmed', 'pending', 'waiting_confirmation', 'completed')
      GROUP BY hour
      ORDER BY hour
    `, [startDate, endDate]);
    
    // Статистика по дням недели
    const weekdayStats = await pool.query(`
      SELECT 
        EXTRACT(DOW FROM booking_date) as day_of_week,
        CASE EXTRACT(DOW FROM booking_date)
          WHEN 0 THEN 'Воскресенье'
          WHEN 1 THEN 'Понедельник'
          WHEN 2 THEN 'Вторник'
          WHEN 3 THEN 'Среда'
          WHEN 4 THEN 'Четверг'
          WHEN 5 THEN 'Пятница'
          WHEN 6 THEN 'Суббота'
        END as day_name,
        COUNT(*) as booking_count,
        COUNT(CASE WHEN status IN ('confirmed', 'completed') THEN 1 END) as successful_count,
        ROUND(AVG(guests_count), 1) as avg_guests
      FROM bookings
      WHERE booking_date BETWEEN $1 AND $2
      GROUP BY day_of_week, day_name
      ORDER BY day_of_week
    `, [startDate, endDate]);
    
    // Тренд по дням
    const dailyTrend = await pool.query(`
      SELECT 
        booking_date,
        COUNT(*) as booking_count,
        COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed_count,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count,
        COUNT(CASE WHEN status = 'no_show' THEN 1 END) as no_show_count,
        SUM(guests_count) as total_guests
      FROM bookings
      WHERE booking_date BETWEEN $1 AND $2
      GROUP BY booking_date
      ORDER BY booking_date
    `, [startDate, endDate]);
    
    // Средняя длительность (только для completed с actual_end_time)
    const avgDuration = await pool.query(`
      SELECT 
        ROUND(AVG(EXTRACT(EPOCH FROM (actual_end_time - start_time)) / 3600), 2) as avg_duration_hours,
        COUNT(*) as completed_with_time_count
      FROM bookings
      WHERE booking_date BETWEEN $1 AND $2
        AND status = 'completed'
        AND actual_end_time IS NOT NULL
    `, [startDate, endDate]);
    
    // Статистика по причинам завершения
    const completionReasons = await pool.query(`
      SELECT 
        completed_reason,
        COUNT(*) as count,
        ROUND(AVG(EXTRACT(EPOCH FROM (actual_end_time - start_time)) / 3600), 2) as avg_duration_hours
      FROM bookings
      WHERE booking_date BETWEEN $1 AND $2
        AND status = 'completed'
        AND completed_reason IS NOT NULL
      GROUP BY completed_reason
      ORDER BY count DESC
    `, [startDate, endDate]);
    
    // Статистика по напоминаниям "По факту"
    const reminderStats = await pool.query(`
      SELECT 
        COUNT(*) as total_by_fact,
        COUNT(CASE WHEN reminder_sent_at IS NOT NULL THEN 1 END) as reminder_sent_count,
        COUNT(CASE WHEN reminder_response = 'still_sitting' THEN 1 END) as still_sitting_count,
        COUNT(CASE WHEN completed_reason = 'auto_6h_timeout' THEN 1 END) as auto_6h_count,
        COUNT(CASE WHEN second_reminder_sent_at IS NOT NULL THEN 1 END) as second_reminder_count
      FROM bookings
      WHERE booking_date BETWEEN $1 AND $2
        AND end_time IS NULL
    `, [startDate, endDate]);
    
    console.log('✅ Аналитика сформирована');
    
    res.json({
      period: {
        start_date: startDate,
        end_date: endDate
      },
      overall: overallStats.rows[0],
      popular_tables: popularTables.rows,
      popular_times: popularTimes.rows,
      weekday_stats: weekdayStats.rows,
      daily_trend: dailyTrend.rows,
      avg_duration: avgDuration.rows[0],
      completion_reasons: completionReasons.rows,
      reminder_stats: reminderStats.rows[0]
    });
    
  } catch (error) {
    console.error('❌ Ошибка формирования аналитики:', error);
    res.status(500).json({ error: 'Ошибка получения аналитики' });
  }
});

// ============================================
// НОВЫЙ ENDPOINT: СТАТИСТИКА ЗАВЕРШЁННЫХ БРОНЕЙ
// ============================================

app.get('/api/analytics/completed', async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    const endDate = end_date || new Date().toISOString().split('T')[0];
    const startDate = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    console.log(`📊 Запрос статистики завершённых броней: ${startDate} - ${endDate}`);
    
    // Общая статистика завершённых
    const completedStats = await pool.query(`
      SELECT 
        COUNT(*) as total_completed,
        COUNT(CASE WHEN completed_reason = 'manual' THEN 1 END) as manual_count,
        COUNT(CASE WHEN completed_reason = 'auto_time_expired' THEN 1 END) as auto_time_count,
        COUNT(CASE WHEN completed_reason = 'auto_6h_timeout' THEN 1 END) as auto_6h_count,
        COUNT(CASE WHEN completed_reason = 'still_sitting_6h' THEN 1 END) as still_sitting_6h_count,
        ROUND(AVG(EXTRACT(EPOCH FROM (actual_end_time - start_time)) / 3600), 2) as avg_duration_hours,
        MIN(EXTRACT(EPOCH FROM (actual_end_time - start_time)) / 3600) as min_duration_hours,
        MAX(EXTRACT(EPOCH FROM (actual_end_time - start_time)) / 3600) as max_duration_hours
      FROM bookings
      WHERE booking_date BETWEEN $1 AND $2
        AND status = 'completed'
        AND actual_end_time IS NOT NULL
    `, [startDate, endDate]);
    
    // Топ самых долгих визитов
    const longestVisits = await pool.query(`
      SELECT 
        id,
        booking_date,
        start_time,
        actual_end_time,
        customer_name,
        table_id,
        EXTRACT(EPOCH FROM (actual_end_time - start_time)) / 3600 as duration_hours,
        completed_reason
      FROM bookings
      WHERE booking_date BETWEEN $1 AND $2
        AND status = 'completed'
        AND actual_end_time IS NOT NULL
      ORDER BY duration_hours DESC
      LIMIT 10
    `, [startDate, endDate]);
    
    // Распределение по длительности
    const durationDistribution = await pool.query(`
      SELECT 
        CASE 
          WHEN EXTRACT(EPOCH FROM (actual_end_time - start_time)) / 3600 < 1 THEN '< 1 час'
          WHEN EXTRACT(EPOCH FROM (actual_end_time - start_time)) / 3600 < 2 THEN '1-2 часа'
          WHEN EXTRACT(EPOCH FROM (actual_end_time - start_time)) / 3600 < 3 THEN '2-3 часа'
          WHEN EXTRACT(EPOCH FROM (actual_end_time - start_time)) / 3600 < 4 THEN '3-4 часа'
          WHEN EXTRACT(EPOCH FROM (actual_end_time - start_time)) / 3600 < 6 THEN '4-6 часов'
          ELSE '> 6 часов'
        END as duration_range,
        COUNT(*) as count
      FROM bookings
      WHERE booking_date BETWEEN $1 AND $2
        AND status = 'completed'
        AND actual_end_time IS NOT NULL
      GROUP BY duration_range
      ORDER BY 
        CASE duration_range
          WHEN '< 1 час' THEN 1
          WHEN '1-2 часа' THEN 2
          WHEN '2-3 часа' THEN 3
          WHEN '3-4 часа' THEN 4
          WHEN '4-6 часов' THEN 5
          ELSE 6
        END
    `, [startDate, endDate]);
    
    console.log('✅ Статистика завершённых броней сформирована');
    
    res.json({
      period: {
        start_date: startDate,
        end_date: endDate
      },
      completed_stats: completedStats.rows[0],
      longest_visits: longestVisits.rows,
      duration_distribution: durationDistribution.rows
    });
    
  } catch (error) {
    console.error('❌ Ошибка формирования статистики:', error);
    res.status(500).json({ error: 'Ошибка получения статистики' });
  }
});

// ============================================
// ЭКСПОРТ В EXCEL (JSON для frontend) - ОБНОВЛЁННЫЙ
// ============================================

app.get('/api/export/excel', async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    const endDate = end_date || new Date().toISOString().split('T')[0];
    const startDate = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    console.log(`📥 Запрос на экспорт: ${startDate} - ${endDate}`);
    
    const result = await pool.query(`
      SELECT 
        b.id,
        b.booking_date as "Дата",
        b.start_time as "Время начала",
        b.end_time as "Время окончания (план)",
        b.actual_end_time as "Время окончания (факт)",
        CASE 
          WHEN b.actual_end_time IS NOT NULL THEN
            EXTRACT(EPOCH FROM (b.actual_end_time - b.start_time)) / 3600
          ELSE NULL
        END as "Длительность (часы)",
        t.table_number as "Номер стола",
        h.name as "Зал",
        b.customer_name as "Имя клиента",
        b.customer_phone as "Телефон",
        b.guests_count as "Количество гостей",
        b.status as "Статус",
        CASE b.status
          WHEN 'pending' THEN 'Ожидает'
          WHEN 'waiting_confirmation' THEN 'Ожидает подтверждения'
          WHEN 'confirmed' THEN 'Подтверждено'
          WHEN 'completed' THEN 'Завершено'
          WHEN 'cancelled' THEN 'Отменено'
          WHEN 'no_show' THEN 'Не пришёл'
        END as "Статус (текст)",
        b.completed_reason as "Причина завершения",
        b.created_at as "Создано",
        b.completed_at as "Завершено",
        b.cancellation_reason as "Причина отмены"
      FROM bookings b
      JOIN tables t ON b.table_id = t.id
      JOIN halls h ON t.hall_id = h.id
      WHERE b.booking_date BETWEEN $1 AND $2
      ORDER BY b.booking_date DESC, b.start_time DESC
    `, [startDate, endDate]);
    
    console.log(`✅ Данные для экспорта готовы: ${result.rows.length} записей`);
    
    res.json({
      period: {
        start_date: startDate,
        end_date: endDate
      },
      total_records: result.rows.length,
      data: result.rows
    });
    
  } catch (error) {
    console.error('❌ Ошибка экспорта:', error);
    res.status(500).json({ error: 'Ошибка экспорта данных' });
  }
});

// ============================================
// НОВЫЙ ENDPOINT: ЭКСПОРТ ИСТОРИИ ДЕЙСТВИЙ
// ============================================

app.get('/api/export/history', async (req, res) => {
  try {
    const { start_date, end_date, booking_id } = req.query;
    
    const endDate = end_date || new Date().toISOString().split('T')[0];
    const startDate = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    console.log(`📥 Запрос на экспорт истории: ${startDate} - ${endDate}`);
    
    let query = `
      SELECT 
        h.id,
        h.booking_id as "ID брони",
        b.customer_name as "Клиент",
        b.booking_date as "Дата брони",
        h.action as "Действие",
        h.details as "Детали",
        h.created_at as "Время действия"
      FROM booking_history h
      JOIN bookings b ON h.booking_id = b.id
      WHERE b.booking_date BETWEEN $1 AND $2
    `;
    
    const params = [startDate, endDate];
    
    if (booking_id) {
      query += ` AND h.booking_id = $3`;
      params.push(booking_id);
    }
    
    query += ` ORDER BY h.created_at DESC`;
    
    const result = await pool.query(query, params);
    
    console.log(`✅ История действий готова: ${result.rows.length} записей`);
    
    res.json({
      period: {
        start_date: startDate,
        end_date: endDate
      },
      booking_id: booking_id || 'all',
      total_records: result.rows.length,
      data: result.rows
    });
    
  } catch (error) {
    console.error('❌ Ошибка экспорта истории:', error);
    res.status(500).json({ error: 'Ошибка экспорта истории' });
  }
});

// ============================================
// 404 HANDLER
// ============================================

app.use((req, res) => {
  console.log(`⚠️ 404: ${req.method} ${req.path}`);
  res.status(404).json({ 
    error: 'Endpoint не найден',
    path: req.path,
    method: req.method
  });
});

// ============================================
// ERROR HANDLERS
// ============================================

process.on('unhandledRejection', (err) => {
  console.error('🔴 Необработанная ошибка Promise:', err);
});

process.on('uncaughtException', (err) => {
  console.error('🔴 Необработанное исключение:', err);
  process.exit(1);
});

// ============================================
// ЗАПУСК СЕРВЕРА
// ============================================

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('==================================================');
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`📍 http://localhost:${PORT}`);
  console.log(`🆕 Версия 7.0.0 (Не Усложняй / Guest-ready layout metadata)`);
  console.log('==================================================');
  console.log('');
  console.log('📋 Возможности:');
  console.log('  🤖 Telegram Bot интеграция');
  console.log('  🌐 Webhook (Production) / Polling (Development)');
  console.log('  👥 Поддержка групповых чатов');
  console.log('  ⚡ Inline-кнопки для быстрых действий');
  console.log('  📊 Полная аналитика и статистика');
  console.log('  📥 Экспорт в Excel');
  console.log('  ⏰ Автоподтверждение прихода (15 мин)');
  console.log('  ✅ Уведомления в реальном времени');
  console.log('  🚫 Автоотмена no-show');
  console.log('  ✏️ Полное редактирование броней');
  console.log('  📱 Mini App для Telegram');
  console.log('  🗺️ Метаданные для открытой гостевой карты');
  console.log('');
  console.log('✨ АКТУАЛЬНО ДЛЯ "НЕ УСЛОЖНЯЙ":');
  console.log('  🪑 7 столов с новой картой посадки');
  console.log('  🎮 Отдельная метка стола с PlayStation');
  console.log('  🛋️ Хранение конфигурации диванов и кресел');
  console.log('  🗺️ Подготовка к открытой карте для гостей');
  console.log('');
  console.log('==================================================');
  console.log('');
  
  if (process.env.NODE_ENV === 'production') {
    console.log('🌐 Режим: PRODUCTION (Webhook)');
  } else {
    console.log('💻 Режим: DEVELOPMENT (Polling)');
  }
  
  console.log('');
  console.log('📊 СТАТУСЫ БРОНИРОВАНИЙ:');
  console.log('  🟡 pending - Ожидает подтверждения');
  console.log('  🟠 waiting_confirmation - Ожидает подтверждения прихода');
  console.log('  🟢 confirmed - Подтверждено (активная бронь)');
  console.log('  ✅ completed - Завершено успешно');
  console.log('  🔴 cancelled - Отменено');
  console.log('  ⚫ no_show - Не пришёл');
  console.log('');
  console.log('==================================================');
  console.log('');
});
