-- Создание таблиц
CREATE TABLE IF NOT EXISTS halls (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  capacity INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tables (
  id SERIAL PRIMARY KEY,
  hall_id INTEGER REFERENCES halls(id) ON DELETE CASCADE,
  table_number VARCHAR(20) NOT NULL UNIQUE,
  public_label VARCHAR(100),
  capacity INTEGER NOT NULL,
  min_capacity INTEGER DEFAULT 1,
  furniture_description TEXT,
  features TEXT,
  has_playstation BOOLEAN DEFAULT false,
  position_x FLOAT NOT NULL,
  position_y FLOAT NOT NULL,
  width FLOAT DEFAULT 60,
  height FLOAT DEFAULT 60,
  shape VARCHAR(20) DEFAULT 'rect',
  is_vip BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  booking_number VARCHAR(20) UNIQUE,
  table_id INTEGER REFERENCES tables(id),
  hall_id INTEGER REFERENCES halls(id),
  booking_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME,
  duration INTEGER DEFAULT 120,
  customer_name VARCHAR(100) NOT NULL,
  customer_phone VARCHAR(20) NOT NULL,
  customer_email VARCHAR(100),
  guests_count INTEGER NOT NULL,
  comment TEXT,
  status VARCHAR(20) DEFAULT 'pending',
  deposit_required BOOLEAN DEFAULT false,
  deposit_amount DECIMAL(10,2),
  deposit_paid BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  cancelled_at TIMESTAMP,
  cancellation_reason TEXT
);

CREATE TABLE IF NOT EXISTS working_hours (
  id SERIAL PRIMARY KEY,
  day_of_week INTEGER NOT NULL,
  open_time TIME NOT NULL,
  close_time TIME NOT NULL,
  is_working BOOLEAN DEFAULT true,
  time_slot_duration INTEGER DEFAULT 30,
  UNIQUE(day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(booking_date);
CREATE INDEX IF NOT EXISTS idx_bookings_table ON bookings(table_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

-- Заполнение рабочих часов (Понедельник-Четверг)
INSERT INTO working_hours (day_of_week, open_time, close_time, time_slot_duration) 
SELECT 1, '14:00', '02:00', 30
WHERE NOT EXISTS (SELECT 1 FROM working_hours WHERE day_of_week = 1);

INSERT INTO working_hours (day_of_week, open_time, close_time, time_slot_duration) 
SELECT 2, '14:00', '02:00', 30
WHERE NOT EXISTS (SELECT 1 FROM working_hours WHERE day_of_week = 2);

INSERT INTO working_hours (day_of_week, open_time, close_time, time_slot_duration) 
SELECT 3, '14:00', '02:00', 30
WHERE NOT EXISTS (SELECT 1 FROM working_hours WHERE day_of_week = 3);

INSERT INTO working_hours (day_of_week, open_time, close_time, time_slot_duration) 
SELECT 4, '14:00', '02:00', 30
WHERE NOT EXISTS (SELECT 1 FROM working_hours WHERE day_of_week = 4);

-- Пятница-Суббота
INSERT INTO working_hours (day_of_week, open_time, close_time, time_slot_duration) 
SELECT 5, '14:00', '03:00', 30
WHERE NOT EXISTS (SELECT 1 FROM working_hours WHERE day_of_week = 5);

INSERT INTO working_hours (day_of_week, open_time, close_time, time_slot_duration) 
SELECT 6, '14:00', '03:00', 30
WHERE NOT EXISTS (SELECT 1 FROM working_hours WHERE day_of_week = 6);

-- Воскресенье
INSERT INTO working_hours (day_of_week, open_time, close_time, is_working, time_slot_duration) 
SELECT 0, '14:00', '02:00', true, 30
WHERE NOT EXISTS (SELECT 1 FROM working_hours WHERE day_of_week = 0);

-- Залы
INSERT INTO halls (id, name, description, capacity) 
SELECT 1, 'Общий зал', 'Общий зал hookah spot "Не Усложняй" в Брянске', 24
WHERE NOT EXISTS (SELECT 1 FROM halls WHERE id = 1);

-- Столы "Не Усложняй"
INSERT INTO tables (hall_id, table_number, public_label, capacity, min_capacity, furniture_description, features, has_playstation, position_x, position_y, width, height, shape) 
SELECT 1, '1', 'Трехместный стол', 3, 1, 'Двухместный диван и кресло', 'Уютная смешанная посадка', false, 90, 165, 120, 90, 'sofa-mixed'
WHERE NOT EXISTS (SELECT 1 FROM tables WHERE table_number = '1');

INSERT INTO tables (hall_id, table_number, public_label, capacity, min_capacity, furniture_description, features, has_playstation, position_x, position_y, width, height, shape) 
SELECT 1, '2', 'Трехместный стол с PlayStation', 3, 1, 'Трехместный диван', 'PlayStation', true, 95, 315, 140, 90, 'sofa-ps'
WHERE NOT EXISTS (SELECT 1 FROM tables WHERE table_number = '2');

INSERT INTO tables (hall_id, table_number, public_label, capacity, min_capacity, furniture_description, features, has_playstation, position_x, position_y, width, height, shape) 
SELECT 1, '3', 'Четырехместный стол', 4, 2, 'Два двухместных дивана', 'Подходит для компании', false, 335, 325, 165, 90, 'sofa-double'
WHERE NOT EXISTS (SELECT 1 FROM tables WHERE table_number = '3');

INSERT INTO tables (hall_id, table_number, public_label, capacity, min_capacity, furniture_description, features, has_playstation, position_x, position_y, width, height, shape) 
SELECT 1, '4', 'Четырехместный стол', 4, 2, 'Два двухместных дивана', 'Подходит для компании', false, 565, 325, 165, 90, 'sofa-double'
WHERE NOT EXISTS (SELECT 1 FROM tables WHERE table_number = '4');

INSERT INTO tables (hall_id, table_number, public_label, capacity, min_capacity, furniture_description, features, has_playstation, position_x, position_y, width, height, shape) 
SELECT 1, '5', 'Двухместный стол', 2, 1, 'Два кресла', 'Компактная посадка', false, 880, 330, 95, 95, 'chairs'
WHERE NOT EXISTS (SELECT 1 FROM tables WHERE table_number = '5');

INSERT INTO tables (hall_id, table_number, public_label, capacity, min_capacity, furniture_description, features, has_playstation, position_x, position_y, width, height, shape) 
SELECT 1, '6', 'Четырехместный стол', 4, 2, 'Два двухместных дивана', 'Спокойная зона у стены', false, 855, 165, 165, 90, 'sofa-double'
WHERE NOT EXISTS (SELECT 1 FROM tables WHERE table_number = '6');

INSERT INTO tables (hall_id, table_number, public_label, capacity, min_capacity, furniture_description, features, has_playstation, position_x, position_y, width, height, shape) 
SELECT 1, '7', 'Четырехместный стол', 4, 2, 'Два двухместных дивана', 'Зона рядом с баром', false, 660, 165, 165, 90, 'sofa-double'
WHERE NOT EXISTS (SELECT 1 FROM tables WHERE table_number = '7');

-- ============================================
-- LOYALTY MVP
-- ============================================

CREATE TABLE IF NOT EXISTS loyalty_admins (
  id SERIAL PRIMARY KEY,
  telegram_user_id BIGINT UNIQUE,
  telegram_username VARCHAR(100),
  phone_last4 VARCHAR(4),
  full_name VARCHAR(120) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loyalty_guests (
  id SERIAL PRIMARY KEY,
  telegram_user_id BIGINT UNIQUE,
  telegram_username VARCHAR(100),
  first_name VARCHAR(120),
  last_name VARCHAR(120),
  display_name VARCHAR(120) NOT NULL,
  phone VARCHAR(20) NOT NULL UNIQUE,
  phone_last4 VARCHAR(4) NOT NULL,
  total_visits INTEGER DEFAULT 0,
  current_stamps INTEGER DEFAULT 0,
  level_code VARCHAR(20) DEFAULT 'guest',
  average_check DECIMAL(10,2) DEFAULT 0,
  last_visit_at TIMESTAMP,
  last_seen_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loyalty_reward_catalog (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  title VARCHAR(150) NOT NULL,
  description TEXT,
  min_level_code VARCHAR(20) NOT NULL DEFAULT 'guest',
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loyalty_reward_instances (
  id SERIAL PRIMARY KEY,
  guest_id INTEGER NOT NULL REFERENCES loyalty_guests(id) ON DELETE CASCADE,
  reward_catalog_id INTEGER REFERENCES loyalty_reward_catalog(id),
  status VARCHAR(20) NOT NULL DEFAULT 'available',
  opened_at TIMESTAMP DEFAULT NOW(),
  selected_at TIMESTAMP,
  redeemed_at TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  opened_after_visit_id INTEGER,
  selected_by_guest BOOLEAN DEFAULT false,
  admin_comment TEXT
);

CREATE TABLE IF NOT EXISTS loyalty_visits (
  id SERIAL PRIMARY KEY,
  guest_id INTEGER NOT NULL REFERENCES loyalty_guests(id) ON DELETE CASCADE,
  confirmed_by_admin_id INTEGER REFERENCES loyalty_admins(id),
  check_amount DECIMAL(10,2) DEFAULT 0,
  stamps_awarded INTEGER NOT NULL DEFAULT 1,
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loyalty_audit_log (
  id SERIAL PRIMARY KEY,
  guest_id INTEGER REFERENCES loyalty_guests(id) ON DELETE SET NULL,
  admin_id INTEGER REFERENCES loyalty_admins(id) ON DELETE SET NULL,
  action_type VARCHAR(50) NOT NULL,
  action_summary TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_loyalty_guests_phone_last4 ON loyalty_guests(phone_last4);
CREATE INDEX IF NOT EXISTS idx_loyalty_guests_level_code ON loyalty_guests(level_code);
CREATE INDEX IF NOT EXISTS idx_loyalty_reward_instances_guest_status ON loyalty_reward_instances(guest_id, status);
CREATE INDEX IF NOT EXISTS idx_loyalty_visits_guest_id ON loyalty_visits(guest_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_audit_guest_id ON loyalty_audit_log(guest_id);

INSERT INTO loyalty_reward_catalog (code, title, description, min_level_code, display_order)
SELECT 'welcome_boost', 'Welcome-бонус клуба', 'Базовый reward для старта в системе лояльности.', 'guest', 1
WHERE NOT EXISTS (SELECT 1 FROM loyalty_reward_catalog WHERE code = 'welcome_boost');

INSERT INTO loyalty_reward_catalog (code, title, description, min_level_code, display_order)
SELECT 'express_hookah', 'Экспресс кальян на электронной чаше Хука Про', 'Флагманская MVP-награда с сильной эмоцией и понятной себестоимостью.', 'svoy', 2
WHERE NOT EXISTS (SELECT 1 FROM loyalty_reward_catalog WHERE code = 'express_hookah');

INSERT INTO loyalty_reward_catalog (code, title, description, min_level_code, display_order)
SELECT 'double_day', 'Двойной штамп на следующий дневной визит', 'Награда для загрузки спокойных часов и быстрого возврата.', 'svoy', 3
WHERE NOT EXISTS (SELECT 1 FROM loyalty_reward_catalog WHERE code = 'double_day');

INSERT INTO loyalty_reward_catalog (code, title, description, min_level_code, display_order)
SELECT 'personal_offer', 'Персональная цена на выбранную позицию', 'Точечная скидка без ощущения массовой акции.', 'svoy', 4
WHERE NOT EXISTS (SELECT 1 FROM loyalty_reward_catalog WHERE code = 'personal_offer');

INSERT INTO loyalty_reward_catalog (code, title, description, min_level_code, display_order)
SELECT 'daytime_special', 'Дневной special для своих', 'Закрытый reward для гостей, которых важно привести в дневные часы.', 'circle', 5
WHERE NOT EXISTS (SELECT 1 FROM loyalty_reward_catalog WHERE code = 'daytime_special');

INSERT INTO loyalty_reward_catalog (code, title, description, min_level_code, display_order)
SELECT 'secret_position', 'Секретная позиция недели', 'Reward уровня клуба "В кругу" и выше.', 'circle', 6
WHERE NOT EXISTS (SELECT 1 FROM loyalty_reward_catalog WHERE code = 'secret_position');

INSERT INTO loyalty_reward_catalog (code, title, description, min_level_code, display_order)
SELECT 'legend_surprise', 'Сюрприз от команды', 'Редкая статусная награда только для уровня "Легенда".', 'legend', 7
WHERE NOT EXISTS (SELECT 1 FROM loyalty_reward_catalog WHERE code = 'legend_surprise');

ALTER TABLE loyalty_guests
ADD COLUMN IF NOT EXISTS coins INTEGER DEFAULT 0;

ALTER TABLE loyalty_guests
ADD COLUMN IF NOT EXISTS wheel_spins_count INTEGER DEFAULT 0;

ALTER TABLE loyalty_guests
ADD COLUMN IF NOT EXISTS last_match_rewarded_on DATE;

CREATE TABLE IF NOT EXISTS loyalty_wheel_prize_catalog (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  title VARCHAR(150) NOT NULL,
  short_label VARCHAR(50) NOT NULL,
  description TEXT,
  prize_type VARCHAR(20) NOT NULL DEFAULT 'discount_percent',
  discount_percent DECIMAL(5,2),
  discount_amount DECIMAL(10,2),
  min_order_amount DECIMAL(10,2),
  bonus_coins INTEGER DEFAULT 0,
  probability_weight INTEGER NOT NULL DEFAULT 1,
  min_level_code VARCHAR(20) NOT NULL DEFAULT 'guest',
  segment_color VARCHAR(20) DEFAULT '#F29100',
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loyalty_wheel_spins (
  id SERIAL PRIMARY KEY,
  guest_id INTEGER NOT NULL REFERENCES loyalty_guests(id) ON DELETE CASCADE,
  prize_catalog_id INTEGER REFERENCES loyalty_wheel_prize_catalog(id),
  coin_cost INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loyalty_wheel_prize_instances (
  id SERIAL PRIMARY KEY,
  guest_id INTEGER NOT NULL REFERENCES loyalty_guests(id) ON DELETE CASCADE,
  wheel_spin_id INTEGER REFERENCES loyalty_wheel_spins(id) ON DELETE SET NULL,
  prize_catalog_id INTEGER NOT NULL REFERENCES loyalty_wheel_prize_catalog(id),
  status VARCHAR(20) NOT NULL DEFAULT 'won',
  won_at TIMESTAMP DEFAULT NOW(),
  activated_at TIMESTAMP,
  redeemed_at TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  admin_comment TEXT,
  prize_snapshot JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS loyalty_match_sessions (
  id SERIAL PRIMARY KEY,
  guest_id INTEGER NOT NULL REFERENCES loyalty_guests(id) ON DELETE CASCADE,
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  score INTEGER DEFAULT 0,
  target_score INTEGER DEFAULT 2000,
  duration_seconds INTEGER DEFAULT 120,
  reward_granted BOOLEAN DEFAULT false,
  state JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_loyalty_wheel_spins_guest_id ON loyalty_wheel_spins(guest_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_wheel_prize_instances_guest_status ON loyalty_wheel_prize_instances(guest_id, status);
CREATE INDEX IF NOT EXISTS idx_loyalty_match_sessions_guest_id ON loyalty_match_sessions(guest_id);

INSERT INTO loyalty_wheel_prize_catalog (
  code, title, short_label, description, prize_type, discount_percent, discount_amount,
  min_order_amount, probability_weight, min_level_code, segment_color, display_order
)
SELECT 'wheel_5_percent', 'Скидка 5% от 1 500 ₽', '5%', 'Мягкий частый приз с безопасной экономикой.', 'discount_percent', 5, NULL,
  1500, 24, 'guest', '#A96C18', 1
WHERE NOT EXISTS (SELECT 1 FROM loyalty_wheel_prize_catalog WHERE code = 'wheel_5_percent');

INSERT INTO loyalty_wheel_prize_catalog (
  code, title, short_label, description, prize_type, discount_percent, discount_amount,
  min_order_amount, probability_weight, min_level_code, segment_color, display_order
)
SELECT 'wheel_7_percent', 'Скидка 7% от 1 800 ₽', '7%', 'Частый приз для ощущения реальной выгоды без сильного давления на маржу.', 'discount_percent', 7, NULL,
  1800, 18, 'guest', '#C27D1C', 2
WHERE NOT EXISTS (SELECT 1 FROM loyalty_wheel_prize_catalog WHERE code = 'wheel_7_percent');

INSERT INTO loyalty_wheel_prize_catalog (
  code, title, short_label, description, prize_type, discount_percent, discount_amount,
  min_order_amount, probability_weight, min_level_code, segment_color, display_order
)
SELECT 'wheel_300_fix', 'Скидка 300 ₽ от 2 500 ₽', '300₽', 'Простой фиксированный приз для понятного восприятия.', 'discount_fixed', NULL, 300,
  2500, 14, 'svoy', '#D88A1E', 3
WHERE NOT EXISTS (SELECT 1 FROM loyalty_wheel_prize_catalog WHERE code = 'wheel_300_fix');

INSERT INTO loyalty_wheel_prize_catalog (
  code, title, short_label, description, prize_type, discount_percent, discount_amount,
  min_order_amount, probability_weight, min_level_code, segment_color, display_order
)
SELECT 'wheel_10_percent', 'Скидка 10% от 3 000 ₽', '10%', 'Средний приз для частых гостей.', 'discount_percent', 10, NULL,
  3000, 10, 'svoy', '#E59B2C', 4
WHERE NOT EXISTS (SELECT 1 FROM loyalty_wheel_prize_catalog WHERE code = 'wheel_10_percent');

INSERT INTO loyalty_wheel_prize_catalog (
  code, title, short_label, description, prize_type, discount_percent, discount_amount,
  min_order_amount, probability_weight, min_level_code, segment_color, display_order
)
SELECT 'wheel_400_fix', 'Скидка 400 ₽ от 3 500 ₽', '400₽', 'Хороший приз среднего веса.', 'discount_fixed', NULL, 400,
  3500, 8, 'svoy', '#EEA731', 5
WHERE NOT EXISTS (SELECT 1 FROM loyalty_wheel_prize_catalog WHERE code = 'wheel_400_fix');

INSERT INTO loyalty_wheel_prize_catalog (
  code, title, short_label, description, prize_type, discount_percent, discount_amount,
  min_order_amount, probability_weight, min_level_code, segment_color, display_order
)
SELECT 'wheel_12_percent', 'Скидка 12% от 4 000 ₽', '12%', 'Более заметная награда для уровня "В кругу".', 'discount_percent', 12, NULL,
  4000, 6, 'circle', '#F1B236', 6
WHERE NOT EXISTS (SELECT 1 FROM loyalty_wheel_prize_catalog WHERE code = 'wheel_12_percent');

INSERT INTO loyalty_wheel_prize_catalog (
  code, title, short_label, description, prize_type, discount_percent, discount_amount,
  min_order_amount, probability_weight, min_level_code, segment_color, display_order
)
SELECT 'wheel_500_fix', 'Скидка 500 ₽ от 4 500 ₽', '500₽', 'Редкий prize для более высоких чеков.', 'discount_fixed', NULL, 500,
  4500, 5, 'circle', '#F4BF49', 7
WHERE NOT EXISTS (SELECT 1 FROM loyalty_wheel_prize_catalog WHERE code = 'wheel_500_fix');

INSERT INTO loyalty_wheel_prize_catalog (
  code, title, short_label, description, prize_type, discount_percent, discount_amount,
  min_order_amount, probability_weight, min_level_code, segment_color, display_order
)
SELECT 'wheel_15_percent', 'Скидка 15% от 5 000 ₽', '15%', 'Сильный редкий prize для статуса "Легенда".', 'discount_percent', 15, NULL,
  5000, 3, 'legend', '#F8CA58', 8
WHERE NOT EXISTS (SELECT 1 FROM loyalty_wheel_prize_catalog WHERE code = 'wheel_15_percent');

INSERT INTO loyalty_wheel_prize_catalog (
  code, title, short_label, description, prize_type, discount_percent, discount_amount,
  min_order_amount, probability_weight, min_level_code, segment_color, display_order
)
SELECT 'wheel_700_fix', 'Скидка 700 ₽ от 6 000 ₽', '700₽', 'Редкий фиксированный приз с высокой минимальной суммой.', 'discount_fixed', NULL, 700,
  6000, 2, 'legend', '#FFD775', 9
WHERE NOT EXISTS (SELECT 1 FROM loyalty_wheel_prize_catalog WHERE code = 'wheel_700_fix');

INSERT INTO loyalty_wheel_prize_catalog (
  code, title, short_label, description, prize_type, discount_percent, discount_amount,
  min_order_amount, probability_weight, min_level_code, segment_color, display_order
)
SELECT 'wheel_express', 'Экспресс кальян на электронной чаше Хука Про от 5 500 ₽', 'Хука', 'Самый редкий эмоциональный джекпот в колесе.', 'special', NULL, NULL,
  5500, 1, 'legend', '#FFF1B8', 10
WHERE NOT EXISTS (SELECT 1 FROM loyalty_wheel_prize_catalog WHERE code = 'wheel_express');
