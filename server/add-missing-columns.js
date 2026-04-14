require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function addMissingColumns() {
  try {
    console.log('🔧 Добавляю недостающие колонки...\n');

    // Добавляем колонки
    await pool.query(`
      ALTER TABLE bookings 
      ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS cancellation_reason TEXT
    `);
    
    console.log('✅ Колонки добавлены\n');

    // Проверяем структуру
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'bookings'
      ORDER BY ordinal_position
    `);

    console.log('📊 Структура таблицы bookings:');
    console.log('┌─────────────────────────┬──────────────────────────┬──────────────┐');
    console.log('│ Колонка                 │ Тип                      │ Nullable     │');
    console.log('├─────────────────────────┼──────────────────────────┼──────────────┤');
    
    result.rows.forEach(row => {
      const col = row.column_name.padEnd(23);
      const type = row.data_type.padEnd(24);
      const nullable = row.is_nullable.padEnd(12);
      console.log(`│ ${col} │ ${type} │ ${nullable} │`);
    });
    
    console.log('└─────────────────────────┴──────────────────────────┴──────────────┘\n');

    // Проверяем что нужные колонки есть
    const hasCancelledAt = result.rows.some(r => r.column_name === 'cancelled_at');
    const hasCancellationReason = result.rows.some(r => r.column_name === 'cancellation_reason');
    
    if (hasCancelledAt && hasCancellationReason) {
      console.log('✅ Колонки cancelled_at и cancellation_reason успешно добавлены!');
    } else {
      console.log('❌ ОШИБКА: Колонки не добавлены!');
    }

    console.log('\n🎉 Готово!\n');

    await pool.end();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Ошибка:', error.message);
    console.error('🔴 Детали:', error);
    await pool.end();
    process.exit(1);
  }
}

addMissingColumns();

