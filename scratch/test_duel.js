const http = require('http');
const WebSocket = require('ws');

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

async function runTest() {
  console.log('--- 1. Autenticando Ash y Blue ---');
  const ashAuth = await postJSON('/api/auth/mock', { name: 'Ash' });
  const blueAuth = await postJSON('/api/auth/mock', { name: 'Blue' });

  console.log(`Ash ID: ${ashAuth.user.id}, Token: ${ashAuth.token.slice(0, 15)}...`);
  console.log(`Blue ID: ${blueAuth.user.id}, Token: ${blueAuth.token.slice(0, 15)}...`);

  const ashDecks = await getJSON('/api/decks', ashAuth.token);
  const blueDecks = await getJSON('/api/decks', blueAuth.token);

  const ashDeckId = ashDecks[0].id;
  const blueDeckId = blueDecks[0].id;

  console.log('--- 2. Conectando WebSockets ---');
  const ashWs = new WebSocket(`ws://localhost:3000/ws?token=${ashAuth.token}`);
  const blueWs = new WebSocket(`ws://localhost:3000/ws?token=${blueAuth.token}`);

  let ashHand = [];
  let blueHand = [];
  let currentTurnOwnerId = null;
  let currentPhase = 'setup';

  const handleMessage = (playerLabel, dataStr) => {
    const msg = JSON.parse(dataStr);
    const { type, payload } = msg;
    const evTypes = payload && payload.events ? payload.events.map(e => e.type).join(', ') : '';
    console.log(`[WS -> ${playerLabel}] Tipo: ${type} ${evTypes ? `[${evTypes}]` : ''}`);

    if (type === 'MATCH_START') {
      console.log(`>>> MATCH_START para ${playerLabel}! (Goes first: ${payload.goesFirst})`);
      if (playerLabel === 'Ash') ashHand = payload.hand;
      if (playerLabel === 'Blue') blueHand = payload.hand;
    }

    if (type === 'STATE_UPDATE') {
      const snap = payload.stateSnapshot;
      if (snap) {
        currentTurnOwnerId = snap.turnOwnerId;
        currentPhase = snap.phase;
        console.log(`   [Snapshot Server] Fase: ${snap.phase}, Turno de: ${snap.turnOwnerId === ashAuth.user.id ? 'Ash' : 'Blue'}, Turno Nº: ${snap.turnNumber}`);
      }

      (payload.events || []).forEach(ev => {
        if (ev.type === 'POISON_DAMAGE') {
          console.log(`   ⚡ [EFECTO] Daño de Veneno entre turnos a ${ev.playerId === ashAuth.user.id ? 'Ash' : 'Blue'}: ${ev.damage} HP`);
        }
        if (ev.type === 'KNOCKOUT') {
          console.log(`   ⚡ [EFECTO] ¡K.O. de Pokémon en zona ${ev.zone} para ${ev.playerId === ashAuth.user.id ? 'Ash' : 'Blue'}!`);
        }
        if (ev.type === 'MUST_PROMOTE') {
          console.log(`   ⚡ [FASE] MUST_PROMOTE para ${ev.playerId === ashAuth.user.id ? 'Ash' : 'Blue'}`);
        }
        if (ev.type === 'TURN_CHANGED') {
          console.log(`   ⚡ [TURNO] Cambió el turno a ${ev.turnOwnerId === ashAuth.user.id ? 'Ash' : 'Blue'}`);
        }
      });
    }

    if (type === 'MATCH_OVER') {
      console.log(`\n==================================================`);
      console.log(`RESULTADO DE LA PRUEBA: ¡MATCH_OVER Exitoso!`);
      console.log(`Ganador: ${payload.winnerId === ashAuth.user.id ? 'Ash' : 'Blue'}`);
      console.log(`Razón de finalización: ${payload.reason}`);
      console.log(`==================================================\n`);
      process.exit(0);
    }
  };

  ashWs.on('message', data => handleMessage('Ash', data));
  blueWs.on('message', data => handleMessage('Blue', data));

  await new Promise(r => setTimeout(r, 1000));
  console.log('--- 3. Uniendo a la cola ---');
  ashWs.send(JSON.stringify({ type: 'JOIN_QUEUE', payload: { deckId: ashDeckId } }));
  blueWs.send(JSON.stringify({ type: 'JOIN_QUEUE', payload: { deckId: blueDeckId } }));

  // Esperar 1.5s para colocar Pokémon Activo y Banca
  setTimeout(() => {
    console.log('\n--- 4. Colocando Pokémon Activos en Setup ---');
    if (ashHand.length > 0) ashWs.send(JSON.stringify({ type: 'GAME_ACTION', payload: { actionType: 'PLACE_ACTIVE', cardId: ashHand[0].cardId } }));
    if (blueHand.length > 0) blueWs.send(JSON.stringify({ type: 'GAME_ACTION', payload: { actionType: 'PLACE_ACTIVE', cardId: blueHand[0].cardId } }));
    if (ashHand.length > 1) ashWs.send(JSON.stringify({ type: 'GAME_ACTION', payload: { actionType: 'PLACE_BENCH', cardId: ashHand[1].cardId, index: 0 } }));
    if (blueHand.length > 1) blueWs.send(JSON.stringify({ type: 'GAME_ACTION', payload: { actionType: 'PLACE_BENCH', cardId: blueHand[1].cardId, index: 0 } }));
  }, 2000);

  // Esperar a la fase activa (3.5s) y simular veneno + daño pre-KO
  setTimeout(() => {
    console.log('\n--- 5. Simulo envenenar al activo y dejarlo a 10 HP de vida ---');
    const activeWs = currentTurnOwnerId === ashAuth.user.id ? ashWs : blueWs;
    const activeName = currentTurnOwnerId === ashAuth.user.id ? 'Ash' : 'Blue';
    console.log(`   Jugador activo atacando/aplicando veneno: ${activeName}`);

    activeWs.send(JSON.stringify({
      type: 'GAME_ACTION',
      payload: {
        actionType: 'MANUAL_STATUS_CHANGE',
        targetSide: 'player',
        targetZone: 'active',
        targetIndex: 0,
        condition: 'poisoned'
      }
    }));

    activeWs.send(JSON.stringify({
      type: 'GAME_ACTION',
      payload: {
        actionType: 'MANUAL_DAMAGE_CHANGE',
        targetSide: 'player',
        targetZone: 'active',
        targetIndex: 0,
        amount: 30 // Daño alto suficiente para que los 10 de veneno maten al Pokémon al finalizar turno
      }
    }));

    // Pasar turno para activar veneno entre turnos y provocar KO
    setTimeout(() => {
      console.log('\n--- 6. Pasando turno (MANUAL_PASS_TURN) -> Ejecuta veneno entre turnos y KO ---');
      activeWs.send(JSON.stringify({
        type: 'GAME_ACTION',
        payload: { actionType: 'MANUAL_PASS_TURN' }
      }));

      // Probar rendición universal en fase MUST_PROMOTE
      setTimeout(() => {
        console.log('\n--- 7. Probando Rendición Universal (SURRENDER) durante la fase de promoción / KO ---');
        activeWs.send(JSON.stringify({
          type: 'GAME_ACTION',
          payload: { actionType: 'SURRENDER' }
        }));
      }, 1500);

    }, 1500);

  }, 4000);
}

runTest().catch(err => {
  console.error('Error en el test:', err);
  process.exit(1);
});
