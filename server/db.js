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
      victories INT DEFAULT 0,
      ranked_category VARCHAR(50) DEFAULT 'Principiante',
      ranked_level INT DEFAULT 1,
      consecutive_wins INT DEFAULT 0,
      consecutive_losses INT DEFAULT 0,
      master_ranked_wins INT DEFAULT 0,
      avatar VARCHAR(255) DEFAULT 'Icons/pikachu-.webp'
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Migrations for users table if columns do not exist
  try {
    const columnsToAdd = [
      { name: 'ranked_category', def: "VARCHAR(50) DEFAULT 'Principiante'" },
      { name: 'ranked_level', def: 'INT DEFAULT 1' },
      { name: 'consecutive_wins', def: 'INT DEFAULT 0' },
      { name: 'consecutive_losses', def: 'INT DEFAULT 0' },
      { name: 'master_ranked_wins', def: 'INT DEFAULT 0' },
      { name: 'avatar', def: "VARCHAR(255) DEFAULT 'Icons/pikachu-.webp'" }
    ];
    for (const col of columnsToAdd) {
      const [cols] = await p.query(`SHOW COLUMNS FROM users LIKE ?`, [col.name]);
      if (cols.length === 0) {
        await p.query(`ALTER TABLE users ADD COLUMN \`${col.name}\` ${col.def}`);
        console.log(`Added ${col.name} column to users table.`);
      }
    }
  } catch (err) {
    console.error('Error migrating users table:', err);
  }

  // 2. Create Decks Table
  await p.query(`
    CREATE TABLE IF NOT EXISTS decks (
      id VARCHAR(255) PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      cards JSON NOT NULL,
      is_starter BOOLEAN DEFAULT FALSE,
      box_image VARCHAR(255) DEFAULT 'Decks/pokeball.png',
      coin_front VARCHAR(255) DEFAULT 'Coins/show(62).png',
      coin_back VARCHAR(255) DEFAULT 'Coins/coin-back.png',
      card_back VARCHAR(255) DEFAULT 'pokemon_card_backside.png',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Migration: Add box_image and other custom columns if table already exists without them
  try {
    const deckColumns = [
      { name: 'box_image', def: "VARCHAR(255) DEFAULT 'Decks/pokeball.png'" },
      { name: 'coin_front', def: "VARCHAR(255) DEFAULT 'Coins/show(62).png'" },
      { name: 'coin_back', def: "VARCHAR(255) DEFAULT 'Coins/coin-back.png'" },
      { name: 'card_back', def: "VARCHAR(255) DEFAULT 'pokemon_card_backside.png'" }
    ];
    for (const col of deckColumns) {
      const [cols] = await p.query(`SHOW COLUMNS FROM decks LIKE ?`, [col.name]);
      if (cols.length === 0) {
        await p.query(`ALTER TABLE decks ADD COLUMN \`${col.name}\` ${col.def}`);
        console.log(`Added ${col.name} column to decks table.`);
      }
    }
    // Migrate old values
    await p.query(`UPDATE decks SET box_image = 'Decks/pokeball.png' WHERE box_image = 'pokeball.png'`);
    await p.query(`UPDATE decks SET box_image = CONCAT('Decks/', box_image) WHERE box_image NOT LIKE 'Decks/%'`);
  } catch (err) {
    console.error('Error migrating decks table:', err);
  }

  // 3. Create Battles Table
  await p.query(`
    CREATE TABLE IF NOT EXISTS battles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      opponent_name VARCHAR(255) NOT NULL,
      result ENUM('won', 'lost') NOT NULL,
      duration INT NOT NULL,
      is_ranked BOOLEAN DEFAULT FALSE,
      user_category VARCHAR(50) DEFAULT NULL,
      user_level INT DEFAULT NULL,
      opponent_id VARCHAR(255) DEFAULT NULL,
      opponent_category VARCHAR(50) DEFAULT NULL,
      opponent_level INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Migrations for battles table if columns do not exist
  try {
    const columnsToAdd = [
      { name: 'is_ranked', def: 'BOOLEAN DEFAULT FALSE' },
      { name: 'user_category', def: 'VARCHAR(50) DEFAULT NULL' },
      { name: 'user_level', def: 'INT DEFAULT NULL' },
      { name: 'opponent_id', def: 'VARCHAR(255) DEFAULT NULL' },
      { name: 'opponent_category', def: 'VARCHAR(50) DEFAULT NULL' },
      { name: 'opponent_level', def: 'INT DEFAULT NULL' }
    ];
    for (const col of columnsToAdd) {
      const [cols] = await p.query(`SHOW COLUMNS FROM battles LIKE ?`, [col.name]);
      if (cols.length === 0) {
        await p.query(`ALTER TABLE battles ADD COLUMN \`${col.name}\` ${col.def}`);
        console.log(`Added ${col.name} column to battles table.`);
      }
    }
  } catch (err) {
    console.error('Error migrating battles table:', err);
  }

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
  if (!rows[0]) return null;
  const user = rows[0];

  // Obtener victorias online normales (casual, no ranked)
  const vRows = await query(
    "SELECT COUNT(*) as victories FROM battles WHERE user_id = ? AND result = 'won' AND is_ranked = 0",
    [userId]
  );
  user.normal_victories = vRows[0] ? vRows[0].victories : 0;
  return user;
}

