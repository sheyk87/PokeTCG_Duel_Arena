// server/emblemEvaluator.js
// Evaluador de logros y emblemas para PokeTCG Duel Arena

const db = require('./db');

// Lista de mapeo de Emblemas a archivos de imágenes
const EMBLEM_IMAGES = {
  // Categoría 1
  'Maestro Fuego': 'charizardemblem.png',
  'Maestro Agua': 'megablastoiseemblem.png',
  'Maestro Planta': 'megavenusauremblem.png',
  'Maestro Eléctrico': 'pikachuemblem.png',
  'Maestro Psíquico': 'mewtwoemblem.png',
  'Maestro Lucha': 'megalucarioemblem.png',
  'Maestro Incoloro': 'eeveeemblem.png',
  'Purista de Básicos': 'wishiwashiemblem.png',
  'Maestro Evolutivo': 'garchompemblem.png',
  'Arquetipo Híbrido': 'arceusemblem.png',
  'Purista Energético': 'dialgaemblem.png',
  'Sin Ayuda Extrema': 'mabosstiffemblem.png',

  // Categoría 2
  'Victoria Impecable': 'shinymewemblem.png',
  'Impacto Devastador': 'buzzwoleemblem.png',
  'Golpe Múltiple': 'articunozapdosmoltresemblem.png',
  'Sniper de Banca': 'greninjaemblem.png',
  'Ataque Relámpago': 'roaringmoonemblem.png',
  'Mazo Exhausto (Deckout)': 'giratinaemblem.png',
  'Remontada Épica': 'ho-ohemblem.png',
  'Al Borde del Abismo': 'suicuneemblem.png',
  'En la Cuerda Floja': 'celebiemblem.png',
  'Muro Inquebrantable': 'lugiaemblem.png',

  // Categoría 3
  'Iniciante Casual': 'sobbleemblem.png',
  'Veterano Casual': 'mantykeemblem.png',
  'Leyenda Casual': 'alcremieemblem.png',
  'Racha Casual I': 'oricorioemblem.png',
  'Racha Casual II': 'sprigatitofuecocoandquaxlyemblem.png',
  'Racha Casual III': 'koraidon&miraidonemblem.png',

  // Categoría 4
  'Gladiador I': 'megasceptileemblem.png',
  'Gladiador II': 'megacharizardyemblem.png',
  'Gladiador III': 'shinymegagengaremblem.png',
  'Racha de Fuego I': 'megablazikenemblem.png',
  'Racha de Fuego II': 'ironvaliantemblem.png',
  'Racha de Fuego III': 'palkiaemblem.png',
  'Rango Pokéball': 'meowthemblem.png',
  'Rango Superball': 'alolandugtrioemblem.png',
  'Rango Ultraball': 'solgaleoemblem.png',
  'Rango Masterball': 'lunalaemblem.png',

  // Categoría 5
  'Señor de las Alteraciones': 'gholdengoemblem.png',
  'Acelerador de Energía': 'pikachuver.2emblem.png',
  'Especialista en Retiradas': 'megapinsiremblem.png',
  'Control del Mazo': 'shayminemblem.png',
  'Moneda de la Suerte': 'megagardevoiremblem.png',

  // Categoría 6
  'Constancia Diaria': 'megaaltariaemblem.png',
  'Camaleón': 'smeargleemblem.png',
  'Duelo Amistoso': 'megagyaradosemblem.png',
  'El Golpe del David': 'ogerponemblem.png',
  'Maldición del Dado': 'mewemblem.png'
};

