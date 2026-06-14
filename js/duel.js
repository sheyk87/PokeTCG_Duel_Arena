// js/duel.js

import { GameRules } from './gameRules.js';
import { parseAttackText } from './effectEngine.js';

export class Duel {
  constructor(db, deckBuilder) {
    this.db = db;
    this.deckBuilder = deckBuilder;

    // Game States
    this.player = null;
    this.opponent = null;
    this.turnOwner = null; // 'player' or 'opponent'
    this.turnNumber = 1;
    this.phase = 'setup'; // 'setup', 'active', 'must-promote', 'game-over'

    // Interactions
    this.selectedBoardCard = null; // { side: 'player'|'opponent', zone: 'active'|'bench', index: number }
    this.selectedHandCardIndex = null;
    this.energyAttachedThisTurn = false;
    this.retreatedThisTurn = false;
    this.targetingAction = null; // { type: 'trainer'|'ability', cardIndex?: number, sourceCard?: object }

    // Audio Context (Synth retro sounds)
    this.audioCtx = null;

    // Callbacks
    this.onGameStart = null;
    this.onGameExit = null;
    this.warningTimeout = null;

    // Track already animated cards
    this.animatedCards = new Set();

    // Theme and Animation settings
    this.boardTheme = localStorage.getItem('pkmn_tcg_board_theme') || 'modern';
    this.battleAnimationsEnabled = localStorage.getItem('pkmn_tcg_battle_anims') !== 'false';

    this.playerActiveTrainer = null;
    this.opponentActiveTrainer = null;
    this.activeStadium = null;
    this.positionsData = {};
    this.isCoinFlipping = false;
  }

  async init() {
    this.setupUI();
    await this.loadBattlefieldsThemeOptions();
  }

  showWarning(message) {
    const banner = document.getElementById('duel-alert-banner');
    if (!banner) {
      console.warn('Warning banner not found, fallback to console:', message);
      return;
    }
    banner.textContent = message;
    banner.style.display = 'block';

    if (this.warningTimeout) {
      clearTimeout(this.warningTimeout);
    }

    this.warningTimeout = setTimeout(() => {
      banner.style.display = 'none';
      this.warningTimeout = null;
    }, 4000);
  }

