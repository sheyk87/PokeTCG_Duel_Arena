require('dotenv').config();
const db = require('./server/db');

async function run() {
  console.log('===========================================================');
  console.log('  INICIANDO REINICIO DE LA BASE DE DATOS POKÉMON TCG');
  console.log('===========================================================');

  try {
    await db.reset();
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
