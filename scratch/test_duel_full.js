const http = require('http');
const WebSocket = require('ws');
const cardLoader = require('./server/cardLoader');

function postJSON(path, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function getJSON(path, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

const sleep = ms => new Promise(res => setTimeout(res, ms));

async function runFullDuelTest() {
  await cardLoader.init();

  console.log('===========================================================');
  console.log('  SIMULACIÓN COMPLETA Y PERFECTA DE DUELO ONLINE (Ash vs Blue)');
  console.log('===========================================================');

  const ashAuth = await postJSON('/api/auth/mock', { name: 'Ash' });
  const blueAuth = await postJSON('/api/auth/mock', { name: 'Blue' });

  const ashDecks = await getJSON('/api/decks', ashAuth.token);
  const blueDecks = await getJSON('/api/decks', blueAuth.token);

  const ashDeckId = ashDecks[0].id;
  const blueDeckId = blueDecks[0].id;

  console.log(`\n[AUTH] Ash ID: ${ashAuth.user.id} | Blue ID: ${blueAuth.user.id}`);

  const ashWs = new WebSocket(`ws://localhost:3000/ws?token=${ashAuth.token}`);
  const blueWs = new WebSocket(`ws://localhost:3000/ws?token=${blueAuth.token}`);

  let ashHand = [], ashPrizes = [];
  let blueHand = [], bluePrizes = [];
  let currentTurnOwnerId = null;

  const sendAction = (ws, action) => {
    ws.send(JSON.stringify({ type: 'GAME_ACTION', payload: action }));
  };

  const findBasicPokemon = (hand) => {
    return hand.find(entry => {
      const card = cardLoader.getCardById(entry.cardId);
      return card && card.supertype === 'Pokémon' && card.subtypes && card.subtypes.includes('Basic');
    });
  };

  const handleMessage = (playerLabel, dataStr) => {
    const msg = JSON.parse(dataStr);
    const { type, payload } = msg;

    if (type === 'MATCH_START') {
      console.log(`\n[MATCH_START -> ${playerLabel}] Recibidas cartas iniciales.`);
      if (playerLabel === 'Ash') {
        ashHand = payload.hand;
        ashPrizes = payload.prizes;
      } else {
        blueHand = payload.hand;
        bluePrizes = payload.prizes;
      }
    }

    if (type === 'STATE_UPDATE') {
      const snap = payload.stateSnapshot;
      if (snap) {
        currentTurnOwnerId = snap.turnOwnerId;
      }

      (payload.events || []).forEach(ev => {
        switch (ev.type) {
          case 'SETUP_COMPLETE':
            console.log('\n>>> [EVENTO] ¡SETUP_COMPLETE! Ambos colocaron activo. Comienza el combate principal.');
            break;
          case 'TURN_CHANGED':
            const ownerName = ev.turnOwnerId === ashAuth.user.id ? 'Ash' : 'Blue';
            console.log(`\n>>> [TURNO ${ev.turnNumber}] Le toca a: ${ownerName}`);
            break;
          case 'DRAW_CARD_RESOLVED':
            const drawer = ev.playerId === ashAuth.user.id ? 'Ash' : 'Blue';
            console.log(`   + [ROBO] ${drawer} robó una carta (Mazo restante: ${ev.deckSize})`);
            break;
          case 'MANUAL_DAMAGE_CHANGE_RESOLVED':
            const dmgUser = ev.playerId === ashAuth.user.id ? 'Ash' : 'Blue';
            console.log(`   + [DAÑO MANUAL] ${dmgUser} modificó daño en ${ev.targetSide} ${ev.targetZone}[${ev.targetIndex || 0}] -> Nuevo Daño: ${ev.newDamage}`);
            break;
          case 'MANUAL_STATUS_CHANGE_RESOLVED':
            const statusUser = ev.playerId === ashAuth.user.id ? 'Ash' : 'Blue';
            console.log(`   + [ESTADO MANUAL] ${statusUser} aplicó condición: ${ev.condition || 'Normal'}`);
            break;
          case 'MANUAL_ATTACH_ENERGY_RESOLVED':
            const enUser = ev.playerId === ashAuth.user.id ? 'Ash' : 'Blue';
            console.log(`   + [ENERGÍA MANUAL] ${enUser} unió energía a ${ev.targetSide} ${ev.targetZone}[${ev.targetIndex || 0}]`);
            break;
          case 'MANUAL_CARD_MOVEMENT_RESOLVED':
            const moveUser = ev.playerId === ashAuth.user.id ? 'Ash' : 'Blue';
            console.log(`   + [MOVIMIENTO] ${moveUser} movió carta desde ${ev.fromZone} hacia ${ev.targetSide} ${ev.targetZone}[${ev.targetIndex || 0}]`);
            break;
          case 'MANUAL_SHUFFLE_RESOLVED':
            console.log(`   + [BARAJADO MANUAL] Mazo barajado por ${ev.playerName}`);
            break;
          case 'MANUAL_FLIP_COIN_RESOLVED':
            console.log(`   + [MONEDA MANUAL] ${ev.playerName} lanzó moneda -> Resultado: ${ev.isHeads ? 'Cara (Heads)' : 'Cruz (Tails)'}`);
            break;
          case 'POISON_DAMAGE':
            const poisPlr = ev.playerId === ashAuth.user.id ? 'Ash' : 'Blue';
            console.log(`   + [VENENO ENTRE TURNOS] ${poisPlr} recibió ${ev.damage} de daño por veneno.`);
            break;
          case 'KNOCKOUT':
            const koPlr = ev.playerId === ashAuth.user.id ? 'Ash' : 'Blue';
            console.log(`   ⚡ [K.O. EN VIVO] ¡El Pokémon de ${koPlr} en zona ${ev.zone} ha sido DEBILITADO!`);
            break;
          case 'TAKE_PRIZE_RESOLVED':
            const prizePlr = ev.playerId === ashAuth.user.id ? 'Ash' : 'Blue';
            console.log(`   + [PREMIO] ${prizePlr} tomó carta de Premio. Premios restantes: ${ev.prizesLeft}`);
            break;
          case 'MUST_PROMOTE':
            const promPlr = ev.playerId === ashAuth.user.id ? 'Ash' : 'Blue';
            console.log(`   ⚡ [MUST_PROMOTE] ${promPlr} debe promover un Pokémon de banca al puesto activo.`);
            break;
          case 'GAME_OVER_RESOLVED':
            console.log(`   🏆 [GAME_OVER] Fin del combate. Ganador ID: ${ev.winnerId}`);
            break;
        }
      });
    }

    if (type === 'ACTION_REJECTED') {
      console.warn(`   ⚠️ [ACTION_REJECTED para ${playerLabel}]: ${payload.reason}`);
    }

    if (type === 'MATCH_OVER') {
      const winnerName = payload.winnerId === ashAuth.user.id ? 'Ash' : 'Blue';
      console.log(`\n===========================================================`);
      console.log(` RESULTADO FINAL DE LA PARTIDA: ¡Ganó ${winnerName}!`);
      console.log(` Razón de finalización: ${payload.reason}`);
      console.log(`===========================================================\n`);
      process.exit(0);
    }
  };

  ashWs.on('message', d => handleMessage('Ash', d));
  blueWs.on('message', d => handleMessage('Blue', d));

  await sleep(1000);
  console.log('\n[MATCHMAKING] Uniendo a la cola...');
  ashWs.send(JSON.stringify({ type: 'JOIN_QUEUE', payload: { deckId: ashDeckId } }));
  blueWs.send(JSON.stringify({ type: 'JOIN_QUEUE', payload: { deckId: blueDeckId } }));

  await sleep(2000);
  console.log('\n--- PASO 1: Selección de Pokémon Básicos y Setup ---');
  const ashBasic = findBasicPokemon(ashHand);
  const blueBasic = findBasicPokemon(blueHand);

  if (ashBasic) sendAction(ashWs, { actionType: 'PLACE_ACTIVE', cardId: ashBasic.cardId });
  if (blueBasic) sendAction(blueWs, { actionType: 'PLACE_ACTIVE', cardId: blueBasic.cardId });

  await sleep(1500);

  // Definir WS según el jugador que tiene el primer turno
  const p1Ws = currentTurnOwnerId === ashAuth.user.id ? ashWs : blueWs;
  const p2Ws = currentTurnOwnerId === ashAuth.user.id ? blueWs : ashWs;
  const p1Name = currentTurnOwnerId === ashAuth.user.id ? 'Ash' : 'Blue';
  const p2Name = currentTurnOwnerId === ashAuth.user.id ? 'Blue' : 'Ash';
  const p1Hand = currentTurnOwnerId === ashAuth.user.id ? ashHand : blueHand;

  console.log(`\n--- PASO 2: Acciones del Turno 1 (${p1Name}) ---`);

  // A. Robar de mazo
  console.log(`1. ${p1Name} roba 1 carta extra del mazo (MANUAL_DRAW)...`);
  sendAction(p1Ws, { actionType: 'MANUAL_DRAW', count: 1 });
  await sleep(600);

  // B. Barajar mazo
  console.log(`2. ${p1Name} baraja su mazo (MANUAL_SHUFFLE)...`);
  sendAction(p1Ws, { actionType: 'MANUAL_SHUFFLE' });
  await sleep(600);

  // C. Tirar moneda
  console.log(`3. ${p1Name} lanza una moneda (MANUAL_FLIP_COIN)...`);
  sendAction(p1Ws, { actionType: 'MANUAL_FLIP_COIN' });
  await sleep(600);

  // D. Aplicar daño y curar
  console.log(`4. ${p1Name} modifica contadores de daño (+40 HP y curar -20 HP)...`);
  sendAction(p1Ws, { actionType: 'MANUAL_DAMAGE_CHANGE', targetSide: 'player', targetZone: 'active', targetIndex: 0, amount: 40 });
  await sleep(600);
  sendAction(p1Ws, { actionType: 'MANUAL_DAMAGE_CHANGE', targetSide: 'player', targetZone: 'active', targetIndex: 0, amount: -20 });
  await sleep(600);

  // E. Aplicar condición especial y curar
  console.log(`5. ${p1Name} aplica y cura condición de Quemadura (MANUAL_STATUS_CHANGE)...`);
  sendAction(p1Ws, { actionType: 'MANUAL_STATUS_CHANGE', targetSide: 'player', targetZone: 'active', targetIndex: 0, condition: 'burned' });
  await sleep(600);
  sendAction(p1Ws, { actionType: 'MANUAL_STATUS_CHANGE', targetSide: 'player', targetZone: 'active', targetIndex: 0, condition: null });
  await sleep(600);

  // F. Modificar daño al Pokémon del rival
  console.log(`6. ${p1Name} daña al Pokémon activo del rival (${p2Name}) infligiendo 30 de daño...`);
  sendAction(p1Ws, { actionType: 'MANUAL_DAMAGE_CHANGE', targetSide: 'opponent', targetZone: 'active', targetIndex: 0, amount: 30 });
  await sleep(800);

  // G. Pasar turno a P2
  console.log(`7. ${p1Name} finaliza su turno (MANUAL_PASS_TURN)...`);
  sendAction(p1Ws, { actionType: 'MANUAL_PASS_TURN' });
  await sleep(1500);

  console.log(`\n--- PASO 3: Acciones del Turno 2 (${p2Name}) ---`);

  // A. P2 inflige daño alto al activo de P1
  console.log(`1. ${p2Name} inflige 100 de daño adicional al Pokémon Activo de ${p1Name}...`);
  sendAction(p2Ws, { actionType: 'MANUAL_DAMAGE_CHANGE', targetSide: 'opponent', targetZone: 'active', targetIndex: 0, amount: 100 });
  await sleep(1000);

  // B. Tomar carta de premio por K.O.
  console.log(`2. ${p2Name} toma 1 carta de Premio (MANUAL_TAKE_PRIZE)...`);
  sendAction(p2Ws, { actionType: 'MANUAL_TAKE_PRIZE', prizeIndex: 0 });
  await sleep(1000);

  // C. P2 pasa el turno
  console.log(`3. ${p2Name} finaliza su turno (MANUAL_PASS_TURN)...`);
  sendAction(p2Ws, { actionType: 'MANUAL_PASS_TURN' });
  await sleep(1500);

  console.log(`\n--- PASO 4: Cierre del Combate por Tomar los Premios Restantes ---`);
  console.log(`1. ${p1Name} toma sus cartas de premio restantes hasta ganar por condición autoritativa de victoria...`);

  for (let i = 0; i < 6; i++) {
    sendAction(p1Ws, { actionType: 'MANUAL_TAKE_PRIZE', prizeIndex: 0 });
    await sleep(400);
  }
}

runFullDuelTest().catch(err => {
  console.error('Error durante la simulación completa:', err);
  process.exit(1);
});
