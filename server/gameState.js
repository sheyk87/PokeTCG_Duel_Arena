const cardLoader = require('./cardLoader');
const effectEngine = require('./effectEngine');

class ServerGameState {
  constructor(matchId, p1Id, p1Name, p1Deck, p2Id, p2Name, p2Deck, goesFirstId) {
    this.matchId = matchId;
    this.p1Id = p1Id;
    this.p2Id = p2Id;
    this.goesFirstId = goesFirstId;
    this.turnOwnerId = goesFirstId;
    this.phase = 'setup'; // 'setup', 'active', 'must-promote-p1', 'must-promote-p2', 'game-over'
    this.turnNumber = 1;
    this.winnerId = null;
    this.gameOverReason = '';
    this.startTime = Date.now();
    this.pendingTurnEnd = false;

    this.players = {
      [p1Id]: this.initPlayerState(p1Id, p1Name, p1Deck),
      [p2Id]: this.initPlayerState(p2Id, p2Name, p2Deck)
    };
  }

  initPlayerState(playerId, name, shuffledDeck) {
    const deck = [];
    shuffledDeck.forEach((entry, idx) => {
      const card = cardLoader.getCardById(entry.cardId);
      if (card) {
        deck.push({
          instanceId: `${playerId}-card-${idx + 1}`,
          card: card,
          damage: 0,
          attachedEnergy: [],
          specialCondition: null,
          turnPlaced: 0
        });
      }
    });

    // Simulando el pop() desde el final del deck invertido del cliente:
    // El cliente hace reverse() y luego pop() 7 veces para la mano inicial.
    // Esto equivale a tomar los primeros 7 elementos de shuffledDeck en orden original.
    const hand = [];
    for (let i = 0; i < 7; i++) {
      if (deck.length > 0) {
        hand.push(deck.shift());
      }
    }

    // Los premios son los siguientes 6 elementos de la lista barajada (posiciones 7 a 12).
    const prizes = [];
    for (let i = 0; i < 6; i++) {
      if (deck.length > 0) {
        prizes.push(deck.shift());
      }
    }

    return {
      playerId,
      name,
      deck, // cartas restantes en el mazo
      hand,
      prizes,
      discard: [],
      active: null,
      activeTrainer: null,
      bench: [null, null, null, null, null],
      energyAttachedThisTurn: false,
      retreatedThisTurn: false
    };
  }

  getPlayerState(playerId) {
    return this.players[playerId];
  }

  getOpponentState(playerId) {
    const opponentId = playerId === this.p1Id ? this.p2Id : this.p1Id;
    return this.players[opponentId];
  }

  // Verifica los requisitos de energía
  checkEnergyRequirements(costArray, attachedEnergies) {
    if (!costArray || costArray.length === 0) return true;

    const required = {};
    costArray.forEach(type => {
      required[type] = (required[type] || 0) + 1;
    });

    const attached = {};
    attachedEnergies.forEach(energyCard => {
      let type = energyCard.name.replace(' Energy', '');
      if (energyCard.name === 'Double Colorless Energy') {
        attached['Colorless'] = (attached['Colorless'] || 0) + 2;
      } else {
        attached[type] = (attached[type] || 0) + 1;
      }
    });

    for (const type in required) {
      if (type !== 'Colorless') {
        const reqCount = required[type];
        const hasCount = attached[type] || 0;
        if (hasCount < reqCount) {
          return false;
        }
        attached[type] -= reqCount;
      }
    }

    if (required['Colorless']) {
      let neededColorless = required['Colorless'];
      let remainingTotal = 0;
      for (const type in attached) {
        remainingTotal += attached[type];
      }
      if (remainingTotal < neededColorless) {
        return false;
      }
    }

    return true;
  }

  // Procesa y valida la acción recibida del cliente
  processAction(playerId, action) {
    console.log('[ServerGameState] processAction:', playerId, action);
    if (this.phase === 'game-over') {
      return { valid: false, reason: 'La partida ya ha finalizado.' };
    }

    const { actionType } = action;
    const player = this.getPlayerState(playerId);
    const opponent = this.getOpponentState(playerId);

    if (actionType && actionType.startsWith('MANUAL_')) {
      return this.handleManualAction(player, opponent, action);
    }

    // Validar fase de setup obligatorio
    if (this.phase === 'setup') {
      if (actionType !== 'PLACE_ACTIVE' && actionType !== 'PLACE_BENCH' && actionType !== 'MULLIGAN' && actionType !== 'SURRENDER') {
        return { valid: false, reason: 'Solo se permiten acciones de configuración (PLACE_ACTIVE, PLACE_BENCH, MULLIGAN, SURRENDER) durante la fase de preparación. Acción recibida: ' + actionType };
      }
    }

    // Validar si el jugador debe promover un Pokémon tras KO
    if (this.phase === `must-promote-p1` || this.phase === `must-promote-p2`) {
      const activeMustPromoteId = this.phase === 'must-promote-p1' ? this.p1Id : this.p2Id;
      if (playerId !== activeMustPromoteId) {
        return { valid: false, reason: 'Debes esperar a que tu oponente promueva un Pokémon Activo.' };
      }
      if (actionType !== 'PROMOTE_BENCH') {
        return { valid: false, reason: 'Debes promover un Pokémon de tu banca al puesto activo.' };
      }
    }

    // Para acciones normales del turno, debe ser el turno del jugador
    if (this.phase === 'active') {
      if (this.turnOwnerId !== playerId) {
        if (actionType !== 'SURRENDER') {
          return { valid: false, reason: 'No es tu turno.' };
        }
      }
    }

    switch (actionType) {
      case 'MULLIGAN':
        return this.handleMulligan(player, action);
      case 'PLACE_ACTIVE':
        return this.handlePlaceActive(player, action);
      case 'PLACE_BENCH':
        return this.handlePlaceBench(player, action);
      case 'ATTACH_ENERGY':
        return this.handleAttachEnergy(player, action);
      case 'EVOLVE':
        return this.handleEvolve(player, action);
      case 'PLAY_TRAINER':
        return this.handlePlayTrainer(player, opponent, action);
      case 'ATTACK':
        return this.handleAttack(player, opponent, action);
      case 'RETREAT':
        return this.handleRetreat(player, action);
      case 'PROMOTE_BENCH':
        return this.handlePromoteBench(player, action);
      case 'PASS_TURN':
        return this.handlePassTurn(player, opponent);
      case 'SURRENDER':
        return this.handleSurrender(player);
      default:
        return { valid: false, reason: `Tipo de acción no reconocido: ${actionType}` };
    }
  }

