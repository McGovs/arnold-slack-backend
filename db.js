import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Save or update installation
export async function saveInstallation(installation) {
  const query = `
    INSERT INTO slack_installations (
      team_id, team_name, bot_user_id, bot_access_token, scope, installed_by, installed_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    ON CONFLICT (team_id) 
    DO UPDATE SET
      team_name = $2,
      bot_user_id = $3,
      bot_access_token = $4,
      scope = $5,
      updated_at = NOW()
    RETURNING *;
  `;
  
  const values = [
    installation.teamId,
    installation.teamName,
    installation.botUserId,
    installation.accessToken,
    installation.scope,
    installation.installedBy
  ];
  
  try {
    const result = await pool.query(query, values);
    return result.rows[0];
  } catch (error) {
    console.error('Error saving installation:', error);
    throw error;
  }
}

// Get bot token for a specific team
export async function getBotToken(teamId) {
  const query = 'SELECT bot_access_token FROM slack_installations WHERE team_id = $1';
  
  try {
    const result = await pool.query(query, [teamId]);
    return result.rows[0]?.bot_access_token || null;
  } catch (error) {
    console.error('Error getting bot token:', error);
    throw error;
  }
}

// Get bot token by user ID (looks up which team the user belongs to)
export async function getBotTokenByUserId(userId) {
  // For now, we'll need to determine team from context
  // This is a helper that will be used differently
  return null;
}

// Get all installations
export async function getAllInstallations() {
  const query = 'SELECT * FROM slack_installations ORDER BY installed_at DESC';
  
  try {
    const result = await pool.query(query);
    return result.rows;
  } catch (error) {
    console.error('Error getting installations:', error);
    throw error;
  }
}

// Delete installation
export async function deleteInstallation(teamId) {
  const query = 'DELETE FROM slack_installations WHERE team_id = $1';
  
  try {
    await pool.query(query, [teamId]);
    return true;
  } catch (error) {
    console.error('Error deleting installation:', error);
    throw error;
  }
}
