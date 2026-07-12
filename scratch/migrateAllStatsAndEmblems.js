const db = require('../server/db');

async function runMigration() {
  console.log('--- Iniciando migración masiva de estadísticas y emblemas ---');
  try {
    // Inicializar BD por si acaso
    await db.initDB();

    // Obtener todos los usuarios
    const users = await db.query('SELECT id, name FROM users');
    console.log(`Se encontraron ${users.length} usuarios en la base de datos.`);

    for (const user of users) {
      console.log(`Migrando estadísticas y recalculando emblemas para: ${user.name} (${user.id})...`);
      try {
        await db.migrateExistingUserStats(user.id);
        console.log(`✓ Migración exitosa para ${user.name}`);
      } catch (err) {
        console.error(`✗ Error al migrar el usuario ${user.name}:`, err);
      }
    }

    console.log('--- Migración masiva completada con éxito ---');
    process.exit(0);
  } catch (err) {
    console.error('Error crítico durante la migración masiva:', err);
    process.exit(1);
  }
}

runMigration();