  // Mulligan
  handleMulligan(player, action) {
    // Verificar que no tenga básicos en su mano
    const hasBasic = player.hand.some(c => c.card.supertype === 'Pokémon' && c.card.subtypes?.includes('Basic'));
    if (hasBasic) {
      return { valid: false, reason: 'Tienes un Pokémon Básico en tu mano inicial, no puedes realizar Mulligan.' };
    }

    const { handSize } = action;
    if (handSize === undefined || handSize <= 0 || handSize > 7) {
      return { valid: false, reason: 'Cantidad de cartas inválida para el Mulligan.' };
    }

    // Devolver mano al mazo
    player.deck.push(...player.hand);
    player.hand = [];

    // Re-barajar mazo en el servidor
    for (let i = player.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [player.deck[i], player.deck[j]] = [player.deck[j], player.deck[i]];
    }

    // Robar nuevas cartas
    for (let i = 0; i < handSize; i++) {
      if (player.deck.length > 0) {
        player.hand.push(player.deck.shift());
      }
    }

    // Retornar los eventos para sincronizar
    return {
      valid: true,
      events: [
        {
          type: 'MULLIGAN_RESOLVED',
          playerId: player.playerId,
          handSize,
          newShuffledDeckIds: player.deck.map(c => ({ cardId: c.card.cardId || c.card.id, instanceId: c.instanceId })),
          newHandIds: player.hand.map(c => ({ cardId: c.card.cardId || c.card.id, instanceId: c.instanceId }))
        }
      ]
    };
  }

  // Colocar Activo durante setup
  handlePlaceActive(player, action) {
    if (player.active) {
      return { valid: false, reason: 'Ya tienes un Pokémon Activo colocado.' };
    }

    const { cardId } = action;
    const handIdx = player.hand.findIndex(c => c.card.id === cardId);
    if (handIdx === -1) {
      return { valid: false, reason: 'No tienes esa carta en tu mano.' };
    }

    const cardObj = player.hand[handIdx];
    if (cardObj.card.supertype !== 'Pokémon' || !cardObj.card.subtypes?.includes('Basic')) {
      return { valid: false, reason: 'Solo puedes colocar un Pokémon Básico como activo.' };
    }

    // Colocar activo
    player.active = cardObj;
    player.active.turnPlaced = 0;
    player.hand.splice(handIdx, 1);

    const events = [
      {
        type: 'PLACE_ACTIVE_RESOLVED',
        playerId: player.playerId,
        cardId,
        instanceId: player.active.instanceId
      }
    ];

    // Verificar si ambos jugadores ya colocaron su activo para iniciar el combate
    const opponent = this.getOpponentState(player.playerId);
    if (player.active && opponent.active) {
      this.phase = 'active';
      events.push({
        type: 'SETUP_COMPLETE',
        turnOwnerId: this.turnOwnerId
      });
      // Robar carta inicial del primer turno
      const firstPlayer = this.getPlayerState(this.turnOwnerId);
      if (firstPlayer.deck.length > 0) {
        const drawn = firstPlayer.deck.shift();
        firstPlayer.hand.push(drawn);
        events.push({
          type: 'DRAW_CARD_RESOLVED',
          playerId: firstPlayer.playerId,
          cardId: drawn.card.id,
          instanceId: drawn.instanceId,
          deckSize: firstPlayer.deck.length
        });
      } else {
        // Deck Out al inicio
        this.resolveGameOver(opponent.playerId, 'El oponente se quedó sin cartas al inicio de su turno (Deck Out).');
        events.push({
          type: 'GAME_OVER_RESOLVED',
          winnerId: opponent.playerId,
          reason: 'El oponente se quedó sin cartas al inicio de su turno (Deck Out).'
        });
      }
    }

    return { valid: true, events };
  }

  // Colocar en Banca (puede ser en setup o durante el turno activo)
  handlePlaceBench(player, action) {
    const { cardId, index } = action;
    if (index === undefined || index < 0 || index > 4) {
      return { valid: false, reason: 'Índice de banca inválido.' };
    }
    if (player.bench[index]) {
      return { valid: false, reason: 'Ese slot de la banca ya está ocupado.' };
    }

    const handIdx = player.hand.findIndex(c => c.card.id === cardId);
    if (handIdx === -1) {
      return { valid: false, reason: 'No tienes esa carta en tu mano.' };
    }

    const cardObj = player.hand[handIdx];
    if (cardObj.card.supertype !== 'Pokémon' || !cardObj.card.subtypes?.includes('Basic')) {
      return { valid: false, reason: 'Solo puedes colocar Pokémon Básicos en la banca.' };
    }

    // Colocar en banca
    player.bench[index] = cardObj;
    player.bench[index].turnPlaced = this.phase === 'setup' ? 0 : this.turnNumber;
    player.hand.splice(handIdx, 1);

    return {
      valid: true,
      events: [
        {
          type: 'PLACE_BENCH_RESOLVED',
          playerId: player.playerId,
          cardId,
          index,
          instanceId: cardObj.instanceId
        }
      ]
    };
  }

  // Unir Energía
  handleAttachEnergy(player, action) {
    if (player.energyAttachedThisTurn) {
      return { valid: false, reason: 'Ya has unido una carta de Energía este turno.' };
    }

    const { cardId, targetZone, targetIndex } = action;
    const handIdx = player.hand.findIndex(c => c.card.id === cardId);
    if (handIdx === -1) {
      return { valid: false, reason: 'No tienes esa carta en tu mano.' };
    }

    const cardObj = player.hand[handIdx];
    if (cardObj.card.supertype !== 'Energy') {
      return { valid: false, reason: 'La carta seleccionada no es una Energía.' };
    }

    let targetPkmn = null;
    if (targetZone === 'active') {
      targetPkmn = player.active;
    } else if (targetZone === 'bench') {
      targetPkmn = player.bench[targetIndex];
    }

    if (!targetPkmn) {
      return { valid: false, reason: 'El Pokémon objetivo no existe.' };
    }

    // Unir energía
    targetPkmn.attachedEnergy.push(cardObj.card);
    player.hand.splice(handIdx, 1);
    player.energyAttachedThisTurn = true;

    return {
      valid: true,
      events: [
        {
          type: 'ATTACH_ENERGY_RESOLVED',
          playerId: player.playerId,
          cardId,
          targetZone,
          targetIndex
        }
      ]
    };
  }

