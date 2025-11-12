import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function setupDatabase() {
  try {
    // Create installations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS slack_installations (
        id SERIAL PRIMARY KEY,
        team_id VARCHAR(255) UNIQUE NOT NULL,
        team_name VARCHAR(255) NOT NULL,
        bot_user_id VARCHAR(255) NOT NULL,
        bot_access_token TEXT NOT NULL,
        scope TEXT,
        installed_by VARCHAR(255),
        installed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    console.log('✅ Database tables created successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error setting up database:', error);
    process.exit(1);
  }
}

setupDatabase();