// Configuración detallada de cada emblema
const EMBLEMS_CONFIG = [
  // CATEGORÍA 1: Especialización Elemental y Deckbuilding
  {
    id: 'Maestro Fuego',
    category: 'elemental',
    target: 25,
    description: 'Ganar 25 partidas con un mazo compuesto únicamente por Pokémon y Energías de tipo Fuego.',
    evaluator: (user, stats, originalDeck, result) => {
      if (result !== 'won') return null;
      return isMonoType(originalDeck, 'Fire') ? { progressIncrement: 1 } : null;
    }
  },
  {
    id: 'Maestro Agua',
    category: 'elemental',
    target: 25,
    description: 'Ganar 25 partidas con un mazo compuesto únicamente por Pokémon y Energías de tipo Agua.',
    evaluator: (user, stats, originalDeck, result) => {
      if (result !== 'won') return null;
      return isMonoType(originalDeck, 'Water') ? { progressIncrement: 1 } : null;
    }
  },
  {
    id: 'Maestro Planta',
    category: 'elemental',
    target: 25,
    description: 'Ganar 25 partidas con un mazo compuesto únicamente por Pokémon y Energías de tipo Planta.',
    evaluator: (user, stats, originalDeck, result) => {
      if (result !== 'won') return null;
      return isMonoType(originalDeck, 'Grass') ? { progressIncrement: 1 } : null;
    }
  },
  {
    id: 'Maestro Eléctrico',
    category: 'elemental',
    target: 25,
    description: 'Ganar 25 partidas con un mazo compuesto únicamente por Pokémon y Energías de tipo Rayo.',
    evaluator: (user, stats, originalDeck, result) => {
      if (result !== 'won') return null;
      return isMonoType(originalDeck, 'Lightning') ? { progressIncrement: 1 } : null;
    }
  },
  {
    id: 'Maestro Psíquico',
    category: 'elemental',
    target: 25,
    description: 'Ganar 25 partidas con un mazo compuesto únicamente por Pokémon y Energías de tipo Psíquico.',
    evaluator: (user, stats, originalDeck, result) => {
      if (result !== 'won') return null;
      return isMonoType(originalDeck, 'Psychic') ? { progressIncrement: 1 } : null;
    }
  },
  {
    id: 'Maestro Lucha',
    category: 'elemental',
    target: 25,
    description: 'Ganar 25 partidas con un mazo compuesto únicamente por Pokémon y Energías de tipo Lucha.',
    evaluator: (user, stats, originalDeck, result) => {
      if (result !== 'won') return null;
      return isMonoType(originalDeck, 'Fighting') ? { progressIncrement: 1 } : null;
    }
  },
  {
    id: 'Maestro Incoloro',
    category: 'elemental',
    target: 25,
    description: 'Ganar 25 partidas con un mazo compuesto únicamente por Pokémon de tipo Incoloro.',
    evaluator: (user, stats, originalDeck, result) => {
      if (result !== 'won') return null;
      return isMonoType(originalDeck, 'Colorless') ? { progressIncrement: 1 } : null;
    }
  },
  {
    id: 'Purista de Básicos',
    category: 'elemental',
    target: 1,
    description: 'Ganar una partida utilizando un mazo que no contenga ningún Pokémon de Fase 1 o Fase 2 (solo Básicos).',
    evaluator: (user, stats, originalDeck, result) => {
      if (result !== 'won') return null;
      const onlyBasics = !originalDeck.some(inst => inst.card && inst.card.supertype === 'Pokémon' && inst.card.subtype !== 'Basic');
      return onlyBasics ? { progress: 1 } : null;
    }
  },
  {
    id: 'Maestro Evolutivo',
    category: 'elemental',
    target: 1,
    description: 'Ganar una partida habiendo evolucionado exitosamente a 3 Pokémon a su Fase 2 dentro de la misma partida.',
    evaluator: (user, stats, originalDeck, result) => {
      if (result !== 'won') return null;
      return (stats.evolutionsToStage2 >= 3) ? { progress: 1 } : null;
    }
  },
  {
    id: 'Arquetipo Híbrido',
    category: 'elemental',
    target: 1,
    description: 'Ganar una partida con un mazo que combine al menos 4 tipos de energía distintas.',
    evaluator: (user, stats, originalDeck, result) => {
      if (result !== 'won') return null;
      const energyTypes = new Set();
      originalDeck.forEach(inst => {
        const card = inst.card;
        if (card && card.supertype === 'Energy') {
          if (card.name === 'Double Colorless Energy') {
            energyTypes.add('Colorless');
          } else {
            energyTypes.add(card.name.replace(' Energy', ''));
          }
        }
      });
      return (energyTypes.size >= 4) ? { progress: 1 } : null;
    }
  },
  {
    id: 'Purista Energético',
    category: 'elemental',
    target: 10,
    description: 'Ganar 10 partidas sin incluir ninguna carta de Energía Especial en el mazo.',
    evaluator: (user, stats, originalDeck, result) => {
      if (result !== 'won') return null;
      const hasSpecial = originalDeck.some(inst => inst.card && inst.card.supertype === 'Energy' && (inst.card.name.includes('Special') || inst.card.name === 'Double Colorless Energy'));
      return !hasSpecial ? { progressIncrement: 1 } : null;
    }
  },
  {
    id: 'Sin Ayuda Extrema',
    category: 'elemental',
    target: 1,
    description: 'Ganar una partida utilizando un mazo con 10 o menos cartas de Entrenador (Soporte/Objeto/Estadio).',
    evaluator: (user, stats, originalDeck, result) => {
      if (result !== 'won') return null;
      const trainers = originalDeck.filter(inst => inst.card && inst.card.supertype === 'Trainer').length;
      return (trainers <= 10) ? { progress: 1 } : null;
    }
  },

  // CATEGORÍA 2: Hazañas de Combate y Momentos Épicos
  {
    id: 'Victoria Impecable',
    category: 'combate',
    target: 1,
    description: 'Ganar una partida sin que el rival robe ninguna carta de Premio (6-0).',
    evaluator: (user, stats, originalDeck, result, opponentPrizesLeft) => {
      if (result !== 'won') return null;
      return (opponentPrizesLeft === 6) ? { progress: 1 } : null;
    }
  },
  {
    id: 'Impacto Devastador',
    category: 'combate',
    target: 1,
    description: 'Realizar un único ataque de 300 o más de daño en un solo turno.',
    evaluator: (user, stats) => {
      return (stats.maxDamageDealt >= 300) ? { progress: 1 } : null;
    }
  },
  {
    id: 'Golpe Múltiple',
    category: 'combate',
    target: 1,
    description: 'Dejar Fuera de Combate a 2 o más Pokémon rivales en el mismo turno.',
    evaluator: (user, stats) => {
      return (stats.maxKosInTurn >= 2) ? { progress: 1 } : null;
    }
  },
  {
    id: 'Sniper de Banca',
    category: 'combate',
    target: 1,
    description: 'Dejar Fuera de Combate a un total acumulado de 3 Pokémon que se encontraban en la Banca rival.',
    evaluator: (user, stats) => {
      return (stats.benchKos >= 3) ? { progress: 1 } : null;
    }
  },
  {
    id: 'Ataque Relámpago',
    category: 'combate',
    target: 1,
    description: 'Ganar una partida en 4 turnos o menos.',
    evaluator: (user, stats, originalDeck, result, opponentPrizesLeft, turnNumber) => {
      if (result !== 'won') return null;
      // turnNumber en ServerGameState aumenta en cada cambio de turno
      // Si el juego acaba en el turno 8 o menos (4 rondas completas de ambos jugadores), cumple
      return (turnNumber <= 8) ? { progress: 1 } : null;
    }
  },
  {
    id: 'Mazo Exhausto (Deckout)',
    category: 'combate',
    target: 1,
    description: 'Ganar una partida provocando que el rival se quede sin cartas en su mazo para robar.',
    evaluator: (user, stats, originalDeck, result, opponentPrizesLeft, turnNumber, gameOverReason) => {
      if (result !== 'won') return null;
      const isDeckout = gameOverReason && gameOverReason.includes('Mazo') || gameOverReason && gameOverReason.includes('Deck Out');
      return isDeckout ? { progress: 1 } : null;
    }
  },
  {
    id: 'Remontada Épica',
    category: 'combate',
    target: 1,
    description: 'Ganar una partida habiendo estado 1 a 6 abajo en cartas de Premio.',
    evaluator: (user, stats, originalDeck, result) => {
      if (result !== 'won') return null;
      return stats.hadEpicComeback ? { progress: 1 } : null;
    }
  },
  {
    id: 'Al Borde del Abismo',
    category: 'combate',
    target: 1,
    description: 'Sobrevivir al ataque del rival dejando a tu Pokémon Activo con 10 PV o menos y ganar en tu siguiente turno.',
    evaluator: (user, stats, originalDeck, result) => {
      if (result !== 'won') return null;
      return stats.survivedAt10Hp ? { progress: 1 } : null;
    }
  },
  {
    id: 'En la Cuerda Floja',
    category: 'combate',
    target: 1,
    description: 'Ganar la partida en el turno exacto en el que te quedaba solo 1 carta en tu mazo.',
    evaluator: (user, stats, originalDeck, result, opponentPrizesLeft, turnNumber, gameOverReason, playerDeckSize) => {
      if (result !== 'won') return null;
      return (playerDeckSize === 1) ? { progress: 1 } : null;
    }
  },
  {
    id: 'Muro Inquebrantable',
    category: 'combate',
    target: 1,
    description: 'Curar un total acumulado de 500 de daño a tus Pokémon en una sola partida.',
    evaluator: (user, stats) => {
      return (stats.healedDamage >= 500) ? { progress: 1 } : null;
    }
  },

  // CATEGORÍA 3: Progresión en Casual
  {
    id: 'Iniciante Casual',
    category: 'especial',
    target: 50,
    description: 'Ganar 50 partidas en Modo Casual.',
    evaluator: (user) => {
      return { progress: user.casual_won };
    }
  },
  {
    id: 'Veterano Casual',
    category: 'especial',
    target: 100,
    description: 'Ganar 100 partidas en Modo Casual.',
    evaluator: (user) => {
      return { progress: user.casual_won };
    }
  },
  {
    id: 'Leyenda Casual',
    category: 'especial',
    target: 250,
    description: 'Ganar 250 partidas en Modo Casual.',
    evaluator: (user) => {
      return { progress: user.casual_won };
    }
  },
  {
    id: 'Racha Casual I',
    category: 'especial',
    target: 10,
    description: 'Conseguid una racha de 10 victorias seguidas en Modo Casual.',
    evaluator: (user) => {
      return { progress: user.max_win_streak_casual };
    }
  },
  {
    id: 'Racha Casual II',
    category: 'especial',
    target: 25,
    description: 'Conseguid una racha de 25 victorias seguidas en Modo Casual.',
    evaluator: (user) => {
      return { progress: user.max_win_streak_casual };
    }
  },
  {
    id: 'Racha Casual III',
    category: 'especial',
    target: 50,
    description: 'Conseguid una racha de 50 victorias seguidas en Modo Casual.',
    evaluator: (user) => {
      return { progress: user.max_win_streak_casual };
    }
  },

  // CATEGORÍA 4: Competitivo y Ranked
  {
    id: 'Gladiador I',
    category: 'especial',
    target: 50,
    description: 'Ganar 50 partidas en Modo Ranked.',
    evaluator: (user) => {
      return { progress: user.ranked_won };
    }
  },
  {
    id: 'Gladiador II',
    category: 'especial',
    target: 100,
    description: 'Ganar 100 partidas en Modo Ranked.',
    evaluator: (user) => {
      return { progress: user.ranked_won };
    }
  },
  {
    id: 'Gladiador III',
    category: 'especial',
    target: 250,
    description: 'Ganar 250 partidas en Modo Ranked.',
    evaluator: (user) => {
      return { progress: user.ranked_won };
    }
  },
  {
    id: 'Racha de Fuego I',
    category: 'especial',
    target: 10,
    description: 'Conseguir una racha de 10 victorias seguidas en Modo Ranked.',
    evaluator: (user) => {
      return { progress: user.max_win_streak_ranked };
    }
  },
  {
    id: 'Racha de Fuego II',
    category: 'especial',
    target: 25,
    description: 'Conseguir una racha de 25 victorias seguidas en Modo Ranked.',
    evaluator: (user) => {
      return { progress: user.max_win_streak_ranked };
    }
  },
  {
    id: 'Racha de Fuego III',
    category: 'especial',
    target: 50,
    description: 'Conseguir una racha de 50 victorias seguidas en Modo Ranked.',
    evaluator: (user) => {
      return { progress: user.max_win_streak_ranked };
    }
  },
  {
    id: 'Rango Pokéball',
    category: 'especial',
    target: 1,
    description: 'Alcanzar el rango Experto.',
    evaluator: (user) => {
      const allowed = ['Experto', 'Veterano', 'Ultra', 'Maestro'];
      return allowed.includes(user.ranked_category) ? { progress: 1 } : null;
    }
  },
  {
    id: 'Rango Superball',
    category: 'especial',
    target: 1,
    description: 'Alcanzar el rango Veterano.',
    evaluator: (user) => {
      const allowed = ['Veterano', 'Ultra', 'Maestro'];
      return allowed.includes(user.ranked_category) ? { progress: 1 } : null;
    }
  },
  {
    id: 'Rango Ultraball',
    category: 'especial',
    target: 1,
    description: 'Alcanzar el rango Ultra.',
    evaluator: (user) => {
      const allowed = ['Ultra', 'Maestro'];
      return allowed.includes(user.ranked_category) ? { progress: 1 } : null;
    }
  },
  {
    id: 'Rango Masterball',
    category: 'especial',
    target: 1,
    description: 'Alcanzar la máxima división (Maestro).',
    evaluator: (user) => {
      return (user.ranked_category === 'Maestro') ? { progress: 1 } : null;
    }
  },

  // CATEGORÍA 5: Control de Mecánicas de Juego
  {
    id: 'Señor de las Alteraciones',
    category: 'combate',
    target: 50,
    description: 'Infligir condiciones de estado (Veneno, Quemadura, Parálisis, Sueño, Confusión) 50 veces en total.',
    evaluator: (user, stats) => {
      return stats.statusEffectsApplied > 0 ? { progressIncrement: stats.statusEffectsApplied } : null;
    }
  },
  {
    id: 'Acelerador de Energía',
    category: 'combate',
    target: 1,
    description: 'Unir o mover 4 o más cartas de Energía en un solo turno.',
    evaluator: (user, stats) => {
      return (stats.maxEnergiesAttachedOrMovedInTurn >= 4) ? { progress: 1 } : null;
    }
  },
  {
    id: 'Especialista en Retiradas',
    category: 'combate',
    target: 1,
    description: 'Cambiar de Pokémon Activo 3 o más veces en el mismo turno.',
    evaluator: (user, stats) => {
      return (stats.maxRetreatsInTurn >= 3) ? { progress: 1 } : null;
    }
  },
  {
    id: 'Control del Mazo',
    category: 'combate',
    target: 1,
    description: 'Buscar o robar 10 o más cartas de tu mazo en un solo turno mediante habilidades o cartas de Entrenador.',
    evaluator: (user, stats) => {
      return (stats.maxCardsDrawnOrSearchedInTurn >= 10) ? { progress: 1 } : null;
    }
  },
  {
    id: 'Moneda de la Suerte',
    category: 'combate',
    target: 1,
    description: 'Acertar 4 lanzamientos de moneda seguidos ("Caras") en una sola partida.',
    evaluator: (user, stats) => {
      return (stats.maxCoinHeadsStreak >= 4) ? { progress: 1 } : null;
    }
  },

  // CATEGORÍA 6: Constancia, Comunidad y Curiosidades
  {
    id: 'Constancia Diaria',
    category: 'especial',
    target: 1,
    description: 'Jugar al menos una partida diaria durante 7 días consecutivos.',
    evaluator: async (user) => {
      const dates = await db.query(`
        SELECT DISTINCT DATE(created_at) as battle_date 
        FROM battles 
        WHERE user_id = ? 
        ORDER BY battle_date DESC 
        LIMIT 10
      `, [user.id]);
      if (dates.length < 7) return null;
      
      let consecutiveDays = 1;
      let lastDate = new Date(dates[0].battle_date);
      
      for (let i = 1; i < dates.length; i++) {
        const currentDate = new Date(dates[i].battle_date);
        const diffTime = Math.abs(lastDate - currentDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays === 1) {
          consecutiveDays++;
          if (consecutiveDays >= 7) {
            return { progress: 1 };
          }
        } else if (diffDays > 1) {
          // Racha rota
          break;
        }
        lastDate = currentDate;
      }
      return null;
    }
  },
  {
    id: 'Camaleón',
    category: 'especial',
    target: 1,
    description: 'Ganar al menos una partida con 10 mazos guardados totalmente diferentes.',
    evaluator: async (user) => {
      const rows = await db.query(`
        SELECT COUNT(DISTINCT deck_name) as count 
        FROM battles 
        WHERE user_id = ? AND result = 'won' AND deck_name IS NOT NULL AND deck_name != ''
      `, [user.id]);
      const uniqueDecks = rows[0] ? rows[0].count : 0;
      return (uniqueDecks >= 10) ? { progress: 1 } : null;
    }
  },
  {
    id: 'Duelo Amistoso',
    category: 'especial',
    target: 20,
    description: 'Completar 20 partidas en salas privadas o enfrentamientos directos contra Amigos.',
    evaluator: (user, stats, originalDeck, result, opponentPrizesLeft, turnNumber, gameOverReason, playerDeckSize, isPrivate) => {
      return isPrivate ? { progressIncrement: 1 } : null;
    }
  },
  {
    id: 'El Golpe del David',
    category: 'especial',
    target: 1,
    description: 'Dar el golpe final para ganar la partida utilizando un Pokémon Básico considerado de bajo daño (ej. Magikarp, Sunkern).',
    evaluator: (user, stats, originalDeck, result) => {
      if (result !== 'won') return null;
      if (!stats.lastAttackerCardId) return null;
      
      // Mapear Magikarp (base1-35, etc.) y Sunkern, o cualquier Pokémon con max HP <= 30
      // En base a la ID, o podemos verificar si es Magikarp o Sunkern en su nombre
      const cardId = stats.lastAttackerCardId;
      // Podríamos cargar la carta para ver su HP/nombre, pero para mayor velocidad podemos mirar IDs comunes
      // o mapearla si es un Pokémon de bajo daño básico.
      // Por simplicidad, usemos una lista de IDs de bajo HP/daño, o podemos cargarla directamente.
      // E.g. Magikarp en Base set: base1-35. Magikarp Promos: promo-magikarp, etc.
      // También evaluamos si la ID contiene "magikarp" o "sunkern".
      const idLower = cardId.toLowerCase();
      const isDavid = idLower.includes('magikarp') || idLower.includes('sunkern') || idLower === 'base1-35';
      return isDavid ? { progress: 1 } : null;
    }
  },
  {
    id: 'Maldición del Dado',
    category: 'especial',
    target: 1,
    description: 'Perder 5 lanzamientos de moneda seguidos ("Cruz") dentro de una misma partida.',
    evaluator: (user, stats) => {
      return (stats.maxCoinTailsStreak >= 5) ? { progress: 1 } : null;
    }
  }
];