  // Evolucionar
  handleEvolve(player, action) {
    const { cardId, targetZone, targetIndex } = action;
    const handIdx = player.hand.findIndex(c => c.card.id === cardId);
    if (handIdx === -1) {
      return { valid: false, reason: 'No tienes esa carta en tu mano.' };
    }

    const cardObj = player.hand[handIdx];
    if (cardObj.card.supertype !== 'Pokémon' || (!cardObj.card.subtypes?.includes('Stage 1') && !cardObj.card.subtypes?.includes('Stage 2'))) {
      return { valid: false, reason: 'La carta no es una evolución válida.' };
    }

    let targetPkmn = null;
    if (targetZone === 'active') {
      targetPkmn = player.active;
    } else if (targetZone === 'bench') {
      targetPkmn = player.bench[targetIndex];
    }

    if (!targetPkmn) {
      return { valid: false, reason: 'El Pokémon objetivo no existe.' };
    }

    // Verificar requisitos de evolución
    if (targetPkmn.card.name !== cardObj.card.evolvesFrom) {
      return { valid: false, reason: `${cardObj.card.name} debe evolucionar de ${cardObj.card.evolvesFrom}, pero el objetivo es ${targetPkmn.card.name}.` };
    }

    if (targetPkmn.turnPlaced >= this.turnNumber) {
      return { valid: false, reason: 'No puedes evolucionar un Pokémon en el mismo turno en el que fue colocado.' };
    }

    // Realizar evolución
    const oldCardName = targetPkmn.card.name;
    // Guardar la carta anterior en una lista de evolución o simplemente descartarla / mantenerla unida
    // En este simulador, simplemente reemplazamos card por la evolucionada, manteniendo daño y energía.
    targetPkmn.card = cardObj.card;
    targetPkmn.turnPlaced = this.turnNumber;
    // Las condiciones especiales se limpian al evolucionar
    targetPkmn.specialCondition = null;
    
    player.hand.splice(handIdx, 1);

    return {
      valid: true,
      events: [
        {
          type: 'EVOLVE_RESOLVED',
          playerId: player.playerId,
          cardId,
          targetZone,
          targetIndex,
          oldCardName
        }
      ]
    };
  }

  // Jugar entrenador
  handlePlayTrainer(player, opponent, action) {
    const { cardId, targetDetails } = action;
    const handIdx = player.hand.findIndex(c => c.card.id === cardId);
    if (handIdx === -1) {
      return { valid: false, reason: 'No tienes esa carta en tu mano.' };
    }

    const cardObj = player.hand[handIdx];
    if (cardObj.card.supertype !== 'Trainer') {
      return { valid: false, reason: 'La carta seleccionada no es un Entrenador.' };
    }

    const card = cardObj.card;
    const events = [];

    // Helper para robar cartas
    const drawCards = (plr, count) => {
      const drawnEntries = [];
      for (let i = 0; i < count; i++) {
        if (plr.deck.length > 0) {
          const drawn = plr.deck.shift();
          plr.hand.push(drawn);
          drawnEntries.push({ cardId: drawn.card.id, instanceId: drawn.instanceId });
        }
      }
      return drawnEntries;
    };

    const handler = effectEngine.CustomTrainers[card.name];
    if (handler) {
      const result = handler(player, opponent, targetDetails, drawCards);
      if (!result.success) {
        return { valid: false, reason: result.reason || 'Acción de entrenador inválida.' };
      }
      events.push({
        type: 'PLAY_TRAINER_RESOLVED',
        playerId: player.playerId,
        cardId,
        effect: result.effect,
        details: result.details
      });
    } else {
      // Entrenador genérico sin efectos especiales implementados
      events.push({
        type: 'PLAY_TRAINER_RESOLVED',
        playerId: player.playerId,
        cardId,
        effect: 'GENERIC',
        details: {}
      });
    }

    // Mover entrenador al descarte y quitar de la mano
    player.discard.push(card);
    player.hand.splice(handIdx, 1);

    return { valid: true, events };
  }

