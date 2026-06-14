require('dotenv').config();
const mysql = require('mysql2/promise');

const config = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'R00tMySQL',
  database: process.env.DB_NAME || 'pkmn_cards_db'
};

let pool;

async function getPool() {
  if (pool) return pool;

  // First connect without database to ensure it exists
  const connection = await mysql.createConnection({
    host: config.host,
    user: config.user,
    password: config.password
  });

  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${config.database}\``);
  await connection.end();

  // Create connection pool with database
  pool = mysql.createPool({
    ...config,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  return pool;
}

// Starter decks definition
const STARTER_DECKS = [
  {
    name: 'Overgrowth (Grass/Water Starter)',
    cards: [
      { cardId: 'base1-2', count: 2 },   // Blastoise
      { cardId: 'base1-42', count: 3 },  // Wartortle
      { cardId: 'base1-63', count: 4 },  // Squirtle
      { cardId: 'base1-30', count: 3 },  // Ivysaur
      { cardId: 'base1-44', count: 4 },  // Bulbasaur
      { cardId: 'base1-69', count: 4 },  // Weedle
      { cardId: 'base1-33', count: 3 },  // Kakuna
      { cardId: 'base1-17', count: 1 },  // Beedrill
      { cardId: 'base1-91', count: 4 },  // Bill
      { cardId: 'base1-88', count: 2 },  // Professor Oak
      { cardId: 'base1-94', count: 4 },  // Potion
      { cardId: 'base1-95', count: 2 },  // Switch
      { cardId: 'base1-99', count: 14 }, // Grass Energy
      { cardId: 'base1-102', count: 14 } // Water Energy
    ]
  },
  {
    name: 'Zap! (Lightning/Psychic Starter)',
    cards: [
      { cardId: 'base1-1', count: 2 },   // Alakazam
      { cardId: 'base1-32', count: 3 },  // Kadabra
      { cardId: 'base1-43', count: 4 },  // Abra
      { cardId: 'base1-58', count: 4 },  // Pikachu
      { cardId: 'base1-14', count: 1 },  // Raichu
      { cardId: 'base1-53', count: 4 },  // Magnemite
      { cardId: 'base1-9', count: 2 },   // Magneton
      { cardId: 'base1-10', count: 2 },  // Mewtwo
      { cardId: 'base1-31', count: 2 },  // Jynx
      { cardId: 'base1-91', count: 4 },  // Bill
      { cardId: 'base1-93', count: 2 },  // Gust of Wind
      { cardId: 'base1-92', count: 4 },  // Energy Removal
      { cardId: 'base1-100', count: 14 },// Lightning Energy
      { cardId: 'base1-101', count: 12 } // Psychic Energy
    ]
  }
];

async function initDB() {
  const p = await getPool();

  // 1. Create Users Table
  await p.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(255) PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      victories INT DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 2. Create Decks Table
  await p.query(`
    CREATE TABLE IF NOT EXISTS decks (
      id VARCHAR(255) PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      cards JSON NOT NULL,
      is_starter BOOLEAN DEFAULT FALSE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 3. Create Battles Table
  await p.query(`
    CREATE TABLE IF NOT EXISTS battles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      opponent_name VARCHAR(255) NOT NULL,
      result ENUM('won', 'lost') NOT NULL,
      duration INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  console.log('MySQL Database and Tables initialized successfully.');
}

async function query(sql, params) {
  const p = await getPool();
  const [rows] = await p.execute(sql, params);
  return rows;
}

// User helper methods
async function findUserById(userId) {
  const rows = await query('SELECT * FROM users WHERE id = ?', [userId]);
  return rows[0] || null;
}

async function findUserByEmail(email) {
  const rows = await query('SELECT * FROM users WHERE email = ?', [email]);
  return rows[0] || null;
}

async function registerOrLoginUser(id, email, name) {
  let user = await findUserById(id);
  if (!user) {
    // Register new user
    await query('INSERT INTO users (id, email, name, victories) VALUES (?, ?, ?, 0)', [id, email, name]);
    user = { id, email, name, victories: 0 };
    
    // Seed starter decks
    for (let i = 0; i < STARTER_DECKS.length; i++) {
      const deck = STARTER_DECKS[i];
      const deckId = `starter-${id}-${i + 1}`;
      await query(
        'INSERT INTO decks (id, user_id, name, cards, is_starter) VALUES (?, ?, ?, ?, TRUE)',
        [deckId, id, deck.name, JSON.stringify(deck.cards)]
      );
    }
  }
  return user;
}

async function getUserDecks(userId) {
  return await query('SELECT * FROM decks WHERE user_id = ?', [userId]);
}

async function saveUserDeck(deckId, userId, name, cardsJson) {
  // Check if exists
  const rows = await query('SELECT id FROM decks WHERE id = ? AND user_id = ?', [deckId, userId]);
  if (rows.length > 0) {
    // Update
    await query('UPDATE decks SET name = ?, cards = ? WHERE id = ? AND user_id = ?', [name, cardsJson, deckId, userId]);
  } else {
    // Insert new
    await query('INSERT INTO decks (id, user_id, name, cards, is_starter) VALUES (?, ?, ?, ?, FALSE)', [deckId, userId, name, cardsJson]);
  }
  return { id: deckId, user_id: userId, name, cards: JSON.parse(cardsJson) };
}

async function deleteUserDeck(deckId, userId) {
  await query('DELETE FROM decks WHERE id = ? AND user_id = ? AND is_starter = FALSE', [deckId, userId]);
}

async function recordBattle(userId, opponentName, result, duration) {
  await query(
    'INSERT INTO battles (user_id, opponent_name, result, duration) VALUES (?, ?, ?, ?)',
    [userId, opponentName, result, duration]
  );
  if (result === 'won') {
    await query('UPDATE users SET victories = victories + 1 WHERE id = ?', [userId]);
  }
}

async function getUserBattleHistory(userId) {
  return await query('SELECT * FROM battles WHERE user_id = ? ORDER BY created_at DESC', [userId]);
}

async function getLeaderboard() {
  return await query(`
    SELECT name, victories, 
      (SELECT COUNT(*) FROM battles WHERE battles.user_id = users.id) as total_games 
    FROM users 
    ORDER BY victories DESC, name ASC 
    LIMIT 250
  `);
}

async function getUserLeaderboardPosition(userId) {
  const user = await findUserById(userId);
  if (!user) return { position: 0, victories: 0 };

  // Calculate position (count of users with more victories + 1)
  const rows = await query(
    'SELECT COUNT(*) as count FROM users WHERE victories > ? OR (victories = ? AND name < ?)',
    [user.victories, user.victories, user.name]
  );
  return {
    position: rows[0].count + 1,
    victories: user.victories
  };
}

module.exports = {
  config,
  STARTER_DECKS,
  initDB,
  query,
  findUserById,
  findUserByEmail,
  registerOrLoginUser,
  getUserDecks,
  saveUserDeck,
  deleteUserDeck,
  recordBattle,
  getUserBattleHistory,
  getLeaderboard,
  getUserLeaderboardPosition
};
