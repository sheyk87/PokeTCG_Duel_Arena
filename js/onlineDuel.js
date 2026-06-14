import { Duel } from './duel.js';
import { GameRules } from './gameRules.js';

export class OnlineDuel extends Duel {
  constructor(db, deckBuilder, appController) {
    super(db, deckBuilder);
    this.appController = appController;
    this.socket = null;
    this.isOnlineMatch = false;
    this.localPlayerId = null;
    this.opponentName = 'Oponente';
    this.isProcessingQueue = false;
    this.messageQueue = [];
    this.isRetreating = false;
    this.selectedDeckId = null;
    this.currentPrivateRoomId = null;
    this.currentPrivatePassword = null;

    // Bind UI elements for queue
    this.btnCancelQueue = document.getElementById('btn-cancel-queue');
    if (this.btnCancelQueue) {
      this.btnCancelQueue.addEventListener('click', () => this.leaveQueue());
    }
  }

  setupWebSocket(onOpenCallback) {
    const token = localStorage.getItem('pkmn_session_token');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?token=${token}`;

    this.socket = new WebSocket(wsUrl);
    this.isOnlineMatch = true;

    this.socket.onopen = () => {
      console.log('WebSocket connection opened.');
      if (onOpenCallback) onOpenCallback();
    };

    this.socket.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        const { type, payload } = msg;

        // Emparejamiento normal
        if (type === 'QUEUE_STATUS') {
          const countEl = document.getElementById('queue-online-count');
          if (countEl) countEl.textContent = payload.onlineCount;
        }

        else if (type === 'MATCH_START') {
          const pDeck = this.deckBuilder.savedDecks[this.selectedDeckId];
          await this.initOnlineMatch(payload, pDeck);
        }

        else if (type === 'STATE_UPDATE' || type === 'ACTION_REJECTED') {
          this.messageQueue.push(msg);
          this.processQueue();
        }

        else if (type === 'CHAT_MESSAGE') {
          this.renderChatMessage(payload);
        }

        else if (type === 'MATCH_ERROR') {
          await window.customAlert('Error de Matchmaking', payload.message || 'Error en la partida.');
          this.leaveQueue();
        }

        // Salas privadas
        else if (type === 'PRIVATE_ROOM_CREATED') {
          this.currentPrivateRoomId = payload.roomId;
          const roomIdEl = document.getElementById('private-waiting-room-id');
          const passEl = document.getElementById('private-waiting-password');
          if (roomIdEl) roomIdEl.textContent = payload.roomId;
          if (passEl) passEl.textContent = this.currentPrivatePassword || 'Ninguna';
          this.appController.navigateTo('privateWaiting');
        }

        else if (type === 'PRIVATE_ROOM_ERROR') {
          await window.customAlert('Sala Privada', payload.message || 'Error en la operación.');
          this.closePrivateSocket();
        }

        else if (type === 'PRIVATE_ROOM_CANCELLED') {
          this.closePrivateSocket();
        }

      } catch (err) {
        console.error('Error handling WebSocket message:', err);
      }
    };

    this.socket.onclose = () => {
      console.log('WebSocket connection closed.');
      this.stopDuelTimers();
      if (this.phase !== 'game-over' && this.isOnlineMatch) {
        this.showWarning('Se perdió la conexión con el servidor.');
        if (this.onGameExit) this.onGameExit();
      }
    };

    this.socket.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  }

  // Override startMatchFlow to initiate WebSocket queue instead of instant local match
  async startMatchFlow() {
    const pDeckId = document.getElementById('player-duel-deck-select').value;
    const pDeck = this.deckBuilder.savedDecks[pDeckId];
    if (!pDeck) {
      await window.customAlert('Mazo Inválido', 'Por favor selecciona un mazo válido.');
      return;
    }

    document.getElementById('modal-deck-selector').classList.remove('active');
    this.selectedDeckId = pDeckId;

    // Transition to screen-queue
    this.appController.navigateTo('queue');

    this.setupWebSocket(() => {
      this.socket.send(JSON.stringify({
        type: 'JOIN_QUEUE',
        payload: { deckId: pDeckId }
      }));
    });
  }

  leaveQueue() {
    this.stopDuelTimers();
    this.messageQueue = [];
    this.isProcessingQueue = false;
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'LEAVE_QUEUE' }));
      this.socket.close();
    }
    this.isOnlineMatch = false;
    this.appController.navigateTo('menu');
  }

  closePrivateSocket() {
    this.stopDuelTimers();
    this.messageQueue = [];
    this.isProcessingQueue = false;
    this.currentPrivateRoomId = null;
    this.currentPrivatePassword = null;
    if (this.socket) {
      this.socket.close();
    }
    this.isOnlineMatch = false;
    this.appController.navigateTo('menu');
  }

  createPrivateRoom(deckId, password) {
    this.selectedDeckId = deckId;
    this.currentPrivatePassword = password;
    this.setupWebSocket(() => {
      this.socket.send(JSON.stringify({
        type: 'CREATE_PRIVATE_ROOM',
        payload: { deckId, password }
      }));
    });
  }

  joinPrivateRoom(roomId, password, deckId) {
    this.selectedDeckId = deckId;
    this.setupWebSocket(() => {
      this.socket.send(JSON.stringify({
        type: 'JOIN_PRIVATE_ROOM',
        payload: { roomId, password, deckId }
      }));
    });
  }

  cancelPrivateRoom() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN && this.currentPrivateRoomId) {
      this.socket.send(JSON.stringify({
        type: 'CANCEL_PRIVATE_ROOM',
        payload: { roomId: this.currentPrivateRoomId }
      }));
    }
    this.closePrivateSocket();
  }

  // Setup initial state from MATCH_START server payload
  async initOnlineMatch(data, playerDeckTemplate) {
    this.messageQueue = [];
    this.isProcessingQueue = false;
    const { matchId, opponentName, goesFirst } = data;
    this.matchId = matchId;
    this.opponentName = opponentName;
    this.localPlayerId = SESSIONS_LOCAL_USER_ID();

    // Clear elements
    const logBox = document.getElementById('duel-log');
    if (logBox) logBox.innerHTML = '';
    const chatBox = document.getElementById('duel-chat-messages');
    if (chatBox) chatBox.innerHTML = '';

    this.addLog('system', `¡Partida Encontrada! Te enfrentas a: ${opponentName}`);

    // Transition to duel arena screen
    this.appController.navigateTo('duel');

    // 1. Setup local player state using server synced deck, hand, prizes
    this.player = this.createPlayerState('Tú', playerDeckTemplate, false);

    // Clear and set deck
    this.player.deck = [];
    data.deck.forEach((entry) => {
      const originalCard = this.db.getCardById(entry.cardId);
      if (originalCard) {
        this.player.deck.push({
          instanceId: entry.instanceId,
          card: originalCard,
          damage: 0,
          attachedEnergy: [],
          specialCondition: null,
          turnPlaced: 0
        });
      }
    });
    // Reverse the deck to match client's draw pop order (top-most card at the end of the array)
    this.player.deck.reverse();

    // Clear and set hand
    this.player.hand = [];
    data.hand.forEach((entry) => {
      const originalCard = this.db.getCardById(entry.cardId);
      if (originalCard) {
        this.player.hand.push({
          instanceId: entry.instanceId,
          card: originalCard,
          damage: 0,
          attachedEnergy: [],
          specialCondition: null,
          turnPlaced: 0
        });
      }
    });

    // Clear and set prizes
    this.player.prizes = [];
    data.prizes.forEach((entry) => {
      const originalCard = this.db.getCardById(entry.cardId);
      if (originalCard) {
        this.player.prizes.push({
          instanceId: entry.instanceId,
          card: originalCard,
          damage: 0,
          attachedEnergy: [],
          specialCondition: null,
          turnPlaced: 0
        });
      }
    });

    // 2. Setup opponent state
    const opponentMockDeck = [];
    for (let i = 0; i < data.opponentDeckSize; i++) {
      opponentMockDeck.push({
        instanceId: `online-o-deck-${i + 1}`,
        card: null,
        damage: 0,
        attachedEnergy: [],
        specialCondition: null,
        turnPlaced: 0
      });
    }

    this.opponent = {
      name: opponentName,
      isAI: false,
      deck: opponentMockDeck,
      hand: [],
      active: null,
      bench: [null, null, null, null, null],
      prizes: [],
      discard: [],
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

    // Populate opponent hand and prizes mock cards
    for (let i = 0; i < data.opponentHandSize; i++) {
      this.opponent.hand.push({
        instanceId: `online-o-hand-${i + 1}`,
        card: null,
        damage: 0,
        attachedEnergy: [],
        specialCondition: null,
        turnPlaced: 0
      });
    }
    for (let i = 0; i < data.opponentPrizesSize; i++) {
      this.opponent.prizes.push({
        instanceId: `online-o-prize-${i + 1}`,
        card: null,
        damage: 0,
        attachedEnergy: [],
        specialCondition: null,
        turnPlaced: 0
      });
    }

    // Reset parameters
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
    this.isRetreating = false;

    // Disable Pass Turn during setup
    document.getElementById('btn-pass-turn').disabled = true;

    // Set starting turn
    this.turnOwner = goesFirst ? 'player' : 'opponent';

    // Play coin toss animation at start of duel
    await this.showStartingCoinFlip(goesFirst);

    this.addLog('system', 'Fase de Preparación: Coloca un Pokémon Básico en tu zona Activa.');

    // Mostrar controles de sandbox manual en duelos online
    const chatPanel = document.getElementById('online-chat-panel');
    if (chatPanel) chatPanel.style.display = 'flex';

    const chatContainer = document.getElementById('online-chat-input-container');
    if (chatContainer) chatContainer.style.display = 'flex';

    this.setupOnlineManualBindings();

    this.updateBoardUI();
    this.highlightPlayableBasicsInHand();

    this.isOnlineMatch = true;
    this.startDuelTimers();
    this.checkOnlineMulligan();
  }

  async showStartingCoinFlip(playerGoesFirst) {
    this.playSound('coin');
    const coinModal = document.getElementById('modal-coin-flip');
    const coin = document.getElementById('game-coin');
    const resultText = document.getElementById('coin-result-text');

    if (!coinModal || !coin) {
      return;
    }

    coinModal.classList.add('active');
    coin.className = 'coin'; // Reset anims
    resultText.textContent = 'Lanzando moneda...';

    await new Promise(r => setTimeout(r, 200));

    if (playerGoesFirst) {
      coin.classList.add('flip-heads-anim');
    } else {
      coin.classList.add('flip-tails-anim');
    }

    await new Promise(r => setTimeout(r, 2000));

    resultText.textContent = playerGoesFirst ? '¡CARA! Vas primero.' : `¡CRUZ! El oponente ${this.opponentName} va primero.`;

    await new Promise(r => setTimeout(r, 1200));
    coinModal.classList.remove('active');
  }

  async checkOnlineMulligan() {
    const hasBasic = this.player.hand.some(c => c.card.supertype === 'Pokémon' && c.card.subtypes?.includes('Basic'));
    if (hasBasic) {
      this.highlightPlayableBasicsInHand();
      return;
    }

    const handSize = this.player.hand.length - 1;
    if (handSize === 0) {
      this.showWarning('No tienes Pokémon Básicos en tu mano y te has quedado sin cartas.');
      this.sendGameAction('SURRENDER', {});
      return;
    }

    await window.customAlert('Mulligan', `No tienes Pokémon Básicos en tu mano inicial. Tu mano se mezclará en el mazo y robarás ${handSize} cartas.`);
    this.sendGameAction('MULLIGAN', { handSize });
  }

  // Intercept local actions and send them to socket
  sendGameAction(actionType, payload) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({
        type: 'GAME_ACTION',
        payload: { actionType, ...payload }
      }));
    }
  }

  // Selecciona una carta de la mano en el modo Sandbox
  handleHandCardClick(index) {
    if (!this.isOnlineMatch) {
      super.handleHandCardClick(index);
      return;
    }
    this.selectedHandCardIndex = index;
    this.selectedBoardCard = null;
    this.updateBoardUI();
    this.renderActionPanel();
  }

  // Manejador del click en el tablero en modo Sandbox Manual
  handleBoardSlotClick(side, zone, index) {
    if (!this.isOnlineMatch) {
      super.handleBoardSlotClick(side, zone, index);
      return;
    }

    if (this.phase === 'game-over') return;

    // Si hay una acción de objetivo activa (unir energía o evolucionar)
    if (this.targetingAction) {
      const { type, cardInstanceId } = this.targetingAction;
      if (type === 'attach-energy') {
        this.sendGameAction('MANUAL_ATTACH_ENERGY', {
          cardInstanceId,
          targetSide: side,
          targetZone: zone,
          targetIndex: index
        });
      } else if (type === 'evolve') {
        this.sendGameAction('MANUAL_EVOLVE', {
          cardInstanceId,
          targetSide: side,
          targetZone: zone,
          targetIndex: index
        });
      }
      this.targetingAction = null;
      this.selectedHandCardIndex = null;
      this.updateBoardUI();
      this.renderActionPanel();
      return;
    }

    // Si había una carta seleccionada en la mano y se hace click en el tablero
    if (this.selectedHandCardIndex !== null) {
      const cardObj = this.player.hand[this.selectedHandCardIndex];
      if (cardObj) {
        // Enviar movimiento sandbox genérico del cliente al servidor
        this.sendGameAction('MANUAL_CARD_MOVEMENT', {
          cardInstanceId: cardObj.instanceId,
          targetSide: side,
          targetZone: zone,
          targetIndex: index
        });
      }
      this.selectedHandCardIndex = null;
      this.updateBoardUI();
      this.renderActionPanel();
      return;
    }

    // Selección normal de cartas en juego
    this.selectedBoardCard = { side, zone, index };
    this.updateBoardUI();
    this.renderActionPanel();
  }

  // Inicio de turno manual (siempre permite finalizar el turno en modo Sandbox)
  beginOnlineTurn() {
    this.energyAttachedThisTurn = false;
    this.retreatedThisTurn = false;
    this.selectedBoardCard = null;
    this.selectedHandCardIndex = null;
    this.targetingAction = null;
    this.isRetreating = false;

    this.resetTurnTimer();

    const passBtn = document.getElementById('btn-pass-turn');
    if (passBtn) {
      passBtn.disabled = false; // Siempre habilitado
    }

    this.updateBoardUI();
  }

  // Pasar Turno manual
  async endTurn() {
    this.sendGameAction('MANUAL_PASS_TURN', {});
  }

  takePrizeManually(index) {
    this.sendGameAction('MANUAL_TAKE_PRIZE', { prizeIndex: index });
  }

  // Bindeos exclusivos de chat y lanzamiento de monedas en Sandbox
  setupOnlineManualBindings() {
    if (this.onlineManualBindingsDone) return;
    this.onlineManualBindingsDone = true;

    const btnSend = document.getElementById('btn-send-chat');
    const inputMsg = document.getElementById('chat-msg-input');

    const sendFn = () => {
      const text = inputMsg.value.trim();
      if (text !== '') {
        this.sendChatMessage(text);
        inputMsg.value = '';
      }
    };

    if (btnSend && inputMsg) {
      btnSend.addEventListener('click', sendFn);
      inputMsg.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendFn();
      });
    }

    const playerCoin = document.getElementById('player-coin');
    if (playerCoin) {
      playerCoin.addEventListener('click', () => {
        if (this.isCoinFlipping) return;
        this.sendGameAction('MANUAL_FLIP_COIN', { side: 'player' });
      });
    }

    const opponentCoin = document.getElementById('opponent-coin');
    if (opponentCoin) {
      opponentCoin.addEventListener('click', () => {
        if (this.isCoinFlipping) return;
        this.sendGameAction('MANUAL_FLIP_COIN', { side: 'opponent' });
      });
    }
  }

  // Envía mensajes de chat al WebSocket del servidor
  sendChatMessage(text) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({
        type: 'SEND_CHAT',
        payload: { text }
      }));
    }
  }

  // Renderiza los mensajes de chat en el registro
  renderChatMessage(payload) {
    const { senderId, senderName, text } = payload;
    const isSelf = senderId === this.localPlayerId;

    const chatBox = document.getElementById('duel-chat-messages');
    if (chatBox) {
      const div = document.createElement('div');
      div.className = `log-entry chat ${isSelf ? 'player' : 'opponent'}`;
      div.innerHTML = `💬 <strong>${senderName}</strong>: ${text}`;
      chatBox.appendChild(div);
      chatBox.scrollTop = chatBox.scrollHeight;
    }
  }

  // Busca y remueve localmente una carta de cualquier pila del cliente (para simular el movimiento manual)
  findAndRemoveCardLocal(identifier, fromZone, relativeSender, cardId) {
    if (relativeSender === 'opponent') {
      const o = this.opponent;
      if (fromZone === 'hand' && o.hand.length > 0) {
        return { cardObj: o.hand.shift(), owner: 'opponent', fromZone: 'hand' };
      }
      if (fromZone === 'prizes' && o.prizes.length > 0) {
        return { cardObj: o.prizes.shift(), owner: 'opponent', fromZone: 'prizes' };
      }
      if (fromZone === 'deck' && o.deck.length > 0) {
        return { cardObj: o.deck.shift(), owner: 'opponent', fromZone: 'deck' };
      }
    }

    // Buscar en el jugador local
    const p = this.player;
    let idx = p.hand.findIndex(c => c.instanceId === identifier);
    if (idx !== -1) return { cardObj: p.hand.splice(idx, 1)[0], owner: 'player', fromZone: 'hand' };

    if (p.active && p.active.instanceId === identifier) {
      const cardObj = p.active;
      p.active = null;
      return { cardObj, owner: 'player', fromZone: 'active' };
    }
    idx = p.bench.findIndex(c => c && c.instanceId === identifier);
    if (idx !== -1) {
      const cardObj = p.bench[idx];
      p.bench[idx] = null;
      return { cardObj, owner: 'player', fromZone: 'bench', fromIndex: idx };
    }
    idx = p.prizes.findIndex(c => c.instanceId === identifier);
    if (idx !== -1) return { cardObj: p.prizes.splice(idx, 1)[0], owner: 'player', fromZone: 'prizes' };

    idx = p.deck.findIndex(c => c.instanceId === identifier);
    if (idx !== -1) return { cardObj: p.deck.splice(idx, 1)[0], owner: 'player', fromZone: 'deck' };

    idx = p.discard.findIndex(c => c.id === identifier || c.instanceId === identifier || (cardId && (c.id === cardId || c.card?.id === cardId)));
    if (idx !== -1) {
      const rawCard = p.discard.splice(idx, 1)[0];
      const cardObj = {
        instanceId: `online-p-discarded-${Date.now()}-${Math.random()}`,
        card: rawCard.card ? rawCard.card : rawCard,
        damage: 0,
        attachedEnergy: [],
        specialCondition: null,
        turnPlaced: 0
      };
      return { cardObj, owner: 'player', fromZone: 'discard' };
    }

    if (this.playerActiveTrainer && this.playerActiveTrainer.instanceId === identifier) {
      const cardObj = this.playerActiveTrainer;
      this.playerActiveTrainer = null;
      return { cardObj, owner: 'player', fromZone: 'trainer' };
    }

    // Buscar en el oponente
    const o = this.opponent;
    idx = o.hand.findIndex(c => c.instanceId === identifier);
    if (idx !== -1) return { cardObj: o.hand.splice(idx, 1)[0], owner: 'opponent', fromZone: 'hand' };

    if (o.active && o.active.instanceId === identifier) {
      const cardObj = o.active;
      o.active = null;
      return { cardObj, owner: 'opponent', fromZone: 'active' };
    }
    idx = o.bench.findIndex(c => c && c.instanceId === identifier);
    if (idx !== -1) {
      const cardObj = o.bench[idx];
      o.bench[idx] = null;
      return { cardObj, owner: 'opponent', fromZone: 'bench', fromIndex: idx };
    }
    idx = o.prizes.findIndex(c => c.instanceId === identifier);
    if (idx !== -1) return { cardObj: o.prizes.splice(idx, 1)[0], owner: 'opponent', fromZone: 'prizes' };

    idx = o.deck.findIndex(c => c.instanceId === identifier);
    if (idx !== -1) return { cardObj: o.deck.splice(idx, 1)[0], owner: 'opponent', fromZone: 'deck' };

    idx = o.discard.findIndex(c => c.id === identifier || c.instanceId === identifier || (cardId && (c.id === cardId || c.card?.id === cardId)));
    if (idx !== -1) {
      const rawCard = o.discard.splice(idx, 1)[0];
      const cardObj = {
        instanceId: `online-o-discarded-${Date.now()}-${Math.random()}`,
        card: rawCard.card ? rawCard.card : rawCard,
        damage: 0,
        attachedEnergy: [],
        specialCondition: null,
        turnPlaced: 0
      };
      return { cardObj, owner: 'opponent', fromZone: 'discard' };
    }

    if (this.opponentActiveTrainer && this.opponentActiveTrainer.instanceId === identifier) {
      const cardObj = this.opponentActiveTrainer;
      this.opponentActiveTrainer = null;
      return { cardObj, owner: 'opponent', fromZone: 'trainer' };
    }

    return null;
  }

  // Renderiza el panel de acciones lateral adaptado al modo Sandbox
  renderActionPanel() {
    if (!this.isOnlineMatch) {
      super.renderActionPanel();
      return;
    }

    const panel = document.getElementById('active-pkmn-details');
    const buttonsContainer = document.getElementById('combat-actions-container');
    if (!panel || !buttonsContainer) return;

    panel.innerHTML = '';
    buttonsContainer.innerHTML = '';

    // Caso A: Carta seleccionada en la mano
    if (this.selectedHandCardIndex !== null) {
      const cardObj = this.player.hand[this.selectedHandCardIndex];
      if (!cardObj) return;
      const card = cardObj.card;

      panel.innerHTML = `
        <div class="detail-row"><strong>${card.name}</strong> <span>${card.supertype}</span></div>
        <div class="detail-row"><span style="font-size:0.8rem; color:var(--color-text-muted);">${card.rules ? card.rules.join('<br>') : (card.supertype === 'Energy' ? 'Energía básica' : 'Pokémon')}</span></div>
      `;

      // Cancelar selección
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'sandbox-btn';
      cancelBtn.textContent = 'Cancelar Selección';
      cancelBtn.addEventListener('click', () => {
        this.selectedHandCardIndex = null;
        this.updateBoardUI();
        this.renderActionPanel();
      });
      buttonsContainer.appendChild(cancelBtn);

      // Descartar directamente de mano
      const discardBtn = document.createElement('button');
      discardBtn.className = 'sandbox-btn accent-red';
      discardBtn.textContent = 'Descartar Carta';
      discardBtn.addEventListener('click', () => {
        this.sendGameAction('MANUAL_CARD_MOVEMENT', {
          cardInstanceId: cardObj.instanceId,
          targetSide: 'player',
          targetZone: 'discard'
        });
        this.selectedHandCardIndex = null;
        this.updateBoardUI();
        this.renderActionPanel();
      });
      buttonsContainer.appendChild(discardBtn);

      // Opciones según tipo de carta
      if (card.supertype === 'Trainer') {
        const playBtn = document.createElement('button');
        playBtn.className = 'sandbox-btn accent-green';
        playBtn.innerHTML = `<strong>Confirmar y Jugar</strong>`;
        playBtn.addEventListener('click', () => {
          this.sendGameAction('MANUAL_CARD_MOVEMENT', {
            cardInstanceId: cardObj.instanceId,
            targetSide: 'player',
            targetZone: 'trainer',
            targetIndex: 0
          });
          this.sendChatMessage(`Juega carta de Entrenador: ${card.name}`);
          this.selectedHandCardIndex = null;
          this.updateBoardUI();
          this.renderActionPanel();
        });
        buttonsContainer.appendChild(playBtn);
      }

      else if (card.supertype === 'Energy') {
        const infoMsg = document.createElement('p');
        infoMsg.className = 'placeholder-text';
        infoMsg.textContent = 'Modo Energía: Haz clic en uno de tus Pokémon en el tablero para unírsela.';
        buttonsContainer.appendChild(infoMsg);

        this.targetingAction = { type: 'attach-energy', cardInstanceId: cardObj.instanceId };
      }

      else if (card.supertype === 'Pokémon') {
        if (!this.player.active) {
          const activeBtn = document.createElement('button');
          activeBtn.className = 'sandbox-btn';
          activeBtn.textContent = 'Colocar como Activo';
          activeBtn.addEventListener('click', () => {
            this.sendGameAction('MANUAL_CARD_MOVEMENT', {
              cardInstanceId: cardObj.instanceId,
              targetSide: 'player',
              targetZone: 'active'
            });
            this.selectedHandCardIndex = null;
            this.updateBoardUI();
            this.renderActionPanel();
          });
          buttonsContainer.appendChild(activeBtn);
        }

        const benchRow = document.createElement('div');
        benchRow.className = 'sandbox-row';
        benchRow.innerHTML = '<span style="font-size:0.75rem; color:var(--color-text-muted);">Colocar en Banca:</span>';

        for (let i = 0; i < 5; i++) {
          const bBtn = document.createElement('button');
          bBtn.className = 'sandbox-btn';
          bBtn.textContent = `Slot ${i + 1}`;
          bBtn.disabled = !!this.player.bench[i];
          bBtn.addEventListener('click', () => {
            this.sendGameAction('MANUAL_CARD_MOVEMENT', {
              cardInstanceId: cardObj.instanceId,
              targetSide: 'player',
              targetZone: 'bench',
              targetIndex: i
            });
            this.selectedHandCardIndex = null;
            this.updateBoardUI();
            this.renderActionPanel();
          });
          benchRow.appendChild(bBtn);
        }
        buttonsContainer.appendChild(benchRow);

        if (card.evolvesFrom) {
          const evolveBtn = document.createElement('button');
          evolveBtn.className = 'sandbox-btn';
          evolveBtn.textContent = `Evolucionar (Haz clic en un ${card.evolvesFrom})`;
          evolveBtn.addEventListener('click', () => {
            this.targetingAction = { type: 'evolve', cardInstanceId: cardObj.instanceId };
            this.showWarning(`Haz clic en el Pokémon en juego que deseas evolucionar a ${card.name}.`);
          });
          buttonsContainer.appendChild(evolveBtn);
        }
      }
      return;
    }

    // Caso B: Ninguna carta seleccionada
    if (!this.selectedBoardCard) {
      panel.innerHTML = '<p class="placeholder-text">Selecciona una carta en juego para ver sus acciones disponibles.</p>';

      const generalGroup = document.createElement('div');
      generalGroup.className = 'sandbox-group';
      generalGroup.innerHTML = '<div class="sandbox-title">Controles de Mazo</div>';

      const generalRow = document.createElement('div');
      generalRow.className = 'sandbox-row';

      const draw1Btn = document.createElement('button');
      draw1Btn.className = 'sandbox-btn';
      draw1Btn.textContent = 'Robar 1 Carta';
      draw1Btn.addEventListener('click', () => {
        this.sendGameAction('MANUAL_DRAW', { count: 1 });
      });
      generalRow.appendChild(draw1Btn);

      const shuffleBtn = document.createElement('button');
      shuffleBtn.className = 'sandbox-btn';
      shuffleBtn.textContent = 'Barajar Mazo';
      shuffleBtn.addEventListener('click', () => {
        this.sendGameAction('MANUAL_SHUFFLE', {});
      });
      generalRow.appendChild(shuffleBtn);

      generalGroup.appendChild(generalRow);
      buttonsContainer.appendChild(generalGroup);
      return;
    }

    // Caso C: Carta en el tablero seleccionada
    const { side, zone, index } = this.selectedBoardCard;
    const targetState = side === 'player' ? this.player : this.opponent;

    if (zone === 'trainer') {
      const trainerCardObj = side === 'player' ? this.playerActiveTrainer : this.opponentActiveTrainer;
      if (!trainerCardObj) {
        panel.innerHTML = '<p class="placeholder-text">Ranura de Entrenador vacía.</p>';
        return;
      }
      const trainerCard = trainerCardObj.card || trainerCardObj;
      panel.innerHTML = `
        <div class="detail-row"><strong>${trainerCard.name}</strong> <span>Entrenador</span></div>
        <div class="detail-row"><span style="font-size:0.8rem; color:var(--color-text-muted);">${trainerCard.rules ? trainerCard.rules.join('<br>') : ''}</span></div>
      `;

      // Cancelar selección
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'sandbox-btn';
      cancelBtn.textContent = 'Cancelar Selección';
      cancelBtn.addEventListener('click', () => {
        this.selectedBoardCard = null;
        this.updateBoardUI();
        this.renderActionPanel();
      });
      buttonsContainer.appendChild(cancelBtn);

      // Descartar entrenador
      const discardBtn = document.createElement('button');
      discardBtn.className = 'sandbox-btn accent-red';
      discardBtn.textContent = 'Enviar a Pila de Descarte';
      discardBtn.addEventListener('click', () => {
        this.sendGameAction('MANUAL_CARD_MOVEMENT', {
          cardInstanceId: trainerCardObj.instanceId,
          targetSide: side,
          targetZone: 'discard'
        });
        this.selectedBoardCard = null;
        this.updateBoardUI();
        this.renderActionPanel();
      });
      buttonsContainer.appendChild(discardBtn);

      // Devolver a la mano
      const handBtn = document.createElement('button');
      handBtn.className = 'sandbox-btn';
      handBtn.textContent = 'Devolver a la Mano';
      handBtn.addEventListener('click', () => {
        this.sendGameAction('MANUAL_CARD_MOVEMENT', {
          cardInstanceId: trainerCardObj.instanceId,
          targetSide: side,
          targetZone: 'hand'
        });
        this.selectedBoardCard = null;
        this.updateBoardUI();
        this.renderActionPanel();
      });
      buttonsContainer.appendChild(handBtn);
      return;
    }

    const pkmn = zone === 'active' ? targetState.active : targetState.bench[index];

    if (!pkmn) {
      panel.innerHTML = '<p class="placeholder-text">Ranura vacía.</p>';
      return;
    }

    panel.innerHTML = `
      <div class="detail-row"><strong>${pkmn.card.name}</strong> <span>HP ${pkmn.card.hp - pkmn.damage}/${pkmn.card.hp}</span></div>
      <div class="detail-row"><span>Etapa: ${pkmn.card.subtypes[0]}</span> <span>Tipo: ${pkmn.card.types ? pkmn.card.types[0] : 'Incoloro'}</span></div>
      <div class="detail-row"><span>Condición: ${pkmn.specialCondition || 'Normal'}</span> <span>Daño: ${pkmn.damage}</span></div>
    `;

    // 1. Ajustar Daño
    const dmgGroup = document.createElement('div');
    dmgGroup.className = 'sandbox-group';
    dmgGroup.innerHTML = '<div class="sandbox-title">Ajustar Daño (HP)</div>';

    const dmgRow = document.createElement('div');
    dmgRow.className = 'sandbox-row';

    const add10 = document.createElement('button');
    add10.className = 'sandbox-btn accent-red';
    add10.textContent = '+10';
    add10.addEventListener('click', () => this.sendGameAction('MANUAL_DAMAGE_CHANGE', { targetSide: side, targetZone: zone, targetIndex: index, amount: 10 }));

    const sub10 = document.createElement('button');
    sub10.className = 'sandbox-btn accent-green';
    sub10.textContent = '-10';
    sub10.addEventListener('click', () => this.sendGameAction('MANUAL_DAMAGE_CHANGE', { targetSide: side, targetZone: zone, targetIndex: index, amount: -10 }));

    const add50 = document.createElement('button');
    add50.className = 'sandbox-btn accent-red';
    add50.textContent = '+50';
    add50.addEventListener('click', () => this.sendGameAction('MANUAL_DAMAGE_CHANGE', { targetSide: side, targetZone: zone, targetIndex: index, amount: 50 }));

    const clearDmg = document.createElement('button');
    clearDmg.className = 'sandbox-btn';
    clearDmg.textContent = 'Limpiar';
    clearDmg.addEventListener('click', () => this.sendGameAction('MANUAL_DAMAGE_CHANGE', { targetSide: side, targetZone: zone, targetIndex: index, amount: -pkmn.damage }));

    dmgRow.appendChild(add10);
    dmgRow.appendChild(sub10);
    dmgRow.appendChild(add50);
    dmgRow.appendChild(clearDmg);
    dmgGroup.appendChild(dmgRow);
    buttonsContainer.appendChild(dmgGroup);

    // 2. Ajustar Estados
    const statusGroup = document.createElement('div');
    statusGroup.className = 'sandbox-group';
    statusGroup.innerHTML = '<div class="sandbox-title">Condición Especial</div>';

    const statusGrid = document.createElement('div');
    statusGrid.className = 'sandbox-status-grid';

    const conditions = [
      { label: 'Normal', value: null },
      { label: 'Envenenado', value: 'poisoned' },
      { label: 'Quemado', value: 'burned' },
      { label: 'Dormido', value: 'asleep' },
      { label: 'Paralizado', value: 'paralyzed' },
      { label: 'Confundido', value: 'confused' }
    ];

    conditions.forEach(cond => {
      const lbl = document.createElement('label');
      lbl.className = 'sandbox-status-item';
      lbl.innerHTML = `
        <input type="radio" name="sandbox-status" ${pkmn.specialCondition === cond.value ? 'checked' : ''}>
        <span>${cond.label}</span>
      `;
      lbl.querySelector('input').addEventListener('change', () => {
        this.sendGameAction('MANUAL_STATUS_CHANGE', { targetSide: side, targetZone: zone, targetIndex: index, condition: cond.value });
      });
      statusGrid.appendChild(lbl);
    });
    statusGroup.appendChild(statusGrid);
    buttonsContainer.appendChild(statusGroup);

    // 3. Gestión manual de energías adjuntas (Descartar / Retirar a mano)
    const energyGroup = document.createElement('div');
    energyGroup.className = 'sandbox-group';
    energyGroup.innerHTML = '<div class="sandbox-title">Energías Unidas</div>';

    const energyList = document.createElement('div');
    energyList.className = 'attached-energy-list';

    if (pkmn.attachedEnergy && pkmn.attachedEnergy.length > 0) {
      pkmn.attachedEnergy.forEach(energyCard => {
        const item = document.createElement('div');
        item.className = 'attached-energy-item';
        item.innerHTML = `
          <span>⚡ ${energyCard.name}</span>
          <div>
            <button class="btn-detach-discard" title="Descartar">🗑️ Descartar</button>
            <button class="btn-detach-hand" title="Devolver a la Mano">👋 Mano</button>
          </div>
        `;
        item.querySelector('.btn-detach-discard').addEventListener('click', () => {
          this.sendGameAction('MANUAL_DISCARD_ENERGY', {
            targetSide: side,
            targetZone: zone,
            targetIndex: index,
            energyCardId: energyCard.id,
            destinationZone: 'discard'
          });
        });
        item.querySelector('.btn-detach-hand').addEventListener('click', () => {
          this.sendGameAction('MANUAL_DISCARD_ENERGY', {
            targetSide: side,
            targetZone: zone,
            targetIndex: index,
            energyCardId: energyCard.id,
            destinationZone: 'hand'
          });
        });
        energyList.appendChild(item);
      });
    } else {
      energyList.innerHTML = '<p class="placeholder-text" style="padding:0;">Ninguna energía unida.</p>';
    }
    energyGroup.appendChild(energyList);
    buttonsContainer.appendChild(energyGroup);

    // 4. Mover Pokémon a otras zonas
    const moveGroup = document.createElement('div');
    moveGroup.className = 'sandbox-group';
    moveGroup.innerHTML = '<div class="sandbox-title">Mover Pokémon</div>';

    const moveRow = document.createElement('div');
    moveRow.className = 'sandbox-row';

    const discardCardBtn = document.createElement('button');
    discardCardBtn.className = 'sandbox-btn accent-red';
    discardCardBtn.textContent = 'Descartar';
    discardCardBtn.addEventListener('click', () => {
      this.sendGameAction('MANUAL_CARD_MOVEMENT', {
        cardInstanceId: pkmn.instanceId,
        targetSide: side,
        targetZone: 'discard'
      });
      this.selectedBoardCard = null;
      this.updateBoardUI();
      this.renderActionPanel();
    });
    moveRow.appendChild(discardCardBtn);

    const returnHandBtn = document.createElement('button');
    returnHandBtn.className = 'sandbox-btn';
    returnHandBtn.textContent = 'Mano';
    returnHandBtn.addEventListener('click', () => {
      this.sendGameAction('MANUAL_CARD_MOVEMENT', {
        cardInstanceId: pkmn.instanceId,
        targetSide: side,
        targetZone: 'hand'
      });
      this.selectedBoardCard = null;
      this.updateBoardUI();
      this.renderActionPanel();
    });
    moveRow.appendChild(returnHandBtn);

    if (zone === 'bench') {
      const makeActiveBtn = document.createElement('button');
      makeActiveBtn.className = 'sandbox-btn';
      makeActiveBtn.textContent = 'Puesto Activo';
      makeActiveBtn.addEventListener('click', () => {
        this.sendGameAction('MANUAL_CARD_MOVEMENT', {
          cardInstanceId: pkmn.instanceId,
          targetSide: side,
          targetZone: 'active'
        });
        this.selectedBoardCard = null;
        this.updateBoardUI();
        this.renderActionPanel();
      });
      moveRow.appendChild(makeActiveBtn);
    } else if (zone === 'active') {
      const moveBenchSelect = document.createElement('select');
      moveBenchSelect.className = 'sandbox-select';
      moveBenchSelect.innerHTML = '<option value="">-- Mover a Banca --</option>';
      for (let i = 0; i < 5; i++) {
        moveBenchSelect.innerHTML += `<option value="${i}">Banca Slot ${i + 1} ${targetState.bench[i] ? '(Reemplazar)' : '(Vacío)'}</option>`;
      }
      moveBenchSelect.addEventListener('change', (e) => {
        const slot = e.target.value;
        if (slot !== '') {
          this.sendGameAction('MANUAL_CARD_MOVEMENT', {
            cardInstanceId: pkmn.instanceId,
            targetSide: side,
            targetZone: 'bench',
            targetIndex: parseInt(slot)
          });
          this.selectedBoardCard = null;
          this.updateBoardUI();
          this.renderActionPanel();
        }
      });
      moveRow.appendChild(moveBenchSelect);
    }
    moveGroup.appendChild(moveRow);
    buttonsContainer.appendChild(moveGroup);

    // 5. Declarar Ataques/Poderes (Macros de chat)
    if (side === 'player') {
      const macrosGroup = document.createElement('div');
      macrosGroup.className = 'sandbox-group';
      macrosGroup.innerHTML = '<div class="sandbox-title">Declarar Ataques/Poderes</div>';

      const macrosRow = document.createElement('div');
      macrosRow.className = 'sandbox-row';

      if (pkmn.card.abilities) {
        pkmn.card.abilities.forEach(ab => {
          const abBtn = document.createElement('button');
          abBtn.className = 'sandbox-btn';
          abBtn.textContent = `Poder: ${ab.name}`;
          abBtn.addEventListener('click', () => {
            this.sendChatMessage(`Declara Poder [${ab.name}]: ${ab.text}`);
          });
          macrosRow.appendChild(abBtn);
        });
      }

      if (pkmn.card.attacks) {
        pkmn.card.attacks.forEach(atk => {
          const atkBtn = document.createElement('button');
          atkBtn.className = 'sandbox-btn';
          atkBtn.textContent = `Atacar: ${atk.name}`;
          atkBtn.addEventListener('click', () => {
            const extraDmgText = atk.damage ? ` (causa ${atk.damage} de daño)` : '';
            this.sendChatMessage(`Declara Ataque [${atk.name}]${extraDmgText}: ${atk.text}`);
          });
          macrosRow.appendChild(atkBtn);
        });
      }

      macrosGroup.appendChild(macrosRow);
      buttonsContainer.appendChild(macrosGroup);
    }
  }

  // Surrender / Forfeit
  endGame(winnerSide, reason) {
    if (this.phase === 'game-over') return;
    if (winnerSide === 'opponent') {
      this.sendGameAction('SURRENDER', {});
    }
  }

  // Ends game local only (when received match over from server)
  endGameLocal(winnerSide, reason) {
    this.phase = 'game-over';
    this.messageQueue = [];
    this.isProcessingQueue = false;
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

    if (this.socket) {
      this.socket.close();
    }
  }

  async processQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    try {
      while (this.messageQueue.length > 0) {
        const msg = this.messageQueue.shift();
        const { type, payload } = msg;

        if (type === 'STATE_UPDATE') {
          const { events, stateSnapshot } = payload;
          for (const event of events) {
            await this.handleStateUpdateEvent(event);
          }
          if (stateSnapshot) {
            this.syncStateWithSnapshot(stateSnapshot);
          }
        } else if (type === 'ACTION_REJECTED') {
          const { reason } = payload;
          this.showWarning(`Acción rechazada por el servidor: ${reason}`);
          this.updateBoardUI();
        }
      }
    } catch (err) {
      console.error('Error processing message queue:', err);
    } finally {
      this.isProcessingQueue = false;
    }
  }

  async handleStateUpdateEvent(event) {
    const { type } = event;
    console.log('[OnlineDuel] Processing event:', event);

    switch (type) {
      case 'MULLIGAN_RESOLVED': {
        const { playerId, handSize, newShuffledDeckIds, newHandIds } = event;
        const isLocal = playerId === this.localPlayerId;
        if (isLocal) {
          this.addLog('player', `No tienes Pokémon Básicos en tu mano. ¡Mulligan! Se re-baraja y robas ${handSize} cartas.`);

          const resolvedShuffled = [];
          newShuffledDeckIds.forEach((entry) => {
            const originalCard = this.db.getCardById(entry.cardId);
            if (originalCard) {
              resolvedShuffled.push({
                instanceId: entry.instanceId,
                card: originalCard,
                damage: 0,
                attachedEnergy: [],
                specialCondition: null,
                turnPlaced: 0
              });
            }
          });
          this.player.deck = resolvedShuffled.reverse();

          this.player.hand = [];
          newHandIds.forEach((entry) => {
            const originalCard = this.db.getCardById(entry.cardId);
            if (originalCard) {
              this.player.hand.push({
                instanceId: entry.instanceId,
                card: originalCard,
                damage: 0,
                attachedEnergy: [],
                specialCondition: null,
                turnPlaced: 0
              });
            }
          });

          this.updateBoardUI();
          await this.checkOnlineMulligan();
        } else {
          this.addLog('opponent', `${this.opponentName} no tiene Pokémon Básicos en su mano. Re-baraja y roba ${handSize} cartas.`);
          this.opponent.hand = [];
          for (let i = 0; i < handSize; i++) {
            this.opponent.hand.push({
              instanceId: `online-o-hand-${i + 1}`,
              card: null,
              damage: 0,
              attachedEnergy: [],
              specialCondition: null,
              turnPlaced: 0
            });
          }
          this.updateBoardUI();
        }
        break;
      }

      case 'PLACE_ACTIVE_RESOLVED': {
        const { playerId, cardId, instanceId } = event;
        const isLocal = playerId === this.localPlayerId;
        const originalCard = this.db.getCardById(cardId);

        if (isLocal) {
          const handIdx = this.player.hand.findIndex(c => c.card.id === cardId);
          if (handIdx !== -1) {
            this.player.active = this.player.hand[handIdx];
            this.player.active.turnPlaced = 0;
            this.player.hand.splice(handIdx, 1);
          } else {
            this.player.active = { card: originalCard, damage: 0, attachedEnergy: [], specialCondition: null, turnPlaced: 0 };
          }
          this.addLog('player', `Colocaste a ${originalCard.name} como tu Pokémon Activo.`);
        } else {
          this.opponent.active = {
            instanceId: instanceId || `online-o-active`,
            card: originalCard,
            damage: 0,
            attachedEnergy: [],
            specialCondition: null,
            turnPlaced: 0
          };
          if (this.opponent.hand.length > 0) this.opponent.hand.pop();
          this.addLog('opponent', `${this.opponentName} colocó a ${originalCard.name} como su Pokémon Activo.`);
        }
        this.updateBoardUI();
        break;
      }

      case 'PLACE_BENCH_RESOLVED': {
        const { playerId, cardId, index, instanceId } = event;
        const isLocal = playerId === this.localPlayerId;
        const originalCard = this.db.getCardById(cardId);

        if (isLocal) {
          const handIdx = this.player.hand.findIndex(c => c.card.id === cardId);
          if (handIdx !== -1) {
            this.player.bench[index] = this.player.hand[handIdx];
            this.player.bench[index].turnPlaced = this.turnNumber;
            this.player.hand.splice(handIdx, 1);
          } else {
            this.player.bench[index] = { card: originalCard, damage: 0, attachedEnergy: [], specialCondition: null, turnPlaced: this.turnNumber };
          }
          this.addLog('player', `Colocaste a ${originalCard.name} en la Banca.`);
        } else {
          this.opponent.bench[index] = {
            instanceId: instanceId || `online-o-bench-${index}`,
            card: originalCard,
            damage: 0,
            attachedEnergy: [],
            specialCondition: null,
            turnPlaced: this.turnNumber
          };
          if (this.opponent.hand.length > 0) this.opponent.hand.pop();
          this.addLog('opponent', `${this.opponentName} colocó a ${originalCard.name} en la Banca.`);
        }
        this.updateBoardUI();
        break;
      }

      case 'ATTACH_ENERGY_RESOLVED': {
        const { playerId, cardId, targetZone, targetIndex } = event;
        const isLocal = playerId === this.localPlayerId;
        const energyCard = this.db.getCardById(cardId);

        let pkmn = null;
        if (isLocal) {
          pkmn = targetZone === 'active' ? this.player.active : this.player.bench[targetIndex];
          const handIdx = this.player.hand.findIndex(c => c.card.id === cardId);
          if (handIdx !== -1) this.player.hand.splice(handIdx, 1);
          if (pkmn) {
            pkmn.attachedEnergy.push(energyCard);
            this.addLog('player', `Uniste ${energyCard.name} a ${pkmn.card.name}.`);
          }
        } else {
          pkmn = targetZone === 'active' ? this.opponent.active : this.opponent.bench[targetIndex];
          if (this.opponent.hand.length > 0) this.opponent.hand.pop();
          if (pkmn) {
            pkmn.attachedEnergy.push(energyCard);
            this.addLog('opponent', `${this.opponentName} unió ${energyCard.name} a ${pkmn.card.name}.`);
          }
        }
        this.playSound('attach');
        this.updateBoardUI();
        break;
      }

      case 'EVOLVE_RESOLVED': {
        const { playerId, cardId, targetZone, targetIndex, oldCardName } = event;
        const isLocal = playerId === this.localPlayerId;
        const evolutionCard = this.db.getCardById(cardId);

        let pkmn = null;
        if (isLocal) {
          pkmn = targetZone === 'active' ? this.player.active : this.player.bench[targetIndex];
          const handIdx = this.player.hand.findIndex(c => c.card.id === cardId);
          if (handIdx !== -1) this.player.hand.splice(handIdx, 1);
          if (pkmn) {
            pkmn.card = evolutionCard;
            pkmn.turnPlaced = this.turnNumber;
            pkmn.specialCondition = null;
            this.addLog('player', `¡Evolucionaste a ${oldCardName} en ${evolutionCard.name}!`);
          }
        } else {
          pkmn = targetZone === 'active' ? this.opponent.active : this.opponent.bench[targetIndex];
          if (this.opponent.hand.length > 0) this.opponent.hand.pop();
          if (pkmn) {
            pkmn.card = evolutionCard;
            pkmn.turnPlaced = this.turnNumber;
            pkmn.specialCondition = null;
            this.addLog('opponent', `¡${this.opponentName} evolucionó a ${oldCardName} en ${evolutionCard.name}!`);
          }
        }
        this.playSound('attach');
        this.updateBoardUI();
        break;
      }

      case 'PLAY_TRAINER_RESOLVED': {
        const { playerId, cardId, effect, details } = event;
        const isLocal = playerId === this.localPlayerId;
        const trainerCard = this.db.getCardById(cardId);

        if (isLocal) {
          this.playerActiveTrainer = trainerCard;
          const handIdx = this.player.hand.findIndex(c => c.card.id === cardId);
          if (handIdx !== -1) this.player.hand.splice(handIdx, 1);
        } else {
          this.opponentActiveTrainer = trainerCard;
          if (this.opponent.hand.length > 0) this.opponent.hand.pop();
        }

        this.playSound('attach');
        this.updateBoardUI();

        await new Promise(r => setTimeout(r, 1200));

        if (effect === 'BILL') {
          this.addLog(isLocal ? 'player' : 'opponent', isLocal ? `Jugaste Bill y robaste 2 cartas.` : `${this.opponentName} jugó Bill y robó 2 cartas.`);
          if (isLocal) {
            details.drawnCards.forEach(entry => {
              const originalCard = this.db.getCardById(entry.cardId);
              if (originalCard && this.player.deck.length > 0) {
                this.player.deck.pop();
                this.player.hand.push({
                  instanceId: entry.instanceId,
                  card: originalCard,
                  damage: 0,
                  attachedEnergy: [],
                  specialCondition: null,
                  turnPlaced: 0
                });
              }
            });
          } else {
            this.opponent.drawCards(2);
          }
        } else if (effect === 'PROFESSOR_OAK') {
          this.addLog(isLocal ? 'player' : 'opponent', isLocal ? `Jugaste Profesor Oak: descartaste tu mano y robaste 7 cartas.` : `${this.opponentName} jugó Profesor Oak: descartó su mano y robó 7 cartas.`);
          if (isLocal) {
            this.player.hand.forEach(c => this.player.discard.push(c.card));
            this.player.hand = [];
            details.oakDrawn.forEach(entry => {
              const originalCard = this.db.getCardById(entry.cardId);
              if (originalCard && this.player.deck.length > 0) {
                this.player.deck.pop();
                this.player.hand.push({
                  instanceId: entry.instanceId,
                  card: originalCard,
                  damage: 0,
                  attachedEnergy: [],
                  specialCondition: null,
                  turnPlaced: 0
                });
              }
            });
          } else {
            this.opponent.hand = [];
            this.opponent.drawCards(7);
          }
        } else if (effect === 'POTION') {
          const { targetSide, zone, index } = details;
          let targetObjSide = isLocal ? (targetSide === 'player' ? 'player' : 'opponent') : (targetSide === 'player' ? 'opponent' : 'player');
          const pkmn = targetObjSide === 'player'
            ? (zone === 'active' ? this.player.active : this.player.bench[index])
            : (zone === 'active' ? this.opponent.active : this.opponent.bench[index]);

          if (pkmn) {
            pkmn.damage = Math.max(0, pkmn.damage - 20);
            this.addLog(isLocal ? 'player' : 'opponent', `Curó 20 de daño a ${pkmn.card.name} usando Poción.`);
          }
        } else if (effect === 'SWITCH') {
          const { benchIndex } = details;
          const target = isLocal ? this.player : this.opponent;
          const oldAct = target.active;
          const newAct = target.bench[benchIndex];
          if (oldAct && newAct) {
            target.active = newAct;
            target.bench[benchIndex] = oldAct;
            target.active.specialCondition = null;
            oldAct.specialCondition = null;
            this.addLog(isLocal ? 'player' : 'opponent', `Retiró a ${oldAct.card.name} y promovió a ${newAct.card.name} usando Cambio.`);
          }
        } else if (effect === 'GUST_OF_WIND') {
          const { benchIndex } = details;
          const target = isLocal ? this.opponent : this.player;
          const oldAct = target.active;
          const newAct = target.bench[benchIndex];
          if (oldAct && newAct) {
            target.active = newAct;
            target.bench[benchIndex] = oldAct;
            target.active.specialCondition = null;
            oldAct.specialCondition = null;
            this.addLog(isLocal ? 'player' : 'opponent', `Obligó a cambiar el Pokémon Activo a ${newAct.card.name} usando Ráfaga de Viento.`);
          }
        } else if (effect === 'ENERGY_REMOVAL') {
          const target = isLocal ? this.opponent : this.player;
          if (target.active && target.active.attachedEnergy.length > 0) {
            const energy = target.active.attachedEnergy.pop();
            target.discard.push(energy);
            this.addLog(isLocal ? 'player' : 'opponent', `Descartó una energía ${energy.name} de ${target.active.card.name} usando Quitaenergía.`);
          }
        } else if (effect === 'FULL_HEAL') {
          const target = isLocal ? this.player : this.opponent;
          if (target.active) {
            target.active.specialCondition = null;
            this.addLog(isLocal ? 'player' : 'opponent', `Curó todas las condiciones especiales de ${target.active.card.name} usando Cura Total.`);
          }
        }

        if (isLocal) {
          this.player.discard.push(trainerCard);
          this.playerActiveTrainer = null;
        } else {
          this.opponent.discard.push(trainerCard);
          this.opponentActiveTrainer = null;
        }
        this.updateBoardUI();
        break;
      }

      case 'CONFUSION_CHECK': {
        const { playerId, isHeads } = event;
        const isLocal = playerId === this.localPlayerId;
        this.addLog(isLocal ? 'player' : 'opponent', `${isLocal ? 'Tú' : this.opponentName} está confundido. Lanza una moneda...`);
        await this.flipCoinVisual(`¿Ataca confundido?`, isHeads);
        break;
      }

      case 'CONFUSION_FAIL': {
        const { playerId, damage } = event;
        const isLocal = playerId === this.localPlayerId;
        const target = isLocal ? this.player : this.opponent;
        if (target.active) {
          target.active.damage += damage;
          this.addLog(isLocal ? 'player' : 'opponent', `¡Sello! El ataque falla y se hace ${damage} de daño a sí mismo.`);
        }
        this.updateBoardUI();
        break;
      }

      case 'ACCURACY_CHECK': {
        const { playerId, isHeads, effectName } = event;
        const isLocal = playerId === this.localPlayerId;
        const name = isLocal ? 'Tú' : this.opponentName;
        this.addLog(isLocal ? 'player' : 'opponent', `${name} está afectado por precisión. Lanza una moneda...`);
        await this.flipCoinVisual(`¿Precisión para ${isLocal ? this.player.active.card.name : this.opponent.active.card.name}?`, isHeads);
        break;
      }

      case 'ACCURACY_FAIL': {
        const { playerId } = event;
        const isLocal = playerId === this.localPlayerId;
        this.addLog(isLocal ? 'player' : 'opponent', `¡Sello! El ataque falla.`);
        break;
      }

      case 'DAMAGE_PREVENTED': {
        const { playerId, cardId } = event;
        const isLocal = playerId === this.localPlayerId;
        const target = isLocal ? this.player : this.opponent;
        const name = target.active ? target.active.card.name : 'Pokémon';
        this.addLog('system', `¡El daño es prevenido por el efecto activo en ${name}!`);
        break;
      }

      case 'EFFECT_PREVENTED': {
        const { playerId, cardId, effect } = event;
        const isLocal = playerId === this.localPlayerId;
        const target = isLocal ? this.player : this.opponent;
        const name = target.active ? target.active.card.name : 'Pokémon';
        this.addLog('system', `¡El efecto ${effect} es prevenido por el efecto activo en ${name}!`);
        break;
      }

      case 'ATTACK_RESOLVED': {
        const { playerId, attackName, damage, coinFlips, selfDmg, benchDmg, statusApplied, isWeakness, isResistance, statusCoinFlipNeeded, statusCoinFlipResult } = event;
        const isLocal = playerId === this.localPlayerId;
        const attacker = isLocal ? this.player.active : this.opponent.active;
        const defender = isLocal ? this.opponent.active : this.player.active;

        if (attacker && defender) {
          if (coinFlips && coinFlips.length > 0) {
            for (let i = 0; i < coinFlips.length; i++) {
              await this.flipCoinVisual(`${attackName} Moneda ${coinFlips.length > 1 ? i + 1 : ''}`, coinFlips[i]);
            }
          }

          const attackObj = attacker.card.attacks.find(a => a.name === attackName) || { name: attackName, damage, text: '' };
          await this.animateClash(attackObj, attacker, defender, damage, isWeakness, isResistance);

          defender.damage += damage;
          this.addLog(isLocal ? 'player' : 'opponent', `¡${attacker.card.name} usó ${attackName} y causó ${damage} de daño a ${defender.card.name}!`);

          if (selfDmg > 0) {
            attacker.damage += selfDmg;
            this.addLog(isLocal ? 'player' : 'opponent', `${attacker.card.name} se hizo ${selfDmg} de daño a sí mismo.`);
          }

          if (benchDmg > 0) {
            const attackerState = isLocal ? this.player : this.opponent;
            const defenderState = isLocal ? this.opponent : this.player;
            attackerState.bench.forEach(pkmn => { if (pkmn) pkmn.damage += benchDmg; });
            defenderState.bench.forEach(pkmn => { if (pkmn) pkmn.damage += benchDmg; });
          }

          // Animación de moneda para efectos de estado (Poison Sting, Bubble, etc.)
          if (statusCoinFlipNeeded) {
            const conditionLabel = statusApplied || 'efecto';
            const flipMessage = statusCoinFlipResult
              ? `¡Cara! ${defender.card.name} será afectado.`
              : `¡Sello! ${defender.card.name} no es afectado.`;
            await this.flipCoinVisual(`¿Aplica ${conditionLabel}?`, statusCoinFlipResult);
            this.addLog('system', flipMessage);
          }

          if (statusApplied) {
            defender.specialCondition = statusApplied;
            const statusLabels = { confused: 'Confundido', asleep: 'Dormido', paralyzed: 'Paralizado', poisoned: 'Envenenado', burned: 'Quemado' };
            this.addLog(isLocal ? 'opponent' : 'player', `${defender.card.name} ahora está ${statusLabels[statusApplied] || statusApplied}.`);
          }
        }
        this.updateBoardUI();
        break;
      }

      case 'KNOCKOUT': {
        const { playerId, cardId, zone, index } = event;
        const isLocal = playerId === this.localPlayerId;
        const target = isLocal ? this.player : this.opponent;

        let pkmn = null;
        if (zone === 'active') {
          pkmn = target.active;
          target.active = null;
        } else {
          pkmn = target.bench[index];
          target.bench[index] = null;
        }

        if (pkmn) {
          this.addLog(isLocal ? 'player' : 'opponent', `¡${pkmn.card.name} fue debilitado!`);
          if (!isLocal) {
            this.addLog('system', '¡Has debilitado a un Pokémon rival! Elige una de tus cartas de Premio para llevarla a tu mano.');
            this.showWarning('¡Elige una carta de Premio!');
          }
          target.discard.push(pkmn.card);
          pkmn.attachedEnergy.forEach(e => target.discard.push(e));
        }
        this.updateBoardUI();
        break;
      }

      case 'TAKE_PRIZE_RESOLVED': {
        const { playerId, cardId, prizesLeft, prizeIndex } = event;
        const isLocal = playerId === this.localPlayerId;
        const idx = (prizeIndex !== undefined) ? prizeIndex : 0;

        if (isLocal) {
          if (this.player.prizes.length > 0) {
            const targetIdx = (idx >= 0 && idx < this.player.prizes.length) ? idx : 0;
            const pObj = this.player.prizes.splice(targetIdx, 1)[0];
            const prizeCard = this.db.getCardById(cardId);
            if (prizeCard) pObj.card = prizeCard;
            this.player.hand.push(pObj);
            this.addLog('player', `Tomaste una carta de Premio. Premios restantes: ${prizesLeft}`);
          }
        } else {
          if (this.opponent.prizes.length > 0) {
            const targetIdx = (idx >= 0 && idx < this.opponent.prizes.length) ? idx : 0;
            this.opponent.prizes.splice(targetIdx, 1);
            this.opponent.hand.push({
              instanceId: `online-o-hand-${Date.now()}`,
              card: null,
              damage: 0,
              attachedEnergy: [],
              specialCondition: null,
              turnPlaced: 0
            });
            this.addLog('opponent', `${this.opponentName} tomó una carta de Premio. Premios restantes: ${prizesLeft}`);
          }
        }
        this.updateBoardUI();
        break;
      }

      case 'TURN_CHANGED': {
        const { turnOwnerId, turnNumber } = event;
        this.turnOwner = turnOwnerId === this.localPlayerId ? 'player' : 'opponent';
        this.turnNumber = turnNumber;

        this.addLog('system', `--- Turno ${turnNumber}: ${this.turnOwner === 'player' ? 'Tú' : this.opponentName} ---`);
        this.beginOnlineTurn();
        break;
      }

      case 'DRAW_CARD_RESOLVED': {
        const { playerId, cardId, instanceId } = event;
        const isLocal = playerId === this.localPlayerId;

        if (isLocal) {
          const drawnCard = this.db.getCardById(cardId);
          if (drawnCard) {
            if (this.player.deck.length > 0) {
              this.player.deck.pop();
            }
            this.player.hand.push({
              instanceId: instanceId || `online-p-hand-${Date.now()}-${Math.random()}`,
              card: drawnCard,
              damage: 0,
              attachedEnergy: [],
              specialCondition: null,
              turnPlaced: 0
            });
            this.playSound('draw');
            this.addLog('player', `Robaste una carta.`);
          }
        } else {
          if (this.opponent.deck.length > 0) {
            this.opponent.deck.pop();
          }
          this.opponent.hand.push({
            instanceId: instanceId || `online-o-hand-${Date.now()}`,
            card: null,
            damage: 0,
            attachedEnergy: [],
            specialCondition: null,
            turnPlaced: 0
          });
          this.addLog('opponent', `${this.opponentName} robó una carta.`);
        }
        this.updateBoardUI();
        break;
      }

      case 'POISON_DAMAGE': {
        const { playerId, damage } = event;
        const isLocal = playerId === this.localPlayerId;
        const target = isLocal ? this.player : this.opponent;
        if (target.active) {
          target.active.damage += damage;
          this.addLog(isLocal ? 'player' : 'opponent', `El veneno le causó ${damage} de daño a ${target.active.card.name}.`);
        }
        this.updateBoardUI();
        break;
      }

      case 'BURN_DAMAGE': {
        const { playerId, damage } = event;
        const isLocal = playerId === this.localPlayerId;
        const target = isLocal ? this.player : this.opponent;
        if (target.active) {
          target.active.damage += damage;
          this.addLog(isLocal ? 'player' : 'opponent', `La quemadura le causó ${damage} de daño a ${target.active.card.name}.`);
        }
        this.updateBoardUI();
        break;
      }

      case 'BURN_CURED': {
        const { playerId } = event;
        const isLocal = playerId === this.localPlayerId;
        const target = isLocal ? this.player : this.opponent;
        if (target.active) {
          target.active.specialCondition = null;
          this.addLog(isLocal ? 'player' : 'opponent', `${target.active.card.name} se curó de la quemadura.`);
        }
        this.updateBoardUI();
        break;
      }

      case 'SLEEP_CURED': {
        const { playerId } = event;
        const isLocal = playerId === this.localPlayerId;
        const target = isLocal ? this.player : this.opponent;
        if (target.active) {
          target.active.specialCondition = null;
          this.addLog(isLocal ? 'player' : 'opponent', `${target.active.card.name} se despertó.`);
        }
        this.updateBoardUI();
        break;
      }

      case 'PARALYSIS_CURED': {
        const { playerId } = event;
        const isLocal = playerId === this.localPlayerId;
        const target = isLocal ? this.player : this.opponent;
        if (target.active) {
          target.active.specialCondition = null;
          this.addLog(isLocal ? 'player' : 'opponent', `${target.active.card.name} se curó de la parálisis.`);
        }
        this.updateBoardUI();
        break;
      }

      case 'MUST_PROMOTE': {
        const { playerId } = event;
        const isLocal = playerId === this.localPlayerId;
        this.phase = isLocal ? 'must-promote' : 'opponent-must-promote';
        this.isRetreating = false;
        if (isLocal) {
          this.showWarning('Tu Pokémon activo fue debilitado. Elige un Pokémon de tu banca para promover.');
        }
        this.updateBoardUI();
        break;
      }

      case 'PROMOTE_BENCH_RESOLVED': {
        const { playerId, benchIndex } = event;
        const isLocal = playerId === this.localPlayerId;
        const target = isLocal ? this.player : this.opponent;

        const newActive = target.bench[benchIndex];
        const oldActive = target.active;

        if (oldActive) {
          target.active = newActive;
          target.bench[benchIndex] = oldActive;
        } else {
          target.active = newActive;
          target.bench[benchIndex] = null;
        }

        if (target.active) {
          target.active.specialCondition = null;
        }

        this.addLog(isLocal ? 'player' : 'opponent', `${isLocal ? 'Tú' : this.opponentName} promovió a ${newActive.card.name} al puesto Activo.`);
        this.phase = 'active';
        this.updateBoardUI();
        break;
      }

      case 'RETREAT_RESOLVED': {
        const { playerId, benchIndex, retreatCost } = event;
        const isLocal = playerId === this.localPlayerId;
        const target = isLocal ? this.player : this.opponent;

        const pkmn = target.active;
        if (pkmn) {
          for (let i = 0; i < retreatCost; i++) {
            const energy = pkmn.attachedEnergy.pop();
            if (energy) target.discard.push(energy);
          }
          const newActive = target.bench[benchIndex];
          target.active = newActive;
          target.bench[benchIndex] = pkmn;

          target.active.specialCondition = null;
          pkmn.specialCondition = null;

          this.addLog(isLocal ? 'player' : 'opponent', `${isLocal ? 'Retiraste' : `${this.opponentName} retiró`} a ${pkmn.card.name} descartando ${retreatCost} energías.`);
        }
        this.updateBoardUI();
        break;
      }

      case 'SETUP_COMPLETE': {
        const { turnOwnerId } = event;
        this.phase = 'active';
        this.turnOwner = turnOwnerId === this.localPlayerId ? 'player' : 'opponent';
        this.addLog('system', '--- ¡Comienza el combate principal! ---');
        this.addLog('system', `Es el turno de: ${this.turnOwner === 'player' ? 'Tú' : this.opponentName}`);

        const passBtn = document.getElementById('btn-pass-turn');
        if (passBtn) {
          passBtn.disabled = (this.turnOwner !== 'player');
        }
        this.updateBoardUI();
        break;
      }

      case 'GAME_OVER_RESOLVED': {
        const { winnerId, reason } = event;
        const isWin = winnerId === this.localPlayerId;
        this.endGameLocal(isWin ? 'player' : 'opponent', reason);
        break;
      }

      case 'MANUAL_DAMAGE_CHANGE_RESOLVED': {
        const { playerId, targetSide, targetZone, targetIndex, newDamage, amount } = event;
        const isLocalSender = playerId === this.localPlayerId;
        const relativeTargetSide = isLocalSender ? targetSide : (targetSide === 'player' ? 'opponent' : 'player');
        const target = relativeTargetSide === 'player' ? this.player : this.opponent;
        const pkmn = targetZone === 'active' ? target.active : target.bench[targetIndex];
        if (pkmn) {
          pkmn.damage = newDamage;
          const label = amount > 0 ? `recibió ${amount} de daño` : `curó ${Math.abs(amount)} de daño`;
          this.addLog('system', `${relativeTargetSide === 'player' ? 'Tu' : this.opponentName} ${pkmn.card.name} ${label}.`);
        }
        this.updateBoardUI();
        this.renderActionPanel();
        break;
      }

      case 'MANUAL_STATUS_CHANGE_RESOLVED': {
        const { playerId, targetSide, targetZone, targetIndex, condition } = event;
        const isLocalSender = playerId === this.localPlayerId;
        const relativeTargetSide = isLocalSender ? targetSide : (targetSide === 'player' ? 'opponent' : 'player');
        const target = relativeTargetSide === 'player' ? this.player : this.opponent;
        const pkmn = targetZone === 'active' ? target.active : target.bench[targetIndex];
        if (pkmn) {
          pkmn.specialCondition = condition;
          const condLabels = { poisoned: 'envenenado', asleep: 'dormido', paralyzed: 'paralizado', confused: 'confundido', burned: 'quemado' };
          const label = condition ? `ahora está ${condLabels[condition] || condition}` : 'está normal';
          this.addLog('system', `${relativeTargetSide === 'player' ? 'Tu' : this.opponentName} ${pkmn.card.name} ${label}.`);
        }
        this.updateBoardUI();
        this.renderActionPanel();
        break;
      }

      case 'MANUAL_CARD_MOVEMENT_RESOLVED': {
        const { playerId, cardId, instanceId, fromZone, fromIndex, targetSide, targetZone, targetIndex } = event;
        const isLocalSender = playerId === this.localPlayerId;
        const relativeSender = isLocalSender ? 'player' : 'opponent';
        const res = this.findAndRemoveCardLocal(instanceId, fromZone, relativeSender, cardId);

        let cardObj = null;
        if (res) {
          cardObj = res.cardObj;
          cardObj.instanceId = instanceId;
        } else {
          const originalCard = this.db.getCardById(cardId);
          cardObj = {
            instanceId,
            card: originalCard,
            damage: 0,
            attachedEnergy: [],
            specialCondition: null,
            turnPlaced: 0
          };
        }

        if (cardObj && !cardObj.card && cardId) {
          cardObj.card = this.db.getCardById(cardId);
        }

        const isLocalTargetSender = playerId === this.localPlayerId;
        const relativeTargetSide = isLocalTargetSender ? targetSide : (targetSide === 'player' ? 'opponent' : 'player');
        const targetState = relativeTargetSide === 'player' ? this.player : this.opponent;

        if (targetZone === 'active') {
          const oldActive = targetState.active;
          targetState.active = cardObj;
          if (oldActive) targetState.hand.push(oldActive);
          
          // Clear must-promote phase if we are promoting a Pokemon manually
          if (relativeTargetSide === 'player' && this.phase === 'must-promote') {
            this.phase = 'active';
          } else if (relativeTargetSide === 'opponent' && this.phase === 'opponent-must-promote') {
            this.phase = 'active';
          }
        } else if (targetZone === 'trainer') {
          if (relativeTargetSide === 'player') {
            this.playerActiveTrainer = cardObj;
          } else {
            this.opponentActiveTrainer = cardObj;
          }
        } else if (targetZone === 'bench') {
          const oldBench = targetState.bench[targetIndex];
          targetState.bench[targetIndex] = cardObj;
          if (oldBench) targetState.hand.push(oldBench);
        } else if (targetZone === 'hand') {
          targetState.hand.push(cardObj);
        } else if (targetZone === 'discard') {
          if (cardObj.attachedEnergy && cardObj.attachedEnergy.length > 0) {
            cardObj.attachedEnergy.forEach(e => targetState.discard.push(e));
            cardObj.attachedEnergy = [];
          }
          targetState.discard.push(cardObj.card || cardObj);
        } else if (targetZone === 'deck') {
          if (targetIndex === 'top') {
            targetState.deck.unshift(cardObj);
          } else {
            targetState.deck.push(cardObj);
          }
        } else if (targetZone === 'prizes') {
          targetState.prizes.push(cardObj);
        }

        const fromLabel = { hand: 'mano', active: 'puesto activo', bench: 'banca', discard: 'descarte', prizes: 'premios', deck: 'mazo', trainer: 'zona trainer' };
        const toLabel = { hand: 'mano', active: 'puesto activo', bench: 'banca', discard: 'descarte', prizes: 'premios', deck: 'mazo', trainer: 'zona trainer' };
        const cardName = cardObj.card ? cardObj.card.name : 'carta oculta';
        const senderName = isLocalSender ? 'Tú' : this.opponentName;

        this.addLog('system', `${senderName} movió ${cardName} desde ${fromLabel[fromZone] || fromZone} hacia ${toLabel[targetZone] || targetZone}.`);

        this.updateBoardUI();
        this.renderActionPanel();
        break;
      }

      case 'MANUAL_ATTACH_ENERGY_RESOLVED': {
        const { playerId, cardId, instanceId, targetSide, targetZone, targetIndex } = event;
        const isLocalSender = playerId === this.localPlayerId;
        const relativeTargetSide = isLocalSender ? targetSide : (targetSide === 'player' ? 'opponent' : 'player');

        const sender = isLocalSender ? this.player : this.opponent;
        const handIdx = sender.hand.findIndex(c => c.instanceId === instanceId);
        let energyCard = null;
        if (handIdx !== -1) {
          energyCard = sender.hand.splice(handIdx, 1)[0].card;
        } else {
          energyCard = this.db.getCardById(cardId);
          if (!isLocalSender && sender.hand.length > 0) {
            sender.hand.shift();
          }
        }

        const target = relativeTargetSide === 'player' ? this.player : this.opponent;
        const pkmn = targetZone === 'active' ? target.active : target.bench[targetIndex];
        if (pkmn && energyCard) {
          pkmn.attachedEnergy.push(energyCard);
          const name = isLocalSender ? 'Tú' : this.opponentName;
          this.addLog('system', `${name} unió ${energyCard.name} a ${pkmn.card.name}.`);
        }

        this.playSound('attach');
        this.updateBoardUI();
        this.renderActionPanel();
        break;
      }

      case 'MANUAL_DISCARD_ENERGY_RESOLVED': {
        const { playerId, targetSide, targetZone, targetIndex, energyCardId, destinationZone } = event;
        const isLocalSender = playerId === this.localPlayerId;
        const relativeTargetSide = isLocalSender ? targetSide : (targetSide === 'player' ? 'opponent' : 'player');

        const target = relativeTargetSide === 'player' ? this.player : this.opponent;
        const pkmn = targetZone === 'active' ? target.active : target.bench[targetIndex];
        if (pkmn) {
          const idx = pkmn.attachedEnergy.findIndex(e => e.id === energyCardId);
          if (idx !== -1) {
            const energyCard = pkmn.attachedEnergy.splice(idx, 1)[0];
            const name = isLocalSender ? 'Tú' : this.opponentName;

            if (destinationZone === 'hand') {
              const newInstanceId = `online-detached-${Date.now()}`;
              target.hand.push({
                instanceId: newInstanceId,
                card: energyCard,
                damage: 0,
                attachedEnergy: [],
                specialCondition: null,
                turnPlaced: 0
              });
              this.addLog('system', `${name} retiró ${energyCard.name} de ${pkmn.card.name} a su mano.`);
            } else {
              target.discard.push(energyCard);
              this.addLog('system', `${name} descartó ${energyCard.name} de ${pkmn.card.name}.`);
            }
          }
        }
        this.updateBoardUI();
        this.renderActionPanel();
        break;
      }

      case 'MANUAL_EVOLVE_RESOLVED': {
        const { playerId, cardId, instanceId, targetSide, targetZone, targetIndex, oldCardName } = event;
        const isLocalSender = playerId === this.localPlayerId;
        const relativeTargetSide = isLocalSender ? targetSide : (targetSide === 'player' ? 'opponent' : 'player');

        const sender = isLocalSender ? this.player : this.opponent;
        const handIdx = sender.hand.findIndex(c => c.instanceId === instanceId);
        let evolutionCard = null;
        if (handIdx !== -1) {
          evolutionCard = sender.hand.splice(handIdx, 1)[0].card;
        } else {
          evolutionCard = this.db.getCardById(cardId);
          if (!isLocalSender && sender.hand.length > 0) {
            sender.hand.shift();
          }
        }

        const target = relativeTargetSide === 'player' ? this.player : this.opponent;
        const pkmn = targetZone === 'active' ? target.active : target.bench[targetIndex];
        if (pkmn && evolutionCard) {
          pkmn.card = evolutionCard;
          pkmn.specialCondition = null;
          const name = isLocalSender ? 'Tú' : this.opponentName;
          this.addLog('system', `${name} evolucionó a ${oldCardName} en ${evolutionCard.name}.`);
        }

        this.playSound('attach');
        this.updateBoardUI();
        this.renderActionPanel();
        break;
      }

      case 'MANUAL_SHUFFLE_RESOLVED': {
        const { playerId } = event;
        const isLocal = playerId === this.localPlayerId;
        const name = isLocal ? 'Tú' : this.opponentName;
        this.addLog('system', `${name} barajó su mazo.`);
        this.playSound('shuffle');
        break;
      }

      case 'MANUAL_COIN_FLIP_RESOLVED': {
        const { playerId, isHeads } = event;
        const isLocal = playerId === this.localPlayerId;
        const name = isLocal ? 'Tú' : this.opponentName;

        this.addLog('system', `${name} lanzó una moneda...`);
        await this.flipBoardCoin(isHeads, isLocal ? 'player' : 'opponent');

        this.addLog('system', `Resultado del lanzamiento: ${isHeads ? '¡CARA!' : '¡CRUZ!'}`);
        break;
      }

      case 'MANUAL_EXAMINE_DECK_RESOLVED': {
        const { playerId } = event;
        const isLocal = playerId === this.localPlayerId;
        const name = isLocal ? 'Tú' : this.opponentName;
        this.addLog('system', `${name} está examinando su mazo.`);
        break;
      }
    }
  }

  syncStateWithSnapshot(snapshot) {
    if (!snapshot || !snapshot.players) return;

    console.log('[OnlineDuel] Synchronizing local state with server snapshot:', snapshot);

    // Sync game phase and turn ownership
    if (snapshot.phase === 'active') {
      this.phase = 'active';
    } else if (snapshot.phase === 'setup') {
      this.phase = 'setup';
    } else if (snapshot.phase === 'game-over') {
      this.phase = 'game-over';
    } else if (snapshot.phase === 'must-promote-p1' || snapshot.phase === 'must-promote-p2') {
      const p1Id = Object.keys(snapshot.players)[0];
      const p2Id = Object.keys(snapshot.players)[1];
      const targetId = snapshot.phase === 'must-promote-p1' ? p1Id : p2Id;
      this.phase = (targetId === this.localPlayerId) ? 'must-promote' : 'opponent-must-promote';
    }

    this.turnNumber = snapshot.turnNumber;

    // Helper: Map card snapshot to card object
    const mapCardFromSnapshot = (cardSnap) => {
      if (!cardSnap) return null;
      const originalCard = this.db.getCardById(cardSnap.cardId);
      if (!originalCard) {
        console.warn(`Card ID not found in database for snapshot: ${cardSnap.cardId}`);
        return null;
      }
      return {
        instanceId: cardSnap.instanceId,
        card: originalCard,
        damage: cardSnap.damage || 0,
        specialCondition: cardSnap.specialCondition || null,
        attachedEnergy: (cardSnap.attachedEnergy || []).map(energyId => {
          return this.db.getCardById(energyId);
        }).filter(e => !!e),
        turnPlaced: 0
      };
    };

    // Sync each player
    for (const id in snapshot.players) {
      const isLocal = id === this.localPlayerId;
      const pSnap = snapshot.players[id];
      const targetState = isLocal ? this.player : this.opponent;

      if (!targetState) continue;

      // Sync active Pokémon
      targetState.active = mapCardFromSnapshot(pSnap.active);

      // Sync active Trainer card
      const activeTrainer = mapCardFromSnapshot(pSnap.activeTrainer);
      if (isLocal) {
        this.playerActiveTrainer = activeTrainer;
      } else {
        this.opponentActiveTrainer = activeTrainer;
      }

      // Sync bench Pokémon
      for (let i = 0; i < 5; i++) {
        targetState.bench[i] = pSnap.bench[i] ? mapCardFromSnapshot(pSnap.bench[i]) : null;
      }

      // Sync discard pile
      targetState.discard = (pSnap.discard || []).map(cardId => this.db.getCardById(cardId)).filter(c => !!c);

      // Sync sizes of deck, hand, and prizes
      if (isLocal) {
        if (pSnap.handSize !== targetState.hand.length) {
          console.warn(`Local hand size mismatch. Local: ${targetState.hand.length}, Server: ${pSnap.handSize}`);
        }
      } else {
        const handDiff = pSnap.handSize - targetState.hand.length;
        if (handDiff > 0) {
          for (let i = 0; i < handDiff; i++) {
            targetState.hand.push({ instanceId: `opponent-hand-dummy-${Date.now()}-${i}`, card: { name: 'Card', supertype: 'Unknown' } });
          }
        } else if (handDiff < 0) {
          targetState.hand.splice(pSnap.handSize);
        }
      }

      // Adjust prizes length
      const prizesDiff = pSnap.prizesSize - targetState.prizes.length;
      if (prizesDiff > 0) {
        for (let i = 0; i < prizesDiff; i++) {
          targetState.prizes.push({ instanceId: `opponent-prize-dummy-${Date.now()}-${i}`, card: { name: 'Prize', supertype: 'Unknown' } });
        }
      } else if (prizesDiff < 0) {
        targetState.prizes.splice(pSnap.prizesSize);
      }
      
      // Adjust deck length if needed
      if (pSnap.deckSize !== targetState.deck.length) {
        const deckDiff = pSnap.deckSize - targetState.deck.length;
        if (deckDiff > 0) {
          for (let i = 0; i < deckDiff; i++) {
            targetState.deck.push({ instanceId: `deck-dummy-${Date.now()}-${i}`, card: { name: 'Deck Card', supertype: 'Unknown' } });
          }
        } else if (deckDiff < 0) {
          targetState.deck.splice(pSnap.deckSize);
        }
      }
    }

    this.updateBoardUI();
    this.renderActionPanel();
  }
}

// Helpers for Session parsing
function SESSIONS_LOCAL_USER_ID() {
  const token = localStorage.getItem('pkmn_session_token');
  if (!token) return '';
  return window.CURRENT_USER_ID || '';
}