  // Atacar
  handleAttack(player, opponent, action) {
    if (!player.active) {
      return { valid: false, reason: 'No tienes un Pokémon Activo.' };
    }
    if (!opponent.active) {
      return { valid: false, reason: 'El oponente no tiene un Pokémon Activo.' };
    }

    const { attackIndex } = action;
    const attacks = player.active.card.attacks;
    if (attackIndex === undefined || attackIndex < 0 || attackIndex >= attacks.length) {
      return { valid: false, reason: 'Índice de ataque inválido.' };
    }

    const attack = attacks[attackIndex];

    // Verificar requisitos de energía
    const hasEnergy = this.checkEnergyRequirements(attack.cost, player.active.attachedEnergy);
    if (!hasEnergy) {
      return { valid: false, reason: 'Energía insuficiente para usar este ataque.' };
    }

    // Verificar condiciones especiales
    if (player.active.specialCondition === 'paralyzed') {
      return { valid: false, reason: 'Tu Pokémon está Paralizado y no puede atacar.' };
    }
    if (player.active.specialCondition === 'asleep') {
      return { valid: false, reason: 'Tu Pokémon está Dormido y no puede atacar.' };
    }

    const events = [];

    // Chequeo de confusión
    if (player.active.specialCondition === 'confused') {
      const isHeads = Math.random() < 0.5;
      events.push({
        type: 'CONFUSION_CHECK',
        playerId: player.playerId,
        isHeads
      });

      if (!isHeads) {
        player.active.damage += 20;
        events.push({
          type: 'CONFUSION_FAIL',
          playerId: player.playerId,
          damage: 20
        });
        this.checkAndResolveKnockouts(events);
        this.endTurn(events);
        return { valid: true, events };
      }
    }

    // Chequeo de precisión (Sand-Attack / Smokescreen)
    if (player.active.attackFailureCheck) {
      const isHeads = Math.random() < 0.5;
      events.push({
        type: 'ACCURACY_CHECK',
        playerId: player.playerId,
        isHeads,
        effectName: player.active.attackFailureCheck
      });

      if (!isHeads) {
        events.push({
          type: 'ACCURACY_FAIL',
          playerId: player.playerId,
          effectName: player.active.attackFailureCheck
        });
        player.active.attackFailureCheck = null;
        this.checkAndResolveKnockouts(events);
        this.endTurn(events);
        return { valid: true, events };
      }
      player.active.attackFailureCheck = null;
    }

    // Calcular daño usando el Effect Engine
    let finalDmg = parseInt(attack.damage) || 0;
    const customHandler = effectEngine.CustomAttacks[attack.name];
    if (customHandler) {
      finalDmg = customHandler(player.active, opponent.active, finalDmg, player.active.attachedEnergy);
    }

    const parsedEffects = effectEngine.parseAttackText(attack.text);
    let coinFlips = [];
    let selfDmg = 0;
    let benchDmg = 0;
    let statusApplied = null;
    let statusCoinFlipNeeded = false;
    let statusCoinFlipResult = null;

    // Procesar efectos parsed
    parsedEffects.forEach(eff => {
      if (eff.type === 'damage_multiplier') {
        const flips = [];
        let heads = 0;
        for (let i = 0; i < eff.coins; i++) {
          const flip = Math.random() < 0.5;
          flips.push(flip);
          if (flip) heads++;
        }
        coinFlips = flips;
        finalDmg = eff.damagePerHead * heads;
      }
      else if (eff.type === 'coin_extra_damage') {
        const flip = Math.random() < 0.5;
        coinFlips.push(flip);
        if (flip) {
          finalDmg = eff.baseDmg + eff.extraDmg;
        } else {
          finalDmg = eff.baseDmg;
        }
      }
      else if (eff.type === 'coin_status') {
        statusCoinFlipNeeded = true;
        statusCoinFlipResult = Math.random() < 0.5;
        if (statusCoinFlipResult) {
          statusApplied = eff.condition;
        }
      }
      else if (eff.type === 'direct_status') {
        statusApplied = eff.condition;
      }
      else if (eff.type === 'coin_prevent_damage') {
        const flip = Math.random() < 0.5;
        coinFlips.push(flip);
        if (flip) {
          player.active.preventDamage = true;
        }
      }
      else if (eff.type === 'coin_prevent_all') {
        const flip = Math.random() < 0.5;
        coinFlips.push(flip);
        if (flip) {
          player.active.preventAllEffects = true;
        }
      }
      else if (eff.type === 'accuracy_debuff') {
        opponent.active.attackFailureCheck = 'precision';
      }
      else if (eff.type === 'self_damage') {
        selfDmg = eff.damage;
      }
      else if (eff.type === 'bench_damage') {
        benchDmg = eff.damage;
      }
    });

    // Validar si el defensor tiene prevención activa
    let isWeakness = false;
    let isResistance = false;

    if (opponent.active.preventDamage || opponent.active.preventAllEffects) {
      finalDmg = 0;
      events.push({
        type: 'DAMAGE_PREVENTED',
        playerId: opponent.playerId,
        cardId: opponent.active.card.id
      });
    } else {
      // Aplicar Debilidades y Resistencias
      if (opponent.active.card.weaknesses) {
        isWeakness = opponent.active.card.weaknesses.some(w => player.active.card.types.includes(w.type));
        if (isWeakness) {
          finalDmg *= 2;
        }
      }

      if (opponent.active.card.resistances) {
        isResistance = opponent.active.card.resistances.some(r => player.active.card.types.includes(r.type));
        if (isResistance) {
          finalDmg = Math.max(0, finalDmg - 30);
        }
      }
    }

    // Aplicar daño
    opponent.active.damage += finalDmg;

    // Aplicar Auto-daño
    if (selfDmg > 0) {
      player.active.damage += selfDmg;
    }

    // Aplicar daño a banca
    if (benchDmg > 0) {
      player.bench.forEach(pkmn => { if (pkmn) pkmn.damage += benchDmg; });
      opponent.bench.forEach(pkmn => {
        if (pkmn && !pkmn.preventDamage && !pkmn.preventAllEffects) {
          pkmn.damage += benchDmg;
        }
      });
    }

    // Aplicar condición especial si el oponente no está protegido
    if (statusApplied && opponent.active) {
      if (opponent.active.preventAllEffects) {
        events.push({
          type: 'EFFECT_PREVENTED',
          playerId: opponent.playerId,
          cardId: opponent.active.card.id,
          effect: statusApplied
        });
      } else {
        opponent.active.specialCondition = statusApplied;
      }
    }

    events.push({
      type: 'ATTACK_RESOLVED',
      playerId: player.playerId,
      attackName: attack.name,
      damage: finalDmg,
      coinFlips,
      selfDmg,
      benchDmg,
      statusApplied,
      isWeakness,
      isResistance,
      statusCoinFlipNeeded,
      statusCoinFlipResult
    });

    // Resolver knockouts y verificar victoria
    this.checkAndResolveKnockouts(events);

    // Finalizar el turno: si hay KO pendiente de promoción, diferir hasta después de la promoción
    if (this.phase === 'active') {
      this.endTurn(events);
    } else if (this.phase === 'must-promote-p1' || this.phase === 'must-promote-p2') {
      this.pendingTurnEnd = true;
    }

    return { valid: true, events };
  }

  // Retirada
  handleRetreat(player, action) {
    if (player.retreatedThisTurn) {
      return { valid: false, reason: 'Ya has retirado a tu Pokémon activo este turno.' };
    }
    if (!player.active) {
      return { valid: false, reason: 'No tienes un Pokémon Activo.' };
    }

    const { benchIndex } = action;
    if (benchIndex === undefined || benchIndex < 0 || benchIndex > 4 || !player.bench[benchIndex]) {
      return { valid: false, reason: 'Ese slot de la banca está vacío o no es válido.' };
    }

    const retreatCost = player.active.card.retreatCost ? player.active.card.retreatCost.length : 0;
    
    // Verificar si tiene suficiente energía
    const hasEnoughEnergy = player.active.attachedEnergy.length >= retreatCost; // Simplificación
    if (!hasEnoughEnergy) {
      return { valid: false, reason: 'El Pokémon activo no tiene suficiente energía para retirarse.' };
    }

    // Descartar energías de retiro
    const discardedEnergies = [];
    for (let i = 0; i < retreatCost; i++) {
      const e = player.active.attachedEnergy.pop();
      player.discard.push(e);
      discardedEnergies.push(e.id);
    }

    const oldActive = player.active;
    player.active = player.bench[benchIndex];
    player.bench[benchIndex] = oldActive;

    // Limpiar condiciones al ir a la banca
    player.active.specialCondition = null;
    oldActive.specialCondition = null;

    player.retreatedThisTurn = true;

    return {
      valid: true,
      events: [
        {
          type: 'RETREAT_RESOLVED',
          playerId: player.playerId,
          benchIndex,
          retreatCost,
          discardedEnergies
        }
      ]
    };
  }

