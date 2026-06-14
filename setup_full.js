require('dotenv').config();
const mysql = require('mysql2/promise');
const db = require('./server/db');

async function run() {
  console.log('===========================================================');
  console.log('  INICIANDO INSTALACIÓN DE BASE DE DATOS POKÉMON TCG');
  console.log('===========================================================');

  const { config } = db;
  console.log(`Configuración del servidor: Host: ${config.host}, Usuario: ${config.user}, Base de Datos: ${config.database}`);

  let connection;
  try {
    // 1. Establecer conexión inicial sin base de datos para borrarla si existe
    console.log(`Conectando al servidor MySQL en ${config.host} para reiniciar la base de datos...`);
    connection = await mysql.createConnection({
      host: config.host,
      user: config.user,
      password: config.password
    });

    console.log(`Eliminando base de datos si existe: \`${config.database}\`...`);
    await connection.query(`DROP DATABASE IF EXISTS \`${config.database}\``);
    console.log(`Base de datos \`${config.database}\` eliminada correctamente.`);
  } catch (err) {
    console.error('Error al conectar o eliminar la base de datos:', err.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }

  try {
    // 2. Ejecutar la función de inicialización del módulo de base de datos
    console.log('Creando la base de datos y las tablas de nuevo...');
    await db.initDB();
    console.log('===========================================================');
    console.log('  ¡INSTALACIÓN DE BASE DE DATOS FINALIZADA CON ÉXITO!');
    console.log('===========================================================');
    process.exit(0);
  } catch (err) {
    console.error('Error durante la inicialización de las tablas:', err.message);
    process.exit(1);
  }
}

run();
