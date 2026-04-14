const { Pool } = require('pg');
require('dotenv').config();

console.log('DATABASE_URL из .env:');
console.log(process.env.DATABASE_URL);
console.log('\n---\n');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function testConnection() {
  try {
    console.log('Попытка подключения...');
    const result = await pool.query('SELECT NOW()');
    console.log('✅ Подключение успешно!');
    console.log('Время сервера:', result.rows[0].now);
  } catch (error) {
    console.error('❌ Ошибка подключения:');
    console.error(error.message);
  } finally {
    await pool.end();
  }
}

testConnection();
