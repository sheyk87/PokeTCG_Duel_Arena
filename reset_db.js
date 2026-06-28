require('dotenv').config();
const db = require('./server/db');

async function run() {
  console.log('===========================================================');
  console.log('  INICIANDO REINICIO DE LA BASE DE DATOS POKÉMON TCG');
  console.log('===========================================================');

  try {
    // Inicializar base de datos y correr migraciones
    await db.initDB();

    // 1. Eliminar todos los combates registrados
    console.log('Eliminando el historial de combates (battles)...');
    const deleteBattlesResult = await db.query('DELETE FROM battles');
    console.log('Historial de combates eliminado.');

    // 2. Eliminar todos los decks (tanto personalizados como iniciales)
    console.log('Eliminando todos los decks (mazos) de la base de datos...');
    const deleteDecksResult = await db.query('DELETE FROM decks');
    console.log('Todos los decks eliminados.');

    // 3. Reiniciar el contador de victorias de todos los usuarios y estadísticas competitivas
    console.log('Restableciendo victorias y estadísticas competitivas a 0...');
    const updateUsersResult = await db.query(
      "UPDATE users SET victories = 0, avatar = 'Icons/pikachu-.webp', ranked_category = 'Principiante', ranked_level = 1, consecutive_wins = 0, consecutive_losses = 0, master_ranked_wins = 0"
    );
    console.log('Estadísticas competitivas y victorias de los usuarios restablecidas.');

    // 4. Obtener todos los usuarios registrados para re-sembrar sus mazos iniciales
    console.log('Obteniendo lista de usuarios registrados...');
    const users = await db.query('SELECT id, name FROM users');
    console.log(`Se encontraron ${users.length} usuarios en el sistema.`);

    // 5. Re-sembrar los mazos iniciales para cada uno de los usuarios existentes
    if (users.length > 0) {
      console.log('Sembrando mazos iniciales (STARTER_DECKS) para los usuarios existentes...');
      const { STARTER_DECKS } = db;
      let seededDecksCount = 0;

      for (const user of users) {
        for (let i = 0; i < STARTER_DECKS.length; i++) {
          const deck = STARTER_DECKS[i];
          const deckId = `starter-${user.id}-${i + 1}`;
          
          await db.query(
            'INSERT INTO decks (id, user_id, name, cards, is_starter, box_image, coin_front, coin_back, card_back) VALUES (?, ?, ?, ?, TRUE, ?, ?, ?, ?)',
            [deckId, user.id, deck.name, JSON.stringify(deck.cards), 'Decks/pokeball.png', 'Coins/show(62).png', 'Coins/coin-back.png', 'pokemon_card_backside.png']
          );
          seededDecksCount++;
        }
      }
      console.log(`Se han re-creado con éxito ${seededDecksCount} mazos iniciales.`);
    } else {
      console.log('No hay usuarios en la base de datos, no se requiere sembrar mazos.');
    }

    console.log('===========================================================');
    console.log('  ¡REINICIO DE BASE DE DATOS FINALIZADO CON ÉXITO!');
    console.log('===========================================================');
    process.exit(0);
  } catch (err) {
    console.error('Error durante el reinicio de la base de datos:', err.message);
    process.exit(1);
  }
}

run();
