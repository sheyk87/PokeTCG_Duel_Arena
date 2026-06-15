require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const { OAuth2Client } = require('google-auth-library');
const db = require('./server/db.js');
const cardLoader = require('./server/cardLoader');
const ServerGameState = require('./server/gameState');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.resolve(__dirname);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf'
};

// In-memory Session Store (token -> user details)
const SESSIONS = new Map();
const ACTIVE_ENTRENADORES = new Map();

// Google Client Config
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const oauthClient = GOOGLE_CLIENT_ID && GOOGLE_CLIENT_ID !== 'YOUR_GOOGLE_CLIENT_ID_PLACEHOLDER'
  ? new OAuth2Client(GOOGLE_CLIENT_ID)
  : null;

// Helper: Decode Google JWT (with/without signature validation depending on config)
async function getUserFromGoogleToken(token) {
  if (oauthClient) {
    try {
      const ticket = await oauthClient.verifyIdToken({
        idToken: token,
        audience: GOOGLE_CLIENT_ID
      });
      const payload = ticket.getPayload();
      return {
        id: payload.sub,
        email: payload.email,
        name: payload.name
      };
    } catch (e) {
      console.warn("Secure Google validation failed, falling back to decoding payload:", e.message);
    }
  }
  // Local development fallback
  try {
    const segments = token.split('.');
    if (segments.length === 3) {
      const payload = JSON.parse(Buffer.from(segments[1], 'base64').toString('utf8'));
      return {
        id: payload.sub || `google-${Date.now()}`,
        email: payload.email || 'user@example.com',
        name: payload.name || 'Entrenador Google'
      };
    }
  } catch (err) {
    console.error("JWT decoding failed:", err);
  }
  throw new Error("Invalid Google Token");
}

// Helper: Read request body
function getRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      resolve(body);
    });
    req.on('error', err => reject(err));
  });
}