  // Promover de banca (en KO o cambio)
  handlePromoteBench(player, action) {
    const { benchIndex } = action;
    if (benchIndex === undefined || benchIndex < 0 || benchIndex > 4 || !player.bench[benchIndex]) {
      return { valid: false, reason: 'El slot de la banca seleccionado está vacío o es inválido.' };
    }

    const newActive = player.bench[benchIndex];
    const oldActive = player.active;

    if (oldActive) {
      // Intercambio normal (se debería hacer por Cambio o Retiro)
      player.active = newActive;
      player.bench[benchIndex] = oldActive;
    } else {
      // Promoción por KO (el activo estaba vacío)
      player.active = newActive;
      player.bench[benchIndex] = null;
    }

    if (player.active) {
      player.active.specialCondition = null;
    }

    // Si estábamos esperando promoción por KO, devolver la fase a active
    if (this.phase === `must-promote-p1` && player.playerId === this.p1Id) {
      this.phase = 'active';
    } else if (this.phase === `must-promote-p2` && player.playerId === this.p2Id) {
      this.phase = 'active';
    }

    const events = [
      {
        type: 'PROMOTE_BENCH_RESOLVED',
        playerId: player.playerId,
        benchIndex
      }
    ];

    // Si había un fin de turno pendiente (el atacante derribó al activo), completar el cambio de turno ahora
    if (this.pendingTurnEnd && this.phase === 'active') {
      this.pendingTurnEnd = false;
      this.endTurn(events);
    }

    return { valid: true, events };
  }

  // Pasar Turno
  handlePassTurn(player, opponent) {
    const events = [];
    this.endTurn(events);
    return { valid: true, events };
  }

  // Rendirse
  handleSurrender(player) {
    const opponent = this.getOpponentState(player.playerId);
    this.resolveGameOver(opponent.playerId, `${player.name} se ha rendido.`);
    
    return {
      valid: true,
      events: [
        {
          type: 'GAME_OVER_RESOLVED',
          winnerId: opponent.playerId,
          reason: `${player.name} se ha rendido.`
        }
      ]
    };
  }

  // Resolver final de turno (entre turnos)
  endTurn(events) {
    // Limpiar precisión (Sand-Attack/Smokescreen) al finalizar el turno del jugador que estaba atacando/actuando
    const currentPlayer = this.players[this.turnOwnerId];
    if (currentPlayer && currentPlayer.active) {
      currentPlayer.active.attackFailureCheck = null;
    }

    // 1. Efectos entre turnos (Veneno, Sueño)
    const p1 = this.players[this.p1Id];
    const p2 = this.players[this.p2Id];

    [p1, p2].forEach(p => {
      if (p.active) {
        if (p.active.specialCondition === 'poisoned') {
          p.active.damage += 10;
          events.push({
            type: 'POISON_DAMAGE',
            playerId: p.playerId,
            damage: 10
          });
        }
        if (p.active.specialCondition === 'burned') {
          p.active.damage += 20;
          events.push({
            type: 'BURN_DAMAGE',
            playerId: p.playerId,
            damage: 20
          });
          const cures = Math.random() < 0.5;
          if (cures) {
            p.active.specialCondition = null;
            events.push({
              type: 'BURN_CURED',
              playerId: p.playerId
            });
          }
        }
        if (p.active.specialCondition === 'asleep') {
          const wakesUp = Math.random() < 0.5;
          if (wakesUp) {
            p.active.specialCondition = null;
            events.push({
              type: 'SLEEP_CURED',
              playerId: p.playerId
            });
          }
        }
        // Parálisis dura un turno del oponente, por lo que se cura al final de tu propio turno
        if (p.active.specialCondition === 'paralyzed' && this.turnOwnerId === p.playerId) {
          p.active.specialCondition = null;
          events.push({
            type: 'PARALYSIS_CURED',
            playerId: p.playerId
          });
        }
      }
    });

    // Comprobar knockouts debido al veneno
    this.checkAndResolveKnockouts(events);

    if (this.phase === 'game-over') {
      return;
    }

    // 2. Cambiar turno
    this.turnOwnerId = this.turnOwnerId === this.p1Id ? this.p2Id : this.p1Id;
    this.turnNumber++;

    // Resetear restricciones del turno para el nuevo jugador
    const nextPlayer = this.players[this.turnOwnerId];
    nextPlayer.energyAttachedThisTurn = false;
    nextPlayer.retreatedThisTurn = false;

    // Limpiar efectos de prevención que expiran al comenzar el turno del nuevo jugador (Withdraw, Agility, Barrier)
    if (nextPlayer.active) {
      nextPlayer.active.preventDamage = false;
      nextPlayer.active.preventAllEffects = false;
    }
    nextPlayer.bench.forEach(pkmn => {
      if (pkmn) {
        pkmn.preventDamage = false;
        pkmn.preventAllEffects = false;
      }
    });

    events.push({
      type: 'TURN_CHANGED',
      turnOwnerId: this.turnOwnerId,
      turnNumber: this.turnNumber
    });

    // 3. Robar carta para el nuevo turno
    if (nextPlayer.deck.length > 0) {
      const drawn = nextPlayer.deck.shift();
      nextPlayer.hand.push(drawn);
      events.push({
        type: 'DRAW_CARD_RESOLVED',
        playerId: nextPlayer.playerId,
        cardId: drawn.card.id,
        instanceId: drawn.instanceId,
        deckSize: nextPlayer.deck.length
      });
    } else {
      const opponent = this.getOpponentState(nextPlayer.playerId);
      this.resolveGameOver(opponent.playerId, 'Te has quedado sin cartas en tu mazo al inicio de tu turno (Deck Out).');
      events.push({
        type: 'GAME_OVER_RESOLVED',
        winnerId: opponent.playerId,
        reason: 'Te has quedado sin cartas en tu mazo al inicio de tu turno (Deck Out).'
      });
    }
  }