// Helper para determinar si el mazo es mono-tipo
function isMonoType(cards, requiredType) {
  let hasRequired = false;
  for (const inst of cards) {
    const card = inst.card;
    if (!card) continue;
    
    if (card.supertype === 'Pokémon') {
      if (!card.types || !card.types.includes(requiredType)) {
        return false;
      }
      hasRequired = true;
    } else if (card.supertype === 'Energy') {
      if (card.name === 'Double Colorless Energy') {
        if (requiredType !== 'Colorless') return false;
      } else {
        const energyType = card.name.replace(' Energy', '');
        if (energyType !== requiredType) {
          return false;
        }
      }
      hasRequired = true;
    }
  }
  return hasRequired;
}

function getPlayerAllCards(playerState) {
  if (!playerState) return [];
  const cards = [];
  if (playerState.active) cards.push(playerState.active);
  if (playerState.activeTrainer) cards.push(playerState.activeTrainer);
  playerState.bench.forEach(c => { if (c) cards.push(c); });
  playerState.hand.forEach(c => { if (c) cards.push(c); });
  playerState.prizes.forEach(c => { if (c) cards.push(c); });
  playerState.discard.forEach(c => { if (c) cards.push({ card: c }); });
  playerState.deck.forEach(c => { if (c) cards.push(c); });
  return cards;
}