async function findUserByEmail(email) {
  const rows = await query('SELECT * FROM users WHERE email = ?', [email]);
  return rows[0] || null;
}

async function registerOrLoginUser(id, email, name) {
  let user = await findUserById(id);
  if (!user) {
    // Register new user
    await query('INSERT INTO users (id, email, name, victories, avatar) VALUES (?, ?, ?, 0, ?)', [id, email, name, 'Icons/pikachu-.webp']);
    user = { id, email, name, victories: 0, avatar: 'Icons/pikachu-.webp' };
    
    // Seed starter decks
    for (let i = 0; i < STARTER_DECKS.length; i++) {
      const deck = STARTER_DECKS[i];
      const deckId = `starter-${id}-${i + 1}`;
      await query(
        'INSERT INTO decks (id, user_id, name, cards, is_starter, box_image, coin_front, coin_back, card_back) VALUES (?, ?, ?, ?, TRUE, ?, ?, ?, ?)',
        [deckId, id, deck.name, JSON.stringify(deck.cards), 'Decks/pokeball.png', 'Coins/show(62).png', 'Coins/coin-back.png', 'pokemon_card_backside.png']
      );
    }
  }
  return user;
}

async function getUserDecks(userId) {
  return await query('SELECT * FROM decks WHERE user_id = ?', [userId]);
}

async function saveUserDeck(deckId, userId, name, cardsJson, boxImage, coinFront, coinBack, cardBack) {
  if (!boxImage) boxImage = 'Decks/pokeball.png';
  if (!coinFront) coinFront = 'Coins/show(62).png';
  if (!coinBack) coinBack = 'Coins/coin-back.png';
  if (!cardBack) cardBack = 'pokemon_card_backside.png';
  // Check if exists
  const rows = await query('SELECT id FROM decks WHERE id = ? AND user_id = ?', [deckId, userId]);
  if (rows.length > 0) {
    // Update
    await query(
      'UPDATE decks SET name = ?, cards = ?, box_image = ?, coin_front = ?, coin_back = ?, card_back = ? WHERE id = ? AND user_id = ?',
      [name, cardsJson, boxImage, coinFront, coinBack, cardBack, deckId, userId]
    );
  } else {
    // Insert new
    await query(
      'INSERT INTO decks (id, user_id, name, cards, is_starter, box_image, coin_front, coin_back, card_back) VALUES (?, ?, ?, ?, FALSE, ?, ?, ?, ?)',
      [deckId, userId, name, cardsJson, boxImage, coinFront, coinBack, cardBack]
    );
  }
  return { id: deckId, user_id: userId, name, cards: JSON.parse(cardsJson), box_image: boxImage, coin_front: coinFront, coin_back: coinBack, card_back: cardBack };
}

async function deleteUserDeck(deckId, userId) {
  await query('DELETE FROM decks WHERE id = ? AND user_id = ? AND is_starter = FALSE', [deckId, userId]);
}