  // Comprueba si algún Pokémon tiene HP <= 0 y resuelve el KO
  checkAndResolveKnockouts(events) {
    const p1 = this.players[this.p1Id];
    const p2 = this.players[this.p2Id];

    const handleKO = (player, opponent, pkmn, zone, index) => {
      const hp = parseInt(pkmn.card.hp) || 0;
      if (pkmn.damage >= hp) {
        events.push({
          type: 'KNOCKOUT',
          playerId: player.playerId,
          cardId: pkmn.card.id,
          zone,
          index
        });

        // Mover a descarte
        player.discard.push(pkmn.card);
        pkmn.attachedEnergy.forEach(e => player.discard.push(e));

        if (zone === 'active') {
          player.active = null;
        } else {
          player.bench[index] = null;
        }

        // El oponente toma un premio
        if (opponent.prizes.length > 0) {
          const prizeCard = opponent.prizes.shift();
          opponent.hand.push(prizeCard);
          events.push({
            type: 'TAKE_PRIZE_RESOLVED',
            playerId: opponent.playerId,
            cardId: prizeCard.card.id,
            prizesLeft: opponent.prizes.length
          });
        }
      }
    };

    // Verificar activos
    if (p1.active) handleKO(p1, p2, p1.active, 'active', null);
    if (p2.active) handleKO(p2, p1, p2.active, 'active', null);

    // Verificar bancas
    for (let i = 0; i < 5; i++) {
      if (p1.bench[i]) handleKO(p1, p2, p1.bench[i], 'bench', i);
      if (p2.bench[i]) handleKO(p2, p1, p2.bench[i], 'bench', i);
    }

    // Verificar condiciones de victoria
    const p1PrizesWon = p1.prizes.length === 0;
    const p2PrizesWon = p2.prizes.length === 0;
    const p1HasActive = p1.active !== null || p1.bench.some(b => b !== null);
    const p2HasActive = p2.active !== null || p2.bench.some(b => b !== null);

    // Si ambos roban su último premio a la vez o ambos se quedan sin Pokémon
    if (p1PrizesWon && p2PrizesWon) {
      // Victoria para el que esté atacando
      const winnerId = this.turnOwnerId;
      this.resolveGameOver(winnerId, 'Ambos jugadores tomaron sus últimos premios. Gana el jugador atacante.');
      events.push({
        type: 'GAME_OVER_RESOLVED',
        winnerId,
        reason: 'Ambos jugadores tomaron sus últimos premios. Gana el jugador atacante.'
      });
      return;
    }

    if (p1PrizesWon) {
      this.resolveGameOver(p1.playerId, '¡Tomaste todas tus cartas de Premio!');
      events.push({
        type: 'GAME_OVER_RESOLVED',
        winnerId: p1.playerId,
        reason: `${p1.name} tomó todas sus cartas de Premio.`
      });
      return;
    }

    if (p2PrizesWon) {
      this.resolveGameOver(p2.playerId, '¡Tomaste todas tus cartas de Premio!');
      events.push({
        type: 'GAME_OVER_RESOLVED',
        winnerId: p2.playerId,
        reason: `${p2.name} tomó todas sus cartas de Premio.`
      });
      return;
    }

    if (!p1HasActive && !p2HasActive) {
      // Empate o gana el atacante
      const winnerId = this.turnOwnerId;
      this.resolveGameOver(winnerId, 'Ambos jugadores se quedaron sin Pokémon en juego. Gana el jugador atacante.');
      events.push({
        type: 'GAME_OVER_RESOLVED',
        winnerId,
        reason: 'Ambos jugadores se quedaron sin Pokémon en juego. Gana el jugador atacante.'
      });
      return;
    }

    if (!p1HasActive) {
      this.resolveGameOver(p2.playerId, `${p1.name} se quedó sin Pokémon en juego (Bench Out).`);
      events.push({
        type: 'GAME_OVER_RESOLVED',
        winnerId: p2.playerId,
        reason: `${p1.name} se quedó sin Pokémon en juego.`
      });
      return;
    }

    if (!p2HasActive) {
      this.resolveGameOver(p1.playerId, `${p2.name} se quedó sin Pokémon en juego (Bench Out).`);
      events.push({
        type: 'GAME_OVER_RESOLVED',
        winnerId: p1.playerId,
        reason: `${p2.name} se quedó sin Pokémon en juego.`
      });
      return;
    }

    // Si el activo de p1 fue derrotado y aún tiene banca, debe promover
    if (!p1.active) {
      this.phase = 'must-promote-p1';
      events.push({
        type: 'MUST_PROMOTE',
        playerId: p1.playerId
      });
    }

    // Si el activo de p2 fue derrotado y aún tiene banca, debe promover
    if (!p2.active) {
      // Si ambos tienen que promover, p1 va primero si es su turno o similar.
      // O simplemente establecemos el estado must-promote
      this.phase = 'must-promote-p2';
      events.push({
        type: 'MUST_PROMOTE',
        playerId: p2.playerId
      });
    }
  }

  resolveGameOver(winnerId, reason) {
    this.phase = 'game-over';
    this.winnerId = winnerId;
    this.gameOverReason = reason;
  }

