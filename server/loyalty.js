const crypto = require('crypto');

const MATCH_TARGET_SCORE = 2000;
const MATCH_DURATION_SECONDS = 120;

const LEVELS = [
  {
    code: 'guest',
    title: 'Гость',
    minVisits: 0,
    perks: [
      'Welcome-механика и первый reward pool',
      'Доступ к колесу призов и монетам',
      '1 матч-игра в сутки за шанс заработать ещё монету'
    ]
  },
  {
    code: 'svoy',
    title: 'Свой',
    minVisits: 3,
    perks: [
      'Расширенный reward pool по штампам',
      'Средние призы в колесе и более сильные скидки',
      'Лучшая конверсия монет в полезные rewards'
    ]
  },
  {
    code: 'circle',
    title: 'В кругу',
    minVisits: 7,
    perks: [
      'Закрытые prize-сегменты в колесе',
      'Более заметные fixed-скидки и проценты',
      'Самый приятный баланс редких и частых призов'
    ]
  },
  {
    code: 'legend',
    title: 'Легенда',
    minVisits: 12,
    perks: [
      'Максимальный reward pool',
      'Доступ к джекпот-призам и сильным скидкам',
      'Редкие эмоциональные награды и premium-слоты в колесе'
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

function levelRank(levelCode) {
  return Math.max(0, LEVELS.findIndex(level => level.code === levelCode));
}

function allowedLevels(levelCode) {
  return LEVELS.slice(0, levelRank(levelCode) + 1).map(level => level.code);
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

function getMskDateString(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function getMskDateTime(date) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(date));
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

  let adminByDb = (await pool.query(`
    SELECT *
    FROM loyalty_admins
    WHERE is_active = true
      AND telegram_user_id = $1
    LIMIT 1
  `, [telegramUser.id])).rows[0] || null;

  if (!adminByDb && telegramUser.username) {
    adminByDb = (await pool.query(`
      SELECT *
      FROM loyalty_admins
      WHERE is_active = true
        AND LOWER(telegram_username) = LOWER($1::text)
      LIMIT 1
    `, [telegramUser.username])).rows[0] || null;
  }

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

async function appendAudit(pool, { guestId = null, adminId = null, actionType, actionSummary, metadata = {} }) {
  await pool.query(`
    INSERT INTO loyalty_audit_log (guest_id, admin_id, action_type, action_summary, metadata)
    VALUES ($1, $2, $3, $4, $5::jsonb)
  `, [guestId, adminId, actionType, actionSummary, JSON.stringify(metadata)]);
}

async function getOpenLevelReward(pool, guestId) {
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

async function getSelectedLevelReward(pool, guestId) {
  const result = await pool.query(`
    SELECT
      ri.*,
      rc.code as reward_code,
      rc.title as reward_title,
      rc.description as reward_description
    FROM loyalty_reward_instances ri
    LEFT JOIN loyalty_reward_catalog rc ON rc.id = ri.reward_catalog_id
    WHERE ri.guest_id = $1
      AND ri.status = 'selected'
    ORDER BY ri.id DESC
    LIMIT 1
  `, [guestId]);

  return result.rows[0] || null;
}

async function getRewardPool(pool, levelCode) {
  const result = await pool.query(`
    SELECT id, code, title, description, min_level_code
    FROM loyalty_reward_catalog
    WHERE is_active = true
      AND min_level_code = ANY($1::text[])
    ORDER BY display_order, id
  `, [allowedLevels(levelCode)]);

  return result.rows;
}

async function getWheelPrizePool(pool, levelCode) {
  const result = await pool.query(`
    SELECT *
    FROM loyalty_wheel_prize_catalog
    WHERE is_active = true
      AND min_level_code = ANY($1::text[])
    ORDER BY display_order, id
  `, [allowedLevels(levelCode)]);

  return result.rows;
}

async function getActiveWheelPrize(pool, guestId) {
  const result = await pool.query(`
    SELECT
      i.*,
      c.code,
      c.title,
      c.short_label,
      c.description,
      c.prize_type,
      c.discount_percent,
      c.discount_amount,
      c.min_order_amount,
      c.bonus_coins,
      c.segment_color
    FROM loyalty_wheel_prize_instances i
    JOIN loyalty_wheel_prize_catalog c ON c.id = i.prize_catalog_id
    WHERE i.guest_id = $1
      AND i.status = 'active'
    ORDER BY i.id DESC
    LIMIT 1
  `, [guestId]);

  return result.rows[0] || null;
}

async function getRecentWheelPrizes(pool, guestId) {
  const result = await pool.query(`
    SELECT
      i.*,
      c.code,
      c.title,
      c.short_label,
      c.prize_type,
      c.discount_percent,
      c.discount_amount,
      c.min_order_amount,
      c.segment_color
    FROM loyalty_wheel_prize_instances i
    JOIN loyalty_wheel_prize_catalog c ON c.id = i.prize_catalog_id
    WHERE i.guest_id = $1
    ORDER BY i.id DESC
    LIMIT 8
  `, [guestId]);

  return result.rows;
}

async function getPendingWheelCount(pool, guestId) {
  const result = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM loyalty_wheel_prize_instances
    WHERE guest_id = $1
      AND status = 'won'
  `, [guestId]);

  return result.rows[0]?.count || 0;
}

async function getMatchMeta(pool, guestId) {
  const today = getMskDateString();
  const playedTodayResult = await pool.query(`
    SELECT *
    FROM loyalty_match_sessions
    WHERE guest_id = $1
      AND (started_at AT TIME ZONE 'Europe/Moscow')::date = $2::date
    ORDER BY id DESC
    LIMIT 1
  `, [guestId, today]);

  const latest = playedTodayResult.rows[0] || null;

  return {
    canPlayToday: !latest,
    playedToday: Boolean(latest),
    lastSession: latest ? {
      id: latest.id,
      score: latest.score,
      rewardGranted: latest.reward_granted,
      completedAt: latest.completed_at
    } : null,
    targetScore: MATCH_TARGET_SCORE,
    durationSeconds: MATCH_DURATION_SECONDS
  };
}

function formatOrderCondition(row) {
  if (!row.min_order_amount) return 'без минимальной суммы';
  return `от ${Number(row.min_order_amount).toLocaleString('ru-RU')} ₽`;
}

function describeWheelPrize(row) {
  if (!row) return null;

  if (row.prize_type === 'discount_percent') {
    return `Скидка ${Number(row.discount_percent)}% ${formatOrderCondition(row)}`;
  }

  if (row.prize_type === 'discount_fixed') {
    return `Скидка ${Number(row.discount_amount).toLocaleString('ru-RU')} ₽ ${formatOrderCondition(row)}`;
  }

  if (row.prize_type === 'special') {
    return row.title;
  }

  if (row.prize_type === 'bonus_coins') {
    return `${row.bonus_coins} монет`;
  }

  return row.title;
}

function formatWheelPrizeCatalog(row) {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    shortLabel: row.short_label,
    description: row.description,
    prizeType: row.prize_type,
    discountPercent: row.discount_percent ? Number(row.discount_percent) : null,
    discountAmount: row.discount_amount ? Number(row.discount_amount) : null,
    minOrderAmount: row.min_order_amount ? Number(row.min_order_amount) : null,
    bonusCoins: Number(row.bonus_coins || 0),
    probabilityWeight: Number(row.probability_weight || 0),
    minLevelCode: row.min_level_code,
    segmentColor: row.segment_color,
    legalLine: formatOrderCondition(row)
  };
}

function formatWheelPrizeInstance(row) {
  if (!row) return null;

  const title = row.title || row.reward_title || 'Приз';
  const statusMap = {
    won: 'выигран',
    active: 'активирован',
    redeemed: 'списан'
  };

  return {
    id: row.id,
    title,
    shortLabel: row.short_label || title,
    description: row.description || row.reward_description || '',
    prizeType: row.prize_type || null,
    discountPercent: row.discount_percent ? Number(row.discount_percent) : null,
    discountAmount: row.discount_amount ? Number(row.discount_amount) : null,
    minOrderAmount: row.min_order_amount ? Number(row.min_order_amount) : null,
    bonusCoins: Number(row.bonus_coins || 0),
    segmentColor: row.segment_color || '#F29100',
    status: row.status,
    statusLabel: statusMap[row.status] || row.status,
    expiresAt: row.expires_at,
    wonAt: row.won_at,
    activatedAt: row.activated_at,
    legalLine: formatOrderCondition(row)
  };
}

function buildActivePromotion(levelReward, wheelPrize) {
  if (wheelPrize) {
    return {
      source: 'wheel',
      title: wheelPrize.title,
      subtitle: describeWheelPrize(wheelPrize),
      expiresAt: wheelPrize.expires_at,
      status: wheelPrize.status
    };
  }

  if (levelReward && levelReward.status === 'selected') {
    return {
      source: 'level',
      title: levelReward.reward_title,
      subtitle: levelReward.reward_description,
      expiresAt: levelReward.expires_at,
      status: levelReward.status
    };
  }

  return null;
}

async function loadGuestRow(pool, guestId) {
  return (await pool.query(`
    SELECT *
    FROM loyalty_guests
    WHERE id = $1
    LIMIT 1
  `, [guestId])).rows[0] || null;
}

async function loadGuestDashboard(pool, guestRow) {
  const guest = typeof guestRow === 'number' ? await loadGuestRow(pool, guestRow) : guestRow;
  if (!guest) return null;

  const level = getLevelByVisits(Number(guest.total_visits || 0));
  const nextLevel = getNextLevel(Number(guest.total_visits || 0));
  const levelReward = await getOpenLevelReward(pool, guest.id);
  const selectedLevelReward = levelReward?.status === 'selected' ? levelReward : null;
  const rewardPool = await getRewardPool(pool, level.code);
  const wheelPool = await getWheelPrizePool(pool, level.code);
  const activeWheelPrize = await getActiveWheelPrize(pool, guest.id);
  const recentWheelPrizes = await getRecentWheelPrizes(pool, guest.id);
  const pendingWheelCount = await getPendingWheelCount(pool, guest.id);
  const match = await getMatchMeta(pool, guest.id);
  const activePromotion = buildActivePromotion(selectedLevelReward, activeWheelPrize);

  return {
    id: guest.id,
    displayName: guest.display_name,
    phone: guest.phone,
    phoneLast4: guest.phone_last4,
    totalVisits: Number(guest.total_visits || 0),
    currentStamps: Number(guest.current_stamps || 0),
    averageCheck: Number(guest.average_check || 0),
    coins: Number(guest.coins || 0),
    wheelSpinsCount: Number(guest.wheel_spins_count || 0),
    inactiveDays: guest.last_visit_at
      ? Math.floor((Date.now() - new Date(guest.last_visit_at).getTime()) / (1000 * 60 * 60 * 24))
      : null,
    level,
    nextLevel,
    reward: levelReward ? {
      id: levelReward.id,
      status: levelReward.status,
      expiresAt: levelReward.expires_at,
      selectedRewardId: levelReward.reward_catalog_id,
      selectedRewardTitle: levelReward.reward_title,
      description: levelReward.reward_description
    } : null,
    rewardPool,
    activePromotion,
    wheel: {
      coins: Number(guest.coins || 0),
      canSpin: Number(guest.coins || 0) > 0,
      pendingPrizeCount: pendingWheelCount,
      activePrize: formatWheelPrizeInstance(activeWheelPrize),
      recentPrizes: recentWheelPrizes.map(formatWheelPrizeInstance),
      pool: wheelPool.map(formatWheelPrizeCatalog)
    },
    match
  };
}

function assertPhone(phone) {
  return normalizePhone(phone).length >= 10;
}

async function requireAdmin(req, res, pool) {
  const requester = await resolveRequester(req, pool);
  if (!requester.telegramUser || !requester.isAdmin) {
    res.status(403).json({ error: 'Доступ только для администраторов' });
    return null;
  }
  return requester;
}

function pickWeightedPrize(poolItems) {
  const expandedWeight = poolItems.reduce((sum, item) => sum + Number(item.probability_weight || 0), 0);
  let cursor = Math.random() * expandedWeight;

  for (const item of poolItems) {
    cursor -= Number(item.probability_weight || 0);
    if (cursor <= 0) return item;
  }

  return poolItems[poolItems.length - 1];
}

async function registerLoyaltyRoutes(app, pool) {
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

      res.json({ guest: await loadGuestDashboard(pool, guest) });
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

      res.json({ guest: await loadGuestDashboard(pool, requester.guest) });
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
      const levelReward = await getOpenLevelReward(pool, requester.guest.id);
      const activeWheelPrize = await getActiveWheelPrize(pool, requester.guest.id);

      if (!levelReward || levelReward.id !== instanceId) {
        return res.status(404).json({ error: 'Активная награда уровня не найдена' });
      }

      if (activeWheelPrize) {
        return res.status(409).json({ error: 'Сначала используй активированный приз из колеса. Одновременно активировать два приза нельзя.' });
      }

      const level = getLevelByVisits(Number(requester.guest.total_visits || 0));
      const rewardPool = await getRewardPool(pool, level.code);
      const allowedReward = rewardPool.find(item => item.id === rewardCatalogId);
      if (!allowedReward) {
        return res.status(400).json({ error: 'Эта награда недоступна для текущего уровня' });
      }

      await pool.query(`
        UPDATE loyalty_reward_instances
        SET reward_catalog_id = $2,
            status = 'selected',
            selected_at = NOW(),
            selected_by_guest = true
        WHERE id = $1
      `, [instanceId, rewardCatalogId]);

      await appendAudit(pool, {
        guestId: requester.guest.id,
        actionType: 'level_reward_selected',
        actionSummary: `${requester.guest.display_name} активировал награду уровня "${allowedReward.title}"`,
        metadata: { rewardInstanceId: instanceId, rewardCatalogId }
      });

      res.json({ guest: await loadGuestDashboard(pool, requester.guest.id) });
    } catch (error) {
      console.error('❌ Loyalty reward select error:', error);
      res.status(500).json({ error: 'Ошибка выбора награды' });
    }
  });

  app.post('/api/loyalty/guest/wheel/spin', async (req, res) => {
    try {
      const requester = await resolveRequester(req, pool);
      if (!requester.telegramUser || !requester.guest) {
        return res.status(401).json({ error: 'Доступно только зарегистрированному гостю' });
      }

      const guest = await loadGuestRow(pool, requester.guest.id);
      if (Number(guest.coins || 0) < 1) {
        return res.status(400).json({ error: 'Нужна хотя бы 1 монета для прокрутки колеса' });
      }

      const level = getLevelByVisits(Number(guest.total_visits || 0));
      const wheelPool = await getWheelPrizePool(pool, level.code);
      if (!wheelPool.length) {
        return res.status(400).json({ error: 'Для текущего уровня сегменты колеса ещё не настроены' });
      }

      const pickedPrize = pickWeightedPrize(wheelPool);

      const updatedGuest = (await pool.query(`
        UPDATE loyalty_guests
        SET coins = GREATEST(coins - 1, 0),
            wheel_spins_count = wheel_spins_count + 1,
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [guest.id])).rows[0];

      const spin = (await pool.query(`
        INSERT INTO loyalty_wheel_spins (guest_id, prize_catalog_id, coin_cost)
        VALUES ($1, $2, 1)
        RETURNING *
      `, [guest.id, pickedPrize.id])).rows[0];

      const prizeInstance = (await pool.query(`
        INSERT INTO loyalty_wheel_prize_instances (
          guest_id,
          wheel_spin_id,
          prize_catalog_id,
          status,
          expires_at,
          prize_snapshot
        )
        VALUES ($1, $2, $3, 'won', NOW() + INTERVAL '14 days', $4::jsonb)
        RETURNING *
      `, [
        guest.id,
        spin.id,
        pickedPrize.id,
        JSON.stringify({
          title: pickedPrize.title,
          shortLabel: pickedPrize.short_label,
          prizeType: pickedPrize.prize_type,
          discountPercent: pickedPrize.discount_percent,
          discountAmount: pickedPrize.discount_amount,
          minOrderAmount: pickedPrize.min_order_amount
        })
      ])).rows[0];

      await appendAudit(pool, {
        guestId: guest.id,
        actionType: 'wheel_spin',
        actionSummary: `${guest.display_name} прокрутил колесо и выиграл "${pickedPrize.title}"`,
        metadata: {
          wheelSpinId: spin.id,
          prizeCatalogId: pickedPrize.id,
          coinSpent: 1
        }
      });

      res.json({
        prize: formatWheelPrizeInstance({ ...prizeInstance, ...pickedPrize }),
        guest: await loadGuestDashboard(pool, updatedGuest)
      });
    } catch (error) {
      console.error('❌ Loyalty wheel spin error:', error);
      res.status(500).json({ error: 'Ошибка прокрутки колеса' });
    }
  });

  app.post('/api/loyalty/guest/wheel/prizes/:id/activate', async (req, res) => {
    try {
      const requester = await resolveRequester(req, pool);
      if (!requester.telegramUser || !requester.guest) {
        return res.status(401).json({ error: 'Доступно только зарегистрированному гостю' });
      }

      const prizeId = Number(req.params.id);
      const selectedLevelReward = await getSelectedLevelReward(pool, requester.guest.id);
      const activeWheelPrize = await getActiveWheelPrize(pool, requester.guest.id);

      if (selectedLevelReward) {
        return res.status(409).json({ error: 'Сначала используй активную награду уровня. Одновременно активировать два приза нельзя.' });
      }

      if (activeWheelPrize) {
        return res.status(409).json({ error: 'У тебя уже есть активированный приз из колеса.' });
      }

      const prizeResult = await pool.query(`
        SELECT
          i.*,
          c.*
        FROM loyalty_wheel_prize_instances i
        JOIN loyalty_wheel_prize_catalog c ON c.id = i.prize_catalog_id
        WHERE i.id = $1
          AND i.guest_id = $2
          AND i.status = 'won'
        LIMIT 1
      `, [prizeId, requester.guest.id]);

      const prize = prizeResult.rows[0];
      if (!prize) {
        return res.status(404).json({ error: 'Выигранный приз не найден или уже активирован' });
      }

      await pool.query(`
        UPDATE loyalty_wheel_prize_instances
        SET status = 'active',
            activated_at = NOW()
        WHERE id = $1
      `, [prizeId]);

      await appendAudit(pool, {
        guestId: requester.guest.id,
        actionType: 'wheel_prize_activated',
        actionSummary: `${requester.guest.display_name} активировал приз колеса "${prize.title}"`,
        metadata: { prizeInstanceId: prizeId, prizeCatalogId: prize.prize_catalog_id }
      });

      res.json({ guest: await loadGuestDashboard(pool, requester.guest.id) });
    } catch (error) {
      console.error('❌ Loyalty wheel activate error:', error);
      res.status(500).json({ error: 'Ошибка активации приза' });
    }
  });

  app.post('/api/loyalty/guest/match/start', async (req, res) => {
    try {
      const requester = await resolveRequester(req, pool);
      if (!requester.telegramUser || !requester.guest) {
        return res.status(401).json({ error: 'Доступно только зарегистрированному гостю' });
      }

      const today = getMskDateString();
      const alreadyPlayed = (await pool.query(`
        SELECT id
        FROM loyalty_match_sessions
        WHERE guest_id = $1
          AND (started_at AT TIME ZONE 'Europe/Moscow')::date = $2::date
        LIMIT 1
      `, [requester.guest.id, today])).rows[0];

      if (alreadyPlayed) {
        return res.status(409).json({ error: 'Сегодня матч-игра уже была доступна. Новая попытка откроется завтра.' });
      }

      const session = (await pool.query(`
        INSERT INTO loyalty_match_sessions (guest_id, target_score, duration_seconds)
        VALUES ($1, $2, $3)
        RETURNING *
      `, [requester.guest.id, MATCH_TARGET_SCORE, MATCH_DURATION_SECONDS])).rows[0];

      res.json({
        sessionId: session.id,
        durationSeconds: MATCH_DURATION_SECONDS,
        targetScore: MATCH_TARGET_SCORE
      });
    } catch (error) {
      console.error('❌ Loyalty match start error:', error);
      res.status(500).json({ error: 'Ошибка запуска игры' });
    }
  });

  app.post('/api/loyalty/guest/match/finish', async (req, res) => {
    try {
      const requester = await resolveRequester(req, pool);
      if (!requester.telegramUser || !requester.guest) {
        return res.status(401).json({ error: 'Доступно только зарегистрированному гостю' });
      }

      const sessionId = Number(req.body.sessionId);
      const score = Math.max(0, Number(req.body.score || 0));
      const moves = Math.max(0, Number(req.body.moves || 0));
      const cascades = Math.max(0, Number(req.body.cascades || 0));

      const sessionResult = await pool.query(`
        SELECT *
        FROM loyalty_match_sessions
        WHERE id = $1
          AND guest_id = $2
          AND completed_at IS NULL
        LIMIT 1
      `, [sessionId, requester.guest.id]);

      const session = sessionResult.rows[0];
      if (!session) {
        return res.status(404).json({ error: 'Игровая сессия не найдена' });
      }

      const rewardGranted = score >= MATCH_TARGET_SCORE;

      await pool.query(`
        UPDATE loyalty_match_sessions
        SET completed_at = NOW(),
            score = $2,
            reward_granted = $3,
            state = $4::jsonb
        WHERE id = $1
      `, [
        sessionId,
        score,
        rewardGranted,
        JSON.stringify({ moves, cascades })
      ]);

      if (rewardGranted) {
        await pool.query(`
          UPDATE loyalty_guests
          SET coins = coins + 1,
              last_match_rewarded_on = $2::date,
              updated_at = NOW()
          WHERE id = $1
        `, [requester.guest.id, getMskDateString()]);

        await appendAudit(pool, {
          guestId: requester.guest.id,
          actionType: 'match_reward_granted',
          actionSummary: `${requester.guest.display_name} прошёл матч-игру и получил 1 монету`,
          metadata: { sessionId, score, moves, cascades }
        });
      } else {
        await appendAudit(pool, {
          guestId: requester.guest.id,
          actionType: 'match_finished',
          actionSummary: `${requester.guest.display_name} завершил матч-игру без награды`,
          metadata: { sessionId, score, moves, cascades }
        });
      }

      res.json({
        rewardGranted,
        guest: await loadGuestDashboard(pool, requester.guest.id)
      });
    } catch (error) {
      console.error('❌ Loyalty match finish error:', error);
      res.status(500).json({ error: 'Ошибка завершения игры' });
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
        const dashboard = await loadGuestDashboard(pool, guest);
        const matchesQuery = !query
          || guest.display_name.toLowerCase().includes(query)
          || guest.phone.includes(query)
          || guest.phone_last4.includes(query);

        if (!matchesQuery) continue;
        if (filter === 'reward' && !dashboard.activePromotion) continue;
        if (filter === 'inactive' && (dashboard.inactiveDays || 0) < 53) continue;
        if (filter === 'day' && !(dashboard.currentStamps >= 4 || dashboard.averageCheck < 3000 || dashboard.coins > 0)) continue;

        guests.push({
          id: dashboard.id,
          displayName: dashboard.displayName,
          phone: dashboard.phone,
          phoneLast4: dashboard.phoneLast4,
          totalVisits: dashboard.totalVisits,
          currentStamps: dashboard.currentStamps,
          averageCheck: dashboard.averageCheck,
          inactiveDays: dashboard.inactiveDays,
          coins: dashboard.coins,
          level: dashboard.level,
          activePromotion: dashboard.activePromotion,
          levelReward: dashboard.reward,
          wheel: {
            activePrize: dashboard.wheel.activePrize,
            pendingPrizeCount: dashboard.wheel.pendingPrizeCount
          }
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

      const guest = await loadGuestRow(pool, guestId);
      if (!guest) {
        return res.status(404).json({ error: 'Гость не найден' });
      }

      const openLevelReward = await getOpenLevelReward(pool, guest.id);
      const stampsAwarded = checkAmount >= 5000 ? 2 : 1;
      const appliedStamps = openLevelReward ? 0 : stampsAwarded;

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

      await pool.query(`
        UPDATE loyalty_guests
        SET total_visits = $2,
            current_stamps = $3,
            average_check = $4,
            level_code = $5,
            coins = coins + 1,
            last_visit_at = NOW(),
            last_seen_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
      `, [guest.id, totalVisits, currentStamps, averageCheck, level.code]);

      let openedReward = null;
      if (!openLevelReward && currentStamps >= 6) {
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
          coinsGranted: 1,
          rewardOpened: Boolean(openedReward)
        }
      });

      res.json({
        guest: await loadGuestDashboard(pool, guest.id),
        message: openLevelReward
          ? 'Визит зафиксирован, монета начислена, но штампы не добавлены: сначала нужно использовать текущую награду уровня.'
          : openedReward
            ? 'Визит подтверждён, монета начислена, новая награда уровня открыта автоматически.'
            : 'Визит подтверждён, монета начислена.'
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
          AND ri.status = 'selected'
        LIMIT 1
      `, [rewardId]);

      const reward = rewardResult.rows[0];
      if (!reward) {
        return res.status(404).json({ error: 'Награда уровня не найдена или уже списана' });
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
        actionType: 'level_reward_redeemed',
        actionSummary: `Списана награда уровня гостя ${reward.display_name}`,
        metadata: { rewardId, rewardTitle: reward.reward_title, comment }
      });

      res.json({ success: true, guest: await loadGuestDashboard(pool, reward.guest_id) });
    } catch (error) {
      console.error('❌ Loyalty admin level redeem error:', error);
      res.status(500).json({ error: 'Ошибка списания награды уровня' });
    }
  });

  app.post('/api/loyalty/admin/wheel-prizes/:id/redeem', async (req, res) => {
    try {
      const requester = await requireAdmin(req, res, pool);
      if (!requester) return;

      const prizeId = Number(req.params.id);
      const comment = String(req.body.comment || '').trim();

      const prizeResult = await pool.query(`
        SELECT
          i.*,
          g.display_name,
          c.title
        FROM loyalty_wheel_prize_instances i
        JOIN loyalty_guests g ON g.id = i.guest_id
        JOIN loyalty_wheel_prize_catalog c ON c.id = i.prize_catalog_id
        WHERE i.id = $1
          AND i.status = 'active'
        LIMIT 1
      `, [prizeId]);

      const prize = prizeResult.rows[0];
      if (!prize) {
        return res.status(404).json({ error: 'Активный приз из колеса не найден' });
      }

      await pool.query(`
        UPDATE loyalty_wheel_prize_instances
        SET status = 'redeemed',
            redeemed_at = NOW(),
            admin_comment = $2
        WHERE id = $1
      `, [prizeId, comment || null]);

      await appendAudit(pool, {
        guestId: prize.guest_id,
        adminId: requester.admin?.id || null,
        actionType: 'wheel_prize_redeemed',
        actionSummary: `Списан приз колеса гостя ${prize.display_name}`,
        metadata: { prizeId, prizeTitle: prize.title, comment }
      });

      res.json({ success: true, guest: await loadGuestDashboard(pool, prize.guest_id) });
    } catch (error) {
      console.error('❌ Loyalty admin wheel redeem error:', error);
      res.status(500).json({ error: 'Ошибка списания приза колеса' });
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
        LIMIT 80
      `);

      res.json({
        logs: result.rows.map(item => ({
          id: item.id,
          actionType: item.action_type,
          summary: item.action_summary,
          guestName: item.display_name,
          adminName: item.admin_name,
          createdAt: item.created_at,
          createdAtLabel: getMskDateTime(item.created_at),
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
