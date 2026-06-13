const fs = require('fs');
const path = require('path');

class CardLoader {
  constructor() {
    this.cards = new Map();
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    try {
      const setsPath = path.resolve(__dirname, '../Sets/en.json');
      const setsData = fs.readFileSync(setsPath, 'utf8');
      const sets = JSON.parse(setsData);

      console.log(`[CardLoader] Encontrados ${sets.length} sets. Cargando cartas...`);

      for (const set of sets) {
        const setPath = path.resolve(__dirname, `../cards/en/${set.id}.json`);
        if (fs.existsSync(setPath)) {
          const content = fs.readFileSync(setPath, 'utf8');
          const cardsArray = JSON.parse(content);
          for (const card of cardsArray) {
            // Inyectar setId para consistencia con el cliente
            card.setId = set.id;
            this.cards.set(card.id, card);
          }
        }
      }

      this.initialized = true;
      console.log(`[CardLoader] Carga de cartas completada. Total de cartas cargadas: ${this.cards.size}`);
    } catch (err) {
      console.error('[CardLoader] Error al inicializar el cargador de cartas:', err);
      throw err;
    }
  }

  getCardById(cardId) {
    return this.cards.get(cardId);
  }

  getAllCards() {
    return Array.from(this.cards.values());
  }
}

module.exports = new CardLoader();