  // Busca una carta en cualquier zona, la remueve de su posición y la retorna como objeto de estado de carta
  findAndRemoveCard(identifier) {
    for (const pId in this.players) {
      const p = this.players[pId];
      // Mano
      const handIdx = p.hand.findIndex(c => c.instanceId === identifier);
      if (handIdx !== -1) {
        return { cardObj: p.hand.splice(handIdx, 1)[0], ownerId: pId, fromZone: 'hand' };
      }
      // Activo
      if (p.active && p.active.instanceId === identifier) {
        const cardObj = p.active;
        p.active = null;
        return { cardObj, ownerId: pId, fromZone: 'active' };
      }
      // Trainer
      if (p.activeTrainer && p.activeTrainer.instanceId === identifier) {
        const cardObj = p.activeTrainer;
        p.activeTrainer = null;
        return { cardObj, ownerId: pId, fromZone: 'trainer' };
      }
      // Banca
      const benchIdx = p.bench.findIndex(c => c && c.instanceId === identifier);
      if (benchIdx !== -1) {
        const cardObj = p.bench[benchIdx];
        p.bench[benchIdx] = null;
        return { cardObj, ownerId: pId, fromZone: 'bench', fromIndex: benchIdx };
      }
      // Premios
      const prizeIdx = p.prizes.findIndex(c => c.instanceId === identifier);
      if (prizeIdx !== -1) {
        return { cardObj: p.prizes.splice(prizeIdx, 1)[0], ownerId: pId, fromZone: 'prizes' };
      }
      // Mazo
      const deckIdx = p.deck.findIndex(c => c.instanceId === identifier);
      if (deckIdx !== -1) {
        return { cardObj: p.deck.splice(deckIdx, 1)[0], ownerId: pId, fromZone: 'deck' };
      }
      // Descarte (buscar por cardId o instanceId)
      const discardIdx = p.discard.findIndex(c => c.id === identifier || c.instanceId === identifier);
      if (discardIdx !== -1) {
        const rawCard = p.discard.splice(discardIdx, 1)[0];
        const cardObj = {
          instanceId: `${pId}-card-discarded-${Date.now()}-${Math.random()}`,
          card: rawCard,
          damage: 0,
          attachedEnergy: [],
          specialCondition: null,
          turnPlaced: 0
        };
        return { cardObj, ownerId: pId, fromZone: 'discard' };
      }
    }
    return null;
  }