// Helper: Send JSON response
function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// Main HTTP Server
const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Parse URL path
  let safePath = req.url.split('?')[0];
  try {
    safePath = decodeURIComponent(safePath);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad Request');
    return;
  }

  // Auth Middleware check
  const authHeader = req.headers['authorization'];
  let sessionToken = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    sessionToken = authHeader.split(' ')[1];
  }
  const currentUser = SESSIONS.get(sessionToken);
  if (currentUser) {
    ACTIVE_ENTRENADORES.set(currentUser.id, Date.now());
  }

  // 1. Google Auth API
  if (req.method === 'POST' && safePath === '/api/auth/google') {
    try {
      const body = await getRequestBody(req);
      const { credential } = JSON.parse(body);
      if (!credential) {
        return sendJSON(res, 400, { error: 'Missing credential token' });
      }

      const googleUser = await getUserFromGoogleToken(credential);
      const user = await db.registerOrLoginUser(googleUser.id, googleUser.email, googleUser.name);
      
      const token = `sess-${crypto.randomBytes(24).toString('hex')}`;
      SESSIONS.set(token, user);
      
      return sendJSON(res, 200, { token, user });
    } catch (err) {
      console.error(err);
      return sendJSON(res, 401, { error: 'Authentication failed' });
    }
  }

  // 2. Mock Auth API (for easy local testing)
  if (req.method === 'POST' && safePath === '/api/auth/mock') {
    try {
      const body = await getRequestBody(req);
      const { name } = JSON.parse(body);
      if (!name || name.trim() === '') {
        return sendJSON(res, 400, { error: 'Name is required' });
      }

      const id = `mock-${name.trim().toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      const email = `${id}@mockpkmn.com`;
      
      const user = await db.registerOrLoginUser(id, email, name.trim());
      
      const token = `sess-mock-${crypto.randomBytes(24).toString('hex')}`;
      SESSIONS.set(token, user);
      
      return sendJSON(res, 200, { token, user });
    } catch (err) {
      console.error(err);
      return sendJSON(res, 500, { error: 'Mock login failed' });
    }
  }

  // 3. Get Session details
  if (req.method === 'GET' && safePath === '/api/auth/session') {
    if (!currentUser) {
      return sendJSON(res, 401, { error: 'Unauthorized' });
    }
    // Refresh victorias from database
    const freshUser = await db.findUserById(currentUser.id);
    if (freshUser) SESSIONS.set(sessionToken, freshUser);
    return sendJSON(res, 200, { user: freshUser || currentUser });
  }

  // 3b. Get Auth Config (for Google Client ID)
  if (req.method === 'GET' && safePath === '/api/auth/config') {
    return sendJSON(res, 200, { googleClientId: GOOGLE_CLIENT_ID || '' });
  }

  // 4. Decks APIs
  if (safePath === '/api/decks') {
    if (!currentUser) return sendJSON(res, 401, { error: 'Unauthorized' });
    
    if (req.method === 'GET') {
      const decks = await db.getUserDecks(currentUser.id);
      return sendJSON(res, 200, decks);
    }
    return sendJSON(res, 405, { error: 'Method Not Allowed' });
  }

  if (safePath === '/api/decks/save' && req.method === 'POST') {
    if (!currentUser) return sendJSON(res, 401, { error: 'Unauthorized' });
    try {
      const body = await getRequestBody(req);
      const { id, name, cards, boxImage } = JSON.parse(body);
      if (!id || !name || !cards) {
        return sendJSON(res, 400, { error: 'Missing deck parameters' });
      }
      const saved = await db.saveUserDeck(id, currentUser.id, name, JSON.stringify(cards), boxImage);
      return sendJSON(res, 200, saved);
    } catch (err) {
      console.error(err);
      return sendJSON(res, 500, { error: 'Failed to save deck' });
    }
  }

  if (safePath === '/api/decks/delete' && req.method === 'POST') {
    if (!currentUser) return sendJSON(res, 401, { error: 'Unauthorized' });
    try {
      const body = await getRequestBody(req);
      const { id } = JSON.parse(body);
      if (!id) return sendJSON(res, 400, { error: 'Missing deck id' });
      await db.deleteUserDeck(id, currentUser.id);
      return sendJSON(res, 200, { success: true });
    } catch (err) {
      console.error(err);
      return sendJSON(res, 500, { error: 'Failed to delete deck' });
    }
  }

  // 5. Leaderboard API
  if (req.method === 'GET' && safePath === '/api/leaderboard') {
    try {
      const leaderboard = await db.getLeaderboard();
      let personal = null;
      if (currentUser) {
        personal = await db.getUserLeaderboardPosition(currentUser.id);
      }
      return sendJSON(res, 200, { leaderboard, personal });
    } catch (err) {
      console.error(err);
      return sendJSON(res, 500, { error: 'Failed to load leaderboard' });
    }
  }

  // 5b. Ranked Leaderboard API
  if (req.method === 'GET' && safePath === '/api/ranked/leaderboard') {
    try {
      const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const category = urlObj.searchParams.get('category') || 'all';
      const level = urlObj.searchParams.get('level') || 'all';
      
      const leaderboard = await db.getRankedLeaderboard(category, level);
      const summary = await db.getRankedStatsSummary();
      
      let personal = null;
      if (currentUser) {
        // Obtenemos todo el leaderboard para calcular la posición global
        const fullLeaderboard = await db.getRankedLeaderboard('all', 'all');
        const posIndex = fullLeaderboard.findIndex(p => p.id === currentUser.id);
        const userStats = await db.findUserById(currentUser.id);
        
        // Contamos las victorias ranked del usuario
        const rWins = await db.query(
          "SELECT COUNT(*) as count FROM battles WHERE user_id = ? AND result = 'won' AND is_ranked = 1",
          [currentUser.id]
        );
        
        personal = {
          position: posIndex !== -1 ? posIndex + 1 : 0,
          victories: rWins[0] ? rWins[0].count : 0,
          ranked_category: userStats ? userStats.ranked_category : 'Principiante',
          ranked_level: userStats ? userStats.ranked_level : 1
        };
      }
      
      return sendJSON(res, 200, { leaderboard, summary, personal });
    } catch (err) {
      console.error(err);
      return sendJSON(res, 500, { error: 'Failed to load ranked leaderboard' });
    }
  }

  // 5c. Ranked Stats API
  if (req.method === 'GET' && safePath === '/api/ranked/stats') {
    if (!currentUser) return sendJSON(res, 401, { error: 'Unauthorized' });
    try {
      const stats = await db.findUserById(currentUser.id);
      return sendJSON(res, 200, stats);
    } catch (err) {
      console.error(err);
      return sendJSON(res, 500, { error: 'Failed to load ranked stats' });
    }
  }

  // 6. History API
  if (req.method === 'GET' && safePath === '/api/history') {
    if (!currentUser) return sendJSON(res, 401, { error: 'Unauthorized' });
    try {
      const history = await db.getUserBattleHistory(currentUser.id);
      return sendJSON(res, 200, history);
    } catch (err) {
      console.error(err);
      return sendJSON(res, 500, { error: 'Failed to load history' });
    }
  }

  // 6b. Server Status API (no auth required)
  if (req.method === 'GET' && safePath === '/api/server-status') {
    const now = Date.now();
    for (const [userId, lastActive] of ACTIVE_ENTRENADORES.entries()) {
      if (now - lastActive > 45000) {
        ACTIVE_ENTRENADORES.delete(userId);
      }
    }
    return sendJSON(res, 200, {
      onlinePlayers: ACTIVE_ENTRENADORES.size,
      inQueue: QUEUE.length,
      inRankedQueue: RANKED_QUEUE.length
    });
  }

  // 6c. Recent Battles API (no auth required)
  if (req.method === 'GET' && safePath === '/api/recent-battles') {
    try {
      const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const type = urlObj.searchParams.get('type') || 'normal';
      const isRankedVal = type === 'ranked' ? 1 : 0;
      
      const rows = await db.query(`
        SELECT u.name as winner_name, b.opponent_name as loser_name, b.created_at,
          b.is_ranked, b.user_category as winner_category, b.user_level as winner_level,
          b.opponent_category as loser_category, b.opponent_level as loser_level
        FROM battles b 
        JOIN users u ON b.user_id = u.id 
        WHERE b.result = 'won' AND b.is_ranked = ?
        ORDER BY b.created_at DESC 
        LIMIT 5
      `, [isRankedVal]);
      return sendJSON(res, 200, rows);
    } catch (err) {
      console.error(err);
      return sendJSON(res, 500, { error: 'Failed to load recent battles' });
    }
  }

  // PRESERVED ORIGINAL: Handle POST save-positions
  if (req.method === 'POST' && safePath === '/api/save-positions') {
    try {
      const body = await getRequestBody(req);
      const payload = JSON.parse(body);
      const { theme, positions } = payload;
      
      if (!theme || !positions) {
        return sendJSON(res, 400, { error: 'Missing theme or positions data' });
      }

      const jsonPath = path.join(PUBLIC_DIR, 'cards', 'Battlefields', 'positions.json');
      
      fs.readFile(jsonPath, 'utf8', (err, data) => {
        let current = {};
        if (!err && data) {
          try {
            current = JSON.parse(data);
          } catch (parseErr) {
            current = {};
          }
        }
        
        current[theme] = positions;
        
        fs.writeFile(jsonPath, JSON.stringify(current, null, 2), 'utf8', writeErr => {
          if (writeErr) {
            return sendJSON(res, 500, { error: 'Failed to write positions to disk' });
          }
          return sendJSON(res, 200, { success: true });
        });
      });
    } catch (parseErr) {
      return sendJSON(res, 400, { error: 'Invalid JSON body' });
    }
    return;
  }

  // PRESERVED ORIGINAL: Handle GET api/battlefields
  if (req.method === 'GET' && safePath === '/api/battlefields') {
    const battlefieldsDir = path.join(PUBLIC_DIR, 'cards', 'Battlefields');
    fs.readdir(battlefieldsDir, (err, files) => {
      if (err) {
        return sendJSON(res, 500, { error: 'Failed to read battlefields directory' });
      }
      const images = files.filter(f => {
        const ext = path.extname(f).toLowerCase();
        return ['.jpg', '.jpeg', '.png', '.webp', '.avif'].includes(ext);
      });
      return sendJSON(res, 200, images);
    });
    return;
  }

  // Static files handling
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
    return;
  }

  if (safePath === '/') {
    safePath = '/index.html';
  }

  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });

    const stream = fs.createReadStream(filePath);
    stream.on('error', (streamErr) => {
      console.error(streamErr);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
    });
    stream.pipe(res);
  });
});

// ==============================================================================
// WEBSOCKET SERVER & MATCHMAKING SYSTEM
// ==============================================================================
const wss = new WebSocket.Server({ noServer: true });

const QUEUE = []; // Array of { user, deckId, ws }
const RANKED_QUEUE = []; // Array of { user, deckId, ws, category }
const MATCHES = new Map(); // matchId -> Match details
const PRIVATE_ROOMS = new Map(); // roomId -> { roomId, creator, password, createdBy }

function broadcastQueueCount() {
  const count = QUEUE.length;
  QUEUE.forEach(player => {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(JSON.stringify({
        type: 'QUEUE_STATUS',
        payload: { onlineCount: count }
      }));
    }
  });
}

function broadcastRankedQueueCount() {
  const count = RANKED_QUEUE.length;
  RANKED_QUEUE.forEach(player => {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(JSON.stringify({
        type: 'RANKED_QUEUE_STATUS',
        payload: { onlineCount: count }
      }));
    }
  });
}

function expandAndShuffleDeck(deckTemplate) {
  const flatDeck = [];
  for (const item of deckTemplate) {
    const count = item.count || 1;
    for (let i = 0; i < count; i++) {
      flatDeck.push({ cardId: item.cardId });
    }
  }
  // Fisher-Yates shuffle
  for (let i = flatDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [flatDeck[i], flatDeck[j]] = [flatDeck[j], flatDeck[i]];
  }
  return flatDeck;
}

async function tryMatchmaking() {
  if (QUEUE.length < 2) return;

  let p1Idx = 0;
  let p2Idx = -1;

  for (let i = 1; i < QUEUE.length; i++) {
    if (QUEUE[i].user.id !== QUEUE[p1Idx].user.id) {
      p2Idx = i;
      break;
    }
  }

  if (p2Idx === -1) return;

  const p2 = QUEUE.splice(p2Idx, 1)[0];
  const p1 = QUEUE.splice(p1Idx, 1)[0];
  
  broadcastQueueCount();

  const matchId = `match-${crypto.randomBytes(8).toString('hex')}`;
  
  try {
    // Load decks from DB
    const [d1, d2] = await Promise.all([
      db.query('SELECT cards FROM decks WHERE id = ?', [p1.deckId]),
      db.query('SELECT cards FROM decks WHERE id = ?', [p2.deckId])
    ]);

    const deck1 = d1[0] ? (typeof d1[0].cards === 'string' ? JSON.parse(d1[0].cards) : d1[0].cards) : [];
    const deck2 = d2[0] ? (typeof d2[0].cards === 'string' ? JSON.parse(d2[0].cards) : d2[0].cards) : [];

    const shuffledDeck1 = expandAndShuffleDeck(deck1);
    const shuffledDeck2 = expandAndShuffleDeck(deck2);

    // Coin toss to see who goes first
    const goesFirstId = Math.random() < 0.5 ? p1.user.id : p2.user.id;

    const gameState = new ServerGameState(matchId, p1.user.id, p1.user.name, shuffledDeck1, p2.user.id, p2.user.name, shuffledDeck2, goesFirstId);

    const match = {
      id: matchId,
      player1: { user: p1.user, ws: p1.ws, deck: deck1 },
      player2: { user: p2.user, ws: p2.ws, deck: deck2 },
      goesFirstId,
      startTime: Date.now(),
      gameState
    };

    MATCHES.set(matchId, match);

    p1.ws.currentMatchId = matchId;
    p2.ws.currentMatchId = matchId;

    // Send MATCH_START to both
    p1.ws.send(JSON.stringify({
      type: 'MATCH_START',
      payload: {
        matchId,
        opponentName: p2.user.name,
        p1Id: gameState.p1Id,
        p2Id: gameState.p2Id,
        goesFirst: goesFirstId === p1.user.id,
        hand: gameState.players[p1.user.id].hand.map(c => ({ cardId: c.card.cardId || c.card.id, instanceId: c.instanceId })),
        prizes: gameState.players[p1.user.id].prizes.map(c => ({ cardId: c.card.cardId || c.card.id, instanceId: c.instanceId })),
        deck: gameState.players[p1.user.id].deck.map(c => ({ cardId: c.card.cardId || c.card.id, instanceId: c.instanceId })),
        opponentHandSize: gameState.players[p2.user.id].hand.length,
        opponentPrizesSize: gameState.players[p2.user.id].prizes.length,
        opponentDeckSize: gameState.players[p2.user.id].deck.length
      }
    }));

    p2.ws.send(JSON.stringify({
      type: 'MATCH_START',
      payload: {
        matchId,
        opponentName: p1.user.name,
        p1Id: gameState.p1Id,
        p2Id: gameState.p2Id,
        goesFirst: goesFirstId === p2.user.id,
        hand: gameState.players[p2.user.id].hand.map(c => ({ cardId: c.card.cardId || c.card.id, instanceId: c.instanceId })),
        prizes: gameState.players[p2.user.id].prizes.map(c => ({ cardId: c.card.cardId || c.card.id, instanceId: c.instanceId })),
        deck: gameState.players[p2.user.id].deck.map(c => ({ cardId: c.card.cardId || c.card.id, instanceId: c.instanceId })),
        opponentHandSize: gameState.players[p1.user.id].hand.length,
        opponentPrizesSize: gameState.players[p1.user.id].prizes.length,
        opponentDeckSize: gameState.players[p1.user.id].deck.length
      }
    }));

    console.log(`Matched game: ${p1.user.name} vs ${p2.user.name}`);
  } catch (err) {
    console.error('Failed to start match:', err);
    p1.ws.send(JSON.stringify({ type: 'MATCH_ERROR', payload: { message: 'Error al iniciar la partida.' } }));
    p2.ws.send(JSON.stringify({ type: 'MATCH_ERROR', payload: { message: 'Error al iniciar la partida.' } }));
  }
}

async function tryRankedMatchmaking() {
  if (RANKED_QUEUE.length < 2) return;

  for (let i = 0; i < RANKED_QUEUE.length; i++) {
    const p1 = RANKED_QUEUE[i];
    
    const p2Idx = RANKED_QUEUE.findIndex((p, idx) => 
      idx !== i && 
      p.user.id !== p1.user.id && 
      p.category === p1.category
    );

    if (p2Idx !== -1) {
      const p2 = RANKED_QUEUE.splice(p2Idx, 1)[0];
      const p1Idx = RANKED_QUEUE.findIndex(p => p.user.id === p1.user.id);
      RANKED_QUEUE.splice(p1Idx, 1);

      broadcastRankedQueueCount();

      const matchId = `match-${crypto.randomBytes(8).toString('hex')}`;

      try {
        const [d1, d2] = await Promise.all([
          db.query('SELECT cards FROM decks WHERE id = ?', [p1.deckId]),
          db.query('SELECT cards FROM decks WHERE id = ?', [p2.deckId])
        ]);

        const deck1 = d1[0] ? (typeof d1[0].cards === 'string' ? JSON.parse(d1[0].cards) : d1[0].cards) : [];
        const deck2 = d2[0] ? (typeof d2[0].cards === 'string' ? JSON.parse(d2[0].cards) : d2[0].cards) : [];

        const shuffledDeck1 = expandAndShuffleDeck(deck1);
        const shuffledDeck2 = expandAndShuffleDeck(deck2);

        const goesFirstId = Math.random() < 0.5 ? p1.user.id : p2.user.id;

        const gameState = new ServerGameState(matchId, p1.user.id, p1.user.name, shuffledDeck1, p2.user.id, p2.user.name, shuffledDeck2, goesFirstId);

        const match = {
          id: matchId,
          player1: { user: p1.user, ws: p1.ws, deck: deck1 },
          player2: { user: p2.user, ws: p2.ws, deck: deck2 },
          goesFirstId,
          startTime: Date.now(),
          gameState,
          isRanked: true
        };

        MATCHES.set(matchId, match);

        p1.ws.currentMatchId = matchId;
        p2.ws.currentMatchId = matchId;

        const [user1Data, user2Data] = await Promise.all([
          db.findUserById(p1.user.id),
          db.findUserById(p2.user.id)
        ]);

        p1.ws.send(JSON.stringify({
          type: 'MATCH_START',
          payload: {
            matchId,
            opponentName: p2.user.name,
            p1Id: gameState.p1Id,
            p2Id: gameState.p2Id,
            goesFirst: goesFirstId === p1.user.id,
            isRanked: true,
            opponentRankedCategory: user2Data ? user2Data.ranked_category : 'Principiante',
            opponentRankedLevel: user2Data ? user2Data.ranked_level : 1,
            opponentConsecutiveWins: user2Data ? user2Data.consecutive_wins : 0,
            hand: gameState.players[p1.user.id].hand.map(c => ({ cardId: c.card.cardId || c.card.id, instanceId: c.instanceId })),
            prizes: gameState.players[p1.user.id].prizes.map(c => ({ cardId: c.card.cardId || c.card.id, instanceId: c.instanceId })),
            deck: gameState.players[p1.user.id].deck.map(c => ({ cardId: c.card.cardId || c.card.id, instanceId: c.instanceId })),
            opponentHandSize: gameState.players[p2.user.id].hand.length,
            opponentPrizesSize: gameState.players[p2.user.id].prizes.length,
            opponentDeckSize: gameState.players[p2.user.id].deck.length
          }
        }));

        p2.ws.send(JSON.stringify({
          type: 'MATCH_START',
          payload: {
            matchId,
            opponentName: p1.user.name,
            p1Id: gameState.p1Id,
            p2Id: gameState.p2Id,
            goesFirst: goesFirstId === p2.user.id,
            isRanked: true,
            opponentRankedCategory: user1Data ? user1Data.ranked_category : 'Principiante',
            opponentRankedLevel: user1Data ? user1Data.ranked_level : 1,
            opponentConsecutiveWins: user1Data ? user1Data.consecutive_wins : 0,
            hand: gameState.players[p2.user.id].hand.map(c => ({ cardId: c.card.cardId || c.card.id, instanceId: c.instanceId })),
            prizes: gameState.players[p2.user.id].prizes.map(c => ({ cardId: c.card.cardId || c.card.id, instanceId: c.instanceId })),
            deck: gameState.players[p2.user.id].deck.map(c => ({ cardId: c.card.cardId || c.card.id, instanceId: c.instanceId })),
            opponentHandSize: gameState.players[p1.user.id].hand.length,
            opponentPrizesSize: gameState.players[p1.user.id].prizes.length,
            opponentDeckSize: gameState.players[p1.user.id].deck.length
          }
        }));

        console.log(`Matched ranked game: ${p1.user.name} vs ${p2.user.name} (${p1.category})`);
        return;
      } catch (err) {
        console.error('Failed to start ranked match:', err);
        p1.ws.send(JSON.stringify({ type: 'MATCH_ERROR', payload: { message: 'Error al iniciar la partida competitiva.' } }));
        p2.ws.send(JSON.stringify({ type: 'MATCH_ERROR', payload: { message: 'Error al iniciar la partida competitiva.' } }));
      }
    }
  }
}

async function resolveMatchEnd(matchId, winnerId, reason, duration) {
  const match = MATCHES.get(matchId);
  if (!match) return;

  const p1 = match.player1;
  const p2 = match.player2;

  // Sync cleanup to prevent re-entry / double resolution
  MATCHES.delete(matchId);
  if (p1.ws) p1.ws.currentMatchId = null;
  if (p2.ws) p2.ws.currentMatchId = null;

  const p1Result = p1.user.id === winnerId ? 'won' : 'lost';
  const p2Result = p2.user.id === winnerId ? 'won' : 'lost';

  let p1RankedData = null;
  let p2RankedData = null;

  if (match.isRanked) {
    try {
      const [u1Data, u2Data] = await Promise.all([
        db.findUserById(p1.user.id),
        db.findUserById(p2.user.id)
      ]);

      await Promise.all([
        db.recordBattle(
          p1.user.id, p2.user.name, p1Result, duration, true,
          u1Data ? u1Data.ranked_category : 'Principiante', u1Data ? u1Data.ranked_level : 1,
          p2.user.id, u2Data ? u2Data.ranked_category : 'Principiante', u2Data ? u2Data.ranked_level : 1
        ),
        db.recordBattle(
          p2.user.id, p1.user.name, p2Result, duration, true,
          u2Data ? u2Data.ranked_category : 'Principiante', u2Data ? u2Data.ranked_level : 1,
          p1.user.id, u1Data ? u1Data.ranked_category : 'Principiante', u1Data ? u1Data.ranked_level : 1
        )
      ]);

      const [newP1Rank, newP2Rank] = await Promise.all([
        db.updateRankedStats(p1.user.id, p1Result),
        db.updateRankedStats(p2.user.id, p2Result)
      ]);

      p1RankedData = newP1Rank;
      p2RankedData = newP2Rank;
    } catch (err) {
      console.error('Failed to process ranked stats at match end:', err);
    }
  } else if (!match.isPrivate) {
    try {
      await Promise.all([
        db.recordBattle(p1.user.id, p2.user.name, p1Result, duration),
        db.recordBattle(p2.user.id, p1.user.name, p2Result, duration)
      ]);
    } catch (err) {
      console.error('Failed to record battle in database:', err);
    }
  }

  const overMsg = (winnerId, newRankData) => JSON.stringify({
    type: 'MATCH_OVER',
    payload: { 
      winnerId, 
      reason,
      isRanked: !!match.isRanked,
      rankedStats: newRankData ? {
        category: newRankData.ranked_category,
        level: newRankData.ranked_level,
        consecutiveWins: newRankData.consecutive_wins,
        consecutiveLosses: newRankData.consecutive_losses,
        masterRankedWins: newRankData.master_ranked_wins
      } : null
    }
  });

  if (p1.ws.readyState === WebSocket.OPEN) p1.ws.send(overMsg(winnerId, p1RankedData));
  if (p2.ws.readyState === WebSocket.OPEN) p2.ws.send(overMsg(winnerId, p2RankedData));

  console.log(`Match ${matchId} ended. Winner: ${winnerId === p1.user.id ? p1.user.name : p2.user.name}`);
}

wss.on('connection', (ws, request, session) => {
  console.log(`WS Connection established with ${session.name} (${session.id})`);
  ACTIVE_ENTRENADORES.set(session.id, Date.now());

  ws.on('message', (messageStr) => {
    ACTIVE_ENTRENADORES.set(session.id, Date.now());
    try {
      const msg = JSON.parse(messageStr);
      const { type, payload } = msg;

      if (type === 'JOIN_QUEUE') {
        const { deckId } = payload;
        // Verify deck belongs to user
        db.query('SELECT id FROM decks WHERE id = ? AND user_id = ?', [deckId, session.id])
          .then(rows => {
            if (rows.length === 0) {
              return ws.send(JSON.stringify({ type: 'MATCH_ERROR', payload: { message: 'Mazo inválido o inexistente.' } }));
            }
            // Add to queue
            const existingIdx = QUEUE.findIndex(q => q.user.id === session.id);
            if (existingIdx !== -1) {
              QUEUE[existingIdx] = { user: session, deckId, ws };
            } else {
              QUEUE.push({ user: session, deckId, ws });
            }
            broadcastQueueCount();
            tryMatchmaking();
          });
      }

      else if (type === 'JOIN_RANKED_QUEUE') {
        const { deckId } = payload;
        db.query('SELECT id FROM decks WHERE id = ? AND user_id = ?', [deckId, session.id])
          .then(rows => {
            if (rows.length === 0) {
              return ws.send(JSON.stringify({ type: 'MATCH_ERROR', payload: { message: 'Mazo inválido o inexistente.' } }));
            }
            return db.findUserById(session.id).then(user => {
              const category = user ? user.ranked_category : 'Principiante';
              
              const existingIdx = RANKED_QUEUE.findIndex(q => q.user.id === session.id);
              if (existingIdx !== -1) {
                RANKED_QUEUE[existingIdx] = { user: session, deckId, ws, category };
              } else {
                RANKED_QUEUE.push({ user: session, deckId, ws, category });
              }
              broadcastRankedQueueCount();
              tryRankedMatchmaking();
            });
          })
          .catch(err => {
            console.error('Error in JOIN_RANKED_QUEUE:', err);
            ws.send(JSON.stringify({ type: 'MATCH_ERROR', payload: { message: 'Error de base de datos en emparejamiento.' } }));
          });
      }

      else if (type === 'LEAVE_QUEUE') {
        const idx = QUEUE.findIndex(q => q.user.id === session.id);
        if (idx !== -1) QUEUE.splice(idx, 1);
        broadcastQueueCount();
      }

      else if (type === 'LEAVE_RANKED_QUEUE') {
        const idx = RANKED_QUEUE.findIndex(q => q.user.id === session.id);
        if (idx !== -1) RANKED_QUEUE.splice(idx, 1);
        broadcastRankedQueueCount();
      }

      else if (type === 'SEND_CHAT') {
        const matchId = ws.currentMatchId;
        if (matchId) {
          const match = MATCHES.get(matchId);
          if (match) {
            const { text } = payload;
            const chatMsg = JSON.stringify({
              type: 'CHAT_MESSAGE',
              payload: {
                senderId: session.id,
                senderName: session.name,
                text: text
              }
            });
            if (match.player1.ws.readyState === WebSocket.OPEN) match.player1.ws.send(chatMsg);
            if (match.player2.ws.readyState === WebSocket.OPEN) match.player2.ws.send(chatMsg);
          }
        }
      }

      else if (type === 'GAME_ACTION') {
        const matchId = ws.currentMatchId;
        if (matchId) {
          const match = MATCHES.get(matchId);
          if (match && match.gameState) {
            const result = match.gameState.processAction(session.id, payload);
            if (!result.valid) {
              ws.send(JSON.stringify({
                type: 'ACTION_REJECTED',
                payload: { reason: result.reason, action: payload }
              }));
            } else {
              // Send STATE_UPDATE to both players
              const updateMsg = JSON.stringify({
                type: 'STATE_UPDATE',
                payload: {
                  events: result.events,
                  stateSnapshot: match.gameState.getSnapshot()
                }
              });
              if (match.player1.ws.readyState === WebSocket.OPEN) match.player1.ws.send(updateMsg);
              if (match.player2.ws.readyState === WebSocket.OPEN) match.player2.ws.send(updateMsg);

              // Check if game is over
              if (match.gameState.phase === 'game-over') {
                const duration = Math.round((Date.now() - match.startTime) / 1000);
                resolveMatchEnd(matchId, match.gameState.winnerId, match.gameState.gameOverReason, duration);
              }
            }
          }
        }
      }

      else if (type === 'GAME_OVER') {
        // Ignored or handled via explicit SURRENDER action.
        // For backwards compatibility / fallback if a client sends direct forfeit:
        const matchId = ws.currentMatchId;
        if (matchId) {
          const match = MATCHES.get(matchId);
          if (match && match.gameState) {
            const result = match.gameState.processAction(session.id, { actionType: 'SURRENDER' });
            if (result.valid) {
              const updateMsg = JSON.stringify({
                type: 'STATE_UPDATE',
                payload: {
                  events: result.events,
                  stateSnapshot: match.gameState.getSnapshot()
                }
              });
              if (match.player1.ws.readyState === WebSocket.OPEN) match.player1.ws.send(updateMsg);
              if (match.player2.ws.readyState === WebSocket.OPEN) match.player2.ws.send(updateMsg);

              if (match.gameState.phase === 'game-over') {
                const duration = Math.round((Date.now() - match.startTime) / 1000);
                resolveMatchEnd(matchId, match.gameState.winnerId, match.gameState.gameOverReason, duration);
              }
            }
          }
        }
      }
      else if (type === 'CREATE_PRIVATE_ROOM') {
        const { deckId, password } = payload;
        db.query('SELECT id FROM decks WHERE id = ? AND user_id = ?', [deckId, session.id])
          .then(rows => {
            if (rows.length === 0) {
              return ws.send(JSON.stringify({ type: 'PRIVATE_ROOM_ERROR', payload: { message: 'Mazo inválido o inexistente.' } }));
            }
            
            let roomId;
            do {
              roomId = Math.floor(100000 + Math.random() * 900000).toString();
            } while (PRIVATE_ROOMS.has(roomId));
            
            PRIVATE_ROOMS.set(roomId, {
              roomId,
              creator: { user: session, deckId, ws },
              password: password || '',
              createdBy: session.id
            });
            
            ws.currentPrivateRoomId = roomId;
            console.log(`Private room created: ${roomId} by ${session.name}`);
            
            ws.send(JSON.stringify({
              type: 'PRIVATE_ROOM_CREATED',
              payload: { roomId }
            }));
          })
          .catch(err => {
            console.error(err);
            ws.send(JSON.stringify({ type: 'PRIVATE_ROOM_ERROR', payload: { message: 'Error interno de base de datos.' } }));
          });
      }

      else if (type === 'JOIN_PRIVATE_ROOM') {
        const { roomId, password, deckId } = payload;
        const room = PRIVATE_ROOMS.get(roomId);
        if (!room) {
          return ws.send(JSON.stringify({ type: 'PRIVATE_ROOM_ERROR', payload: { message: 'La sala privada no existe o ha sido cerrada.' } }));
        }

        if (room.creator.user.id === session.id) {
          return ws.send(JSON.stringify({ type: 'PRIVATE_ROOM_ERROR', payload: { message: 'No puedes unirte a tu propia sala.' } }));
        }

        if (room.password && room.password !== password) {
          return ws.send(JSON.stringify({ type: 'PRIVATE_ROOM_ERROR', payload: { message: 'Contraseña incorrecta.' } }));
        }

        db.query('SELECT id FROM decks WHERE id = ? AND user_id = ?', [deckId, session.id])
          .then(rows => {
            if (rows.length === 0) {
              return ws.send(JSON.stringify({ type: 'PRIVATE_ROOM_ERROR', payload: { message: 'Mazo inválido o inexistente.' } }));
            }

            PRIVATE_ROOMS.delete(roomId);
            room.creator.ws.currentPrivateRoomId = null;

            const matchId = `match-${crypto.randomBytes(8).toString('hex')}`;
            const p1 = room.creator;
            const p2 = { user: session, deckId, ws };

            return Promise.all([
              db.query('SELECT cards FROM decks WHERE id = ?', [p1.deckId]),
              db.query('SELECT cards FROM decks WHERE id = ?', [p2.deckId])
            ]).then(([d1, d2]) => {
              const deck1 = d1[0] ? (typeof d1[0].cards === 'string' ? JSON.parse(d1[0].cards) : d1[0].cards) : [];
              const deck2 = d2[0] ? (typeof d2[0].cards === 'string' ? JSON.parse(d2[0].cards) : d2[0].cards) : [];

              const shuffledDeck1 = expandAndShuffleDeck(deck1);
              const shuffledDeck2 = expandAndShuffleDeck(deck2);

              const goesFirstId = Math.random() < 0.5 ? p1.user.id : p2.user.id;
              const gameState = new ServerGameState(matchId, p1.user.id, p1.user.name, shuffledDeck1, p2.user.id, p2.user.name, shuffledDeck2, goesFirstId);

              const match = {
                id: matchId,
                player1: { user: p1.user, ws: p1.ws, deck: deck1 },
                player2: { user: p2.user, ws: p2.ws, deck: deck2 },
                goesFirstId,
                startTime: Date.now(),
                gameState,
                isPrivate: true
              };

              MATCHES.set(matchId, match);

              p1.ws.currentMatchId = matchId;
              p2.ws.currentMatchId = matchId;

              const startMsg = (player, opponent, goesFirst) => JSON.stringify({
                type: 'MATCH_START',
                payload: {
                  matchId,
                  opponentName: opponent.user.name,
                  p1Id: gameState.p1Id,
                  p2Id: gameState.p2Id,
                  goesFirst,
                  hand: gameState.players[player.user.id].hand.map(c => ({ cardId: c.card.cardId || c.card.id, instanceId: c.instanceId })),
                  prizes: gameState.players[player.user.id].prizes.map(c => ({ cardId: c.card.cardId || c.card.id, instanceId: c.instanceId })),
                  deck: gameState.players[player.user.id].deck.map(c => ({ cardId: c.card.cardId || c.card.id, instanceId: c.instanceId })),
                  opponentHandSize: gameState.players[opponent.user.id].hand.length,
                  opponentPrizesSize: gameState.players[opponent.user.id].prizes.length,
                  opponentDeckSize: gameState.players[opponent.user.id].deck.length
                }
              });

              p1.ws.send(startMsg(p1, p2, goesFirstId === p1.user.id));
              p2.ws.send(startMsg(p2, p1, goesFirstId === p2.user.id));

              console.log(`Matched private game: ${p1.user.name} vs ${p2.user.name}`);
            });
          })
          .catch(err => {
            console.error('Error starting private match:', err);
            ws.send(JSON.stringify({ type: 'PRIVATE_ROOM_ERROR', payload: { message: 'Error interno del servidor.' } }));
          });
      }

      else if (type === 'CANCEL_PRIVATE_ROOM') {
        const { roomId } = payload;
        const room = PRIVATE_ROOMS.get(roomId);
        if (room && room.creator.user.id === session.id) {
          PRIVATE_ROOMS.delete(roomId);
          ws.currentPrivateRoomId = null;
          console.log(`Private room ${roomId} cancelled by creator.`);
          ws.send(JSON.stringify({ type: 'PRIVATE_ROOM_CANCELLED' }));
        }
      }
    } catch (err) {
      console.error('WS parsing error:', err);
    }
  });

  ws.on('close', () => {
    console.log(`WS Connection closed for ${session.name}`);
    ACTIVE_ENTRENADORES.delete(session.id);

    // Cleanup private room if creator disconnected
    const prId = ws.currentPrivateRoomId;
    if (prId) {
      const room = PRIVATE_ROOMS.get(prId);
      if (room && room.creator.user.id === session.id) {
        PRIVATE_ROOMS.delete(prId);
        console.log(`Private room ${prId} cleaned up due to creator disconnect.`);
      }
    }

    const idx = QUEUE.findIndex(q => q.user.id === session.id);
    if (idx !== -1) {
      QUEUE.splice(idx, 1);
      broadcastQueueCount();
    }

    const rIdx = RANKED_QUEUE.findIndex(q => q.user.id === session.id);
    if (rIdx !== -1) {
      RANKED_QUEUE.splice(rIdx, 1);
      broadcastRankedQueueCount();
    }

    const matchId = ws.currentMatchId;
    if (matchId) {
      const match = MATCHES.get(matchId);
      if (match) {
        // Disconnect counts as forfeit
        const winner = match.player1.user.id === session.id ? match.player2 : match.player1;
        const duration = Math.round((Date.now() - match.startTime) / 1000);
        resolveMatchEnd(matchId, winner.user.id, 'Oponente desconectado.', duration);
      }
    }
  });
});

// Upgrade HTTP Server to handle WebSockets on '/ws'
server.on('upgrade', (request, socket, head) => {
  try {
    const urlObj = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const pathname = urlObj.pathname;

    if (pathname === '/ws') {
      const token = urlObj.searchParams.get('token');
      const session = SESSIONS.get(token);

      if (!session) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request, session);
      });
    } else {
      socket.destroy();
    }
  } catch (err) {
    console.error('Upgrade connection failed:', err);
    socket.destroy();
  }
});

// Initialize database and load cards then start server
Promise.all([db.initDB(), cardLoader.init()]).then(() => {
  server.listen(PORT, () => {
    console.log('Server is running at http://localhost:' + PORT);
  });
}).catch(err => {
  console.error('Failed to initialize database or card loader. Server cannot start.', err);
});