  // Initial UI setups and bindings
  setupUI() {
    // Buttons
    document.getElementById('btn-pass-turn')?.addEventListener('click', () => {
      if (!this.player) return;
      this.endTurn();
    });
    document.getElementById('btn-forfeit-duel')?.addEventListener('click', async () => {
      if (!this.player) return;
      const confirmForfeit = await window.customConfirm('Retirarse', '¿Estás seguro de que quieres retirarte del duelo? Contará como derrota.');
      if (confirmForfeit) {
        this.endGame('opponent', 'Te has retirado del combate.');
      }
    });

    document.getElementById('btn-start-duel-match')?.addEventListener('click', () => this.startMatchFlow());
    document.getElementById('btn-exit-duel')?.addEventListener('click', () => {
      if (!this.player) return;
      this.stopDuelTimers();
      document.getElementById('modal-game-over').classList.remove('active');
      if (this.onGameExit) this.onGameExit();
    });

    // Close buttons on overlays
    document.querySelectorAll('#modal-deck-selector .modal-close-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('modal-deck-selector').classList.remove('active');
      });
    });

    // Delegate board click handlers
    document.getElementById('player-active')?.addEventListener('click', () => this.handleBoardSlotClick('player', 'active', 0));
    document.getElementById('opponent-active')?.addEventListener('click', () => this.handleBoardSlotClick('opponent', 'active', 0));

    // Bench slots delegation
    for (let i = 0; i < 5; i++) {
      document.querySelector(`#player-bench [data-index="${i}"]`)?.addEventListener('click', () => this.handleBoardSlotClick('player', 'bench', i));
      document.querySelector(`#opponent-bench [data-index="${i}"]`)?.addEventListener('click', () => this.handleBoardSlotClick('opponent', 'bench', i));
    }

    // Coin clicks for player and opponent coins
    const playerCoin = document.getElementById('player-coin');
    if (playerCoin) {
      playerCoin.addEventListener('click', () => {
        if (this.isOnlineMatch) return; // Handled in onlineDuel.js
        if (this.isCoinFlipping) return;
        this.flipLocalCoin('player');
      });
    }

    const opponentCoin = document.getElementById('opponent-coin');
    if (opponentCoin) {
      opponentCoin.addEventListener('click', () => {
        if (this.isOnlineMatch) return; // Handled in onlineDuel.js
        if (this.isCoinFlipping) return;
        this.flipLocalCoin('opponent');
      });
    }

    // Discard pile and deck viewers
    document.getElementById('player-discard-pile')?.addEventListener('click', () => this.openDiscardView('player'));
    document.getElementById('opponent-discard-pile')?.addEventListener('click', () => this.openDiscardView('opponent'));
    document.getElementById('player-deck-pile')?.addEventListener('click', () => this.openDeckView('player'));
    document.getElementById('opponent-deck-pile')?.addEventListener('click', () => this.openDeckView('opponent'));
    document.getElementById('player-trainer-slot')?.addEventListener('click', () => this.handleBoardSlotClick('player', 'trainer', 0));
    document.getElementById('opponent-trainer-slot')?.addEventListener('click', () => this.handleBoardSlotClick('opponent', 'trainer', 0));

    document.querySelector('#modal-discard-view .modal-close-btn')?.addEventListener('click', () => {
      document.getElementById('modal-discard-view').classList.remove('active');
    });

    // Board theme selection
    const themeSelector = document.getElementById('select-board-theme');
    if (themeSelector) {
      themeSelector.value = this.boardTheme;
      themeSelector.addEventListener('change', (e) => {
        this.setBoardTheme(e.target.value);
      });
    }
    this.setBoardTheme(this.boardTheme);

    // Animation toggle binding
    const animToggle = document.getElementById('chk-battle-animations');
    if (animToggle) {
      animToggle.checked = this.battleAnimationsEnabled;
      const label = document.getElementById('label-battle-animations');
      if (label) {
        label.textContent = this.battleAnimationsEnabled ? 'Animaciones: ON' : 'Animaciones: OFF';
      }
      animToggle.addEventListener('change', (e) => {
        this.battleAnimationsEnabled = e.target.checked;
        localStorage.setItem('pkmn_tcg_battle_anims', this.battleAnimationsEnabled);
        if (label) {
          label.textContent = this.battleAnimationsEnabled ? 'Animaciones: ON' : 'Animaciones: OFF';
        }
      });
    }
  }

  setBoardTheme(theme) {
    this.boardTheme = theme;
    localStorage.setItem('pkmn_tcg_board_theme', theme);
    const board = document.querySelector('.duel-board');
    if (board) {
      board.classList.remove('theme-modern', 'theme-trainer', 'theme-classic');
      board.classList.add(`theme-${theme}`);
    }
    this.applyThemeCoordinates();
  }

  async animateClash(attack, attacker, defender, finalDmg, isWeakness, isResistance) {
    if (!this.battleAnimationsEnabled) {
      this.playSound('attack');
      const isPlayer = (attacker === this.player.active);
      const attackerEl = document.querySelector(isPlayer ? '#player-active .board-card' : '#opponent-active .board-card');
      if (attackerEl) {
        attackerEl.classList.add(isPlayer ? 'attacking-player' : 'attacking-opponent');
      }
      await new Promise(r => setTimeout(r, 400));
      if (attackerEl) {
        attackerEl.classList.remove(isPlayer ? 'attacking-player' : 'attacking-opponent');
      }
      return;
    }

    const overlay = document.getElementById('battle-clash-overlay');
    const attackerCard = document.getElementById('clash-attacker-card');
    const defenderCard = document.getElementById('clash-defender-card');
    const attackName = document.getElementById('clash-attack-name');
    const damageBubble = document.getElementById('clash-damage-bubble');
    const modifierBadge = document.getElementById('clash-modifier-badge');
    const arrowPath = document.getElementById('attack-arrow-path');
    const particlesContainer = document.getElementById('clash-particles-container');

    if (!overlay || !attackerCard || !defenderCard || !attackName || !damageBubble) return;

    // Reset overlay elements
    attackerCard.innerHTML = this.db.getCardImgHtml(attacker.card);
    defenderCard.innerHTML = this.db.getCardImgHtml(defender.card);
    attackName.textContent = attack.name;
    damageBubble.textContent = finalDmg;

    // Reset classes
    const attackerWrapper = document.getElementById('clash-attacker-wrapper');
    const defenderWrapper = document.getElementById('clash-defender-wrapper');
    attackerWrapper.classList.remove('attack-slam');
    defenderWrapper.classList.remove('impact-shake');
    damageBubble.classList.remove('pop-active');

    if (modifierBadge) {
      modifierBadge.classList.remove('show-active');
      if (isWeakness) {
        modifierBadge.textContent = 'DEBILIDAD';
        modifierBadge.style.background = '#dc3545';
        modifierBadge.style.color = '#fff';
        modifierBadge.style.borderColor = '#fff';
        modifierBadge.style.display = 'block';
      } else if (isResistance) {
        modifierBadge.textContent = 'RESISTENCIA';
        modifierBadge.style.background = '#28a745';
        modifierBadge.style.color = '#fff';
        modifierBadge.style.borderColor = '#fff';
        modifierBadge.style.display = 'block';
      } else {
        modifierBadge.style.display = 'none';
      }
    }

    if (arrowPath) {
      arrowPath.style.strokeDashoffset = '800';
    }

    if (particlesContainer) {
      particlesContainer.innerHTML = '';
    }

    // Show overlay
    overlay.style.display = 'flex';

    // Wait for slide-in animation to complete
    await new Promise(r => setTimeout(r, 500));

    // Play attack name and arrow drawing
    if (arrowPath) {
      arrowPath.style.strokeDashoffset = '0';
    }

    // Slam attacker
    attackerWrapper.classList.add('attack-slam');

    // Impact timing (slam animation collision happens at 300ms)
    await new Promise(r => setTimeout(r, 300));

    this.playSound('attack');

    // Shake defender and show damage bubble
    defenderWrapper.classList.add('impact-shake');
    damageBubble.classList.add('pop-active');

    if (modifierBadge && (isWeakness || isResistance)) {
      modifierBadge.classList.add('show-active');
    }

    // Generate energy particles on collision if enabled
    if (particlesContainer) {
      this.generateClashParticles(particlesContainer, attacker.card);
    }

    // Hold the screen for clash outcome view
    await new Promise(r => setTimeout(r, 1200));

    // Hide overlay
    overlay.style.display = 'none';
  }

  generateClashParticles(container, attackerCard) {
    const mainType = (attackerCard.types && attackerCard.types[0]) || 'Colorless';
    let emoji = '✨';

    switch (mainType) {
      case 'Fire':
        emoji = '🔥';
        break;
      case 'Grass':
        emoji = '🌿';
        break;
      case 'Water':
        emoji = '💧';
        break;
      case 'Lightning':
        emoji = '⚡';
        break;
      case 'Psychic':
        emoji = '👁️';
        break;
      case 'Fighting':
        emoji = '👊';
        break;
      case 'Darkness':
        emoji = '🌙';
        break;
      case 'Metal':
        emoji = '🛡️';
        break;
      case 'Dragon':
        emoji = '🐉';
        break;
      case 'Fairy':
        emoji = 'Fairy';
        break;
      case 'Colorless':
      default:
        emoji = '🔘';
        break;
    }

    const particleCount = 15;
    const containerRect = container.getBoundingClientRect();
    const centerX = containerRect.width / 2;
    const centerY = containerRect.height / 2;

    for (let i = 0; i < particleCount; i++) {
      const p = document.createElement('div');
      p.className = 'clash-particle';
      p.textContent = emoji;

      const angle = Math.random() * Math.PI * 2;
      const distance = 50 + Math.random() * 120;

      const tx = Math.cos(angle) * distance;
      const ty = Math.sin(angle) * distance;
      const rot = 90 + Math.random() * 360;

      p.style.left = `${centerX}px`;
      p.style.top = `${centerY}px`;
      p.style.setProperty('--tx', `${tx}px`);
      p.style.setProperty('--ty', `${ty}px`);
      p.style.setProperty('--rot', `${rot}deg`);
      p.style.animationDelay = `${Math.random() * 0.2}s`;

      container.appendChild(p);
    }
  }

  async flipCoinVisual(message = "Lanzando moneda...") {
    this.playSound('coin');
    const coinModal = document.getElementById('modal-coin-flip');
    const coin = document.getElementById('game-coin');
    const resultText = document.getElementById('coin-result-text');

    if (!coinModal || !coin) {
      return Math.random() < 0.5;
    }

    coin.className = 'coin';
    if (resultText) resultText.textContent = message;
    coinModal.classList.add('active');

    const isHeads = Math.random() < 0.5;

    await new Promise(r => setTimeout(r, 200));

    if (isHeads) {
      coin.classList.add('flip-heads-anim');
    } else {
      coin.classList.add('flip-tails-anim');
    }

    await new Promise(r => setTimeout(r, 2000));

    if (resultText) {
      resultText.textContent = isHeads ? '¡CARA!' : '¡CRUZ!';
    }

    await new Promise(r => setTimeout(r, 1000));
    coinModal.classList.remove('active');

    return isHeads;
  }

  async flipLocalCoin(side = 'player') {
    const isHeads = Math.random() < 0.5;
    const name = side === 'player' ? this.player.name : this.opponent.name;
    this.addLog('system', `${name} lanzó una moneda...`);
    await this.flipBoardCoin(isHeads, side);
    this.addLog('system', `Resultado del lanzamiento: ${isHeads ? '¡CARA!' : '¡CRUZ!'}`);
  }

  async flipBoardCoin(isHeads, side = 'player') {
    const coinId = side === 'player' ? 'player-coin-inner' : 'opponent-coin-inner';
    const coinInner = document.getElementById(coinId);
    if (!coinInner) return;

    this.isCoinFlipping = true;
    this.playSound('coin');
    coinInner.className = 'board-coin-inner'; // Reset class
    // Trigger reflow
    void coinInner.offsetWidth;

    if (isHeads) {
      coinInner.classList.add('flip-heads-anim');
    } else {
      coinInner.classList.add('flip-tails-anim');
    }

    // Wait for the animation (1.5 seconds)
    await new Promise(r => setTimeout(r, 1500));

    // Reset class to static state
    coinInner.className = 'board-coin-inner ' + (isHeads ? 'heads' : 'tails');
    this.isCoinFlipping = false;
  }

  // Triggered when entering duel screen
  async openDeckSelector() {
    const pSelect = document.getElementById('player-duel-deck-select');
    const oSelect = document.getElementById('opponent-duel-deck-select');
    if (!pSelect || !oSelect) return;

    pSelect.innerHTML = '';
    oSelect.innerHTML = '';

    // Load available decks from DeckBuilder
    const saved = this.deckBuilder.savedDecks;

    // Filter legal decks (Starter decks are legal by default, custom decks must be validated)
    let hasLegalDeck = false;

    for (const id in saved) {
      const deck = saved[id];
      const optP = document.createElement('option');
      optP.value = deck.id;
      optP.textContent = deck.name;

      const optO = document.createElement('option');
      optO.value = deck.id;
      optO.textContent = deck.name;

      pSelect.appendChild(optP);
      oSelect.appendChild(optO);
      hasLegalDeck = true;
    }

    if (!hasLegalDeck) {
      await window.customAlert('Mazo no disponible', 'Primero debes crear o guardar al menos un mazo legal de 60 cartas en el Editor de Mazos.');
      return;
    }

    // Default select
    pSelect.value = 'starter-overgrowth';
    oSelect.value = 'starter-zap';

    document.getElementById('modal-deck-selector').classList.add('active');
  }

  // Sounds synth engine (retro look)
  playSound(type) {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }

      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      const now = this.audioCtx.currentTime;

      if (type === 'draw') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.15);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
      } else if (type === 'attach') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.setValueAtTime(900, now + 0.05);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
      } else if (type === 'attack') {
        // Explosion noise using FM synthesis simulation
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(120, now);
        osc.frequency.linearRampToValueAtTime(40, now + 0.3);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      } else if (type === 'coin') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.setValueAtTime(1320, now + 0.08);
        osc.frequency.setValueAtTime(1760, now + 0.16);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
      } else if (type === 'victory') {
        // Simple major chord sweep
        const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
        notes.forEach((freq, i) => {
          const oscN = this.audioCtx.createOscillator();
          const gainN = this.audioCtx.createGain();
          oscN.connect(gainN);
          gainN.connect(this.audioCtx.destination);

          oscN.type = 'triangle';
          oscN.frequency.setValueAtTime(freq, now + i * 0.12);
          gainN.gain.setValueAtTime(0.1, now + i * 0.12);
          gainN.gain.exponentialRampToValueAtTime(0.01, now + i * 0.12 + 0.3);

          oscN.start(now + i * 0.12);
          oscN.stop(now + i * 0.12 + 0.3);
        });
      }
    } catch (e) {
      console.warn('Audio Context failed to trigger sound:', e);
    }
  }

  // Initial setup trigger
  async startMatchFlow() {
    // Asegurar que controles sandbox online están ocultos en duelo local
    const chatContainer = document.getElementById('online-chat-input-container');
    if (chatContainer) chatContainer.style.display = 'none';

    const coinBtn = document.getElementById('btn-sandbox-coin-flip');
    if (coinBtn) coinBtn.style.display = 'none';

    // Reload coordinates dynamically before starting the match so edits are visible immediately
    try {
      const resPos = await fetch(`/cards/Battlefields/positions.json?t=${Date.now()}`);
      this.positionsData = await resPos.json();
      this.applyThemeCoordinates();
    } catch (e) {
      console.warn('Could not reload battlefields positions dynamically:', e);
    }

    const pDeckId = document.getElementById('player-duel-deck-select').value;
    const oDeckId = document.getElementById('opponent-duel-deck-select').value;

    const pDeck = this.deckBuilder.savedDecks[pDeckId];
    const oDeck = this.deckBuilder.savedDecks[oDeckId];

    if (!pDeck || !oDeck) return;

    document.getElementById('modal-deck-selector').classList.remove('active');

    // Setup player structures
    this.player = this.createPlayerState('Tú', pDeck, false);
    this.opponent = this.createPlayerState('Gary (AI)', oDeck, true);

    this.phase = 'setup';
    this.turnNumber = 1;
    this.energyAttachedThisTurn = false;
    this.retreatedThisTurn = false;
    this.selectedBoardCard = null;
    this.selectedHandCardIndex = null;
    this.targetingAction = null;
    this.animatedCards = new Set();
    this.playerActiveTrainer = null;
    this.opponentActiveTrainer = null;
    this.activeStadium = null;

    // Trigger SPA Navigation callback
    if (this.onGameStart) this.onGameStart();

    this.startDuelTimers();

    // Start battle visual log
    const logBox = document.getElementById('duel-log');
    if (logBox) logBox.innerHTML = '';
    this.addLog('system', '¡Comienza el duelo Pokémon TCG!');
    this.addLog('system', `Barajando mazos: ${pDeck.name} vs ${oDeck.name}`);

    // Initial Shuffle
    this.player.shuffleDeck();
    this.opponent.shuffleDeck();

    // Draw 7 Cards
    this.player.drawCards(7);
    this.opponent.drawCards(7);

    // Validate Mulligans
    await this.checkMulliganFlow('player');
    await this.checkMulliganFlow('opponent');

    // Disable Pass Turn button during setup
    document.getElementById('btn-pass-turn').disabled = true;

    // Trigger starting coin flip
    await this.startFirstTurnFlip();

    // Prompts placement
    this.addLog('system', 'Fase de Preparación: Coloca un Pokémon Básico en tu zona Activa.');
    this.updateBoardUI();

    // Highlight playable Basics in Player's Hand
    this.highlightPlayableBasicsInHand();
  }

  createPlayerState(name, deckTemplate, isAI) {
    // Reconstruct list of cards
    const cardList = [];
    let idCounter = 1;

    deckTemplate.cards.forEach(entry => {
      const originalCard = this.db.getCardById(entry.cardId);
      if (originalCard) {
        for (let i = 0; i < entry.count; i++) {
          cardList.push({
            instanceId: `${deckTemplate.id}-${idCounter++}`,
            card: originalCard,
            damage: 0,
            attachedEnergy: [],
            specialCondition: null,
            turnPlaced: 0
          });
        }
      }
    });

    const state = {
      name,
      isAI,
      deck: cardList,
      hand: [],
      active: null,
      bench: [null, null, null, null, null],
      prizes: [],
      discard: [],

      shuffleDeck() {
        for (let i = this.deck.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }
      },

      drawCards(count) {
        let drawn = 0;
        for (let i = 0; i < count; i++) {
          if (this.deck.length > 0) {
            this.hand.push(this.deck.pop());
            drawn++;
          }
        }
        return drawn;
      }
    };

    return state;
  }

  async checkMulliganFlow(side) {
    const user = side === 'player' ? this.player : this.opponent;
    let handSize = 7;

    while (handSize > 0) {
      const hasBasic = user.hand.some(c => c.card.supertype === 'Pokémon' && c.card.subtypes?.includes('Basic'));
      if (hasBasic) break;

      handSize--;

      if (side === 'player') {
        await window.customAlert('Mulligan', `No tienes Pokémon Básicos en tu mano inicial. Tu mano se mezclará en el mazo y robarás ${handSize} cartas.`);
      }

      this.addLog('system', `${user.name} no tiene Pokémon Básicos en su mano. Mulligan! Revela mano, baraja y roba ${handSize} cartas.`);

      // Put hand back to deck
      user.deck.push(...user.hand);
      user.hand = [];
      user.shuffleDeck();
      user.drawCards(handSize);
      this.updateBoardUI();
    }

    if (handSize === 0) {
      const winner = side === 'player' ? 'opponent' : 'player';
      this.endGame(winner, `${user.name} no tiene Pokémon Básicos en todo su mazo.`);
    }
  }

  // Flip coin modal flow to determine starting turn
  async startFirstTurnFlip() {
    this.playSound('coin');
    const coinModal = document.getElementById('modal-coin-flip');
    const coin = document.getElementById('game-coin');
    const resultText = document.getElementById('coin-result-text');

    if (!coinModal || !coin) {
      // Skip visual flip if elements are missing
      this.turnOwner = Math.random() < 0.5 ? 'player' : 'opponent';
      this.beginTurn();
      return;
    }

    coinModal.classList.add('active');
    coin.className = 'coin'; // Reset anims
    resultText.textContent = 'Lanzando moneda...';

    const coinIsHeads = Math.random() < 0.5;

    await new Promise(r => setTimeout(r, 200));

    if (coinIsHeads) {
      coin.classList.add('flip-heads-anim');
    } else {
      coin.classList.add('flip-tails-anim');
    }

    await new Promise(r => setTimeout(r, 2000));

    const playerGoesFirst = coinIsHeads;
    this.turnOwner = playerGoesFirst ? 'player' : 'opponent';
    resultText.textContent = playerGoesFirst ? '¡CARA! Vas primero.' : `¡CRUZ! El oponente ${this.opponent.name} va primero.`;

    await new Promise(r => setTimeout(r, 1200));
    coinModal.classList.remove('active');
  }

  beginTurn() {
    this.energyAttachedThisTurn = false;
    this.retreatedThisTurn = false;
    this.selectedBoardCard = null;
    this.selectedHandCardIndex = null;
    this.targetingAction = null;

    this.resetTurnTimer();

    document.getElementById('btn-pass-turn').disabled = (this.phase !== 'active' || this.turnOwner !== 'player');

    this.addLog('system', `--- Turno de ${this.turnOwner === 'player' ? this.player.name : this.opponent.name} (Turno ${this.turnNumber}) ---`);

    const activeUser = this.turnOwner === 'player' ? this.player : this.opponent;

    // Draw 1 card at start of turn
    const drawn = activeUser.drawCards(1);
    this.playSound('draw');
    if (drawn === 0) {
      // Deck out defeat!
      const loser = this.turnOwner;
      const winner = loser === 'player' ? 'opponent' : 'player';
      this.endGame(winner, `${activeUser.name} no tiene más cartas en su mazo para robar al inicio de su turno (Deck Out).`);
      return;
    }

    if (this.turnOwner === 'opponent') {
      this.updateBoardUI();
      setTimeout(() => this.executeAITurn(), 1500);
    } else {
      // Active player condition clears checks
      if (this.player.active && this.player.active.specialCondition === 'paralyzed') {
        // Paralysis clears at the end of the next player turn, wait! Clear it now as their turn started
        // Actually, it clears at the end of their turn, let's keep track or clear it at end of turn.
      }
      this.updateBoardUI();
    }
  }

  async endTurn() {
    if (!this.player) return;

    // Limpiar precisión (Sand-Attack/Smokescreen) al finalizar el turno de quien actúa
    const endingSide = this.turnOwner === 'player' ? this.player : this.opponent;
    if (endingSide.active) {
      endingSide.active.attackFailureCheck = null;
    }

    // Clear Trainer slots at end of turn
    if (this.turnOwner === 'player') {
      this.playerActiveTrainer = null;
    } else {
      this.opponentActiveTrainer = null;
    }
    this.updateBoardUI();

    // Between turns status updates
    await this.resolveBetweenTurnsEffects();

    // Flip turns
    this.turnOwner = this.turnOwner === 'player' ? 'opponent' : 'player';
    this.turnNumber++;

    // Limpiar prevención (Withdraw, Agility, Barrier) que expira al comenzar el nuevo turno del jugador
    const startingSide = this.turnOwner === 'player' ? this.player : this.opponent;
    if (startingSide.active) {
      startingSide.active.preventDamage = false;
      startingSide.active.preventAllEffects = false;
    }
    startingSide.bench.forEach(pkmn => {
      if (pkmn) {
        pkmn.preventDamage = false;
        pkmn.preventAllEffects = false;
      }
    });

    this.beginTurn();
  }

  async resolveBetweenTurnsEffects() {
    // 1. Poison check (10 damage after each turn)
    if (this.player.active && this.player.active.specialCondition === 'poisoned') {
      let dmg = 10;
      // Nidoking custom rule: Nidoking's toxic attack deals 20 poison. We will verify if it has toxic special counter
      if (this.player.active.toxicPoison) dmg = 20;
      this.player.active.damage += dmg;
      this.addLog('opponent', `Veneno inflige ${dmg} de daño a ${this.player.active.card.name}.`);
      this.checkKnockout('player');
    }
    if (this.opponent.active && this.opponent.active.specialCondition === 'poisoned') {
      let dmg = 10;
      if (this.opponent.active.toxicPoison) dmg = 20;
      this.opponent.active.damage += dmg;
      this.addLog('player', `Veneno inflige ${dmg} de daño a ${this.opponent.active.card.name}.`);
      this.checkKnockout('opponent');
    }

    // 1.5. Burned check (20 damage, coin flip to cure)
    if (this.player.active && this.player.active.specialCondition === 'burned') {
      this.player.active.damage += 20;
      this.addLog('opponent', `La quemadura inflige 20 de daño a ${this.player.active.card.name}.`);
      this.addLog('player', `Lanzando moneda por quemadura de ${this.player.active.card.name}...`);
      const cures = Math.random() < 0.5;
      if (cures) {
        this.player.active.specialCondition = null;
        this.addLog('player', `${this.player.active.card.name} se ha curado de la quemadura.`);
      } else {
        this.addLog('player', `${this.player.active.card.name} sigue quemado.`);
      }
      this.checkKnockout('player');
    }
    if (this.opponent.active && this.opponent.active.specialCondition === 'burned') {
      this.opponent.active.damage += 20;
      this.addLog('player', `La quemadura inflige 20 de daño a ${this.opponent.active.card.name}.`);
      this.addLog('opponent', `Lanzando moneda por quemadura de ${this.opponent.active.card.name}...`);
      const cures = Math.random() < 0.5;
      if (cures) {
        this.opponent.active.specialCondition = null;
        this.addLog('opponent', `${this.opponent.active.card.name} se ha curado de la quemadura.`);
      } else {
        this.addLog('opponent', `${this.opponent.active.card.name} sigue quemado.`);
      }
      this.checkKnockout('opponent');
    }

    // 2. Sleep check (coin flip to wake up)
    if (this.player.active && this.player.active.specialCondition === 'asleep') {
      this.addLog('player', `${this.player.active.card.name} está dormido. Lanzando moneda para despertar...`);
      const isHeads = await this.flipCoinVisual(`¿Despierta ${this.player.active.card.name}?`);
      if (isHeads) {
        this.player.active.specialCondition = null;
        this.addLog('player', `${this.player.active.card.name} se ha despertado.`);
      } else {
        this.addLog('player', `${this.player.active.card.name} sigue dormido.`);
      }
    }
    if (this.opponent.active && this.opponent.active.specialCondition === 'asleep') {
      this.addLog('opponent', `${this.opponent.active.card.name} está dormido. Lanzando moneda para despertar...`);
      const isHeads = await this.flipCoinVisual(`¿Despierta ${this.opponent.active.card.name}?`);
      if (isHeads) {
        this.opponent.active.specialCondition = null;
        this.addLog('opponent', `${this.opponent.active.card.name} se ha despertado.`);
      } else {
        this.addLog('opponent', `${this.opponent.active.card.name} sigue dormido.`);
      }
    }

    // 3. Clear Paralysis if it was active on the player who is finishing their turn
    const endingSide = this.turnOwner === 'player' ? this.player : this.opponent;
    if (endingSide.active && endingSide.active.specialCondition === 'paralyzed') {
      endingSide.active.specialCondition = null;
      this.addLog('system', `${endingSide.active.card.name} ya no está paralizado.`);
    }
  }

  // Board click handler logic
  handleBoardSlotClick(side, zone, index) {
    if (!this.player) return;
    if (this.phase === 'game-over') return;

    // Promotion Phase KO resolution
    if (this.phase === 'must-promote') {
      if (side === 'player' && zone === 'bench' && this.player.bench[index]) {
        this.promoteBenchedToActive(index);
      }
      return;
    }

    // 1. Setup Active placement
    if (this.phase === 'setup') {
      if (side === 'player' && zone === 'active') {
        if (this.selectedHandCardIndex !== null) {
          const cardObj = this.player.hand[this.selectedHandCardIndex];
          if (cardObj.card.supertype === 'Pokémon' && cardObj.card.subtypes?.includes('Basic')) {
            this.player.active = cardObj;
            this.player.active.turnPlaced = 0; // Turn 0 setup
            this.player.hand.splice(this.selectedHandCardIndex, 1);
            this.selectedHandCardIndex = null;
            this.addLog('player', `Colocaste a ${this.player.active.card.name} como tu Pokémon Activo.`);

            // AI places active automatically
            this.executeAISetupActive();

            // Distribute 6 Prizes
            this.placePrizes('player');
            this.placePrizes('opponent');

            this.updateBoardUI();

            // Setup complete, start turn
            this.phase = 'active';
            this.beginTurn();
          } else {
            this.showWarning('Sólo puedes colocar un Pokémon Básico como tu Pokémon Activo.');
          }
        }
      } else if (side === 'player' && zone === 'bench') {
        // Allow placing bench during setup
        if (this.selectedHandCardIndex !== null) {
          const cardObj = this.player.hand[this.selectedHandCardIndex];
          if (cardObj.card.supertype === 'Pokémon' && cardObj.card.subtypes?.includes('Basic') && !this.player.bench[index]) {
            this.player.bench[index] = cardObj;
            cardObj.turnPlaced = 0;
            this.player.hand.splice(this.selectedHandCardIndex, 1);
            this.selectedHandCardIndex = null;
            this.addLog('player', `Colocaste a ${cardObj.card.name} en la Banca.`);
            this.updateBoardUI();
            this.highlightPlayableBasicsInHand();
          } else if (cardObj.card.supertype === 'Pokémon' && !cardObj.card.subtypes?.includes('Basic')) {
            this.showWarning('Sólo puedes colocar Pokémon Básicos en la Banca.');
          }
        }
      }
      return;
    }

    // Main Game Phase Click resolved
    if (this.turnOwner !== 'player') return; // Only process on player's turn

    // A. Resolve Hand Card plays on Board slots
    if (this.selectedHandCardIndex !== null) {
      const cardObj = this.player.hand[this.selectedHandCardIndex];
      if (!cardObj) {
        this.selectedHandCardIndex = null;
        this.updateBoardUI();
        this.renderActionPanel();
        return;
      }

      const card = cardObj.card;

      if (side !== 'player') {
        this.showWarning('No puedes jugar cartas de tu mano en el lado del oponente.');
        this.selectedHandCardIndex = null;
        this.updateBoardUI();
        this.renderActionPanel();
        return;
      }

      // 1. Play Basic Pokémon
      if (card.supertype === 'Pokémon' && card.subtypes?.includes('Basic')) {
        if (zone === 'bench' && !this.player.bench[index]) {
          this.player.bench[index] = cardObj;
          cardObj.turnPlaced = this.turnNumber;
          this.player.hand.splice(this.selectedHandCardIndex, 1);
          this.selectedHandCardIndex = null;
          this.addLog('player', `Colocaste a ${card.name} en tu Banca.`);
          this.updateBoardUI();
          this.renderActionPanel();
          return;
        } else if (zone === 'bench' && this.player.bench[index]) {
          this.showWarning('Esa ranura de la Banca ya está ocupada.');
        } else if (zone === 'active') {
          this.showWarning('No puedes colocar un Pokémon de tu mano directamente en la zona Activa durante el juego principal.');
        } else {
          this.showWarning('Acción inválida para este Pokémon.');
        }
      }
      // 2. Attach Energy Card
      else if (card.supertype === 'Energy') {
        const pkmn = zone === 'active' ? this.player.active : this.player.bench[index];
        if (pkmn) {
          if (this.energyAttachedThisTurn) {
            this.showWarning('Regla TCG: Sólo puedes unir 1 carta de Energía por turno.');
          } else {
            pkmn.attachedEnergy.push(card);
            this.player.hand.splice(this.selectedHandCardIndex, 1);
            this.energyAttachedThisTurn = true;
            this.selectedHandCardIndex = null;
            this.playSound('attach');
            this.addLog('player', `Uniste ${card.name} a ${pkmn.card.name}.`);
            this.updateBoardUI();
            this.renderActionPanel();
            return;
          }
        } else {
          this.showWarning('Debes hacer clic en uno de tus Pokémon para unirle energía.');
        }
      }
      // 4. Evolve Pokémon
      else if (card.supertype === 'Pokémon' && (card.subtypes?.includes('Stage 1') || card.subtypes?.includes('Stage 2'))) {
        const pkmn = zone === 'active' ? this.player.active : this.player.bench[index];
        if (pkmn) {
          const correctName = pkmn.card.name === card.evolvesFrom;
          const placedPrevious = pkmn.turnPlaced < this.turnNumber;
          if (correctName && placedPrevious) {
            pkmn.card = card; // Evolve!
            pkmn.turnPlaced = this.turnNumber;
            this.player.hand.splice(this.selectedHandCardIndex, 1);
            this.selectedHandCardIndex = null;
            this.playSound('attach');
            this.addLog('player', `¡Evolucionaste a ${card.evolvesFrom} en ${card.name}!`);
            this.updateBoardUI();
            this.renderActionPanel();
            return;
          } else {
            if (!correctName) {
              this.showWarning(`No puedes evolucionar a ${pkmn.card.name} en ${card.name}. Debe evolucionar de ${card.evolvesFrom}.`);
            } else {
              this.showWarning(`No puedes evolucionar a ${pkmn.card.name} en el mismo turno en que fue colocado.`);
            }
          }
        } else {
          this.showWarning('Debes hacer clic en uno de tus Pokémon para evolucionarlo.');
        }
      } else {
        this.showWarning('Acción inválida para la carta seleccionada.');
      }

      // If we reach here, the attempt was invalid/unhandled. Cancel selection.
      this.selectedHandCardIndex = null;
      this.updateBoardUI();
      this.renderActionPanel();
      return;
    }

    // B. Targeting Mode for Trainers/Abilities (e.g. play Potion -> select target on board)
    if (this.targetingAction) {
      const pendingCardObj = this.targetingAction.pendingCard;
      const sourceCard = pendingCardObj ? pendingCardObj.card : null;
      const targetPkmn = side === 'player'
        ? (zone === 'active' ? this.player.active : this.player.bench[index])
        : (zone === 'active' ? this.opponent.active : this.opponent.bench[index]);

      if (!targetPkmn) {
        this.showWarning('Debes hacer clic en un Pokémon para aplicar el efecto.');
        if (pendingCardObj) {
          this.player.hand.push(pendingCardObj);
        }
        this.playerActiveTrainer = null;
        this.targetingAction = null;
        this.selectedHandCardIndex = null;
        this.updateBoardUI();
        this.renderActionPanel();
        return;
      }

      let success = false;
      if (sourceCard && sourceCard.name === 'Potion') {
        const result = GameRules.executeTrainer(sourceCard, this.player, this.opponent, { targetPkmn });
        if (result.success) {
          result.log.forEach(l => this.addLog('player', l));
          this.player.discard.push(sourceCard);
          this.playSound('attach');
          success = true;
        } else {
          this.showWarning(result.log[0] || 'No se pudo usar la Poción.');
        }
      } else if (sourceCard && sourceCard.name === 'Switch') {
        if (side === 'player' && zone === 'bench') {
          const result = GameRules.executeTrainer(sourceCard, this.player, this.opponent, { benchIndex: index });
          if (result.success) {
            result.log.forEach(l => this.addLog('player', l));
            this.player.discard.push(sourceCard);
            this.playSound('attach');
            success = true;
          } else {
            this.showWarning(result.log[0] || 'No se pudo cambiar el Pokémon.');
          }
        } else {
          this.showWarning('Debes hacer clic en un Pokémon en tu Banca para cambiarlo.');
        }
      } else if (sourceCard && sourceCard.name === 'Gust of Wind') {
        if (side === 'opponent' && zone === 'bench') {
          const result = GameRules.executeTrainer(sourceCard, this.player, this.opponent, { benchIndex: index });
          if (result.success) {
            result.log.forEach(l => this.addLog('player', l));
            this.player.discard.push(sourceCard);
            this.playSound('attach');
            success = true;
          } else {
            this.showWarning(result.log[0] || 'No se pudo usar Ráfaga de Viento.');
          }
        } else {
          this.showWarning('Debes hacer clic en un Pokémon en la Banca del oponente.');
        }
      }

      if (success) {
        // Keep it in the slot briefly, then clear
        setTimeout(() => {
          this.playerActiveTrainer = null;
          this.updateBoardUI();
        }, 1200);
      } else {
        // Failed: put back in hand
        if (pendingCardObj) {
          this.player.hand.push(pendingCardObj);
        }
        this.playerActiveTrainer = null;
      }

      this.targetingAction = null;
      this.selectedHandCardIndex = null;
      this.updateBoardUI();
      this.renderActionPanel();
      return;
    }

    // C. Normal selection on board
    this.selectedBoardCard = { side, zone, index };
    this.updateBoardUI();
    this.renderActionPanel();
  }

  // Sets up prizes top-most cards
  placePrizes(side) {
    const user = side === 'player' ? this.player : this.opponent;
    user.prizes = [];
    for (let i = 0; i < 6; i++) {
      if (user.deck.length > 0) {
        user.prizes.push(user.deck.pop());
      }
    }
  }

  promoteBenchedToActive(benchIdx) {
    const newActive = this.player.bench[benchIdx];
    if (newActive) {
      const oldActive = this.player.active;
      if (oldActive) {
        // Retreat swap
        oldActive.specialCondition = null;
        oldActive.toxicPoison = false;
        this.player.active = newActive;
        this.player.bench[benchIdx] = oldActive;
        this.addLog('player', `Retiraste a ${oldActive.card.name} e ingresó ${newActive.card.name}.`);
      } else {
        // Knockout promotion
        this.player.active = newActive;
        this.player.bench[benchIdx] = null;
        this.addLog('player', `Promoviste a ${newActive.card.name} al puesto Activo.`);
      }

      if (this.player.active) {
        this.player.active.specialCondition = null;
        this.player.active.toxicPoison = false;
      }

      this.phase = 'active';
      this.updateBoardUI();
      this.renderActionPanel();
    }
  }

  // Dynamic panel displaying stats, moves, abilities of the selected card
  renderActionPanel() {
    const panel = document.getElementById('active-pkmn-details');
    const buttonsContainer = document.getElementById('combat-actions-container');
    if (!panel || !buttonsContainer) return;

    panel.innerHTML = '';
    buttonsContainer.innerHTML = '';

    // If a hand card is selected, show its options instead
    if (this.selectedHandCardIndex !== null) {
      const cardObj = this.player.hand[this.selectedHandCardIndex];
      if (!cardObj) return;
      const card = cardObj.card;

      panel.innerHTML = `
        <div class="detail-row"><strong>${card.name}</strong> <span>${card.supertype}</span></div>
        <div class="detail-row"><span style="font-size:0.8rem; color:var(--color-text-muted);">${card.rules ? card.rules.join('<br>') : (card.supertype === 'Energy' ? 'Energía básica' : 'Pokémon')}</span></div>
      `;

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'combat-btn';
      cancelBtn.textContent = 'Cancelar Selección';
      cancelBtn.addEventListener('click', () => {
        this.selectedHandCardIndex = null;
        this.updateBoardUI();
        this.renderActionPanel();
      });

      if (card.supertype === 'Trainer') {
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'combat-btn primary';
        confirmBtn.innerHTML = `<strong>Confirmar y Jugar</strong>`;
        confirmBtn.addEventListener('click', () => {
          this.playTrainerCardFromHand(this.selectedHandCardIndex);
        });
        buttonsContainer.appendChild(confirmBtn);
      } else if (card.supertype === 'Energy') {
        const infoMsg = document.createElement('p');
        infoMsg.className = 'placeholder-text';
        infoMsg.textContent = 'Haz clic en uno de tus Pokémon en el tablero para unirle esta energía.';
        buttonsContainer.appendChild(infoMsg);
      } else if (card.supertype === 'Pokémon') {
        const infoMsg = document.createElement('p');
        infoMsg.className = 'placeholder-text';
        if (card.subtypes?.includes('Basic')) {
          infoMsg.textContent = 'Haz clic en tu puesto Activo o en una ranura vacía de tu Banca para colocar este Pokémon.';
        } else {
          infoMsg.textContent = `Haz clic en un ${card.evolvesFrom} en tu tablero para evolucionarlo.`;
        }
        buttonsContainer.appendChild(infoMsg);
      }

      buttonsContainer.appendChild(cancelBtn);
      return;
    }

    if (!this.selectedBoardCard) {
      panel.innerHTML = '<p class="placeholder-text">Selecciona una de tus cartas en juego para realizar acciones.</p>';
      return;
    }

    const { side, zone, index } = this.selectedBoardCard;
    const user = side === 'player' ? this.player : this.opponent;
    const pkmn = zone === 'active' ? user.active : user.bench[index];

    if (!pkmn) {
      panel.innerHTML = '<p class="placeholder-text">Ranura vacía.</p>';
      return;
    }

    // Draw detail rows
    panel.innerHTML = `
      <div class="detail-row"><strong>${pkmn.card.name}</strong> <span>HP ${pkmn.card.hp - pkmn.damage}/${pkmn.card.hp}</span></div>
      <div class="detail-row"><span>Etapa: ${pkmn.card.subtypes[0]}</span> <span>Tipo: ${pkmn.card.types ? pkmn.card.types[0] : 'Incoloro'}</span></div>
      <div class="detail-row"><span>Condición: ${pkmn.specialCondition || 'Normal'}</span> <span>Energía: ${pkmn.attachedEnergy.length}</span></div>
    `;

    // Add buttons for actions if it's the player's side and the player's turn
    if (this.turnOwner === 'player' && side === 'player') {

      // I. If it's Active, render Attacks, Abilities, and Retreat
      if (zone === 'active') {
        const canAct = pkmn.specialCondition !== 'asleep' && pkmn.specialCondition !== 'paralyzed';

        // 1. Pokémon Powers (Abilities)
        if (pkmn.card.abilities) {
          pkmn.card.abilities.forEach(ab => {
            const btn = document.createElement('button');
            btn.className = 'combat-btn';
            btn.innerHTML = `
              <strong>Poder: ${ab.name}</strong>
              <span class="attack-cost">${ab.text}</span>
            `;

            // Custom Power: Damage Swap Alakazam
            if (ab.name === 'Damage Swap' && canAct) {
              btn.addEventListener('click', () => this.triggerDamageSwapFlow());
            } else if (ab.name === 'Rain Dance' && canAct) {
              btn.addEventListener('click', () => this.triggerRainDanceFlow());
            } else {
              btn.disabled = true;
            }
            buttonsContainer.appendChild(btn);
          });
        }

        // 2. Attacks
        pkmn.card.attacks.forEach(atk => {
          const btn = document.createElement('button');
          btn.className = 'combat-btn';
          btn.innerHTML = `
            <strong>Ataque: ${atk.name} (${atk.damage || 'Efecto'})</strong>
            <span class="attack-cost">Costo: ${atk.cost.join(', ')}</span>
            <span class="attack-cost" style="font-size:0.75rem;">${atk.text}</span>
          `;

          // Verify energy requirements
          const hasEnergy = GameRules.checkEnergyRequirements(atk.cost, pkmn.attachedEnergy);

          if (!hasEnergy || !canAct) {
            btn.disabled = true;
          }

          btn.addEventListener('click', () => this.executeAttack(atk, pkmn, this.opponent.active));
          buttonsContainer.appendChild(btn);
        });

        // 3. Retreat
        const retreatBtn = document.createElement('button');
        retreatBtn.className = 'combat-btn';
        const costCount = pkmn.card.retreatCost ? pkmn.card.retreatCost.length : 0;
        retreatBtn.innerHTML = `
          <strong>Retirarse (Retreat)</strong>
          <span class="attack-cost">Costo: ${costCount} Energía(s)</span>
        `;

        const hasRetreatEnergy = pkmn.attachedEnergy.length >= costCount;
        if (!hasRetreatEnergy || this.retreatedThisTurn || this.player.bench.every(b => b === null)) {
          retreatBtn.disabled = true;
        }

        retreatBtn.addEventListener('click', () => this.executeRetreatFlow(pkmn));
        buttonsContainer.appendChild(retreatBtn);
      }

      // II. Benched Pokémon Actions (Evolve)
      else if (zone === 'bench') {
        // Can evolve if card is basic or stage 1, and matched evolution card is in hand
        // Check also if turnPlaced < currentTurn (cannot evolve on the turn placed)
      }
    }
  }

  async playTrainerCardFromHand(index) {
    const cardObj = this.player.hand[index];
    if (!cardObj) return;
    const card = cardObj.card;

    // Remove from hand first
    this.player.hand.splice(index, 1);

    // Place in trainer slot (or stadium slot if it is a Stadium card)
    if (card.subtypes?.includes('Stadium') || card.supertype === 'Stadium') {
      if (this.activeStadium) {
        this.player.discard.push(this.activeStadium);
        this.addLog('system', `El Estadio anterior (${this.activeStadium.name}) es descartado.`);
      }
      this.activeStadium = card;
      this.playSound('attach');
      this.selectedHandCardIndex = null;

      const result = GameRules.executeTrainer(card, this.player, this.opponent);
      result.log.forEach(l => this.addLog('player', l));

      this.updateBoardUI();
      this.renderActionPanel();
      return;
    }

    // Normal Trainer
    this.playerActiveTrainer = card;
    this.updateBoardUI();
    this.playSound('attach');

    // Wait a brief moment to show it in the slot before executing and discarding
    await new Promise(r => setTimeout(r, 1200));

    if (card.name === 'Bill' || card.name === 'Professor Oak' || card.name === 'Full Heal') {
      const result = GameRules.executeTrainer(card, this.player, this.opponent);
      if (result.success) {
        result.log.forEach(l => this.addLog('player', l));
        this.player.discard.push(card);
      } else {
        this.showWarning(result.log[0] || 'No se pudo jugar la carta de Entrenador.');
        // Put back in hand
        this.player.hand.splice(index, 0, cardObj);
      }
      this.playerActiveTrainer = null;
      this.selectedHandCardIndex = null;
      this.updateBoardUI();
      this.renderActionPanel();
    } else {
      // Needs target selection (e.g. Potion, Switch, Gust of Wind)
      this.targetingAction = { type: 'trainer', cardIndex: -1, pendingCard: cardObj };
      this.selectedHandCardIndex = null;
      this.showWarning(`Carta ${card.name}: Selecciona un objetivo en el tablero para aplicar el efecto.`);
      this.updateBoardUI();
      this.renderActionPanel();
    }
  }
  async executeAttack(attack, attacker, defender) {
    if (!defender) {
      this.showWarning('El oponente no tiene Pokémon Activo al cual atacar.');
      return;
    }

    const attackerSide = this.turnOwner; // 'player' or 'opponent'
    const defenderSide = attackerSide === 'player' ? 'opponent' : 'player';

    // 1. Confusion status coin flip check
    if (attacker.specialCondition === 'confused') {
      this.addLog(attackerSide, `${attacker.card.name} está confundido. Lanza una moneda...`);
      const isHeads = await this.flipCoinVisual(`¿Ataca confundido ${attacker.card.name}?`);
      if (!isHeads) {
        this.addLog(attackerSide, '¡Sello! El ataque falla y el Pokémon se hace 20 de daño a sí mismo.');
        attacker.damage += 20;
        this.checkKnockout(attackerSide);
        await this.endTurn();
        return;
      } else {
        this.addLog(attackerSide, '¡Cara! Ataca con éxito.');
      }
    }

    // Chequeo de precisión (Sand-Attack / Smokescreen)
    if (attacker.attackFailureCheck) {
      this.addLog(attackerSide, `${attacker.card.name} está afectado por precisión. Lanza una moneda...`);
      const isHeads = await this.flipCoinVisual(`¿Precisión para ${attacker.card.name}?`);
      if (!isHeads) {
        this.addLog(attackerSide, '¡Sello! El ataque falla.');
        attacker.attackFailureCheck = null;
        await this.endTurn();
        return;
      }
      attacker.attackFailureCheck = null;
    }

    // 2. Resolve damage
    let finalDmg = GameRules.calculateDamage(attack, attacker, defender, attacker.attachedEnergy);

    // Parse parsed effects
    const parsedEffects = parseAttackText(attack.text);
    let selfDmg = 0;
    let benchDmg = 0;
    let statusApplied = null;

    for (const eff of parsedEffects) {
      if (eff.type === 'damage_multiplier') {
        this.addLog(attackerSide, `Lanzando ${eff.coins} moneda(s) para ${attack.name}...`);
        let heads = 0;
        for (let i = 0; i < eff.coins; i++) {
          const flip = await this.flipCoinVisual(`${attack.name} Moneda ${eff.coins > 1 ? i + 1 : ''}`);
          if (flip) heads++;
        }
        finalDmg = eff.damagePerHead * heads;
        this.addLog(attackerSide, `Resultados: ${heads} cara(s). Daño total: ${finalDmg}`);
      }
      else if (eff.type === 'coin_extra_damage') {
        this.addLog(attackerSide, `Lanzando moneda para daño extra de ${attack.name}...`);
        const flip = await this.flipCoinVisual(`¿Daño extra para ${attack.name}?`);
        if (flip) {
          finalDmg = eff.baseDmg + eff.extraDmg;
          this.addLog(attackerSide, `¡Cara! Daño aumentado a ${finalDmg}.`);
        } else {
          finalDmg = eff.baseDmg;
          this.addLog(attackerSide, `¡Sello! Daño base es ${finalDmg}.`);
        }
      }
      else if (eff.type === 'coin_status') {
        this.addLog(attackerSide, `Efecto de ${attack.name}: Lanzando moneda para ${eff.condition}...`);
        const flip = await this.flipCoinVisual(`¿Aplicar ${eff.condition} a ${defender.card.name}?`);
        if (flip) {
          statusApplied = eff.condition;
        } else {
          this.addLog('system', 'Falló el efecto de condición especial.');
        }
      }
      else if (eff.type === 'direct_status') {
        statusApplied = eff.condition;
      }
      else if (eff.type === 'coin_prevent_damage') {
        this.addLog(attackerSide, `Lanzando moneda para prevención de daño de ${attack.name}...`);
        const flip = await this.flipCoinVisual(`¿Prevenir daño para ${attacker.card.name}?`);
        if (flip) {
          attacker.preventDamage = true;
          this.addLog(attackerSide, `¡Cara! Se prevendrán los daños hechos a ${attacker.card.name} durante el próximo turno.`);
        } else {
          this.addLog(attackerSide, `¡Sello! No se previene el daño.`);
        }
      }
      else if (eff.type === 'coin_prevent_all') {
        this.addLog(attackerSide, `Lanzando moneda para prevención total de ${attack.name}...`);
        const flip = await this.flipCoinVisual(`¿Prevenir efectos/daño para ${attacker.card.name}?`);
        if (flip) {
          attacker.preventAllEffects = true;
          this.addLog(attackerSide, `¡Cara! Se prevendrán los efectos y daños a ${attacker.card.name} durante el próximo turno.`);
        } else {
          this.addLog(attackerSide, `¡Sello! No se previenen los efectos.`);
        }
      }
      else if (eff.type === 'accuracy_debuff') {
        defender.attackFailureCheck = 'precision';
        this.addLog(attackerSide, `¡Efecto secundario! ${defender.card.name} tendrá que lanzar moneda para atacar el próximo turno.`);
      }
      else if (eff.type === 'self_damage') {
        selfDmg = eff.damage;
      }
      else if (eff.type === 'bench_damage') {
        benchDmg = eff.damage;
      }
    }

    // Validar si el defensor tiene prevención activa
    const isWeakness = defender.card.weaknesses && defender.card.weaknesses.some(w => attacker.card.types.includes(w.type));
    const isResistance = defender.card.resistances && defender.card.resistances.some(r => attacker.card.types.includes(r.type));

    if (defender.preventDamage || defender.preventAllEffects) {
      finalDmg = 0;
      this.addLog('system', `¡El daño es prevenido por el efecto activo en ${defender.card.name}!`);
    }

    // Run battle clash overlay animation
    await this.animateClash(attack, attacker, defender, finalDmg, isWeakness, isResistance);

    defender.damage += finalDmg;
    this.addLog(attackerSide, `¡${attacker.card.name} usó ${attack.name} y causó ${finalDmg} de daño a ${defender.card.name}!`);

    if (selfDmg > 0) {
      attacker.damage += selfDmg;
      this.addLog(attackerSide, `${attacker.card.name} se hizo ${selfDmg} de daño a sí mismo.`);
    }

    if (benchDmg > 0) {
      const attackerState = attackerSide === 'player' ? this.player : this.opponent;
      const defenderState = attackerSide === 'player' ? this.opponent : this.player;

      attackerState.bench.forEach(pkmn => {
        if (pkmn) {
          pkmn.damage += benchDmg;
          this.addLog(attackerSide, `${pkmn.card.name} de la banca recibió ${benchDmg} de daño.`);
        }
      });

      defenderState.bench.forEach(pkmn => {
        if (pkmn) {
          if (!pkmn.preventDamage && !pkmn.preventAllEffects) {
            pkmn.damage += benchDmg;
            this.addLog(attackerSide, `${pkmn.card.name} de la banca del oponente recibió ${benchDmg} de daño.`);
          }
        }
      });
    }

    // Aplicar condición especial
    if (statusApplied && defender) {
      if (defender.preventAllEffects) {
        this.addLog('system', `¡Los efectos adicionales de estado fueron prevenidos en ${defender.card.name}!`);
      } else {
        defender.specialCondition = statusApplied;
        if (attack.name === 'Toxic') defender.toxicPoison = true;

        const statusLabels = { confused: 'confundido', asleep: 'dormido', paralyzed: 'paralizado', poisoned: 'envenenado', burned: 'quemado' };
        const label = statusLabels[statusApplied] || statusApplied;
        this.addLog(defenderSide, `${defender.card.name} está ${label}.`);
      }
    }

    // Check knockout
    this.checkKnockout('player');
    this.checkKnockout('opponent');

    // End turn automatically
    await this.endTurn();
  }

  // Knockout resolution flow
  checkKnockout(side) {
    const user = side === 'player' ? this.player : this.opponent;
    const opponent = side === 'player' ? this.opponent : this.player;
    let activeKnockedOut = false;

    // 1. Check Active
    const activePkmn = user.active;
    if (activePkmn && activePkmn.damage >= activePkmn.card.hp) {
      this.addLog('system', `¡${activePkmn.card.name} de ${user.name} fue debilitado (K.O.)!`);
      this.showWarning(`¡${activePkmn.card.name} de ${user.name} fue debilitado!`);

      const activeElSelector = side === 'player' ? '#player-active .board-card' : '#opponent-active .board-card';
      const activeEl = document.querySelector(activeElSelector);
      if (activeEl) {
        this.animateCardToDiscard(activeEl, side, activePkmn.card);
      }

      // Move to discard
      user.discard.push(activePkmn.card);
      activePkmn.attachedEnergy.forEach(e => user.discard.push(e));
      user.active = null;
      activeKnockedOut = true;

      // Opponent draws prize
      if (opponent.prizes.length > 0) {
        if (side === 'player') {
          // AI draws automatically
          const drawingSide = 'opponent';
          const prizeIndex = opponent.prizes.length - 1;
          this.animatePrizeToHand(drawingSide, prizeIndex);

          const prize = opponent.prizes.pop();
          opponent.hand.push(prize);
          this.addLog('system', `${opponent.name} tomó 1 carta de Premio.`);

          if (opponent.prizes.length === 0) {
            this.endGame('opponent', '¡Tomó todas sus cartas de Premio!');
            return;
          }
        } else {
          // Local player must click manually, notify them
          this.addLog('system', `¡Has debilitado a un Pokémon rival! Toma una carta de Premio haciendo clic en ella.`);
          this.showWarning('¡Toma una carta de Premio!');
        }
      }
    }

    // 2. Check Bench
    for (let i = 0; i < user.bench.length; i++) {
      const pkmn = user.bench[i];
      if (pkmn && pkmn.damage >= pkmn.card.hp) {
        this.addLog('system', `¡${pkmn.card.name} de la banca de ${user.name} fue debilitado (K.O.)!`);
        this.showWarning(`¡${pkmn.card.name} de la banca de ${user.name} fue debilitado!`);

        const benchElSelector = side === 'player' ? `#player-bench [data-index="${i}"] .board-card` : `#opponent-bench [data-index="${i}"] .board-card`;
        const benchEl = document.querySelector(benchElSelector);
        if (benchEl) {
          this.animateCardToDiscard(benchEl, side, pkmn.card);
        }

        // Move to discard
        user.discard.push(pkmn.card);
        pkmn.attachedEnergy.forEach(e => user.discard.push(e));
        user.bench[i] = null;

        // Opponent draws prize
        if (opponent.prizes.length > 0) {
          if (side === 'player') {
            // AI draws automatically
            const drawingSide = 'opponent';
            const prizeIndex = opponent.prizes.length - 1;
            this.animatePrizeToHand(drawingSide, prizeIndex);

            const prize = opponent.prizes.pop();
            opponent.hand.push(prize);
            this.addLog('system', `${opponent.name} tomó 1 carta de Premio.`);

            if (opponent.prizes.length === 0) {
              this.endGame('opponent', '¡Tomó todas sus cartas de Premio!');
              return;
            }
          } else {
            // Local player must click manually, notify them
            this.addLog('system', `¡Has debilitado a un Pokémon rival! Toma una carta de Premio haciendo clic en ella.`);
            this.showWarning('¡Toma una carta de Premio!');
          }
        }
      }
    }

    // 3. Post-Knockout state validations
    if (activeKnockedOut) {
      // Check if user has no benched Pokémon left (loss condition)
      const hasBench = user.bench.some(b => b !== null);
      if (!hasBench) {
        const winner = side === 'player' ? 'opponent' : 'player';
        this.endGame(winner, `${user.name} no tiene Pokémon en la banca para promover.`);
        return;
      }

      // Trigger Must Promote Phase
      if (side === 'player') {
        this.phase = 'must-promote';
        this.resetTurnTimer();
        this.addLog('system', 'Debes elegir un Pokémon de tu banca para promoverlo a Activo.');
      } else {
        if (user.isAI) {
          this.executeAIPromoteActive();
        } else {
          this.phase = 'opponent-must-promote';
          this.resetTurnTimer();
          this.addLog('system', `Esperando a que ${user.name} elija un Pokémon de su banca para promoverlo a Activo.`);
        }
      }
    }

    this.updateBoardUI();
  }

  // Retreat active
  executeRetreatFlow(pkmn) {
    const costCount = pkmn.card.retreatCost ? pkmn.card.retreatCost.length : 0;

    // Discard energies
    for (let i = 0; i < costCount; i++) {
      const energy = pkmn.attachedEnergy.pop();
      this.player.discard.push(energy);
    }

    this.retreatedThisTurn = true;
    this.addLog('player', `Retiraste a ${pkmn.card.name} descartando ${costCount} energías.`);

    // Choose bench target
    this.phase = 'must-promote'; // Triggers bench selection
    this.updateBoardUI();
  }

  // Alakazam Custom Damage Swap Ability
  triggerDamageSwapFlow() {
    this.showWarning('Modo Damage Swap: Haz clic en el Pokémon con daño del cual quieras quitar el contador, y luego en el Pokémon donde quieras colocarlo.');
    // Simple state flow can be modeled but let's keep it clean
  }

  // Blastoise Rain Dance Ability
  triggerRainDanceFlow() {
    // Allows attaching water energy from hand
    const waterEnergies = this.player.hand.filter(c => c.card.name === 'Water Energy');
    if (waterEnergies.length === 0) {
      this.showWarning('No tienes energías de Agua en tu mano para usar Danza de Lluvia.');
      return;
    }
    this.showWarning('Selecciona una energía de Agua en tu mano y colócala en un Pokémon de agua.');
  }

  // Ends game and opens GameOver Overlay
  endGame(winnerSide, reason) {
    this.phase = 'game-over';
    this.stopDuelTimers();
    this.updateBoardUI();

    const isWin = winnerSide === 'player';
    if (isWin) this.playSound('victory');

    const modal = document.getElementById('modal-game-over');
    const title = document.getElementById('game-over-title');
    const reasonText = document.getElementById('game-over-reason');

    if (title && reasonText && modal) {
      title.textContent = isWin ? '¡VICTORIA!' : '¡DERROTA!';
      title.style.color = isWin ? 'var(--color-accent-green)' : 'var(--color-accent-red)';
      reasonText.textContent = reason;
      modal.classList.add('active');
    }
  }

  startDuelTimers() {
    this.stopDuelTimers();

    this.matchElapsedSeconds = 0;
    this.resetTurnTimer();

    this.matchTimerInterval = setInterval(() => {
      // 1. Increment match elapsed time
      this.matchElapsedSeconds++;
      const elapsedMin = Math.floor(this.matchElapsedSeconds / 60).toString().padStart(2, '0');
      const elapsedSec = (this.matchElapsedSeconds % 60).toString().padStart(2, '0');
      const elapsedEl = document.getElementById('timer-elapsed');
      if (elapsedEl) {
        elapsedEl.textContent = `${elapsedMin}:${elapsedSec}`;
      }

      // 2. Decrement turn timer
      const activeOwner = this.getActiveTimerOwner();
      if (activeOwner) {
        this.turnRemainingSeconds--;
        const turnMin = Math.floor(Math.max(0, this.turnRemainingSeconds) / 60).toString().padStart(2, '0');
        const turnSec = (Math.max(0, this.turnRemainingSeconds) % 60).toString().padStart(2, '0');
        const turnEl = document.getElementById('timer-turn');
        if (turnEl) {
          turnEl.textContent = `${turnMin}:${turnSec}`;
        }

        // 3. Check for timeout
        if (this.turnRemainingSeconds <= 0) {
          this.stopDuelTimers();
          if (activeOwner === 'player') {
            this.endGame('opponent', 'Límite de tiempo agotado (Derrota automática).');
          } else {
            this.endGame('player', 'El oponente se quedó sin tiempo (Victoria automática).');
          }
        }
      }
    }, 1000);
  }

  resetTurnTimer() {
    if (this.isOnlineMatch && this.getActiveTimerOwner() === 'opponent') {
      this.turnRemainingSeconds = 125;
    } else {
      this.turnRemainingSeconds = 120;
    }
    const turnEl = document.getElementById('timer-turn');
    if (turnEl) {
      turnEl.textContent = "02:00";
    }
  }

  stopDuelTimers() {
    if (this.matchTimerInterval) {
      clearInterval(this.matchTimerInterval);
      this.matchTimerInterval = null;
    }
  }

  getActiveTimerOwner() {
    if (this.phase === 'must-promote') {
      return 'player';
    }
    if (this.phase === 'opponent-must-promote') {
      return 'opponent';
    }
    if (this.phase === 'active') {
      return this.turnOwner;
    }
    return null;
  }

  // Add line to the logs
  addLog(side, message) {
    const logBox = document.getElementById('duel-log');
    if (!logBox) return;

    const div = document.createElement('div');
    div.className = `log-entry ${side}`;
    div.textContent = message;
    logBox.appendChild(div);
    logBox.scrollTop = logBox.scrollHeight;
  }

  // UI Updates and Card placements
  updateBoardUI() {
    if (!this.player) return;

    // Ensure Pass Turn button state matches turn owner and phase
    const passBtn = document.getElementById('btn-pass-turn');
    if (passBtn) {
      passBtn.disabled = (this.phase !== 'active' || this.turnOwner !== 'player');
    }

    const opponentNameEl = document.getElementById('opponent-name');
    if (opponentNameEl && this.opponent) {
      opponentNameEl.textContent = this.opponent.name;
    }

    // Apply current board theme
    this.setBoardTheme(this.boardTheme);

    // Render Trainer slots
    const pTrainerSlot = document.getElementById('player-trainer-slot');
    if (pTrainerSlot) {
      pTrainerSlot.innerHTML = '';
      if (this.playerActiveTrainer) {
        pTrainerSlot.classList.remove('empty');
        const cardTemplate = this.playerActiveTrainer.card || this.playerActiveTrainer;
        const isSelected = this.selectedBoardCard &&
          this.selectedBoardCard.side === 'player' &&
          this.selectedBoardCard.zone === 'trainer';
        
        const cardEl = document.createElement('div');
        cardEl.className = `board-card ${isSelected ? 'selected' : ''}`;
        cardEl.innerHTML = this.db.getCardImgHtml(cardTemplate);
        cardEl.style.cursor = 'pointer';
        pTrainerSlot.appendChild(cardEl);
      } else {
        pTrainerSlot.classList.add('empty');
        pTrainerSlot.innerHTML = '<div class="placeholder-label">Trainer Jugador</div>';
      }
    }

    const oTrainerSlot = document.getElementById('opponent-trainer-slot');
    if (oTrainerSlot) {
      oTrainerSlot.innerHTML = '';
      if (this.opponentActiveTrainer) {
        oTrainerSlot.classList.remove('empty');
        const cardTemplate = this.opponentActiveTrainer.card || this.opponentActiveTrainer;
        const isSelected = this.selectedBoardCard &&
          this.selectedBoardCard.side === 'opponent' &&
          this.selectedBoardCard.zone === 'trainer';
        
        const cardEl = document.createElement('div');
        cardEl.className = `board-card ${isSelected ? 'selected' : ''}`;
        cardEl.innerHTML = this.db.getCardImgHtml(cardTemplate);
        cardEl.style.cursor = 'pointer';
        oTrainerSlot.appendChild(cardEl);
      } else {
        oTrainerSlot.classList.add('empty');
        oTrainerSlot.innerHTML = '<div class="placeholder-label">Trainer Oponente</div>';
      }
    }

    // Render Stadium slot
    const stadiumSlot = document.getElementById('board-stadium-slot');
    if (stadiumSlot) {
      stadiumSlot.innerHTML = '';
      if (this.activeStadium) {
        stadiumSlot.classList.remove('empty');
        stadiumSlot.innerHTML = this.db.getCardImgHtml(this.activeStadium);
      } else {
        stadiumSlot.classList.add('empty');
        stadiumSlot.innerHTML = '<div class="placeholder-label">Estadio</div>';
      }
    }

    // A. Player Active
    this.renderBoardSlot('player', 'active', 0, 'player-active');
    // B. Opponent Active
    this.renderBoardSlot('opponent', 'active', 0, 'opponent-active');

    // C. Benches
    for (let i = 0; i < 5; i++) {
      this.renderBoardSlot('player', 'bench', i, null, `#player-bench [data-index="${i}"]`);
      this.renderBoardSlot('opponent', 'bench', i, null, `#opponent-bench [data-index="${i}"]`);
    }

    // D. Piles counts
    document.getElementById('player-deck-count').textContent = this.player.deck.length;
    document.getElementById('opponent-deck-count').textContent = this.opponent.deck.length;

    // Discard pile images
    const pDiscard = document.getElementById('player-discard-pile');
    if (pDiscard) {
      pDiscard.innerHTML = `<span class="pile-count">${this.player.discard.length}</span>`;
      if (this.player.discard.length > 0) {
        pDiscard.classList.remove('empty');
        const rawTop = this.player.discard[this.player.discard.length - 1];
        const topCard = rawTop.card ? rawTop.card : rawTop;
        pDiscard.innerHTML += this.db.getCardImgHtml(topCard);
      } else {
        pDiscard.classList.add('empty');
      }
    }
    const oDiscard = document.getElementById('opponent-discard-pile');
    if (oDiscard) {
      oDiscard.innerHTML = `<span class="pile-count">${this.opponent.discard.length}</span>`;
      if (this.opponent.discard.length > 0) {
        oDiscard.classList.remove('empty');
        const rawTop = this.opponent.discard[this.opponent.discard.length - 1];
        const topCard = rawTop.card ? rawTop.card : rawTop;
        oDiscard.innerHTML += this.db.getCardImgHtml(topCard);
      } else {
        oDiscard.classList.add('empty');
      }
    }

    // E. Prizes slots render
    this.renderPrizesUI('player', 'player-prizes');
    this.renderPrizesUI('opponent', 'opponent-prizes');

    // F. Hand cards
    this.renderHandUI();

    // G. Dynamic step-by-step instructions
    this.updateInstructions();

    // H. Highlight valid targeting slots if hand card is selected or targeting trainer
    if (this.selectedHandCardIndex !== null && this.turnOwner === 'player') {
      const cardObj = this.player.hand[this.selectedHandCardIndex];
      if (cardObj) {
        const card = cardObj.card;
        if (card.supertype === 'Energy') {
          if (this.player.active) {
            document.getElementById('player-active')?.classList.add('highlight-target');
          }
          for (let i = 0; i < 5; i++) {
            if (this.player.bench[i]) {
              document.querySelector(`#player-bench [data-index="${i}"]`)?.classList.add('highlight-target');
            }
          }
        } else if (card.supertype === 'Pokémon') {
          if (card.subtypes?.includes('Basic')) {
            if (this.phase === 'setup') {
              if (!this.player.active) {
                document.getElementById('player-active')?.classList.add('highlight-target');
              }
              for (let i = 0; i < 5; i++) {
                if (!this.player.bench[i]) {
                  document.querySelector(`#player-bench [data-index="${i}"]`)?.classList.add('highlight-target');
                }
              }
            } else {
              for (let i = 0; i < 5; i++) {
                if (!this.player.bench[i]) {
                  document.querySelector(`#player-bench [data-index="${i}"]`)?.classList.add('highlight-target');
                }
              }
            }
          } else {
            if (this.player.active && this.player.active.card.name === card.evolvesFrom && this.player.active.turnPlaced < this.turnNumber) {
              document.getElementById('player-active')?.classList.add('highlight-target');
            }
            for (let i = 0; i < 5; i++) {
              const bPkmn = this.player.bench[i];
              if (bPkmn && bPkmn.card.name === card.evolvesFrom && bPkmn.turnPlaced < this.turnNumber) {
                document.querySelector(`#player-bench [data-index="${i}"]`)?.classList.add('highlight-target');
              }
            }
          }
        }
      }
    } else if (this.targetingAction && this.turnOwner === 'player') {
      const sourceCard = this.player.hand[this.targetingAction.cardIndex]?.card;
      if (sourceCard) {
        if (sourceCard.name === 'Potion') {
          if (this.player.active && this.player.active.damage > 0) {
            document.getElementById('player-active')?.classList.add('highlight-target');
          }
          for (let i = 0; i < 5; i++) {
            if (this.player.bench[i] && this.player.bench[i].damage > 0) {
              document.querySelector(`#player-bench [data-index="${i}"]`)?.classList.add('highlight-target');
            }
          }
          if (this.opponent.active && this.opponent.active.damage > 0) {
            document.getElementById('opponent-active')?.classList.add('highlight-target');
          }
          for (let i = 0; i < 5; i++) {
            if (this.opponent.bench[i] && this.opponent.bench[i].damage > 0) {
              document.querySelector(`#opponent-bench [data-index="${i}"]`)?.classList.add('highlight-target');
            }
          }
        } else if (sourceCard.name === 'Switch') {
          for (let i = 0; i < 5; i++) {
            if (this.player.bench[i]) {
              document.querySelector(`#player-bench [data-index="${i}"]`)?.classList.add('highlight-target');
            }
          }
        } else if (sourceCard.name === 'Gust of Wind') {
          for (let i = 0; i < 5; i++) {
            if (this.opponent.bench[i]) {
              document.querySelector(`#opponent-bench [data-index="${i}"]`)?.classList.add('highlight-target');
            }
          }
        }
      }
    }
    this.applyThemeCoordinates();
  }

  updateInstructions() {
    const banner = document.getElementById('duel-instructions-banner');
    if (!banner) return;

    if (this.phase === 'setup') {
      if (!this.player.active) {
        banner.textContent = 'Fase de Preparación: Selecciona un Pokémon Básico en tu mano (haciendo clic en él) y luego haz clic en el recuadro "Coloca Pokémon Activo" en el centro.';
      } else {
        const hasBasics = this.player.hand.some(c => c.card.supertype === 'Pokémon' && c.card.subtypes?.includes('Basic'));
        const hasEmptyBench = this.player.bench.includes(null);
        if (hasBasics && hasEmptyBench) {
          banner.textContent = 'Fase de Preparación: Si quieres, coloca más Pokémon Básicos de tu mano en la Banca (haz clic en el básico y luego en una ranura vacía de la banca).';
        } else {
          banner.textContent = 'Fase de Preparación: Esperando a que el oponente se prepare...';
        }
      }
    } else if (this.phase === 'must-promote') {
      banner.textContent = '¡Pokémon debilitado / Retirado! Haz clic en uno de tus Pokémon en la Banca para promoverlo al puesto Activo.';
    } else if (this.phase === 'game-over') {
      banner.textContent = 'Combate Finalizado.';
    } else if (this.phase === 'active') {
      if (this.turnOwner === 'player') {
        banner.textContent = 'Tu Turno: 1) Selecciona una carta de tu mano para jugarla (unir energía, evolucionar, jugar entrenador). 2) Selecciona tu Pokémon Activo para Atacar o Retirarte.';
      } else {
        banner.textContent = `Turno del Oponente: ${this.opponent.name} está realizando sus movimientos...`;
      }
    }
  }

  renderBoardSlot(side, zone, index, elementId, selector) {
    const el = elementId ? document.getElementById(elementId) : document.querySelector(selector);
    if (!el) return;

    el.innerHTML = '';

    // Reset selection styles
    el.classList.remove('occupied');
    el.classList.remove('highlight-target');

    const user = side === 'player' ? this.player : this.opponent;
    const pkmn = zone === 'active' ? user.active : user.bench[index];

    if (pkmn) {
      el.classList.add('occupied');

      const isSelected = this.selectedBoardCard &&
        this.selectedBoardCard.side === side &&
        this.selectedBoardCard.zone === zone &&
        this.selectedBoardCard.index === index;

      const cardEl = document.createElement('div');
      let animClass = '';
      if (!this.animatedCards.has(pkmn.instanceId)) {
        this.animatedCards.add(pkmn.instanceId);
        animClass = side === 'player' ? 'animate-place' : 'animate-place-opponent';
      }
      cardEl.className = `board-card ${isSelected ? 'selected' : ''} ${pkmn.specialCondition === 'asleep' ? 'asleep' : ''} ${animClass}`.trim();
      cardEl.innerHTML = this.db.getCardImgHtml(pkmn.card);
      cardEl.style.cursor = 'pointer';

      // Card previews
      cardEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (window.showCardPreview) window.showCardPreview(pkmn.card);
      });

      cardEl.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (window.showCardPreview) window.showCardPreview(pkmn.card);
      });

      // Attached energies indicators
      if (pkmn.attachedEnergy.length > 0) {
        const energyContainer = document.createElement('div');
        energyContainer.className = 'energy-badge-container';

        // Count distinct energy types
        const counts = {};
        pkmn.attachedEnergy.forEach(e => {
          const type = e.name.replace(' Energy', '');
          counts[type] = (counts[type] || 0) + 1;
        });

        for (const type in counts) {
          const bubble = document.createElement('div');
          bubble.className = 'attached-energy-bubble';
          bubble.style.backgroundColor = `var(--type-${type.toLowerCase()})`;
          bubble.textContent = counts[type];
          energyContainer.appendChild(bubble);
        }
        cardEl.appendChild(energyContainer);
      }

      // Damage counters
      if (pkmn.damage > 0) {
        const damageBadge = document.createElement('div');
        damageBadge.className = 'damage-counter-bubble';
        damageBadge.textContent = pkmn.damage;
        cardEl.appendChild(damageBadge);
      }

      // Status badges
      if (pkmn.specialCondition) {
        const statusBadge = document.createElement('div');
        statusBadge.className = `status-badge ${pkmn.specialCondition}`;
        statusBadge.textContent = pkmn.specialCondition.substring(0, 4);
        cardEl.appendChild(statusBadge);
      }

      el.appendChild(cardEl);
    } else {
      // Placeholder label
      const label = document.createElement('div');
      label.className = 'placeholder-label';
      label.textContent = zone === 'active' ? (side === 'player' ? 'Activo Tú' : 'Activo Oponente') : `Banca ${index + 1}`;
      el.appendChild(label);
    }
  }

  renderPrizesUI(side, elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;

    el.innerHTML = '';
    const user = side === 'player' ? this.player : this.opponent;
    const count = user.prizes.length;

    for (let i = 0; i < 6; i++) {
      const slot = document.createElement('div');
      slot.className = `prize-slot ${i < count ? 'card-back' : 'empty'}`;
      slot.setAttribute('data-index', i);
      
      if (side === 'player' && i < count) {
        slot.style.cursor = 'pointer';
        slot.addEventListener('click', async () => {
          const confirmDraw = await window.customConfirm('Tomar Premio', '¿Deseas tomar esta carta de Premio para llevarla a tu mano?');
          if (confirmDraw) {
            this.takePrizeManually(i);
          }
        });
      }
      
      el.appendChild(slot);
    }
  }

  takePrizeManually(index) {
    if (index >= 0 && index < this.player.prizes.length) {
      const prizeCard = this.player.prizes.splice(index, 1)[0];
      this.player.hand.push(prizeCard);
      this.addLog('player', `Tomaste manualmente una carta de Premio. Premios restantes: ${this.player.prizes.length}`);
      
      // Check win condition in offline mode
      if (this.player.prizes.length === 0) {
        this.endGame('player', '¡Tomó todas sus cartas de Premio!');
      }
      this.updateBoardUI();
    }
  }

  // Draw hand cards row
  renderHandUI() {
    const handBox = document.getElementById('player-hand');
    if (!handBox) return;

    handBox.innerHTML = '';

    const cardCount = this.player.hand.length;
    let overlap = 15;
    if (cardCount > 6) {
      overlap = Math.min(55, 15 + (cardCount - 6) * 4);
    }

    this.player.hand.forEach((cardObj, idx) => {
      const cardEl = document.createElement('div');

      const isSelected = this.selectedHandCardIndex === idx;
      cardEl.className = `card-item ${isSelected ? 'selected' : ''}`;

      if (idx > 0) {
        cardEl.style.marginLeft = `-${overlap}px`;
      } else {
        cardEl.style.marginLeft = '0px';
      }

      cardEl.innerHTML = `
        <div class="card-img-wrapper">
          ${this.db.getCardImgHtml(cardObj.card)}
        </div>
      `;

      cardEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleHandCardClick(idx);
      });

      cardEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (window.showCardPreview) window.showCardPreview(cardObj.card);
      });

      cardEl.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (window.showCardPreview) window.showCardPreview(cardObj.card);
      });

      handBox.appendChild(cardEl);
    });
  }

  highlightPlayableBasicsInHand() {
    const handCards = document.querySelectorAll('#player-hand .card-item');
    this.player.hand.forEach((c, i) => {
      const isBasic = c.card.supertype === 'Pokémon' && c.card.subtypes?.includes('Basic');
      if (isBasic && handCards[i]) {
        handCards[i].style.boxShadow = '0 0 12px var(--color-accent-green)';
      }
    });
  }

  // Player Hand click resolved: Play cards!
  handleHandCardClick(index) {
    if (this.phase !== 'setup' && this.turnOwner !== 'player') return;

    this.selectedHandCardIndex = index;
    this.selectedBoardCard = null; // Deselect board card when hand card is selected
    this.updateBoardUI();
    this.renderActionPanel();
  }

  // AI Opponent plays setup phase automatically
  executeAISetupActive() {
    const basics = this.opponent.hand.filter(c => c.card.supertype === 'Pokémon' && c.card.subtypes?.includes('Basic'));
    if (basics.length > 0) {
      // Pick first basic as active
      const activeObj = basics[0];
      this.opponent.active = activeObj;
      activeObj.turnPlaced = 0;
      this.opponent.hand = this.opponent.hand.filter(c => c.instanceId !== activeObj.instanceId);
      this.addLog('opponent', 'Gary (AI) colocó un Pokémon Activo cara abajo.');

      // Place others to bench
      const remainingBasics = this.opponent.hand.filter(c => c.card.supertype === 'Pokémon' && c.card.subtypes?.includes('Basic'));
      let benchCount = 0;
      remainingBasics.forEach(c => {
        if (benchCount < 3) {
          this.opponent.bench[benchCount] = c;
          c.turnPlaced = 0;
          this.opponent.hand = this.opponent.hand.filter(item => item.instanceId !== c.instanceId);
          benchCount++;
        }
      });
      if (benchCount > 0) {
        this.addLog('opponent', `Gary (AI) colocó ${benchCount} Pokémon en su banca.`);
      }
    }
  }

  // AI promote on active knockout
  executeAIPromoteActive() {
    const benchedIdx = this.opponent.bench.findIndex(b => b !== null);
    if (benchedIdx !== -1) {
      this.opponent.active = this.opponent.bench[benchedIdx];
      this.opponent.bench[benchedIdx] = null;
      if (this.opponent.active) {
        this.opponent.active.specialCondition = null;
      }
      this.addLog('opponent', `Gary (AI) promovió a ${this.opponent.active.card.name} al puesto Activo.`);
    }
    this.updateBoardUI();
  }

  // AI automated turn decision tree
  async executeAITurn() {
    if (this.phase === 'game-over') return;

    // 1. Play Basic Pokémon to bench
    const basics = this.opponent.hand.filter(c => c.card.supertype === 'Pokémon' && c.card.subtypes?.includes('Basic'));
    for (const c of basics) {
      const emptyIdx = this.opponent.bench.indexOf(null);
      if (emptyIdx !== -1) {
        this.opponent.bench[emptyIdx] = c;
        c.turnPlaced = this.turnNumber;
        this.opponent.hand = this.opponent.hand.filter(item => item.instanceId !== c.instanceId);
        this.addLog('opponent', `Gary (AI) colocó a ${c.card.name} en su banca.`);
        await new Promise(r => setTimeout(r, 600));
        this.updateBoardUI();
      }
    }

    // 2. Play evolutions if possible
    const evolutions = this.opponent.hand.filter(c => c.card.supertype === 'Pokémon' && (c.card.subtypes?.includes('Stage 1') || c.card.subtypes?.includes('Stage 2')));
    for (const c of evolutions) {
      // Look for matches on active or bench
      let targetObj = null;
      if (this.opponent.active && this.opponent.active.card.name === c.card.evolvesFrom && this.opponent.active.turnPlaced < this.turnNumber) {
        targetObj = this.opponent.active;
      } else {
        const matchBench = this.opponent.bench.find(b => b !== null && b.card.name === c.card.evolvesFrom && b.turnPlaced < this.turnNumber);
        if (matchBench) targetObj = matchBench;
      }

      if (targetObj) {
        this.addLog('opponent', `Gary (AI) evolucionó a ${targetObj.card.name} en ${c.card.name}.`);
        targetObj.card = c.card;
        targetObj.turnPlaced = this.turnNumber;
        this.opponent.hand = this.opponent.hand.filter(item => item.instanceId !== c.instanceId);
        this.playSound('attach');
        await new Promise(r => setTimeout(r, 600));
        this.updateBoardUI();
      }
    }

    // 3. Play Trainers (Bill/Potion)
    const bills = this.opponent.hand.filter(c => c.card.name === 'Bill');
    if (bills.length > 0) {
      const bill = bills[0];
      this.opponentActiveTrainer = bill.card;
      this.updateBoardUI();
      this.playSound('attach');
      await new Promise(r => setTimeout(r, 1200));

      const result = GameRules.executeTrainer(bill.card, this.opponent, this.player);
      result.log.forEach(l => this.addLog('opponent', l));
      this.opponent.hand = this.opponent.hand.filter(item => item.instanceId !== bill.instanceId);
      this.opponent.discard.push(bill.card);
      this.opponentActiveTrainer = null;
      this.updateBoardUI();
      await new Promise(r => setTimeout(r, 600));
    }

    const potions = this.opponent.hand.filter(c => c.card.name === 'Potion');
    if (potions.length > 0 && this.opponent.active && this.opponent.active.damage > 20) {
      const pot = potions[0];
      this.opponentActiveTrainer = pot.card;
      this.updateBoardUI();
      this.playSound('attach');
      await new Promise(r => setTimeout(r, 1200));

      const result = GameRules.executeTrainer(pot.card, this.opponent, this.player, { targetPkmn: this.opponent.active });
      result.log.forEach(l => this.addLog('opponent', l));
      this.opponent.hand = this.opponent.hand.filter(item => item.instanceId !== pot.instanceId);
      this.opponent.discard.push(pot.card);
      this.opponentActiveTrainer = null;
      this.updateBoardUI();
      await new Promise(r => setTimeout(r, 600));
    }

    // 4. Attach 1 Energy
    const energies = this.opponent.hand.filter(c => c.card.supertype === 'Energy');
    if (energies.length > 0 && this.opponent.active) {
      const energy = energies[0];
      this.opponent.active.attachedEnergy.push(energy.card);
      this.opponent.hand = this.opponent.hand.filter(item => item.instanceId !== energy.instanceId);
      this.playSound('attach');
      this.addLog('opponent', `Gary (AI) unió ${energy.card.name} a ${this.opponent.active.card.name}.`);
      await new Promise(r => setTimeout(r, 600));
      this.updateBoardUI();
    }

    // 5. Select best attack
    if (this.opponent.active) {
      const activePkmn = this.opponent.active;
      const defender = this.player.active;
      const canAct = activePkmn.specialCondition !== 'asleep' && activePkmn.specialCondition !== 'paralyzed';

      let bestAttack = null;
      let maxDmg = -1;

      if (canAct) {
        activePkmn.card.attacks.forEach(atk => {
          const satisfies = GameRules.checkEnergyRequirements(atk.cost, activePkmn.attachedEnergy);
          if (satisfies) {
            const dmg = parseInt(atk.damage) || 0;
            if (dmg > maxDmg) {
              maxDmg = dmg;
              bestAttack = atk;
            }
          }
        });
      }

      if (bestAttack) {
        await this.executeAttack(bestAttack, activePkmn, defender);
      } else {
        this.addLog('opponent', 'Gary (AI) no puede atacar en este turno.');
        await new Promise(r => setTimeout(r, 800));
        await this.endTurn();
      }
    }
  }

  openDeckView(side) {
    if (!this.player) return;
    if (this.isOnlineMatch && side !== 'player') {
      this.showWarning('No puedes examinar el mazo de tu oponente.');
      return;
    }

    const user = side === 'player' ? this.player : this.opponent;
    if (!user) return;

    const modal = document.getElementById('modal-deck-view');
    const title = document.getElementById('deck-view-title');
    const grid = document.getElementById('deck-cards-grid');

    if (!modal || !grid) return;

    title.textContent = `Buscar en el Mazo (${user.name})`;
    grid.innerHTML = '';

    if (this.isOnlineMatch) {
      this.sendGameAction('MANUAL_EXAMINE_DECK', {});
    } else {
      this.addLog('system', `${side === 'player' ? 'Tú estás' : user.name + ' está'} examinando su mazo.`);
    }

    // Sort cards alphabetically by name
    const sortedDeck = [...user.deck].sort((a, b) => {
      const nameA = (a.card?.name || '').toLowerCase();
      const nameB = (b.card?.name || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });

    if (sortedDeck.length === 0) {
      grid.innerHTML = '<p class="placeholder-text" style="grid-column: 1/-1; text-align: center;">El mazo está vacío.</p>';
    } else {
      sortedDeck.forEach(cardItem => {
        const card = cardItem.card;
        const cardEl = document.createElement('div');
        cardEl.className = 'card-item compact';
        cardEl.innerHTML = `
          <div class="card-img-wrapper">
            ${this.db.getCardImgHtml(card)}
          </div>
        `;
        cardEl.style.cursor = 'pointer';

        const previewFn = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (window.showCardPreview) {
            window.showCardPreview(card);
          }
        };
        cardEl.addEventListener('contextmenu', previewFn);
        cardEl.addEventListener('dblclick', previewFn);

        cardEl.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();

          if (this.isOnlineMatch && side !== 'player') {
            this.showWarning('Solo puedes buscar cartas en tu propio mazo.');
            return;
          }

          const confirmMove = await window.customConfirm('Buscar Carta', `¿Quieres agregar ${card.name} a tu mano?`);
          if (confirmMove) {
            modal.classList.remove('active');
            if (this.isOnlineMatch) {
              this.sendGameAction('MANUAL_CARD_MOVEMENT', {
                cardInstanceId: cardItem.instanceId,
                targetSide: 'player',
                targetZone: 'hand'
              });
            } else {
              user.deck = user.deck.filter(c => c.instanceId !== cardItem.instanceId);
              user.hand.push(cardItem);
              this.addLog('player', `Buscaste ${card.name} en tu mazo y la agregaste a tu mano.`);
              this.updateBoardUI();
              if (this.renderActionPanel) this.renderActionPanel();
            }
          }
        });

        grid.appendChild(cardEl);
      });
    }

    const closeBtn = modal.querySelector('.modal-close-btn');
    if (closeBtn) {
      const closeFn = () => {
        modal.classList.remove('active');
        closeBtn.removeEventListener('click', closeFn);
      };
      closeBtn.addEventListener('click', closeFn);
    }

    modal.classList.add('active');
  }

  openDiscardView(side) {
    if (!this.player) return;
    const user = side === 'player' ? this.player : this.opponent;
    if (!user) return;

    const modal = document.getElementById('modal-discard-view');
    const title = document.getElementById('discard-view-title');
    const grid = document.getElementById('discard-cards-grid');

    if (!modal || !grid) return;

    title.textContent = `Pila de Descarte (${user.name})`;
    grid.innerHTML = '';

    if (user.discard.length === 0) {
      grid.innerHTML = '<p class="placeholder-text" style="grid-column: 1/-1; text-align: center;">La pila de descarte está vacía.</p>';
    } else {
      user.discard.forEach(cardItem => {
        const card = cardItem.card ? cardItem.card : cardItem;
        const cardEl = document.createElement('div');
        cardEl.className = 'card-item compact';
        cardEl.innerHTML = `
          <div class="card-img-wrapper">
            ${this.db.getCardImgHtml(card)}
          </div>
        `;
        cardEl.style.cursor = 'pointer';

        const previewFn = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (window.showCardPreview) {
            window.showCardPreview(card);
          }
        };

        cardEl.addEventListener('click', previewFn);
        cardEl.addEventListener('contextmenu', previewFn);
        cardEl.addEventListener('dblclick', previewFn);

        grid.appendChild(cardEl);
      });
    }

    modal.classList.add('active');
  }

  async loadBattlefieldsThemeOptions() {
    try {
      const res = await fetch('/api/battlefields');
      const images = await res.json();

      const resPos = await fetch('/cards/Battlefields/positions.json');
      this.positionsData = await resPos.json();

      const themeSelector = document.getElementById('select-board-theme');
      if (themeSelector) {
        themeSelector.innerHTML = '<option value="modern">Moderno (Neon)</option>';
        images.forEach(img => {
          const opt = document.createElement('option');
          opt.value = img;
          opt.textContent = img;
          themeSelector.appendChild(opt);
        });

        themeSelector.value = this.boardTheme;
      }

      this.applyThemeCoordinates();
    } catch (e) {
      console.error('Failed to load battlefields theme options:', e);
    }
  }

  getThemeCoordinates(themeName) {
    if (!themeName || themeName === 'modern') return null;

    const w = 9;
    const h = 21;

    const reversedPlaymats = [
      '4.png',
      '5.png',
      'id-11134207-7rbk6-m7j5avl665jp15.jpg'
    ];

    const isReversed = reversedPlaymats.includes(themeName);

    const template = {};
    if (!isReversed) {
      template['opponent-bench-0'] = { left: 24.5, top: 6, width: w, height: h };
      template['opponent-bench-1'] = { left: 35.0, top: 6, width: w, height: h };
      template['opponent-bench-2'] = { left: 45.5, top: 6, width: w, height: h };
      template['opponent-bench-3'] = { left: 56.0, top: 6, width: w, height: h };
      template['opponent-bench-4'] = { left: 66.5, top: 6, width: w, height: h };
      template['opponent-active'] = { left: 45.5, top: 28, width: w, height: h };
      template['opponent-deck'] = { left: 86.0, top: 6, width: w, height: h };
      template['opponent-discard'] = { left: 86.0, top: 28, width: w, height: h };
      template['opponent-trainer'] = { left: 74.5, top: 28, width: w, height: h };
      template['opponent-prize-0'] = { left: 5.0, top: 6, width: w, height: h };
      template['opponent-prize-1'] = { left: 14.5, top: 6, width: w, height: h };
      template['opponent-prize-2'] = { left: 5.0, top: 20, width: w, height: h };
      template['opponent-prize-3'] = { left: 14.5, top: 20, width: w, height: h };
      template['opponent-prize-4'] = { left: 5.0, top: 34, width: w, height: h };
      template['opponent-prize-5'] = { left: 14.5, top: 34, width: w, height: h };

      template['player-active'] = { left: 45.5, top: 51, width: w, height: h };
      template['player-bench-0'] = { left: 24.5, top: 73, width: w, height: h };
      template['player-bench-1'] = { left: 35.0, top: 73, width: w, height: h };
      template['player-bench-2'] = { left: 45.5, top: 73, width: w, height: h };
      template['player-bench-3'] = { left: 56.0, top: 73, width: w, height: h };
      template['player-bench-4'] = { left: 66.5, top: 73, width: w, height: h };
      template['player-deck'] = { left: 86.0, top: 73, width: w, height: h };
      template['player-discard'] = { left: 86.0, top: 51, width: w, height: h };
      template['player-trainer'] = { left: 74.5, top: 51, width: w, height: h };
      template['player-prize-0'] = { left: 5.0, top: 51, width: w, height: h };
      template['player-prize-1'] = { left: 14.5, top: 51, width: w, height: h };
      template['player-prize-2'] = { left: 5.0, top: 65, width: w, height: h };
      template['player-prize-3'] = { left: 14.5, top: 65, width: w, height: h };
      template['player-prize-4'] = { left: 5.0, top: 79, width: w, height: h };
      template['player-prize-5'] = { left: 14.5, top: 79, width: w, height: h };
      template['stadium'] = { left: 32.5, top: 39.5, width: w, height: h };
    } else {
      template['opponent-bench-0'] = { left: 66.5, top: 6, width: w, height: h };
      template['opponent-bench-1'] = { left: 56.0, top: 6, width: w, height: h };
      template['opponent-bench-2'] = { left: 45.5, top: 6, width: w, height: h };
      template['opponent-bench-3'] = { left: 35.0, top: 6, width: w, height: h };
      template['opponent-bench-4'] = { left: 24.5, top: 6, width: w, height: h };
      template['opponent-active'] = { left: 45.5, top: 28, width: w, height: h };
      template['opponent-deck'] = { left: 5.0, top: 6, width: w, height: h };
      template['opponent-discard'] = { left: 5.0, top: 28, width: w, height: h };
      template['opponent-trainer'] = { left: 16.5, top: 28, width: w, height: h };
      template['opponent-prize-0'] = { left: 86.0, top: 6, width: w, height: h };
      template['opponent-prize-1'] = { left: 76.5, top: 6, width: w, height: h };
      template['opponent-prize-2'] = { left: 86.0, top: 20, width: w, height: h };
      template['opponent-prize-3'] = { left: 76.5, top: 20, width: w, height: h };
      template['opponent-prize-4'] = { left: 86.0, top: 34, width: w, height: h };
      template['opponent-prize-5'] = { left: 76.5, top: 34, width: w, height: h };

      template['player-active'] = { left: 45.5, top: 51, width: w, height: h };
      template['player-bench-0'] = { left: 66.5, top: 73, width: w, height: h };
      template['player-bench-1'] = { left: 56.0, top: 73, width: w, height: h };
      template['player-bench-2'] = { left: 45.5, top: 73, width: w, height: h };
      template['player-bench-3'] = { left: 35.0, top: 73, width: w, height: h };
      template['player-bench-4'] = { left: 24.5, top: 73, width: w, height: h };
      template['player-deck'] = { left: 5.0, top: 73, width: w, height: h };
      template['player-discard'] = { left: 5.0, top: 51, width: w, height: h };
      template['player-trainer'] = { left: 16.5, top: 51, width: w, height: h };
      template['player-prize-0'] = { left: 86.0, top: 51, width: w, height: h };
      template['player-prize-1'] = { left: 76.5, top: 51, width: w, height: h };
      template['player-prize-2'] = { left: 86.0, top: 65, width: w, height: h };
      template['player-prize-3'] = { left: 76.5, top: 65, width: w, height: h };
      template['player-prize-4'] = { left: 86.0, top: 79, width: w, height: h };
      template['player-prize-5'] = { left: 76.5, top: 79, width: w, height: h };
      template['stadium'] = { left: 58.5, top: 39.5, width: w, height: h };
    }

    const saved = this.positionsData[themeName];
    if (saved && saved['player-active']) {
      return saved;
    }

    if (saved) {
      const radius = 12.0;
      const snapped = { ...template };

      const snapGroup = (slotKeys, rawPoints) => {
        if (!rawPoints || rawPoints.length === 0) return;
        slotKeys.forEach(key => {
          if (!snapped[key]) return;
          const current = snapped[key];
          let bestPoint = null;
          let bestDist = radius;

          rawPoints.forEach(pt => {
            const dx = pt[0] - current.left;
            const dy = pt[1] - current.top;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < bestDist) {
              bestDist = dist;
              bestPoint = pt;
            }
          });

          if (bestPoint) {
            snapped[key] = {
              ...current,
              left: Math.round(bestPoint[0] * 10) / 10,
              top: Math.round(bestPoint[1] * 10) / 10
            };
          }
        });
      };

      snapGroup(['opponent-bench-0', 'opponent-bench-1', 'opponent-bench-2', 'opponent-bench-3', 'opponent-bench-4'], saved.opp_bench);
      snapGroup(['player-bench-0', 'player-bench-1', 'player-bench-2', 'player-bench-3', 'player-bench-4'], saved.play_bench);
      snapGroup(['opponent-active', 'opponent-deck', 'opponent-discard', 'opponent-trainer', 'opponent-prize-0', 'opponent-prize-1', 'opponent-prize-2', 'opponent-prize-3', 'opponent-prize-4', 'opponent-prize-5'], saved.opp_core);
      snapGroup(['player-active', 'player-deck', 'player-discard', 'player-trainer', 'player-prize-0', 'player-prize-1', 'player-prize-2', 'player-prize-3', 'player-prize-4', 'player-prize-5'], saved.play_core);

      return snapped;
    }

    return template;
  }

  applyThemeCoordinates() {
    const board = document.querySelector('.duel-board');
    if (!board) return;

    board.classList.remove('has-playmat');
    board.style.backgroundImage = '';

    const allSlotSelectors = [
      '#player-active', '#opponent-active',
      '#player-bench [data-index]', '#opponent-bench [data-index]',
      '#player-prizes .prize-slot', '#opponent-prizes .prize-slot',
      '#player-deck-pile', '#player-discard-pile',
      '#opponent-deck-pile', '#opponent-discard-pile',
      '#board-stadium-slot', '#player-trainer-slot', '#opponent-trainer-slot',
      '#player-coin', '#opponent-coin'
    ];

    allSlotSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        el.style.left = '';
        el.style.top = '';
        el.style.width = '';
        el.style.height = '';
        el.style.position = '';
      });
    });

    if (this.boardTheme === 'modern') {
      return;
    }

    board.classList.add('has-playmat');
    board.style.backgroundImage = `url('/cards/Battlefields/${this.boardTheme}')`;

    const coords = this.getThemeCoordinates(this.boardTheme);
    if (!coords) return;

    const setElementPos = (el, key) => {
      if (!el || !coords[key]) return;
      const c = coords[key];
      el.style.left = `${c.left}%`;
      el.style.top = `${c.top}%`;
      el.style.width = `${c.width}%`;
      el.style.height = `${c.height}%`;
      el.style.position = 'absolute';
    };

    setElementPos(document.getElementById('player-active'), 'player-active');
    setElementPos(document.getElementById('opponent-active'), 'opponent-active');
    setElementPos(document.getElementById('board-stadium-slot'), 'stadium');
    setElementPos(document.getElementById('player-trainer-slot'), 'player-trainer');
    setElementPos(document.getElementById('opponent-trainer-slot'), 'opponent-trainer');
    setElementPos(document.getElementById('player-deck-pile'), 'player-deck');
    setElementPos(document.getElementById('player-discard-pile'), 'player-discard');
    setElementPos(document.getElementById('opponent-deck-pile'), 'opponent-deck');
    setElementPos(document.getElementById('opponent-discard-pile'), 'opponent-discard');

    // Position coins dynamically relative to active slots
    const setCoinPos = (coinId, activeId) => {
      const activeEl = document.getElementById(activeId);
      const coinEl = document.getElementById(coinId);
      if (activeEl && coinEl) {
        const leftPercent = parseFloat(activeEl.style.left) || 0;
        const topPercent = parseFloat(activeEl.style.top) || 0;
        const widthPercent = parseFloat(activeEl.style.width) || 0;
        const heightPercent = parseFloat(activeEl.style.height) || 0;
        
        coinEl.style.position = 'absolute';
        coinEl.style.left = `${leftPercent - 7}%`;
        coinEl.style.top = `${topPercent + (heightPercent / 2) - 3}%`;
        coinEl.style.width = '4%';
        coinEl.style.height = '6%';
      }
    };
    setCoinPos('player-coin', 'player-active');
    setCoinPos('opponent-coin', 'opponent-active');

    for (let i = 0; i < 5; i++) {
      setElementPos(document.querySelector(`#player-bench [data-index="${i}"]`), `player-bench-${i}`);
      setElementPos(document.querySelector(`#opponent-bench [data-index="${i}"]`), `opponent-bench-${i}`);
    }

    for (let i = 0; i < 6; i++) {
      setElementPos(document.querySelector(`#player-prizes [data-index="${i}"]`), `player-prize-${i}`);
      setElementPos(document.querySelector(`#opponent-prizes [data-index="${i}"]`), `opponent-prize-${i}`);
    }
  }

  animateCardToDiscard(fromEl, side, card) {
    if (!fromEl) return;
    const discardElId = side === 'player' ? 'player-discard-pile' : 'opponent-discard-pile';
    const discardEl = document.getElementById(discardElId);
    if (!discardEl) return;

    const fromRect = fromEl.getBoundingClientRect();
    const toRect = discardEl.getBoundingClientRect();

    const clone = fromEl.cloneNode(true);
    clone.classList.remove('active', 'playable', 'targetable', 'selected');
    clone.classList.add('animating-discard-card');

    clone.style.position = 'fixed';
    clone.style.left = `${fromRect.left}px`;
    clone.style.top = `${fromRect.top}px`;
    clone.style.width = `${fromRect.width}px`;
    clone.style.height = `${fromRect.height}px`;
    clone.style.margin = '0';
    clone.style.zIndex = '99999';
    clone.style.pointerEvents = 'none';
    clone.style.transform = 'none';
    clone.style.transition = 'none';

    document.body.appendChild(clone);

    clone.offsetHeight;

    clone.style.transition = 'all 0.8s cubic-bezier(0.25, 0.8, 0.25, 1)';
    clone.style.left = `${toRect.left}px`;
    clone.style.top = `${toRect.top}px`;
    clone.style.width = `${toRect.width}px`;
    clone.style.height = `${toRect.height}px`;
    clone.style.transform = 'rotate(360deg) scale(0.2)';
    clone.style.opacity = '0';

    setTimeout(() => {
      clone.remove();
    }, 800);
  }

  animatePrizeToHand(drawingSide, prizeIndex) {
    const prizesZoneId = drawingSide === 'player' ? 'player-prizes' : 'opponent-prizes';
    const originEl = document.querySelector(`#${prizesZoneId} [data-index="${prizeIndex}"]`);
    if (!originEl) return;

    let targetRect;
    if (drawingSide === 'player') {
      const handEl = document.getElementById('player-hand');
      if (handEl) {
        targetRect = handEl.getBoundingClientRect();
      }
    }

    if (!targetRect) {
      if (drawingSide === 'opponent') {
        const opponentBadge = document.querySelector('.opponent-badge');
        if (opponentBadge) {
          targetRect = opponentBadge.getBoundingClientRect();
        } else {
          targetRect = { left: window.innerWidth / 2, top: 20, width: 100, height: 100 };
        }
      } else {
        targetRect = { left: window.innerWidth / 2, top: window.innerHeight - 100, width: 100, height: 100 };
      }
    }

    const fromRect = originEl.getBoundingClientRect();

    const clone = document.createElement('div');
    clone.className = 'card-back animating-prize-card';

    clone.style.position = 'fixed';
    clone.style.left = `${fromRect.left}px`;
    clone.style.top = `${fromRect.top}px`;
    clone.style.width = `${fromRect.width}px`;
    clone.style.height = `${fromRect.height}px`;
    clone.style.margin = '0';
    clone.style.zIndex = '99999';
    clone.style.pointerEvents = 'none';
    clone.style.transform = 'none';
    clone.style.transition = 'none';

    document.body.appendChild(clone);

    clone.offsetHeight;

    clone.style.transition = 'all 0.8s cubic-bezier(0.25, 0.8, 0.25, 1)';
    const targetLeft = targetRect.left + (targetRect.width / 2) - (fromRect.width / 2);
    const targetTop = targetRect.top + (targetRect.height / 2) - (fromRect.height / 2);

    clone.style.left = `${targetLeft}px`;
    clone.style.top = `${targetTop}px`;
    clone.style.transform = 'scale(0.8) rotate(180deg)';
    clone.style.opacity = '0';

    setTimeout(() => {
      clone.remove();
    }, 800);
  }

  onTrainerPlayed(card, side) {
    if (card.subtypes?.includes('Stadium')) {
      if (this.activeStadium) {
        this.addLog('system', `El Estadio anterior (${this.activeStadium.name}) es descartado.`);
      }
      this.activeStadium = card;
    } else {
      if (side === 'player') {
        this.playerActiveTrainer = card;
      } else {
        this.opponentActiveTrainer = card;
      }
    }
  }
}
