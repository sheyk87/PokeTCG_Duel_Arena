// js/effectEngine.js

export function parseAttackText(text) {
  const effects = [];
  if (!text) return effects;

  // 1. Damage multipliers based on coin flips (e.g. 10x or 30x)
  const multMatch = text.match(/flip (\d+) coins?.*does (\d+)(?:\s+damage)?\s+times the number of heads/i);
  if (multMatch) {
    effects.push({
      type: 'damage_multiplier',
      coins: parseInt(multMatch[1]),
      damagePerHead: parseInt(multMatch[2])
    });
  }

  // 2. Extra damage on coin flip (e.g. 20+ or 30+)
  const extraMatch = text.match(/flip a coin.*if heads, this attack does (\d+)(?:\s+damage)?\s+(?:plus|\+)\s+(\d+)\s+(?:more\s+)?damage/i) ||
                     text.match(/flip a coin.*if heads, this attack does (\d+)(?:\s+damage)?\s+and\s+(\d+)\s+more\s+damage/i);
  if (extraMatch) {
    effects.push({
      type: 'coin_extra_damage',
      baseDmg: parseInt(extraMatch[1]),
      extraDmg: parseInt(extraMatch[2])
    });
  }

  // 3. Status application with coin flip
  const flipStatusMatch = text.match(/flip a coin.*if heads, (?:the )?Defending Pok[eé]mon is now (Confused|Asleep|Paralyzed|Poisoned)/i);
  if (flipStatusMatch) {
    effects.push({
      type: 'coin_status',
      condition: flipStatusMatch[1].toLowerCase()
    });
  } else {
    // 4. Direct status application (no coin flip)
    const directStatusMatch = text.match(/(?:the )?Defending Pok[eé]mon is now (Confused|Asleep|Paralyzed|Poisoned)/i);
    if (directStatusMatch) {
      effects.push({
        type: 'direct_status',
        condition: directStatusMatch[1].toLowerCase()
      });
    }
  }

  // 5. Damage Prevention (Withdraw / Fly)
  const preventDamageMatch = text.match(/flip a coin.*prevent all damage done to (?:[A-Za-z]+|this Pok[eé]mon) during your opponent's next turn/i);
  if (preventDamageMatch) {
    effects.push({
      type: 'coin_prevent_damage'
    });
  }

  // 6. Damage & Effect Prevention (Agility / Barrier)
  const preventAllMatch = text.match(/flip a coin.*prevent all effects of attacks, including damage, done to (?:[A-Za-z]+|this Pok[eé]mon) during your opponent's next turn/i);
  if (preventAllMatch) {
    effects.push({
      type: 'coin_prevent_all'
    });
  }

  // 7. Accuracy reduction on defender (Sand-Attack / Smokescreen)
  const sandAttackMatch = text.match(/if the Defending Pok[eé]mon tries to attack.*flips a coin.*if tails, that attack does nothing/i);
  if (sandAttackMatch) {
    effects.push({
      type: 'accuracy_debuff'
    });
  }

  // 8. Self Damage
  const selfDmgMatch = text.match(/does (\d+)\s+damage to itself/i);
  if (selfDmgMatch) {
    effects.push({
      type: 'self_damage',
      damage: parseInt(selfDmgMatch[1])
    });
  }

  // 9. Bench Damage
  const benchDmgMatch = text.match(/does (\d+)\s+damage to each Benched Pok[eé]mon/i) || 
                        text.match(/does (\d+)\s+damage to each of your opponent's Benched Pok[eé]mon/i);
  if (benchDmgMatch) {
    effects.push({
      type: 'bench_damage',
      damage: parseInt(benchDmgMatch[1])
    });
  }

  return effects;
}

export const CustomAttacks = {
  'Hydro Pump': (attacker, defender, baseDamage, attachedEnergy) => {
    const waterCount = attachedEnergy.filter(e => e.name === 'Water Energy').length;
    const extraWater = Math.max(0, Math.min(2, waterCount - 3));
    return 40 + (extraWater * 10);
  },
  'Psychic': (attacker, defender, baseDamage, attachedEnergy) => {
    const opEnergy = defender.attachedEnergy.length;
    return 10 + (opEnergy * 10);
  }
};

export const CustomTrainers = {
  'Bill': (player, opponent, targetDetails, drawCardsFn) => {
    const drawn = drawCardsFn(player, 2);
    return {
      success: true,
      effect: 'BILL',
      details: { drawnCards: drawn, deckSize: player.deck.length }
    };
  },
  'Professor Oak': (player, opponent, targetDetails, drawCardsFn) => {
    const discardIds = player.hand.map(c => c.card.id);
    player.discard.push(...player.hand.map(c => c.card));
    player.hand = [];
    const drawn = drawCardsFn(player, 7);
    return {
      success: true,
      effect: 'PROFESSOR_OAK',
      details: { discardIds, oakDrawn: drawn, deckSize: player.deck.length }
    };
  },
  'Potion': (player, opponent, targetDetails) => {
    if (!targetDetails) return { success: false, reason: 'Debes elegir un Pokémon objetivo.' };
    const { side, zone, index } = targetDetails;
    const targetState = side === 'player' ? player : opponent;
    const pkmn = zone === 'active' ? targetState.active : targetState.bench[index];
    if (!pkmn) return { success: false, reason: 'El Pokémon objetivo no existe.' };
    const healAmt = Math.min(pkmn.damage, 20);
    pkmn.damage = Math.max(0, pkmn.damage - 20);
    return {
      success: true,
      effect: 'POTION',
      details: { targetSide: side, zone, index, healAmt }
    };
  },
  'Super Potion': (player, opponent, targetDetails) => {
    if (!targetDetails || !targetDetails.energyId) {
      return { success: false, reason: 'Debes elegir una energía para descartar.' };
    }
    const { side, zone, index, energyId } = targetDetails;
    const targetState = side === 'player' ? player : opponent;
    const pkmn = zone === 'active' ? targetState.active : targetState.bench[index];
    if (!pkmn) return { success: false, reason: 'El Pokémon objetivo no existe.' };
    const energyIdx = pkmn.attachedEnergy.findIndex(e => e.id === energyId);
    if (energyIdx === -1) return { success: false, reason: 'La energía seleccionada no está unida a ese Pokémon.' };
    
    const energyCard = pkmn.attachedEnergy.splice(energyIdx, 1)[0];
    player.discard.push(energyCard);
    
    const healAmt = Math.min(pkmn.damage, 40);
    pkmn.damage = Math.max(0, pkmn.damage - 40);
    return {
      success: true,
      effect: 'SUPER_POTION',
      details: { targetSide: side, zone, index, healAmt, discardedEnergyId: energyCard.id }
    };
  },
  'Switch': (player, opponent, targetDetails) => {
    if (!targetDetails || targetDetails.benchIndex === undefined) {
      return { success: false, reason: 'Debes seleccionar un Pokémon de la banca.' };
    }
    const { benchIndex } = targetDetails;
    const oldAct = player.active;
    const newAct = player.bench[benchIndex];
    if (!oldAct || !newAct) return { success: false, reason: 'Pokémon inválidos para Cambio.' };
    
    player.active = newAct;
    player.bench[benchIndex] = oldAct;
    player.active.specialCondition = null;
    oldAct.specialCondition = null;
    
    return {
      success: true,
      effect: 'SWITCH',
      details: { benchIndex }
    };
  },
  'Gust of Wind': (player, opponent, targetDetails) => {
    if (!targetDetails || targetDetails.benchIndex === undefined) {
      return { success: false, reason: 'Debes seleccionar un Pokémon de la banca del oponente.' };
    }
    const { benchIndex } = targetDetails;
    const oldAct = opponent.active;
    const newAct = opponent.bench[benchIndex];
    if (!oldAct || !newAct) return { success: false, reason: 'Pokémon oponentes inválidos para Ráfaga de Viento.' };
    
    opponent.active = newAct;
    opponent.bench[benchIndex] = oldAct;
    opponent.active.specialCondition = null;
    oldAct.specialCondition = null;
    
    return {
      success: true,
      effect: 'GUST_OF_WIND',
      details: { benchIndex }
    };
  },
  'Energy Removal': (player, opponent, targetDetails) => {
    if (!opponent.active || opponent.active.attachedEnergy.length === 0) {
      return { success: false, reason: 'El Pokémon activo del oponente no tiene energía unida.' };
    }
    const removedEnergy = opponent.active.attachedEnergy.pop();
    opponent.discard.push(removedEnergy);
    return {
      success: true,
      effect: 'ENERGY_REMOVAL',
      details: { removedEnergyId: removedEnergy.id }
    };
  },
  'Full Heal': (player, opponent, targetDetails) => {
    if (!player.active || !player.active.specialCondition) {
      return { success: false, reason: 'Tu Pokémon activo no tiene condiciones especiales.' };
    }
    const oldCondition = player.active.specialCondition;
    player.active.specialCondition = null;
    return {
      success: true,
      effect: 'FULL_HEAL',
      details: { oldCondition }
    };
  }
};
