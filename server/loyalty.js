const crypto = require('crypto');

const LEVELS = [
  {
    code: 'guest',
    title: 'Гость',
    minVisits: 0,
    perks: [
      'Старт в клубе и welcome-механика',
      'Базовый reward pool',
      'Прозрачный прогресс до первой награды'
    ]
  },
  {
    code: 'svoy',
    title: 'Свой',
    minVisits: 3,
    perks: [
      'Полный базовый reward pool',
      'Дневные challenges для ускоренного прогресса',
      'Персональные предложения без масс-маркета'
    ]
  },
  {
    code: 'circle',
    title: 'В кругу',
    minVisits: 7,
    perks: [
      'Расширенный reward pool',
      'Закрытые rewards для дневных часов',
      'Больше ценности от каждой награды'
    ]
  },
  {
    code: 'legend',
    title: 'Легенда',
    minVisits: 12,
    perks: [
      'Максимальный статус',
      'Редкие rewards и сюрпризы от команды',
      'Самый сильный эмоциональный пакет'
    ]
  }
];

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function last4(phone) {
  const digits = normalizePhone(phone);
  return digits.slice(-4);
}

function getLevelByVisits(visits) {
  return [...LEVELS].reverse().find(level => visits >= level.minVisits) || LEVELS[0];
}

function getNextLevel(visits) {
  return LEVELS.find(level => visits < level.minVisits) || null;
}

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function verifyTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;

  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  const expected = Buffer.from(calculatedHash, 'hex');
  const actual = Buffer.from(hash, 'hex');

  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return null;
  }

  const user = safeJsonParse(params.get('user'));
  if (!user) return null;

  return {
    id: user.id,
    username: user.username || null,
    first_name: user.first_name || '',
    last_name: user.last_name || ''
  };
}

function getDemoTelegramUser(req) {
  const allowDemoInProduction = process.env.LOYALTY_ALLOW_DEMO === 'true';
  if (process.env.NODE_ENV === 'production' && !allowDemoInProduction) return null;

  const demoId = req.headers['x-demo-telegram-id'] || req.query.demo_user_id;
  if (!demoId) return null;

  const safeDecode = (value, fallback = null) => {
    if (!value) return fallback;
    try {
      return decodeURIComponent(String(value));
    } catch (error) {
      return String(value);
    }
  };

  return {
    id: Number(demoId),
    username: safeDecode(req.headers['x-demo-telegram-username'] || req.query.demo_username, null),
    first_name: safeDecode(req.headers['x-demo-first-name'] || req.query.demo_first_name, 'Demo'),
    last_name: safeDecode(req.headers['x-demo-last-name'] || req.query.demo_last_name, 'User')
  };
}

