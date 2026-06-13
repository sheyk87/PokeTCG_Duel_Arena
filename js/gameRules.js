// js/gameRules.js

import { CustomAttacks, CustomTrainers } from './effectEngine.js';

export const GameRules = {
  
  // Validates if the attached energy satisfies the attack cost requirements
  checkEnergyRequirements(costArray, attachedEnergies) {
    if (!costArray || costArray.length === 0) return true;

    // Create tallies
    const required = {};
    costArray.forEach(type => {
      required[type] = (required[type] || 0) + 1;
    });

    const attached = {};
    attachedEnergies.forEach(energyCard => {
      // Basic energy cards have a name like "Fire Energy" -> type is "Fire"
      // Special energy like "Double Colorless Energy" provides two Colorless
      let type = energyCard.name.replace(' Energy', '');
      
      if (energyCard.name === 'Double Colorless Energy') {
        attached['Colorless'] = (attached['Colorless'] || 0) + 2;
      } else {
        attached[type] = (attached[type] || 0) + 1;
      }
    });

    // Match specific energies first (Fire, Water, Lightning, etc.)
    for (const type in required) {
      if (type !== 'Colorless') {
        const reqCount = required[type];
        const hasCount = attached[type] || 0;
        
        if (hasCount < reqCount) {
          return false; // Insufficient specific energy
        }
        attached[type] -= reqCount;
      }
    }

    // Match Colorless costs using whatever is left
    if (required['Colorless']) {
      let neededColorless = required['Colorless'];
      
      // Tally total remaining energies
      let remainingTotal = 0;
      for (const type in attached) {
        remainingTotal += attached[type];
      }

      if (remainingTotal < neededColorless) {
        return false; // Insufficient overall energy
      }
    }

    return true;
  },

  // Calculate damage applying weakness, resistance, and attack logic
  calculateDamage(attack, attacker, defender, attachedEnergies) {
    const attackerCard = attacker.card;
    const defenderCard = defender.card;
    let baseDamage = parseInt(attack.damage) || 0;
    
    // Check custom registry
    const customHandler = CustomAttacks[attack.name];
    if (customHandler) {
      baseDamage = customHandler(attacker, defender, baseDamage, attachedEnergies);
    }

    let finalDamage = baseDamage;

    // Apply Weakness (x2 for base sets)
    if (defenderCard.weaknesses) {
      const isWeak = defenderCard.weaknesses.some(w => attackerCard.types.includes(w.type));
      if (isWeak) {
        finalDamage *= 2;
      }
    }

    // Apply Resistance (-30)
    if (defenderCard.resistances) {
      const isResistant = defenderCard.resistances.some(r => attackerCard.types.includes(r.type));
      if (isResistant) {
        finalDamage = Math.max(0, finalDamage - 30);
      }
    }

    return finalDamage;
  },

  // Executes a Trainer card's gameplay action
  // Returns object with status and description text for logging
  executeTrainer(card, playerState, opponentState, targetData = {}) {
    const log = [];
    let success = false;

    // Adapt local drawCards to playerState.drawCards
    const drawCardsFn = (pState, count) => {
      const initialSize = pState.hand.length;
      pState.drawCards(count);
      const newSize = pState.hand.length;
      const drawn = pState.hand.slice(initialSize).map(c => c.card.id);
      return drawn;
    };

    // Translate local targetData to standard targetDetails
    const targetDetails = {};
    if (targetData.targetPkmn) {
      if (playerState.active === targetData.targetPkmn) {
        targetDetails.side = 'player';
        targetDetails.zone = 'active';
      } else if (opponentState.active === targetData.targetPkmn) {
        targetDetails.side = 'opponent';
        targetDetails.zone = 'active';
      } else {
        const pBenchIdx = playerState.bench.indexOf(targetData.targetPkmn);
        if (pBenchIdx !== -1) {
          targetDetails.side = 'player';
          targetDetails.zone = 'bench';
          targetDetails.index = pBenchIdx;
        } else {
          const oBenchIdx = opponentState.bench.indexOf(targetData.targetPkmn);
          if (oBenchIdx !== -1) {
            targetDetails.side = 'opponent';
            targetDetails.zone = 'bench';
            targetDetails.index = oBenchIdx;
          }
        }
      }
    }
    if (targetData.benchIndex !== undefined) {
      targetDetails.benchIndex = targetData.benchIndex;
    }
    if (targetData.energyToDiscard) {
      targetDetails.energyId = targetData.energyToDiscard.id;
    }

    const handler = CustomTrainers[card.name];
    if (handler) {
      const result = handler(playerState, opponentState, targetDetails, drawCardsFn);
      if (result.success) {
        success = true;
        if (result.effect === 'BILL') {
          log.push(`${playerState.name} jugó Bill y robó ${result.details.drawnCards.length} carta(s).`);
        } else if (result.effect === 'PROFESSOR_OAK') {
          log.push(`${playerState.name} jugó Profesor Oak: descartó su mano (${result.details.discardIds.length} carta(s)) y robó 7 cartas.`);
        } else if (result.effect === 'POTION') {
          const targetName = targetData.targetPkmn.card.name;
          log.push(`${playerState.name} usó Poción en ${targetName}, curando ${result.details.healAmt} puntos de daño.`);
        } else if (result.effect === 'SUPER_POTION') {
          const targetName = targetData.targetPkmn.card.name;
          log.push(`${playerState.name} usó Súper Poción en ${targetName}: descartó 1 energía y curó ${result.details.healAmt} de daño.`);
        } else if (result.effect === 'SWITCH') {
          log.push(`${playerState.name} jugó Cambio (Switch): retiró a su Pokémon activo y promovió a ${playerState.active.card.name}.`);
        } else if (result.effect === 'GUST_OF_WIND') {
          log.push(`${playerState.name} jugó Gust of Wind: obligó a cambiar el activo del oponente a ${opponentState.active.card.name}.`);
        } else if (result.effect === 'ENERGY_REMOVAL') {
          log.push(`${playerState.name} jugó Quitaenergía: descartó una energía del Pokémon activo del oponente (${opponentState.active.card.name}).`);
        } else if (result.effect === 'FULL_HEAL') {
          log.push(`${playerState.name} jugó Cura Total: curó la condición especial de ${playerState.active.card.name}.`);
        }
      }
    } else {
      log.push(`${playerState.name} jugó ${card.name}, pero no tiene efectos especiales.`);
      success = true;
    }

    return { success, log };
  }
};
