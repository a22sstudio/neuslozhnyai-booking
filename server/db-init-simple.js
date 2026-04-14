require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

// Подключение к БД
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// SQL запросы прямо в коде
const sqlCommands = [
  // Таблица залов
  `CREATE TABLE IF NOT EXISTS halls (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    capacity INTEGER NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
  )`,

  // Таблица столов
  `CREATE TABLE IF NOT EXISTS tables (
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
  )`,

  // Таблица бронирований
  `CREATE TABLE IF NOT EXISTS bookings (
    id SERIAL PRIMARY KEY,
    booking_number VARCHAR(20) UNIQUE,
    table_id INTEGER REFERENCES tables(id),
    hall_id INTEGER REFERENCES halls(id),
    booking_date DATE NOT NULL,
    booking_time TIME NOT NULL,
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
  )`,

  // Таблица рабочих часов
  `CREATE TABLE IF NOT EXISTS working_hours (
    id SERIAL PRIMARY KEY,
    day_of_week INTEGER NOT NULL UNIQUE,
    open_time TIME NOT NULL,
    close_time TIME NOT NULL,
    is_working BOOLEAN DEFAULT true,
    time_slot_duration INTEGER DEFAULT 30
  )`,

  // Индексы
  `CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(booking_date)`,
  `CREATE INDEX IF NOT EXISTS idx_bookings_table ON bookings(table_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status)`,

  // Рабочие часы
  `INSERT INTO working_hours (day_of_week, open_time, close_time, time_slot_duration) 
   SELECT 1, '14:00', '02:00', 30 WHERE NOT EXISTS (SELECT 1 FROM working_hours WHERE day_of_week = 1)`,
  
  `INSERT INTO working_hours (day_of_week, open_time, close_time, time_slot_duration) 
   SELECT 2, '14:00', '02:00', 30 WHERE NOT EXISTS (SELECT 1 FROM working_hours WHERE day_of_week = 2)`,
  
  `INSERT INTO working_hours (day_of_week, open_time, close_time, time_slot_duration) 
   SELECT 3, '14:00', '02:00', 30 WHERE NOT EXISTS (SELECT 1 FROM working_hours WHERE day_of_week = 3)`,
  
  `INSERT INTO working_hours (day_of_week, open_time, close_time, time_slot_duration) 
   SELECT 4, '14:00', '02:00', 30 WHERE NOT EXISTS (SELECT 1 FROM working_hours WHERE day_of_week = 4)`,
  
  `INSERT INTO working_hours (day_of_week, open_time, close_time, time_slot_duration) 
   SELECT 5, '14:00', '03:00', 30 WHERE NOT EXISTS (SELECT 1 FROM working_hours WHERE day_of_week = 5)`,
  
  `INSERT INTO working_hours (day_of_week, open_time, close_time, time_slot_duration) 
   SELECT 6, '14:00', '03:00', 30 WHERE NOT EXISTS (SELECT 1 FROM working_hours WHERE day_of_week = 6)`,
  
  `INSERT INTO working_hours (day_of_week, open_time, close_time, is_working, time_slot_duration) 
   SELECT 0, '14:00', '02:00', true, 30 WHERE NOT EXISTS (SELECT 1 FROM working_hours WHERE day_of_week = 0)`,

  // Залы
  `INSERT INTO halls (id, name, description, capacity) 
   SELECT 1, 'Общий зал', 'Общий зал hookah spot "Не Усложняй" в Брянске', 24 
   WHERE NOT EXISTS (SELECT 1 FROM halls WHERE id = 1)`,

  // Столы "Не Усложняй"
  `INSERT INTO tables (hall_id, table_number, public_label, capacity, min_capacity, furniture_description, features, has_playstation, position_x, position_y, width, height, shape) 
   SELECT 1, '1', 'Трехместный стол', 3, 1, 'Двухместный диван и кресло', 'Уютная смешанная посадка', false, 90, 165, 120, 90, 'sofa-mixed' 
   WHERE NOT EXISTS (SELECT 1 FROM tables WHERE table_number = '1')`,
  
  `INSERT INTO tables (hall_id, table_number, public_label, capacity, min_capacity, furniture_description, features, has_playstation, position_x, position_y, width, height, shape) 
   SELECT 1, '2', 'Трехместный стол с PlayStation', 3, 1, 'Трехместный диван', 'PlayStation', true, 95, 315, 140, 90, 'sofa-ps' 
   WHERE NOT EXISTS (SELECT 1 FROM tables WHERE table_number = '2')`,
  
  `INSERT INTO tables (hall_id, table_number, public_label, capacity, min_capacity, furniture_description, features, has_playstation, position_x, position_y, width, height, shape) 
   SELECT 1, '3', 'Четырехместный стол', 4, 2, 'Два двухместных дивана', 'Подходит для компании', false, 335, 325, 165, 90, 'sofa-double' 
   WHERE NOT EXISTS (SELECT 1 FROM tables WHERE table_number = '3')`,
  
  `INSERT INTO tables (hall_id, table_number, public_label, capacity, min_capacity, furniture_description, features, has_playstation, position_x, position_y, width, height, shape) 
   SELECT 1, '4', 'Четырехместный стол', 4, 2, 'Два двухместных дивана', 'Подходит для компании', false, 565, 325, 165, 90, 'sofa-double' 
   WHERE NOT EXISTS (SELECT 1 FROM tables WHERE table_number = '4')`,
  
  `INSERT INTO tables (hall_id, table_number, public_label, capacity, min_capacity, furniture_description, features, has_playstation, position_x, position_y, width, height, shape) 
   SELECT 1, '5', 'Двухместный стол', 2, 1, 'Два кресла', 'Компактная посадка', false, 880, 330, 95, 95, 'chairs' 
   WHERE NOT EXISTS (SELECT 1 FROM tables WHERE table_number = '5')`,
  
  `INSERT INTO tables (hall_id, table_number, public_label, capacity, min_capacity, furniture_description, features, has_playstation, position_x, position_y, width, height, shape) 
   SELECT 1, '6', 'Четырехместный стол', 4, 2, 'Два двухместных дивана', 'Спокойная зона у стены', false, 855, 165, 165, 90, 'sofa-double' 
   WHERE NOT EXISTS (SELECT 1 FROM tables WHERE table_number = '6')`,
  
  `INSERT INTO tables (hall_id, table_number, public_label, capacity, min_capacity, furniture_description, features, has_playstation, position_x, position_y, width, height, shape) 
   SELECT 1, '7', 'Четырехместный стол', 4, 2, 'Два двухместных дивана', 'Зона рядом с баром', false, 660, 165, 165, 90, 'sofa-double' 
   WHERE NOT EXISTS (SELECT 1 FROM tables WHERE table_number = '7')`,
];

async function initDB() {
  console.log('🔄 Инициализация базы данных...\n');
  
  try {
    console.log('Проверка подключения...');
    await pool.query('SELECT NOW()');
    console.log('✅ Подключение успешно!\n');

    console.log('Создание таблиц и заполнение данными...');
    
    for (let i = 0; i < sqlCommands.length; i++) {
      await pool.query(sqlCommands[i]);
      process.stdout.write(`\rВыполнено: ${i + 1}/${sqlCommands.length}`);
    }
    
    console.log('\n\n✅ База данных готова!\n');

    // Проверка
    const halls = await pool.query('SELECT * FROM halls');
    console.log('📊 Залы:', halls.rows.length);
    
    const tables = await pool.query('SELECT * FROM tables');
    console.log('🪑 Столы:', tables.rows.length);
    
    const hours = await pool.query('SELECT * FROM working_hours');
    console.log('⏰ Рабочие часы:', hours.rows.length, 'дней\n');

    console.log('🎉 Готово! Можно запускать сервер: node server.js\n');

  } catch (error) {
    console.error('\n❌ Ошибка:', error.message);
    console.error('\nДетали:', error);
  } finally {
    await pool.end();
  }
}

initDB();
