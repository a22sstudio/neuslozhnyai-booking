const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function initDatabase() {
  console.log('🔄 Подключение к базе данных Railway...\n');
  
  try {
    // Проверка подключения
    const testConnection = await pool.query('SELECT NOW()');
    console.log('✅ Подключение успешно!');
    console.log('📅 Время сервера:', testConnection.rows[0].now);
    console.log('\n' + '='.repeat(50) + '\n');
    
    // Чтение SQL файла
    const sqlPath = path.join(__dirname, 'setup.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log('📝 Выполнение SQL скрипта...\n');
    
    // Выполнение SQL
    await pool.query(sql);
    
    console.log('✅ SQL скрипт выполнен успешно!\n');
    console.log('='.repeat(50) + '\n');
    
    // Проверка созданных таблиц
    console.log('📊 Проверка созданных данных:\n');
    
    // Залы
    const halls = await pool.query('SELECT * FROM halls ORDER BY id');
    console.log('🏛️  ЗАЛЫ:');
    halls.rows.forEach(hall => {
      console.log(`   ${hall.id}. ${hall.name} (вместимость: ${hall.capacity} чел.)`);
    });
    
    // Столы
    const tables = await pool.query(`
      SELECT h.name as hall_name, t.table_number, t.capacity, t.furniture_description, t.has_playstation
      FROM tables t 
      JOIN halls h ON t.hall_id = h.id 
      ORDER BY h.id, t.table_number
    `);
    
    console.log('\n🪑 СТОЛЫ:');
    let currentHall = '';
    tables.rows.forEach(table => {
      if (currentHall !== table.hall_name) {
        currentHall = table.hall_name;
        console.log(`\n   ${currentHall}:`);
      }
      const psLabel = table.has_playstation ? ' • PlayStation' : '';
      console.log(`   - Стол ${table.table_number} (${table.capacity} мест, ${table.furniture_description})${psLabel}`);
    });
    
    // Рабочие часы
    const hours = await pool.query('SELECT * FROM working_hours ORDER BY day_of_week');
    const daysNames = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
    
    console.log('\n⏰ РАБОЧИЕ ЧАСЫ:');
    hours.rows.forEach(hour => {
      const status = hour.is_working ? '✅' : '❌ Выходной';
      console.log(`   ${daysNames[hour.day_of_week]}: ${hour.open_time.slice(0,5)} - ${hour.close_time.slice(0,5)} ${status}`);
    });
    
    console.log('\n' + '='.repeat(50));
    console.log('\n🎉 База данных успешно инициализирована!\n');
    console.log('Теперь можно запустить сервер: node server.js\n');
    
  } catch (error) {
    console.error('\n❌ ОШИБКА:', error.message);
    console.error('\nПодробности:', error);
  } finally {
    await pool.end();
  }
}

// Запуск
initDatabase();