async function resolveRequester(req, pool) {
  const initData = req.headers['x-telegram-init-data'] || req.body?.initData || req.query.initData;
  const telegramUser = verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN) || getDemoTelegramUser(req);

  if (!telegramUser) {
    console.warn(`⚠️ Loyalty auth failed: requester not resolved for ${req.method} ${req.path}`);
    return { telegramUser: null, guest: null, admin: null, isAdmin: false };
  }

  const guestResult = await pool.query(`
    SELECT *
    FROM loyalty_guests
    WHERE telegram_user_id = $1
    LIMIT 1
  `, [telegramUser.id]);

  let guest = guestResult.rows[0] || null;

  if (guest) {
    guest = (await pool.query(`
      UPDATE loyalty_guests
      SET telegram_username = COALESCE($2::text, telegram_username),
          first_name = COALESCE($3::text, first_name),
          last_name = COALESCE($4::text, last_name),
          last_seen_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [guest.id, telegramUser.username, telegramUser.first_name, telegramUser.last_name])).rows[0];
  }

  const adminByDb = (await pool.query(`
    SELECT *
    FROM loyalty_admins
    WHERE is_active = true
      AND (
        telegram_user_id = $1
        OR ($2::text IS NOT NULL AND LOWER(telegram_username) = LOWER($2::text))
      )
    LIMIT 1
  `, [telegramUser.id, telegramUser.username])).rows[0] || null;

  const envAdminIds = parseCsv(process.env.LOYALTY_ADMIN_IDS).map(value => Number(value));
  const envAdminUsernames = parseCsv(process.env.LOYALTY_ADMIN_USERNAMES).map(value => value.toLowerCase());
  const envAdminPhones = parseCsv(process.env.LOYALTY_ADMIN_PHONE_LAST4);
  const guestPhoneLast4 = guest?.phone_last4 || null;

  const isAdmin = Boolean(
    adminByDb
    || envAdminIds.includes(Number(telegramUser.id))
    || (telegramUser.username && envAdminUsernames.includes(telegramUser.username.toLowerCase()))
    || (guestPhoneLast4 && envAdminPhones.includes(guestPhoneLast4))
  );

  return {
    telegramUser,
    guest,
    admin: adminByDb,
    isAdmin
  };
}

async function getOpenReward(pool, guestId) {
  const result = await pool.query(`
    SELECT
      ri.*,
      rc.code as reward_code,
      rc.title as reward_title,
      rc.description as reward_description
    FROM loyalty_reward_instances ri
    LEFT JOIN loyalty_reward_catalog rc ON rc.id = ri.reward_catalog_id
    WHERE ri.guest_id = $1
      AND ri.status IN ('available', 'selected')
    ORDER BY ri.id DESC
    LIMIT 1
  `, [guestId]);

  return result.rows[0] || null;
}

async function getRewardPool(pool, levelCode) {
  const levelIndex = LEVELS.findIndex(level => level.code === levelCode);
  const allowedLevels = LEVELS.slice(0, levelIndex + 1).map(level => level.code);

  const result = await pool.query(`
    SELECT id, code, title, description, min_level_code
    FROM loyalty_reward_catalog
    WHERE is_active = true
      AND min_level_code = ANY($1::text[])
    ORDER BY display_order, id
  `, [allowedLevels]);

  return result.rows;
}

async function appendAudit(pool, { guestId = null, adminId = null, actionType, actionSummary, metadata = {} }) {
  await pool.query(`
    INSERT INTO loyalty_audit_log (guest_id, admin_id, action_type, action_summary, metadata)
    VALUES ($1, $2, $3, $4, $5::jsonb)
  `, [guestId, adminId, actionType, actionSummary, JSON.stringify(metadata)]);
}

function formatGuestPayload(guest, reward, rewardPool) {
  const level = getLevelByVisits(Number(guest.total_visits || 0));
  const nextLevel = getNextLevel(Number(guest.total_visits || 0));

  return {
    id: guest.id,
    displayName: guest.display_name,
    phone: guest.phone,
    phoneLast4: guest.phone_last4,
    totalVisits: Number(guest.total_visits || 0),
    currentStamps: Number(guest.current_stamps || 0),
    averageCheck: Number(guest.average_check || 0),
    inactiveDays: guest.last_visit_at
      ? Math.floor((Date.now() - new Date(guest.last_visit_at).getTime()) / (1000 * 60 * 60 * 24))
      : null,
    level,
    nextLevel,
    reward,
    rewardPool
  };
}

function assertPhone(phone) {
  const digits = normalizePhone(phone);
  return digits.length >= 10;
}

async function requireAdmin(req, res, pool) {
  const requester = await resolveRequester(req, pool);
  if (!requester.telegramUser || !requester.isAdmin) {
    res.status(403).json({ error: 'Доступ только для администраторов' });
    return null;
  }
  return requester;
}

function registerLoyaltyRoutes(app, pool) {
  app.use('/api/loyalty', (req, res, next) => {
    console.log(`🟠 Loyalty request: ${req.method} ${req.path}`);
    next();
  });

  app.get('/api/loyalty/session', async (req, res) => {
    try {
      const requester = await resolveRequester(req, pool);

      if (!requester.telegramUser) {
        return res.status(401).json({ error: 'Не удалось определить пользователя Telegram' });
      }

      return res.json({
        telegramUser: requester.telegramUser,
        isAdmin: requester.isAdmin,
        guestRegistered: Boolean(requester.guest),
        guest: requester.guest ? {
          id: requester.guest.id,
          displayName: requester.guest.display_name,
          phoneLast4: requester.guest.phone_last4
        } : null
      });
    } catch (error) {
      console.error('❌ Loyalty session error:', error);
      res.status(500).json({ error: 'Ошибка проверки сессии' });
    }
  });

  app.post('/api/loyalty/guest/register', async (req, res) => {
    try {
      const requester = await resolveRequester(req, pool);
      if (!requester.telegramUser) {
        return res.status(401).json({ error: 'Не удалось определить пользователя Telegram' });
      }

      const displayName = String(req.body.displayName || requester.telegramUser.first_name || '').trim();
      const phone = normalizePhone(req.body.phone);

      if (!displayName || !assertPhone(phone)) {
        return res.status(400).json({ error: 'Нужно указать имя и корректный номер телефона' });
      }

      const existingByPhone = await pool.query(`
        SELECT *
        FROM loyalty_guests
        WHERE phone = $1
        LIMIT 1
      `, [phone]);

      let guest;
      if (existingByPhone.rows[0] && existingByPhone.rows[0].telegram_user_id && Number(existingByPhone.rows[0].telegram_user_id) !== Number(requester.telegramUser.id)) {
        return res.status(409).json({ error: 'Этот номер уже привязан к другому Telegram-аккаунту' });
      }

      if (existingByPhone.rows[0]) {
        guest = (await pool.query(`
          UPDATE loyalty_guests
          SET telegram_user_id = $2,
              telegram_username = $3,
              first_name = $4,
              last_name = $5,
              display_name = $6,
              phone_last4 = $7,
              updated_at = NOW(),
              last_seen_at = NOW()
          WHERE id = $1
          RETURNING *
        `, [
          existingByPhone.rows[0].id,
          requester.telegramUser.id,
          requester.telegramUser.username,
          requester.telegramUser.first_name,
          requester.telegramUser.last_name,
          displayName,
          last4(phone)
        ])).rows[0];
      } else {
        guest = (await pool.query(`
          INSERT INTO loyalty_guests (
            telegram_user_id,
            telegram_username,
            first_name,
            last_name,
            display_name,
            phone,
            phone_last4
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        `, [
          requester.telegramUser.id,
          requester.telegramUser.username,
          requester.telegramUser.first_name,
          requester.telegramUser.last_name,
          displayName,
          phone,
          last4(phone)
        ])).rows[0];
      }

      await appendAudit(pool, {
        guestId: guest.id,
        actionType: 'guest_registered',
        actionSummary: `Гость ${guest.display_name} зарегистрировался в loyalty`,
        metadata: { telegramUserId: requester.telegramUser.id }
      });

      const rewardPool = await getRewardPool(pool, guest.level_code || getLevelByVisits(0).code);
      res.json({ guest: formatGuestPayload(guest, null, rewardPool) });
    } catch (error) {
      console.error('❌ Loyalty register error:', error);
      console.error('❌ Loyalty register payload:', {
        displayName: req.body?.displayName,
        phone: req.body?.phone
      });
      res.status(500).json({
        error: process.env.LOYALTY_DEBUG === 'true'
          ? `Ошибка регистрации: ${error.message}`
          : 'Ошибка регистрации в программе лояльности'
      });
    }
  });

  app.get('/api/loyalty/guest/me', async (req, res) => {
    try {
      const requester = await resolveRequester(req, pool);
      if (!requester.telegramUser) {
        return res.status(401).json({ error: 'Не удалось определить пользователя Telegram' });
      }

      if (!requester.guest) {
        return res.status(404).json({ error: 'Гость ещё не зарегистрирован в loyalty' });
      }

      const reward = await getOpenReward(pool, requester.guest.id);
      const level = getLevelByVisits(Number(requester.guest.total_visits || 0));
      const rewardPool = await getRewardPool(pool, level.code);

      res.json({
        guest: formatGuestPayload(
          { ...requester.guest, level_code: level.code },
          reward ? {
            id: reward.id,
            status: reward.status,
            expiresAt: reward.expires_at,
            selectedRewardId: reward.reward_catalog_id,
            selectedRewardTitle: reward.reward_title
          } : null,
          rewardPool
        )
      });
    } catch (error) {
      console.error('❌ Loyalty guest/me error:', error);
      res.status(500).json({ error: 'Ошибка загрузки профиля гостя' });
    }
  });

  app.post('/api/loyalty/guest/rewards/:instanceId/select', async (req, res) => {
    try {
      const requester = await resolveRequester(req, pool);
      if (!requester.telegramUser || !requester.guest) {
        return res.status(401).json({ error: 'Доступно только зарегистрированному гостю' });
      }

      const instanceId = Number(req.params.instanceId);
      const rewardCatalogId = Number(req.body.rewardCatalogId);

      const reward = await getOpenReward(pool, requester.guest.id);
      if (!reward || reward.id !== instanceId) {
        return res.status(404).json({ error: 'Активная награда не найдена' });
      }

      const level = getLevelByVisits(Number(requester.guest.total_visits || 0));
      const rewardPool = await getRewardPool(pool, level.code);
      const allowedReward = rewardPool.find(item => item.id === rewardCatalogId);
      if (!allowedReward) {
        return res.status(400).json({ error: 'Эта награда недоступна для текущего уровня' });
      }

      const updated = (await pool.query(`
        UPDATE loyalty_reward_instances
        SET reward_catalog_id = $2,
            status = 'selected',
            selected_at = NOW(),
            selected_by_guest = true
        WHERE id = $1
        RETURNING *
      `, [instanceId, rewardCatalogId])).rows[0];

      await appendAudit(pool, {
        guestId: requester.guest.id,
        actionType: 'reward_selected',
        actionSummary: `${requester.guest.display_name} выбрал награду "${allowedReward.title}"`,
        metadata: { rewardInstanceId: instanceId, rewardCatalogId }
      });

      res.json({
        reward: {
          id: updated.id,
          status: updated.status,
          selectedRewardId: updated.reward_catalog_id,
          selectedRewardTitle: allowedReward.title
        }
      });
    } catch (error) {
      console.error('❌ Loyalty reward select error:', error);
      res.status(500).json({ error: 'Ошибка выбора награды' });
    }
  });

  app.get('/api/loyalty/admin/guests', async (req, res) => {
    try {
      const requester = await requireAdmin(req, res, pool);
      if (!requester) return;

      const query = String(req.query.q || '').trim().toLowerCase();
      const filter = String(req.query.filter || 'all');

      const result = await pool.query(`
        SELECT *
        FROM loyalty_guests
        ORDER BY updated_at DESC, id DESC
        LIMIT 100
      `);

      const guests = [];
      for (const guest of result.rows) {
        const reward = await getOpenReward(pool, guest.id);
        const inactiveDays = guest.last_visit_at
          ? Math.floor((Date.now() - new Date(guest.last_visit_at).getTime()) / (1000 * 60 * 60 * 24))
          : 999;

        const matchesQuery = !query
          || guest.display_name.toLowerCase().includes(query)
          || guest.phone.includes(query)
          || guest.phone_last4.includes(query);

        if (!matchesQuery) continue;

        if (filter === 'reward' && !reward) continue;
        if (filter === 'inactive' && inactiveDays < 53) continue;
        if (filter === 'day' && !(Number(guest.current_stamps || 0) >= 4 || Number(guest.average_check || 0) < 3000)) continue;

        guests.push({
          id: guest.id,
          displayName: guest.display_name,
          phone: guest.phone,
          phoneLast4: guest.phone_last4,
          totalVisits: Number(guest.total_visits || 0),
          currentStamps: Number(guest.current_stamps || 0),
          averageCheck: Number(guest.average_check || 0),
          inactiveDays,
          level: getLevelByVisits(Number(guest.total_visits || 0)),
          reward: reward ? {
            id: reward.id,
            status: reward.status,
            selectedRewardTitle: reward.reward_title
          } : null
        });
      }

      res.json({ guests });
    } catch (error) {
      console.error('❌ Loyalty admin guests error:', error);
      res.status(500).json({ error: 'Ошибка загрузки гостей' });
    }
  });

  app.post('/api/loyalty/admin/guests', async (req, res) => {
    try {
      const requester = await requireAdmin(req, res, pool);
      if (!requester) return;

      const displayName = String(req.body.displayName || '').trim();
      const phone = normalizePhone(req.body.phone);
      if (!displayName || !assertPhone(phone)) {
        return res.status(400).json({ error: 'Нужно указать имя и корректный номер' });
      }

      const guest = (await pool.query(`
        INSERT INTO loyalty_guests (display_name, phone, phone_last4)
        VALUES ($1, $2, $3)
        ON CONFLICT (phone)
        DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = NOW()
        RETURNING *
      `, [displayName, phone, last4(phone)])).rows[0];

      await appendAudit(pool, {
        guestId: guest.id,
        adminId: requester.admin?.id || null,
        actionType: 'guest_created_by_admin',
        actionSummary: `Админ создал или обновил карточку гостя ${displayName}`,
        metadata: { phoneLast4: guest.phone_last4 }
      });

      res.json({ guest });
    } catch (error) {
      console.error('❌ Loyalty admin create guest error:', error);
      res.status(500).json({ error: 'Ошибка создания гостя' });
    }
  });

  app.post('/api/loyalty/admin/visits', async (req, res) => {
    try {
      const requester = await requireAdmin(req, res, pool);
      if (!requester) return;

      const guestId = Number(req.body.guestId);
      const checkAmount = Number(req.body.checkAmount || 0);
      const comment = String(req.body.comment || '').trim();

      const guestResult = await pool.query(`SELECT * FROM loyalty_guests WHERE id = $1 LIMIT 1`, [guestId]);
      const guest = guestResult.rows[0];
      if (!guest) return res.status(404).json({ error: 'Гость не найден' });

      const openReward = await getOpenReward(pool, guest.id);
      const stampsAwarded = checkAmount >= 5000 ? 2 : 1;
      const appliedStamps = openReward ? 0 : stampsAwarded;

      const visit = (await pool.query(`
        INSERT INTO loyalty_visits (guest_id, confirmed_by_admin_id, check_amount, stamps_awarded, comment)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `, [guest.id, requester.admin?.id || null, checkAmount, appliedStamps, comment || null])).rows[0];

      const totalVisits = Number(guest.total_visits || 0) + 1;
      const currentStamps = Math.min(6, Number(guest.current_stamps || 0) + appliedStamps);
      const averageCheck = Number(guest.total_visits || 0) === 0
        ? checkAmount
        : ((Number(guest.average_check || 0) * Number(guest.total_visits || 0)) + checkAmount) / totalVisits;
      const level = getLevelByVisits(totalVisits);

      const updatedGuest = (await pool.query(`
        UPDATE loyalty_guests
        SET total_visits = $2,
            current_stamps = $3,
            average_check = $4,
            level_code = $5,
            last_visit_at = NOW(),
            last_seen_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [guest.id, totalVisits, currentStamps, averageCheck, level.code])).rows[0];

      let openedReward = null;
      if (!openReward && currentStamps >= 6) {
        openedReward = (await pool.query(`
          INSERT INTO loyalty_reward_instances (guest_id, status, expires_at, opened_after_visit_id)
          VALUES ($1, 'available', NOW() + INTERVAL '14 days', $2)
          RETURNING *
        `, [guest.id, visit.id])).rows[0];
      }

      await appendAudit(pool, {
        guestId: guest.id,
        adminId: requester.admin?.id || null,
        actionType: 'visit_confirmed',
        actionSummary: `Подтверждён визит гостя ${guest.display_name}`,
        metadata: {
          checkAmount,
          stampsAwarded,
          appliedStamps,
          rewardOpened: Boolean(openedReward)
        }
      });

      res.json({
        guest: updatedGuest,
        visit,
        rewardOpened: Boolean(openedReward),
        rewardLocked: Boolean(openReward),
        message: openReward
          ? 'Визит зафиксирован, но штампы не добавлены: сначала нужно использовать текущую награду.'
          : openedReward
            ? 'Визит подтверждён, новая награда открыта автоматически.'
            : 'Визит подтверждён.'
      });
    } catch (error) {
      console.error('❌ Loyalty admin visit error:', error);
      res.status(500).json({ error: 'Ошибка подтверждения визита' });
    }
  });

  app.post('/api/loyalty/admin/rewards/:id/redeem', async (req, res) => {
    try {
      const requester = await requireAdmin(req, res, pool);
      if (!requester) return;

      const rewardId = Number(req.params.id);
      const comment = String(req.body.comment || '').trim();

      const rewardResult = await pool.query(`
        SELECT
          ri.*,
          g.display_name,
          rc.title as reward_title
        FROM loyalty_reward_instances ri
        JOIN loyalty_guests g ON g.id = ri.guest_id
        LEFT JOIN loyalty_reward_catalog rc ON rc.id = ri.reward_catalog_id
        WHERE ri.id = $1
          AND ri.status IN ('available', 'selected')
        LIMIT 1
      `, [rewardId]);

      const reward = rewardResult.rows[0];
      if (!reward) {
        return res.status(404).json({ error: 'Награда не найдена или уже списана' });
      }

      await pool.query(`
        UPDATE loyalty_reward_instances
        SET status = 'redeemed',
            redeemed_at = NOW(),
            admin_comment = $2
        WHERE id = $1
      `, [rewardId, comment || null]);

      await pool.query(`
        UPDATE loyalty_guests
        SET current_stamps = GREATEST(current_stamps - 6, 0),
            updated_at = NOW()
        WHERE id = $1
      `, [reward.guest_id]);

      await appendAudit(pool, {
        guestId: reward.guest_id,
        adminId: requester.admin?.id || null,
        actionType: 'reward_redeemed',
        actionSummary: `Списана награда гостя ${reward.display_name}`,
        metadata: {
          rewardId,
          rewardTitle: reward.reward_title,
          comment
        }
      });

      res.json({ success: true });
    } catch (error) {
      console.error('❌ Loyalty admin redeem error:', error);
      res.status(500).json({ error: 'Ошибка списания награды' });
    }
  });

  app.get('/api/loyalty/admin/logs', async (req, res) => {
    try {
      const requester = await requireAdmin(req, res, pool);
      if (!requester) return;

      const result = await pool.query(`
        SELECT
          l.*,
          g.display_name,
          a.full_name as admin_name
        FROM loyalty_audit_log l
        LEFT JOIN loyalty_guests g ON g.id = l.guest_id
        LEFT JOIN loyalty_admins a ON a.id = l.admin_id
        ORDER BY l.created_at DESC
        LIMIT 50
      `);

      res.json({
        logs: result.rows.map(item => ({
          id: item.id,
          actionType: item.action_type,
          summary: item.action_summary,
          guestName: item.display_name,
          adminName: item.admin_name,
          createdAt: item.created_at,
          metadata: item.metadata
        }))
      });
    } catch (error) {
      console.error('❌ Loyalty admin logs error:', error);
      res.status(500).json({ error: 'Ошибка загрузки журнала' });
    }
  });
}

module.exports = {
  registerLoyaltyRoutes
};