// Función principal para evaluar los emblemas de un jugador tras un combate
async function evaluateUserEmblems(userId, matchStats, playerState, result, opponentPrizesLeft, turnNumber, gameOverReason, playerDeckSize, isRanked, isPrivate) {
  try {
    const originalDeck = getPlayerAllCards(playerState);
    // 1. Obtener la información fresca del usuario y sus emblemas actuales
    const user = await db.getUserProfileData(userId);
    if (!user) return;

    const currentEmblems = await db.getUserEmblems(userId);
    const emblemsMap = {};
    currentEmblems.forEach(e => {
      emblemsMap[e.emblem_id] = e;
    });

    // 2. Actualizar las estadísticas de la tabla users en base a esta batalla
    let casualPlayed = user.casual_played;
    let casualWon = user.casual_won;
    let rankedPlayed = user.ranked_played;
    let rankedWon = user.ranked_won;
    let maxDamage = Math.max(user.max_damage, matchStats.maxDamageDealt || 0);

    let maxWinStreakCasual = user.max_win_streak_casual;
    let currentWinStreakCasual = user.current_win_streak_casual;
    let maxWinStreakRanked = user.max_win_streak_ranked;
    let currentWinStreakRanked = user.current_win_streak_ranked;

    if (isRanked) {
      rankedPlayed++;
      if (result === 'won') {
        rankedWon++;
        currentWinStreakRanked++;
        if (currentWinStreakRanked > maxWinStreakRanked) {
          maxWinStreakRanked = currentWinStreakRanked;
        }
      } else {
        currentWinStreakRanked = 0;
      }
    } else {
      casualPlayed++;
      if (result === 'won') {
        casualWon++;
        currentWinStreakCasual++;
        if (currentWinStreakCasual > maxWinStreakCasual) {
          maxWinStreakCasual = currentWinStreakCasual;
        }
      } else {
        currentWinStreakCasual = 0;
      }
    }

    // Guardar estadísticas generales de batalla
    await db.query(`
      UPDATE users 
      SET casual_played = ?, casual_won = ?, ranked_played = ?, ranked_won = ?,
          max_damage = ?, max_win_streak_casual = ?, max_win_streak_ranked = ?,
          current_win_streak_casual = ?, current_win_streak_ranked = ?
      WHERE id = ?
    `, [
      casualPlayed, casualWon, rankedPlayed, rankedWon,
      maxDamage, maxWinStreakCasual, maxWinStreakRanked,
      currentWinStreakCasual, currentWinStreakRanked,
      userId
    ]);

    // Recargar el objeto user con las estadísticas actualizadas para la evaluación
    const updatedUser = await db.getUserProfileData(userId);

    // 3. Evaluar cada uno de los emblemas configurados
    for (const config of EMBLEMS_CONFIG) {
      const emblem = emblemsMap[config.id];
      
      // Si ya está desbloqueado, no hace falta volver a evaluarlo
      if (emblem && emblem.unlocked_at) continue;

      let currentProgress = emblem ? emblem.progress : 0;
      let evalResult = config.evaluator(
        updatedUser, 
        matchStats, 
        originalDeck, 
        result, 
        opponentPrizesLeft, 
        turnNumber, 
        gameOverReason, 
        playerDeckSize, 
        isPrivate
      );

      // Si la función evaluadora es asíncrona, resolver la promesa
      if (evalResult instanceof Promise) {
        evalResult = await evalResult;
      }

      if (evalResult) {
        if (evalResult.progress !== undefined) {
          currentProgress = evalResult.progress;
        } else if (evalResult.progressIncrement !== undefined) {
          currentProgress += evalResult.progressIncrement;
        }

        const isUnlocked = currentProgress >= config.target;
        // Ajustar el progreso para que no exceda el target
        const finalProgress = Math.min(currentProgress, config.target);

        await db.updateEmblemProgress(userId, config.id, finalProgress, isUnlocked);
      }
    }
  } catch (err) {
    console.error(`Error al evaluar emblemas para el usuario ${userId}:`, err);
  }
}

module.exports = {
  EMBLEM_IMAGES,
  EMBLEMS_CONFIG,
  evaluateUserEmblems
};