async function recordBattle(userId, opponentName, result, duration, isRanked = false, userCategory = null, userLevel = null, opponentId = null, opponentCategory = null, opponentLevel = null) {
  await query(`
    INSERT INTO battles (
      user_id, opponent_name, result, duration, 
      is_ranked, user_category, user_level, 
      opponent_id, opponent_category, opponent_level
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    userId, opponentName, result, duration, 
    isRanked ? 1 : 0, userCategory, userLevel, 
    opponentId, opponentCategory, opponentLevel
  ]);
  if (result === 'won') {
    await query('UPDATE users SET victories = victories + 1 WHERE id = ?', [userId]);
  }
}

async function getUserBattleHistory(userId) {
  return await query('SELECT * FROM battles WHERE user_id = ? ORDER BY created_at DESC', [userId]);
}

async function getLeaderboard() {
  return await query(`
    SELECT name, 
      (SELECT COUNT(*) FROM battles WHERE battles.user_id = users.id AND battles.result = 'won' AND battles.is_ranked = 0) as victories,
      (SELECT COUNT(*) FROM battles WHERE battles.user_id = users.id AND battles.is_ranked = 0) as total_games 
    FROM users 
    ORDER BY victories DESC, name ASC 
    LIMIT 250
  `);
}

async function getUserLeaderboardPosition(userId) {
  const user = await findUserById(userId);
  if (!user) return { position: 0, victories: 0 };

  const vRows = await query(
    "SELECT COUNT(*) as victories FROM battles WHERE user_id = ? AND result = 'won' AND is_ranked = 0",
    [userId]
  );
  const normalVictories = vRows[0] ? vRows[0].victories : 0;

  const rows = await query(`
    SELECT COUNT(*) as count FROM (
      SELECT u.id, u.name, 
        (SELECT COUNT(*) FROM battles b WHERE b.user_id = u.id AND b.result = 'won' AND b.is_ranked = 0) as victories
      FROM users u
    ) as temp
    WHERE victories > ? OR (temp.victories = ? AND temp.name < ?)
  `, [normalVictories, normalVictories, user.name]);

  return {
    position: rows[0].count + 1,
    victories: normalVictories
  };
}

const RANK_CONFIG = {
  'Principiante': { maxLevel: 3, winsNeeded: 3, lossesLimit: 3, nextCategory: 'Great', prevCategory: null },
  'Great': { maxLevel: 4, winsNeeded: 4, lossesLimit: 4, nextCategory: 'Experto', prevCategory: 'Principiante' },
  'Experto': { maxLevel: 5, winsNeeded: 5, lossesLimit: 5, nextCategory: 'Veterano', prevCategory: 'Great' },
  'Veterano': { maxLevel: 5, winsNeeded: 5, lossesLimit: 5, nextCategory: 'Ultra', prevCategory: 'Experto' },
  'Ultra': { maxLevel: 5, winsNeeded: 5, lossesLimit: 5, nextCategory: 'Maestro', prevCategory: 'Veterano' },
  'Maestro': { maxLevel: 0, winsNeeded: 0, lossesLimit: 10, nextCategory: null, prevCategory: 'Ultra' }
};

async function updateRankedStats(userId, result) {
  const user = await findUserById(userId);
  if (!user) return null;

  let category = user.ranked_category || 'Principiante';
  let level = user.ranked_level === undefined || user.ranked_level === null ? 1 : user.ranked_level;
  let wins = user.consecutive_wins || 0;
  let losses = user.consecutive_losses || 0;
  let masterWins = user.master_ranked_wins || 0;

  const config = RANK_CONFIG[category];
  if (!config) return user;

  if (result === 'won') {
    losses = 0; // Se resetea en victorias de ranked
    if (category === 'Maestro') {
      masterWins += 1;
    } else {
      wins += 1;
      if (wins >= config.winsNeeded) {
        wins = 0;
        if (level >= config.maxLevel) {
          category = config.nextCategory;
          level = category === 'Maestro' ? 0 : 1;
        } else {
          level += 1;
        }
      }
    }
  } else if (result === 'lost') {
    wins = 0; // Se resetea en derrotas de ranked
    losses += 1;
    if (losses >= config.lossesLimit) {
      losses = 0;
      if (category === 'Maestro') {
        category = 'Ultra';
        level = 5;
      } else {
        if (level === 1) {
          if (config.prevCategory) {
            category = config.prevCategory;
            level = RANK_CONFIG[category].maxLevel;
          } else {
            // Principiante 1, no desciende
            level = 1;
          }
        } else {
          level -= 1;
        }
      }
    }
  }

  await query(`
    UPDATE users 
    SET ranked_category = ?, ranked_level = ?, consecutive_wins = ?, consecutive_losses = ?, master_ranked_wins = ?
    WHERE id = ?
  `, [category, level, wins, losses, masterWins, userId]);

  return {
    ...user,
    ranked_category: category,
    ranked_level: level,
    consecutive_wins: wins,
    consecutive_losses: losses,
    master_ranked_wins: masterWins
  };
}

async function getRankedLeaderboard(categoryFilter = null, levelFilter = null) {
  let sql = `
    SELECT id, name, victories, ranked_category, ranked_level, consecutive_wins, master_ranked_wins,
      (SELECT COUNT(*) FROM battles WHERE battles.user_id = users.id AND battles.is_ranked = 1) as total_games
    FROM users
    WHERE 1=1
  `;
  const params = [];

  if (categoryFilter && categoryFilter !== 'all') {
    sql += ` AND ranked_category = ?`;
    params.push(categoryFilter);
  }

  if (levelFilter && levelFilter !== 'all') {
    sql += ` AND ranked_level = ?`;
    params.push(parseInt(levelFilter));
  }

  sql += `
    ORDER BY 
      CASE ranked_category
        WHEN 'Maestro' THEN 6
        WHEN 'Ultra' THEN 5
        WHEN 'Veterano' THEN 4
        WHEN 'Experto' THEN 3
        WHEN 'Great' THEN 2
        WHEN 'Principiante' THEN 1
        ELSE 0
      END DESC,
      ranked_level DESC,
      master_ranked_wins DESC,
      consecutive_wins DESC,
      name ASC
    LIMIT 250
  `;

  return await query(sql, params);
}

async function getRankedStatsSummary() {
  const rows = await query(`
    SELECT ranked_category, COUNT(*) as count 
    FROM users 
    GROUP BY ranked_category
  `);
  
  const summary = {
    'Principiante': 0,
    'Great': 0,
    'Experto': 0,
    'Veterano': 0,
    'Ultra': 0,
    'Maestro': 0
  };
  
  rows.forEach(r => {
    if (summary[r.ranked_category] !== undefined) {
      summary[r.ranked_category] = r.count;
    }
  });
  
  return summary;
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
  getUserLeaderboardPosition,
  updateRankedStats,
  getRankedLeaderboard,
  getRankedStatsSummary
};