  // Maneja todas las acciones manuales del modo Sandbox multijugador
  handleManualAction(player, opponent, action) {
    const { actionType } = action;
    const events = [];

    switch (actionType) {
      case 'MANUAL_DAMAGE_CHANGE': {
        const { targetSide, targetZone, targetIndex, amount } = action;
        const targetState = targetSide === 'player' ? player : opponent;
        const pkmn = targetZone === 'active' ? targetState.active : targetState.bench[targetIndex];
        if (pkmn) {
          pkmn.damage = Math.max(0, pkmn.damage + amount);
          events.push({
            type: 'MANUAL_DAMAGE_CHANGE_RESOLVED',
            playerId: player.playerId,
            targetSide,
            targetZone,
            targetIndex,
            newDamage: pkmn.damage,
            amount
          });
        }
        break;
      }

      case 'MANUAL_STATUS_CHANGE': {
        const { targetSide, targetZone, targetIndex, condition } = action;
        const targetState = targetSide === 'player' ? player : opponent;
        const pkmn = targetZone === 'active' ? targetState.active : targetState.bench[targetIndex];
        if (pkmn) {
          pkmn.specialCondition = condition;
          events.push({
            type: 'MANUAL_STATUS_CHANGE_RESOLVED',
            playerId: player.playerId,
            targetSide,
            targetZone,
            targetIndex,
            condition
          });
        }
        break;
      }

      case 'MANUAL_CARD_MOVEMENT': {
        const { cardInstanceId, targetSide, targetZone, targetIndex } = action;
        const res = this.findAndRemoveCard(cardInstanceId);
        if (res) {
          const { cardObj, ownerId, fromZone, fromIndex } = res;
          const targetState = targetSide === 'player' ? player : opponent;

          if (targetZone === 'active') {
            const oldActive = targetState.active;
            targetState.active = cardObj;
            if (oldActive) {
              targetState.hand.push(oldActive);
            }
            // Transition out of must-promote phase if relevant
            if (this.phase === 'must-promote-p1' && targetState.playerId === this.p1Id) {
              this.phase = 'active';
            } else if (this.phase === 'must-promote-p2' && targetState.playerId === this.p2Id) {
              this.phase = 'active';
            }
          } else if (targetZone === 'trainer') {
            const oldTrainer = targetState.activeTrainer;
            targetState.activeTrainer = cardObj;
            if (oldTrainer) {
              targetState.hand.push(oldTrainer);
            }
          } else if (targetZone === 'bench') {
            const oldBench = targetState.bench[targetIndex];
            targetState.bench[targetIndex] = cardObj;
            if (oldBench) {
              targetState.hand.push(oldBench);
            }
          } else if (targetZone === 'hand') {
            targetState.hand.push(cardObj);
          } else if (targetZone === 'discard') {
            if (cardObj.attachedEnergy && cardObj.attachedEnergy.length > 0) {
              cardObj.attachedEnergy.forEach(e => targetState.discard.push(e));
              cardObj.attachedEnergy = [];
            }
            targetState.discard.push(cardObj.card);
          } else if (targetZone === 'deck') {
            if (targetIndex === 'top') {
              targetState.deck.unshift(cardObj);
            } else {
              targetState.deck.push(cardObj);
            }
          } else if (targetZone === 'prizes') {
            targetState.prizes.push(cardObj);
          }

          events.push({
            type: 'MANUAL_CARD_MOVEMENT_RESOLVED',
            playerId: player.playerId,
            cardId: cardObj.card ? cardObj.card.id : null,
            instanceId: cardInstanceId,
            fromZone,
            fromIndex,
            targetSide,
            targetZone,
            targetIndex
          });

          // Si estamos en la fase de preparación y ambos jugadores colocaron su Pokémon Activo, iniciar el duelo principal
          if (this.phase === 'setup' && this.players[this.p1Id].active && this.players[this.p2Id].active) {
            this.phase = 'active';
            events.push({
              type: 'SETUP_COMPLETE',
              turnOwnerId: this.turnOwnerId
            });

            // Robar carta inicial del primer turno
            const firstPlayer = this.getPlayerState(this.turnOwnerId);
            if (firstPlayer.deck.length > 0) {
              const drawn = firstPlayer.deck.shift();
              firstPlayer.hand.push(drawn);
              events.push({
                type: 'DRAW_CARD_RESOLVED',
                playerId: firstPlayer.playerId,
                cardId: drawn.card.id || drawn.card.cardId,
                instanceId: drawn.instanceId,
                deckSize: firstPlayer.deck.length
              });
            }
          }
        }
        break;
      }

      case 'MANUAL_ATTACH_ENERGY': {
        const { cardInstanceId, targetSide, targetZone, targetIndex } = action;
        const handIdx = player.hand.findIndex(c => c.instanceId === cardInstanceId);
        if (handIdx === -1) {
          return { valid: false, reason: 'No se encontró la carta de energía en tu mano.' };
        }
        const cardObj = player.hand.splice(handIdx, 1)[0];
        const targetState = targetSide === 'player' ? player : opponent;
        const pkmn = targetZone === 'active' ? targetState.active : targetState.bench[targetIndex];
        if (pkmn) {
          pkmn.attachedEnergy.push(cardObj.card);
          events.push({
            type: 'MANUAL_ATTACH_ENERGY_RESOLVED',
            playerId: player.playerId,
            cardId: cardObj.card.id,
            instanceId: cardInstanceId,
            targetSide,
            targetZone,
            targetIndex
          });
        } else {
          // Reinsert into hand since target doesn't exist
          player.hand.splice(handIdx, 0, cardObj);
          return { valid: false, reason: 'El Pokémon objetivo no existe en esa posición.' };
        }
        break;
      }

      case 'MANUAL_DISCARD_ENERGY': {
        const { targetSide, targetZone, targetIndex, energyCardId, destinationZone } = action;
        const targetState = targetSide === 'player' ? player : opponent;
        const pkmn = targetZone === 'active' ? targetState.active : targetState.bench[targetIndex];
        if (pkmn) {
          const idx = pkmn.attachedEnergy.findIndex(e => e.id === energyCardId);
          if (idx !== -1) {
            const energyCard = pkmn.attachedEnergy.splice(idx, 1)[0];
            if (destinationZone === 'hand') {
              const newInstanceId = `${targetState.playerId}-card-energy-${Date.now()}-${Math.random()}`;
              targetState.hand.push({
                instanceId: newInstanceId,
                card: energyCard,
                damage: 0,
                attachedEnergy: [],
                specialCondition: null,
                turnPlaced: 0
              });
            } else {
              targetState.discard.push(energyCard);
            }
            events.push({
              type: 'MANUAL_DISCARD_ENERGY_RESOLVED',
              playerId: player.playerId,
              targetSide,
              targetZone,
              targetIndex,
              energyCardId,
              destinationZone
            });
          }
        }
        break;
      }

      case 'MANUAL_EVOLVE': {
        const { cardInstanceId, targetSide, targetZone, targetIndex } = action;
        const handIdx = player.hand.findIndex(c => c.instanceId === cardInstanceId);
        if (handIdx !== -1) {
          const cardObj = player.hand.splice(handIdx, 1)[0];
          const targetState = targetSide === 'player' ? player : opponent;
          const pkmn = targetZone === 'active' ? targetState.active : targetState.bench[targetIndex];
          if (pkmn) {
            const oldCardName = pkmn.card.name;
            pkmn.card = cardObj.card;
            pkmn.specialCondition = null;
            events.push({
              type: 'MANUAL_EVOLVE_RESOLVED',
              playerId: player.playerId,
              cardId: cardObj.card.id,
              instanceId: cardInstanceId,
              targetSide,
              targetZone,
              targetIndex,
              oldCardName
            });
          } else {
            player.hand.splice(handIdx, 0, cardObj);
          }
        }
        break;
      }

      case 'MANUAL_DRAW': {
        const { count } = action;
        for (let i = 0; i < count; i++) {
          if (player.deck.length > 0) {
            const drawn = player.deck.shift();
            player.hand.push(drawn);
            events.push({
              type: 'DRAW_CARD_RESOLVED',
              playerId: player.playerId,
              cardId: drawn.card.id,
              instanceId: drawn.instanceId,
              deckSize: player.deck.length
            });
          }
        }
        break;
      }

      case 'MANUAL_SHUFFLE': {
        for (let i = player.deck.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [player.deck[i], player.deck[j]] = [player.deck[j], player.deck[i]];
        }
        events.push({
          type: 'MANUAL_SHUFFLE_RESOLVED',
          playerId: player.playerId,
          playerName: player.name
        });
        break;
      }

      case 'MANUAL_FLIP_COIN': {
        const isHeads = Math.random() < 0.5;
        events.push({
          type: 'MANUAL_COIN_FLIP_RESOLVED',
          playerId: player.playerId,
          playerName: player.name,
          isHeads
        });
        break;
      }

      case 'MANUAL_TAKE_PRIZE': {
        const { prizeIndex } = action;
        if (prizeIndex >= 0 && prizeIndex < player.prizes.length) {
          const prizeCard = player.prizes.splice(prizeIndex, 1)[0];
          player.hand.push(prizeCard);
          events.push({
            type: 'TAKE_PRIZE_RESOLVED',
            playerId: player.playerId,
            cardId: prizeCard.card.id,
            prizesLeft: player.prizes.length
          });
        }
        break;
      }

      case 'MANUAL_PASS_TURN': {
        this.endTurn(events);
        break;
      }

      case 'MANUAL_EXAMINE_DECK': {
        events.push({
          type: 'MANUAL_EXAMINE_DECK_RESOLVED',
          playerId: player.playerId,
          playerName: player.name
        });
        break;
      }
    }

    return { valid: true, events };
  }

  getSnapshot() {
    return {
      phase: this.phase,
      turnOwnerId: this.turnOwnerId,
      turnNumber: this.turnNumber,
      players: {
        [this.p1Id]: this.getPlayerSnapshot(this.p1Id),
        [this.p2Id]: this.getPlayerSnapshot(this.p2Id)
      }
    };
  }

  getPlayerSnapshot(playerId) {
    const p = this.players[playerId];
    return {
      playerId: p.playerId,
      handSize: p.hand.length,
      deckSize: p.deck.length,
      prizesSize: p.prizes.length,
      active: p.active ? this.getCardSnapshot(p.active) : null,
      activeTrainer: p.activeTrainer ? this.getCardSnapshot(p.activeTrainer) : null,
      bench: p.bench.map(b => b ? this.getCardSnapshot(b) : null),
      discard: p.discard.map(c => c.id || c.cardId)
    };
  }

  getCardSnapshot(cardObj) {
    return {
      instanceId: cardObj.instanceId,
      cardId: cardObj.card.id || cardObj.card.cardId,
      damage: cardObj.damage,
      specialCondition: cardObj.specialCondition,
      attachedEnergy: cardObj.attachedEnergy.map(e => e.id || e.cardId)
    };
  }
}

module.exports = ServerGameState;
