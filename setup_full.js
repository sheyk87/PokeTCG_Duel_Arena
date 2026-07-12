require('dotenv').config();
const db = require('./server/db');

async function run() {
  console.log('===========================================================');
  console.log('  INICIANDO INSTALACIÓN DE BASE DE DATOS POKÉMON TCG');
  console.log('===========================================================');

  try {
    await db.setup();
    console.log('===========================================================');
    console.log('  ¡INSTALACIÓN DE BASE DE DATOS FINALIZADA CON ÉXITO!');
    console.log('===========================================================');
    process.exit(0);
  } catch (err) {
    console.error('Error durante la instalación de la base de datos:', err.message);
    process.exit(1);
  }
}

run();
