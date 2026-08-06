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
  let currentUser = SESSIONS.get(sessionToken);
  if (currentUser) {
    try {
      const userDb = await db.findUserById(currentUser.id);
      if (userDb) {
        if (userDb.is_deleted) {
          SESSIONS.delete(sessionToken);
          currentUser = null;
          return sendJSON(res, 401, { error: 'Deleted', message: 'Esta cuenta ha sido eliminada del sistema.' });
        }
        
        if (userDb.ban_expires_at) {
          const expiresAt = new Date(userDb.ban_expires_at);
          if (expiresAt > new Date()) {
            SESSIONS.delete(sessionToken);
            currentUser = null;
            return sendJSON(res, 403, { 
              error: 'Banned', 
              reason: userDb.ban_reason || 'Sin motivo especificado.', 
              expires_at: userDb.ban_expires_at 
            });
          }
        }
        
        // Actualizar datos de sesión en memoria
        Object.assign(currentUser, userDb);
        ACTIVE_ENTRENADORES.set(currentUser.id, Date.now());
      } else {
        SESSIONS.delete(sessionToken);
        currentUser = null;
      }
    } catch (err) {
      console.error('Failed to validate session in auth middleware:', err);
    }
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
      const { id, name, cards, boxImage, coinFront, coinBack, cardBack } = JSON.parse(body);
      if (!id || !name || !cards) {
        return sendJSON(res, 400, { error: 'Missing deck parameters' });
      }

      // Validar si los cosméticos del mazo están desbloqueados
      const freshUser = await db.findUserById(currentUser.id);
      const normalVictories = freshUser ? freshUser.normal_victories : 0;

      // 1. Validar Box Image (Caja)
      if (boxImage) {
        const boxes = [
          'Decks/pokeball.png',
          'Decks/superball.png',
          'Decks/ultraball.png',
          'Decks/masterball.png',
          'Decks/amorball.png',
          'Decks/parkball.png'
        ];
        let normalizedBox = boxImage;
        if (!normalizedBox.startsWith('Decks/')) normalizedBox = 'Decks/' + normalizedBox;
        
        const boxIndex = boxes.indexOf(normalizedBox);
        if (boxIndex > 0 && normalVictories < boxIndex * 10) {
          return sendJSON(res, 403, { error: `Diseño de caja bloqueado. Requiere ${boxIndex * 10} victorias.` });
        }
      }

      // 2. Validar Coin Back (Moneda Back)
      if (coinBack) {
        const defaultCoinBack = 'coin-back.png';
        const coinsDir = path.join(PUBLIC_DIR, 'Assets', 'Coins');
        let files = [];
        try {
          files = fs.readdirSync(coinsDir);
        } catch (e) {
          console.error('Failed to read Coins dir', e);
        }
        
        const backCoinsList = files.filter(f => ['coin-back.png', 'coin-back2.png', 'coin-back3.png'].includes(f));
        const sortedBacks = [defaultCoinBack];
        backCoinsList.filter(x => x !== defaultCoinBack).sort().forEach(c => sortedBacks.push(c));

        const coinBackFile = coinBack.replace('Coins/', '');
        const backIndex = sortedBacks.indexOf(coinBackFile);
        if (backIndex > 0 && normalVictories < backIndex * 10) {
          return sendJSON(res, 403, { error: `Cara de moneda back bloqueada. Requiere ${backIndex * 10} victorias.` });
        }
      }

      // 3. Validar Card Back (Sleeve)
      if (cardBack) {
        const defaultSleeve = 'pokemon_card_backside.png';
        const sleevesDir = path.join(PUBLIC_DIR, 'Assets', 'Sleeves');
        let files = [];
        try {
          files = fs.readdirSync(sleevesDir);
        } catch (e) {
          console.error('Failed to read Sleeves dir', e);
        }
        
        const sleevesList = files.filter(f => {
          const ext = path.extname(f).toLowerCase();
          return ['.jpg', '.jpeg', '.png', '.webp', '.avif'].includes(ext);
        }).sort();

        const allSleeves = [defaultSleeve];
        sleevesList.forEach(s => allSleeves.push('Sleeves/' + s));

        const sleeveIndex = allSleeves.indexOf(cardBack);
        if (sleeveIndex > 0 && normalVictories < sleeveIndex * 3) {
          return sendJSON(res, 403, { error: `Funda (Sleeve) bloqueada. Requiere ${sleeveIndex * 3} victorias.` });
        }
      }

      // 4. Validar Coin Front (Moneda Front)
      if (coinFront) {
        const defaultCoinFront = 'Coins/show(62).png';
        const coinsDir = path.join(PUBLIC_DIR, 'Assets', 'Coins');
        const iconsDir = path.join(PUBLIC_DIR, 'Assets', 'Icons');
        
        let coinFiles = [];
        let iconFiles = [];
        try {
          coinFiles = fs.readdirSync(coinsDir);
          iconFiles = fs.readdirSync(iconsDir);
        } catch (e) {
          console.error('Failed to read Coins or Icons dir', e);
        }

        const coinFrontsList = coinFiles.filter(f => {
          const ext = path.extname(f).toLowerCase();
          return ['.jpg', '.jpeg', '.png', '.webp', '.avif'].includes(ext) && !['coin-back.png', 'coin-back2.png', 'coin-back3.png'].includes(f);
        });

        const iconFrontsList = iconFiles.filter(f => {
          const ext = path.extname(f).toLowerCase();
          return ['.jpg', '.jpeg', '.png', '.webp', '.avif'].includes(ext);
        });

        const defaultCoinFileName = 'show(62).png';
        const sortedCoins = coinFrontsList.filter(x => x !== defaultCoinFileName).sort();
        const sortedIcons = iconFrontsList.sort();

        const allCoins = [defaultCoinFront];
        sortedCoins.forEach(c => allCoins.push('Coins/' + c));
        sortedIcons.forEach(i => allCoins.push('Icons/' + i));

        const coinFrontIndex = allCoins.indexOf(coinFront);
        if (coinFrontIndex > 0 && normalVictories < coinFrontIndex * 3) {
          return sendJSON(res, 403, { error: `Cara de moneda front bloqueada. Requiere ${coinFrontIndex * 3} victorias.` });
        }
      }

      const saved = await db.saveUserDeck(id, currentUser.id, name, JSON.stringify(cards), boxImage, coinFront, coinBack, cardBack);
      return sendJSON(res, 200, saved);
    } catch (err) {
      console.error(err);
      return sendJSON(res, 500, { error: 'Failed to save deck' });
    }
  }

  if (safePath === '/api/user/update-avatar' && req.method === 'POST') {
    if (!currentUser) return sendJSON(res, 401, { error: 'Unauthorized' });
    try {
      const body = await getRequestBody(req);
      const { avatar } = JSON.parse(body);
      if (!avatar) return sendJSON(res, 400, { error: 'Missing avatar parameter' });

      // Validar si el avatar está desbloqueado
      const freshUser = await db.findUserById(currentUser.id);
      const normalVictories = freshUser ? freshUser.normal_victories : 0;

      const iconsDir = path.join(PUBLIC_DIR, 'Assets', 'Icons');
      const files = fs.readdirSync(iconsDir);
      const images = files.filter(f => {
        const ext = path.extname(f).toLowerCase();
        return ['.jpg', '.jpeg', '.png', '.webp', '.avif'].includes(ext);
      });

      const defaultAvatar = 'pikachu-.webp';
      const sortedIcons = images.filter(x => x !== defaultAvatar).sort();
      sortedIcons.unshift(defaultAvatar);

      const iconFileName = avatar.replace('Icons/', '');
      const iconIndex = sortedIcons.indexOf(iconFileName);

      if (iconIndex === -1) {
        return sendJSON(res, 400, { error: 'Invalid avatar icon name' });
      }

      if (iconIndex > 0 && normalVictories < iconIndex * 3) {
        return sendJSON(res, 403, { error: `Avatar is locked. Requires ${iconIndex * 3} wins, but you have ${normalVictories}.` });
      }

      await db.query('UPDATE users SET avatar = ? WHERE id = ?', [avatar, currentUser.id]);
      currentUser.avatar = avatar;
      return sendJSON(res, 200, { success: true, avatar });
    } catch (err) {
      console.error(err);
      return sendJSON(res, 500, { error: 'Failed to update avatar' });
    }
  }

  if (safePath === '/api/profile/icons' && req.method === 'GET') {
    const iconsDir = path.join(PUBLIC_DIR, 'Assets', 'Icons');
    fs.readdir(iconsDir, (err, files) => {
      if (err) return sendJSON(res, 500, { error: 'Failed to read icons directory' });
      const images = files.filter(f => {
        const ext = path.extname(f).toLowerCase();
        return ['.jpg', '.jpeg', '.png', '.webp', '.avif'].includes(ext);
      });
      return sendJSON(res, 200, images);
    });
    return;
  }

  if (safePath === '/api/coins' && req.method === 'GET') {
    const coinsDir = path.join(PUBLIC_DIR, 'Assets', 'Coins');
    fs.readdir(coinsDir, (err, files) => {
      if (err) return sendJSON(res, 500, { error: 'Failed to read coins directory' });
      const images = files.filter(f => {
        const ext = path.extname(f).toLowerCase();
        return ['.jpg', '.jpeg', '.png', '.webp', '.avif'].includes(ext);
      });
      return sendJSON(res, 200, images);
    });
    return;
  }

  if (safePath === '/api/sleeves' && req.method === 'GET') {
    const sleevesDir = path.join(PUBLIC_DIR, 'Assets', 'Sleeves');
    fs.readdir(sleevesDir, (err, files) => {
      if (err) return sendJSON(res, 500, { error: 'Failed to read sleeves directory' });
      const images = files.filter(f => {
        const ext = path.extname(f).toLowerCase();
        return ['.jpg', '.jpeg', '.png', '.webp', '.avif'].includes(ext);
      });
      return sendJSON(res, 200, images);
    });
    return;
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
  // 5d. User Profile API
  if (req.method === 'GET' && safePath === '/api/user/profile') {
    if (!currentUser) return sendJSON(res, 401, { error: 'Unauthorized' });
    try {
      const profile = await db.getUserProfileData(currentUser.id);
      return sendJSON(res, 200, profile);
    } catch (err) {
      console.error('Failed to load user profile:', err);
      return sendJSON(res, 500, { error: 'Failed to load profile' });
    }
  }

  // 5e. Update Profile API
  if (req.method === 'POST' && safePath === '/api/user/profile/update') {
    if (!currentUser) return sendJSON(res, 401, { error: 'Unauthorized' });
    try {
      const body = await getRequestBody(req);
      const data = JSON.parse(body);
      await db.updateUserProfile(currentUser.id, data);
      
      // Sincronizar el avatar en la sesión actual
      if (data.avatar) {
        currentUser.avatar = data.avatar;
      }
      return sendJSON(res, 200, { success: true });
    } catch (err) {
      console.error('Failed to update user profile:', err);
      return sendJSON(res, 500, { error: 'Failed to update profile' });
    }
  }

  // 5f. User Emblems API
  if (req.method === 'GET' && safePath === '/api/user/emblems') {
    if (!currentUser) return sendJSON(res, 401, { error: 'Unauthorized' });
    try {
      const userDbEmblems = await db.getUserEmblems(currentUser.id);
      const userEmblemsMap = {};
      userDbEmblems.forEach(e => {
        userEmblemsMap[e.emblem_id] = e;
      });

      const emblemEvaluator = require('./server/emblemEvaluator');
      
      const fullEmblemsList = emblemEvaluator.EMBLEMS_CONFIG.map(config => {
        const dbRecord = userEmblemsMap[config.id];
        return {
          emblem_id: config.id,
          category: config.category,
          description: config.description,
          target_value: config.target,
          image_file: emblemEvaluator.EMBLEM_IMAGES[config.id],
          progress: dbRecord ? dbRecord.progress : 0,
          unlocked_at: dbRecord ? dbRecord.unlocked_at : null
        };
      });

      return sendJSON(res, 200, fullEmblemsList);
    } catch (err) {
      console.error('Failed to load user emblems:', err);
      return sendJSON(res, 500, { error: 'Failed to load emblems' });
    }
  }

  // 5g. User Public Profile API
  if (req.method === 'GET' && safePath === '/api/user/public-profile') {
    if (!currentUser) return sendJSON(res, 401, { error: 'Unauthorized' });
    try {
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
      const targetId = parsedUrl.searchParams.get('id');
      if (!targetId) {
        return sendJSON(res, 400, { error: 'Missing user ID' });
      }

      const profile = await db.getUserProfileData(targetId);
      if (!profile) {
        return sendJSON(res, 404, { error: 'User not found' });
      }

      // Obtener el progreso de emblemas del usuario
      const userDbEmblems = await db.getUserEmblems(targetId);
      const userEmblemsMap = {};
      userDbEmblems.forEach(e => {
        userEmblemsMap[e.emblem_id] = e;
      });

      const emblemEvaluator = require('./server/emblemEvaluator');
      const fullEmblemsList = emblemEvaluator.EMBLEMS_CONFIG.map(config => {
        const dbRecord = userEmblemsMap[config.id];
        return {
          emblem_id: config.id,
          category: config.category,
          description: config.description,
          target_value: config.target,
          image_file: emblemEvaluator.EMBLEM_IMAGES[config.id],
          progress: dbRecord ? dbRecord.progress : 0,
          unlocked_at: dbRecord ? dbRecord.unlocked_at : null
        };
      });

      return sendJSON(res, 200, { profile, emblems: fullEmblemsList });
    } catch (err) {
      console.error('Failed to load user public profile:', err);
      return sendJSON(res, 500, { error: 'Failed to load profile' });
    }
  }

  // 5h. Admin API: List all users for moderation
  if (req.method === 'GET' && safePath === '/api/admin/users') {
    if (!currentUser) return sendJSON(res, 401, { error: 'Unauthorized' });
    if (currentUser.role !== 'admin' && currentUser.role !== 'moderator') {
      return sendJSON(res, 403, { error: 'Forbidden' });
    }
    try {
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
      const q = parsedUrl.searchParams.get('q') || '';
      const users = await db.getAllUsersForModeration(q);
      return sendJSON(res, 200, users);
    } catch (err) {
      console.error('Failed to load users for moderation:', err);
      return sendJSON(res, 500, { error: 'Failed to load users' });
    }
  }

  // 5i. Admin API: Ban/Unban user
  if (req.method === 'POST' && safePath === '/api/admin/user/ban') {
    if (!currentUser) return sendJSON(res, 401, { error: 'Unauthorized' });
    if (currentUser.role !== 'admin' && currentUser.role !== 'moderator') {
      return sendJSON(res, 403, { error: 'Forbidden' });
    }
    try {
      const body = await getRequestBody(req);
      const { userId, durationHours, reason } = JSON.parse(body);

      if (!userId) {
        return sendJSON(res, 400, { error: 'Missing userId' });
      }

      const targetUser = await db.findUserById(userId);
      if (!targetUser) {
        return sendJSON(res, 404, { error: 'Target user not found' });
      }
      if (currentUser.role === 'moderator' && (targetUser.role === 'admin' || targetUser.role === 'moderator')) {
        return sendJSON(res, 403, { error: 'Hierarchical role error. You cannot moderate other moderators or admins.' });
      }

      let banExpiresAt = null;
      if (durationHours === -1) {
        banExpiresAt = '9999-12-31 23:59:59';
      } else if (durationHours > 0) {
        const d = new Date();
        d.setMinutes(d.getMinutes() + Math.round(durationHours * 60));
        banExpiresAt = d.toISOString().slice(0, 19).replace('T', ' ');
      }

      await db.updateUserBanStatus(userId, banExpiresAt, reason || null);

      if (banExpiresAt) {
        for (const [token, sessUser] of SESSIONS.entries()) {
          if (sessUser.id === userId) {
            SESSIONS.delete(token);
          }
        }

        if (ACTIVE_WS_CONNECTIONS.has(userId)) {
          const userSockets = ACTIVE_WS_CONNECTIONS.get(userId);
          userSockets.forEach(socket => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ 
                type: 'FORCE_DISCONNECT', 
                payload: { reason: `Has sido suspendido. Expiración: ${banExpiresAt}. Motivo: ${reason || 'Sin motivo especificado.'}` } 
              }));
              socket.close();
            }
          });
          ACTIVE_WS_CONNECTIONS.delete(userId);
        }
      }

      return sendJSON(res, 200, { success: true });
    } catch (err) {
      console.error('Failed to ban/unban user:', err);
      return sendJSON(res, 500, { error: 'Failed to update ban status' });
    }
  }

  // 5j. Admin API: Delete user (logical)
  if (req.method === 'DELETE' && safePath === '/api/admin/user/delete') {
    if (!currentUser) return sendJSON(res, 401, { error: 'Unauthorized' });
    if (currentUser.role !== 'admin') {
      return sendJSON(res, 403, { error: 'Forbidden. Only administrators can delete users.' });
    }
    try {
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
      const targetId = parsedUrl.searchParams.get('id');

      if (!targetId) {
        return sendJSON(res, 400, { error: 'Missing user ID' });
      }

      const targetUser = await db.findUserById(targetId);
      if (!targetUser) {
        return sendJSON(res, 404, { error: 'User not found' });
      }
      
      if (targetId === currentUser.id) {
        return sendJSON(res, 400, { error: 'You cannot delete yourself.' });
      }

      await db.deleteUserFromSystem(targetId);

      for (const [token, sessUser] of SESSIONS.entries()) {
        if (sessUser.id === targetId) {
          SESSIONS.delete(token);
        }
      }

      if (ACTIVE_WS_CONNECTIONS.has(targetId)) {
        const userSockets = ACTIVE_WS_CONNECTIONS.get(targetId);
        userSockets.forEach(socket => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ 
              type: 'FORCE_DISCONNECT', 
              payload: { reason: 'Esta cuenta ha sido eliminada por un administrador.' } 
            }));
            socket.close();
          }
        });
        ACTIVE_WS_CONNECTIONS.delete(targetId);
      }

      return sendJSON(res, 200, { success: true });
    } catch (err) {
      console.error('Failed to delete user:', err);
      return sendJSON(res, 500, { error: 'Failed to delete user' });
    }
  }

  // Admin API: Change user role
  if (req.method === 'POST' && safePath === '/api/admin/user/role') {
    if (!currentUser) return sendJSON(res, 401, { error: 'Unauthorized' });
    if (currentUser.role !== 'admin') {
      return sendJSON(res, 403, { error: 'Forbidden. Only administrators can change roles.' });
    }
    try {
      const body = await getRequestBody(req);
      const { userId, role } = JSON.parse(body);

      if (!userId || !role) {
        return sendJSON(res, 400, { error: 'Missing parameters' });
      }
      if (!['user', 'moderator', 'admin'].includes(role)) {
        return sendJSON(res, 400, { error: 'Invalid role value' });
      }

      const targetUser = await db.findUserById(userId);
      if (!targetUser) {
        return sendJSON(res, 404, { error: 'User not found' });
      }

      await db.query("UPDATE users SET role = ? WHERE id = ?", [role, userId]);
      return sendJSON(res, 200, { success: true, role });
    } catch (err) {
      console.error('Failed to change user role:', err);
      return sendJSON(res, 500, { error: 'Failed to change role' });
    }
  }

  // Admin/Mod API: Get user battle history
  if (req.method === 'GET' && safePath === '/api/admin/user/history') {
    if (!currentUser) return sendJSON(res, 401, { error: 'Unauthorized' });
    if (currentUser.role !== 'admin' && currentUser.role !== 'moderator') {
      return sendJSON(res, 403, { error: 'Forbidden' });
    }
    try {
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
      const targetId = parsedUrl.searchParams.get('id');
      if (!targetId) {
        return sendJSON(res, 400, { error: 'Missing target user ID' });
      }

      const history = await db.getUserBattleHistory(targetId);
      return sendJSON(res, 200, history);
    } catch (err) {
      console.error('Failed to get user history for admin:', err);
      return sendJSON(res, 500, { error: 'Failed to retrieve battle history' });
    }
  }

  // 5k. Admin API: Update Mock User Stats
  if (req.method === 'POST' && safePath === '/api/admin/mock/update-stats') {
    if (!currentUser) return sendJSON(res, 401, { error: 'Unauthorized' });
    if (currentUser.role !== 'admin') {
      return sendJSON(res, 403, { error: 'Forbidden' });
    }
    try {
      const body = await getRequestBody(req);
      const { userId, statsData } = JSON.parse(body);

      if (!userId || !statsData) {
        return sendJSON(res, 400, { error: 'Missing arguments' });
      }

      const targetUser = await db.findUserById(userId);
      if (!targetUser || !targetUser.is_mock) {
        return sendJSON(res, 400, { error: 'Target user is not a Mock user' });
      }

      await db.updateMockUserStats(userId, statsData);
      return sendJSON(res, 200, { success: true });
    } catch (err) {
      console.error('Failed to update mock user stats:', err);
      return sendJSON(res, 500, { error: 'Failed to update stats' });
    }
  }

  // 5l. Admin API: Update Mock User Cosmetics
  if (req.method === 'POST' && safePath === '/api/admin/mock/update-cosmetics') {
    if (!currentUser) return sendJSON(res, 401, { error: 'Unauthorized' });
    if (currentUser.role !== 'admin') {
      return sendJSON(res, 403, { error: 'Forbidden' });
    }
    try {
      const body = await getRequestBody(req);
      const { userId, cosmetics } = JSON.parse(body);

      if (!userId || !cosmetics) {
        return sendJSON(res, 400, { error: 'Missing arguments' });
      }

      const targetUser = await db.findUserById(userId);
      if (!targetUser || !targetUser.is_mock) {
        return sendJSON(res, 400, { error: 'Target user is not a Mock user' });
      }

      await db.updateMockUserCosmetics(userId, JSON.stringify(cosmetics));
      return sendJSON(res, 200, { success: true });
    } catch (err) {
      console.error('Failed to update mock user cosmetics:', err);
      return sendJSON(res, 500, { error: 'Failed to update cosmetics' });
    }
  }

  // 5m. Admin API: Update Mock User Emblem Progress
  if (req.method === 'POST' && safePath === '/api/admin/mock/update-emblem') {
    if (!currentUser) return sendJSON(res, 401, { error: 'Unauthorized' });
    if (currentUser.role !== 'admin') {
      return sendJSON(res, 403, { error: 'Forbidden' });
    }
    try {
      const body = await getRequestBody(req);
      const { userId, emblemId, progress, isUnlocked } = JSON.parse(body);

      if (!userId || !emblemId) {
        return sendJSON(res, 400, { error: 'Missing arguments' });
      }

      const targetUser = await db.findUserById(userId);
      if (!targetUser || !targetUser.is_mock) {
        return sendJSON(res, 400, { error: 'Target user is not a Mock user' });
      }

      await db.updateMockUserEmblemProgress(userId, emblemId, progress, isUnlocked);
      return sendJSON(res, 200, { success: true });
    } catch (err) {
      console.error('Failed to update mock user emblem progress:', err);
      return sendJSON(res, 500, { error: 'Failed to update emblem' });
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

      const jsonPath = path.join(PUBLIC_DIR, 'Assets', 'Battlefields', 'positions.json');
      
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
    const battlefieldsDir = path.join(PUBLIC_DIR, 'Assets', 'Battlefields');
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
const ACTIVE_WS_CONNECTIONS = new Map(); // userId -> Set of ws connections

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
      db.query('SELECT cards, box_image, coin_front, coin_back, card_back FROM decks WHERE id = ?', [p1.deckId]),
      db.query('SELECT cards, box_image, coin_front, coin_back, card_back FROM decks WHERE id = ?', [p2.deckId])
    ]);

    const deck1 = d1[0] ? (typeof d1[0].cards === 'string' ? JSON.parse(d1[0].cards) : d1[0].cards) : [];
    const deck2 = d2[0] ? (typeof d2[0].cards === 'string' ? JSON.parse(d2[0].cards) : d2[0].cards) : [];

    const deck1Custom = {
      boxImage: d1[0] && d1[0].box_image ? d1[0].box_image : 'Decks/pokeball.png',
      coinFront: d1[0] && d1[0].coin_front ? d1[0].coin_front : 'Coins/show(62).png',
      coinBack: d1[0] && d1[0].coin_back ? d1[0].coin_back : 'Coins/coin-back.png',
      cardBack: d1[0] && d1[0].card_back ? d1[0].card_back : 'pokemon_card_backside.png'
    };
    const deck2Custom = {
      boxImage: d2[0] && d2[0].box_image ? d2[0].box_image : 'Decks/pokeball.png',
      coinFront: d2[0] && d2[0].coin_front ? d2[0].coin_front : 'Coins/show(62).png',
      coinBack: d2[0] && d2[0].coin_back ? d2[0].coin_back : 'Coins/coin-back.png',
      cardBack: d2[0] && d2[0].card_back ? d2[0].card_back : 'pokemon_card_backside.png'
    };

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
        localPlayerId: p1.user.id,
        p1Id: gameState.p1Id,
        p2Id: gameState.p2Id,
        goesFirst: goesFirstId === p1.user.id,
        playerDeckCustom: deck1Custom,
        opponentDeckCustom: deck2Custom,
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
        localPlayerId: p2.user.id,
        p1Id: gameState.p1Id,
        p2Id: gameState.p2Id,
        goesFirst: goesFirstId === p2.user.id,
        playerDeckCustom: deck2Custom,
        opponentDeckCustom: deck1Custom,
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

function canPlayRanked(p1, p2) {
  // Misma categoría
  if (p1.category === p2.category) {
    return true;
  }

  const cat1 = p1.category;
  const lvl1 = p1.level;
  const mw1 = p1.masterWins || 0;

  const cat2 = p2.category;
  const lvl2 = p2.level;
  const mw2 = p2.masterWins || 0;

  // Principiante 3 vs Great 1
  if ((cat1 === 'Principiante' && lvl1 === 3 && cat2 === 'Great' && lvl2 === 1) ||
      (cat2 === 'Principiante' && lvl2 === 3 && cat1 === 'Great' && lvl1 === 1)) {
    return true;
  }

  // Great 4 vs Experto 1
  if ((cat1 === 'Great' && lvl1 === 4 && cat2 === 'Experto' && lvl2 === 1) ||
      (cat2 === 'Great' && lvl2 === 4 && cat1 === 'Experto' && lvl1 === 1)) {
    return true;
  }

  // Experto 5 vs Veterano 1
  if ((cat1 === 'Experto' && lvl1 === 5 && cat2 === 'Veterano' && lvl2 === 1) ||
      (cat2 === 'Experto' && lvl2 === 5 && cat1 === 'Veterano' && lvl1 === 1)) {
    return true;
  }

  // Veterano 5 vs Ultra 1
  if ((cat1 === 'Veterano' && lvl1 === 5 && cat2 === 'Ultra' && lvl2 === 1) ||
      (cat2 === 'Veterano' && lvl2 === 5 && cat1 === 'Ultra' && lvl1 === 1)) {
    return true;
  }

  // Ultra 5 vs Maestro (el jugador en categoria Maestro debe ser maximo Maestro 5)
  if ((cat1 === 'Ultra' && lvl1 === 5 && cat2 === 'Maestro' && mw2 <= 5) ||
      (cat2 === 'Ultra' && lvl2 === 5 && cat1 === 'Maestro' && mw1 <= 5)) {
    return true;
  }

  return false;
}

async function tryRankedMatchmaking() {
  if (RANKED_QUEUE.length < 2) return;

  for (let i = 0; i < RANKED_QUEUE.length; i++) {
    const p1 = RANKED_QUEUE[i];
    
    const p2Idx = RANKED_QUEUE.findIndex((p, idx) => 
      idx !== i && 
      p.user.id !== p1.user.id && 
      canPlayRanked(p1, p)
    );

    if (p2Idx !== -1) {
      const p2 = RANKED_QUEUE.splice(p2Idx, 1)[0];
      const p1Idx = RANKED_QUEUE.findIndex(p => p.user.id === p1.user.id);
      RANKED_QUEUE.splice(p1Idx, 1);

      broadcastRankedQueueCount();

      const matchId = `match-${crypto.randomBytes(8).toString('hex')}`;

      try {
        const [d1, d2] = await Promise.all([
          db.query('SELECT cards, box_image, coin_front, coin_back, card_back FROM decks WHERE id = ?', [p1.deckId]),
          db.query('SELECT cards, box_image, coin_front, coin_back, card_back FROM decks WHERE id = ?', [p2.deckId])
        ]);

        const deck1 = d1[0] ? (typeof d1[0].cards === 'string' ? JSON.parse(d1[0].cards) : d1[0].cards) : [];
        const deck2 = d2[0] ? (typeof d2[0].cards === 'string' ? JSON.parse(d2[0].cards) : d2[0].cards) : [];

        const deck1Custom = {
          boxImage: d1[0] && d1[0].box_image ? d1[0].box_image : 'Decks/pokeball.png',
          coinFront: d1[0] && d1[0].coin_front ? d1[0].coin_front : 'Coins/show(62).png',
          coinBack: d1[0] && d1[0].coin_back ? d1[0].coin_back : 'Coins/coin-back.png',
          cardBack: d1[0] && d1[0].card_back ? d1[0].card_back : 'pokemon_card_backside.png'
        };
        const deck2Custom = {
          boxImage: d2[0] && d2[0].box_image ? d2[0].box_image : 'Decks/pokeball.png',
          coinFront: d2[0] && d2[0].coin_front ? d2[0].coin_front : 'Coins/show(62).png',
          coinBack: d2[0] && d2[0].coin_back ? d2[0].coin_back : 'Coins/coin-back.png',
          cardBack: d2[0] && d2[0].card_back ? d2[0].card_back : 'pokemon_card_backside.png'
        };

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
            localPlayerId: p1.user.id,
            p1Id: gameState.p1Id,
            p2Id: gameState.p2Id,
            goesFirst: goesFirstId === p1.user.id,
            isRanked: true,
            opponentRankedCategory: user2Data ? user2Data.ranked_category : 'Principiante',
            opponentRankedLevel: user2Data ? user2Data.ranked_level : 1,
            opponentConsecutiveWins: user2Data ? user2Data.consecutive_wins : 0,
            playerDeckCustom: deck1Custom,
            opponentDeckCustom: deck2Custom,
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
            localPlayerId: p2.user.id,
            p1Id: gameState.p1Id,
            p2Id: gameState.p2Id,
            goesFirst: goesFirstId === p2.user.id,
            isRanked: true,
            opponentRankedCategory: user1Data ? user1Data.ranked_category : 'Principiante',
            opponentRankedLevel: user1Data ? user1Data.ranked_level : 1,
            opponentConsecutiveWins: user1Data ? user1Data.consecutive_wins : 0,
            playerDeckCustom: deck2Custom,
            opponentDeckCustom: deck1Custom,
            hand: gameState.players[p2.user.id].hand.map(c => ({ cardId: c.card.cardId || c.card.id, instanceId: c.instanceId })),
            prizes: gameState.players[p2.user.id].prizes.map(c => ({ cardId: c.card.cardId || c.card.id, instanceId: c.instanceId })),
            deck: gameState.players[p2.user.id].deck.map(c => ({ cardId: c.card.cardId || c.card.id, instanceId: c.instanceId })),
            opponentHandSize: gameState.players[p1.user.id].hand.length,
            opponentPrizesSize: gameState.players[p1.user.id].prizes.length,
            opponentDeckSize: gameState.players[p1.user.id].deck.length
          }
        }));

        const p1LvlStr = p1.category === 'Maestro' ? `M:${p1.masterWins || 0}` : `Lvl:${p1.level}`;
        const p2LvlStr = p2.category === 'Maestro' ? `M:${p2.masterWins || 0}` : `Lvl:${p2.level}`;
        console.log(`Matched ranked game: ${p1.user.name} (${p1.category} ${p1LvlStr}) vs ${p2.user.name} (${p2.category} ${p2LvlStr})`);
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
  const emblemEvaluator = require('./server/emblemEvaluator');

  let p1DeckName = 'Ninguno';
  let p2DeckName = 'Ninguno';
  try {
    const [deck1Rows, deck2Rows] = await Promise.all([
      p1.deckId ? db.query('SELECT name FROM decks WHERE id = ?', [p1.deckId]) : Promise.resolve([]),
      p2.deckId ? db.query('SELECT name FROM decks WHERE id = ?', [p2.deckId]) : Promise.resolve([])
    ]);
    if (deck1Rows && deck1Rows[0]) p1DeckName = deck1Rows[0].name;
    if (deck2Rows && deck2Rows[0]) p2DeckName = deck2Rows[0].name;
  } catch (err) {
    console.error('Failed to get deck names for history:', err);
  }

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
          p2.user.id, u2Data ? u2Data.ranked_category : 'Principiante', u2Data ? u2Data.ranked_level : 1,
          p1DeckName, !!match.isPrivate
        ),
        db.recordBattle(
          p2.user.id, p1.user.name, p2Result, duration, true,
          u2Data ? u2Data.ranked_category : 'Principiante', u2Data ? u2Data.ranked_level : 1,
          p1.user.id, u1Data ? u1Data.ranked_category : 'Principiante', u1Data ? u1Data.ranked_level : 1,
          p2DeckName, !!match.isPrivate
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
  } else {
    try {
      await Promise.all([
        db.recordBattle(p1.user.id, p2.user.name, p1Result, duration, false, null, null, p2.user.id, null, null, p1DeckName, !!match.isPrivate),
        db.recordBattle(p2.user.id, p1.user.name, p2Result, duration, false, null, null, p1.user.id, null, null, p2DeckName, !!match.isPrivate)
      ]);
    } catch (err) {
      console.error('Failed to record battle in database:', err);
    }
  }

  // Evaluar emblemas para ambos jugadores
  if (match.gameState) {
    const p1Stats = match.gameState.matchStats[p1.user.id];
    const p2Stats = match.gameState.matchStats[p2.user.id];
    
    const p1State = match.gameState.players[p1.user.id];
    const p2State = match.gameState.players[p2.user.id];

    if (p1Stats && p1State) {
      const opponentPrizesLeft = p2State ? p2State.prizes.length : 6;
      const playerDeckSize = p1State.deck.length;
      await emblemEvaluator.evaluateUserEmblems(
        p1.user.id,
        p1Stats,
        p1State,
        p1Result,
        opponentPrizesLeft,
        match.gameState.turnNumber,
        match.gameState.gameOverReason || reason,
        playerDeckSize,
        !!match.isRanked,
        !!match.isPrivate
      );
    }
    
    if (p2Stats && p2State) {
      const opponentPrizesLeft = p1State ? p1State.prizes.length : 6;
      const playerDeckSize = p2State.deck.length;
      await emblemEvaluator.evaluateUserEmblems(
        p2.user.id,
        p2Stats,
        p2State,
        p2Result,
        opponentPrizesLeft,
        match.gameState.turnNumber,
        match.gameState.gameOverReason || reason,
        playerDeckSize,
        !!match.isRanked,
        !!match.isPrivate
      );
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
        masterRankedWins: newRankData.master_ranked_wins,
        isPromotion: !!newRankData.isPromotion,
        promotionType: newRankData.promotionType || '',
        isDemotion: !!newRankData.isDemotion,
        demotionType: newRankData.demotionType || ''
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
  ws.isAlive = true;
  ws.messageCount = 0;
  ws.lastRateReset = Date.now();

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  if (!ACTIVE_WS_CONNECTIONS.has(session.id)) {
    ACTIVE_WS_CONNECTIONS.set(session.id, new Set());
  }
  ACTIVE_WS_CONNECTIONS.get(session.id).add(ws);

  ws.on('message', (messageStr) => {
    ACTIVE_ENTRENADORES.set(session.id, Date.now());

    // Rate limiting: máx 25 mensajes por segundo por conexión
    const now = Date.now();
    if (now - ws.lastRateReset > 1000) {
      ws.messageCount = 0;
      ws.lastRateReset = now;
    }
    ws.messageCount++;
    if (ws.messageCount > 25) {
      return;
    }

    try {
      const msg = JSON.parse(messageStr);
      if (!msg || typeof msg !== 'object') return;
      const { type, payload } = msg;
      const safePayload = (payload && typeof payload === 'object') ? payload : {};

      if (type === 'JOIN_QUEUE') {
        const { deckId } = safePayload;
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
        const { deckId } = safePayload;
        db.query('SELECT id FROM decks WHERE id = ? AND user_id = ?', [deckId, session.id])
          .then(rows => {
            if (rows.length === 0) {
              return ws.send(JSON.stringify({ type: 'MATCH_ERROR', payload: { message: 'Mazo inválido o inexistente.' } }));
            }
            return db.findUserById(session.id).then(user => {
              const category = user ? user.ranked_category : 'Principiante';
              const level = user ? user.ranked_level : 1;
              const masterWins = user ? user.master_ranked_wins : 0;
              
              const existingIdx = RANKED_QUEUE.findIndex(q => q.user.id === session.id);
              if (existingIdx !== -1) {
                RANKED_QUEUE[existingIdx] = { user: session, deckId, ws, category, level, masterWins };
              } else {
                RANKED_QUEUE.push({ user: session, deckId, ws, category, level, masterWins });
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
            const { text } = safePayload;
            const chatMsg = JSON.stringify({
              type: 'CHAT_MESSAGE',
              payload: {
                senderId: session.id,
                senderName: session.name,
                text: String(text || '').slice(0, 300)
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
            const result = match.gameState.processAction(session.id, safePayload);
            if (!result.valid) {
              ws.send(JSON.stringify({
                type: 'ACTION_REJECTED',
                payload: {
                  reason: result.reason,
                  action: safePayload,
                  stateSnapshot: match.gameState.getSnapshot()
                }
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
                  localPlayerId: player.user.id,
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

    if (ACTIVE_WS_CONNECTIONS.has(session.id)) {
      ACTIVE_WS_CONNECTIONS.get(session.id).delete(ws);
      if (ACTIVE_WS_CONNECTIONS.get(session.id).size === 0) {
        ACTIVE_WS_CONNECTIONS.delete(session.id);
      }
    }

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

// Periodic Heartbeat (Ping/Pong) & AFK Turn Timeout Check
const wsHeartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log('Terminating dead WS connection');
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });

  // AFK check for active matches
  const now = Date.now();
  MATCHES.forEach((match, matchId) => {
    if (match.gameState && match.gameState.phase !== 'game-over') {
      const turnOwnerId = match.gameState.turnOwnerId;
      const turnOwnerWs = match.player1.user.id === turnOwnerId ? match.player1.ws : match.player2.ws;
      
      // Si el dueño del turno no está activo o la partida lleva más de 140s sin acciones
      const lastAction = match.gameState.lastActionTime || match.startTime;
      if (now - lastAction > 140000) {
        console.log(`AFK turn timeout in match ${matchId} for player ${turnOwnerId}. Forcing turn pass.`);
        const result = match.gameState.processAction(turnOwnerId, { actionType: 'MANUAL_PASS_TURN' });
        if (result && result.valid) {
          const updateMsg = JSON.stringify({
            type: 'STATE_UPDATE',
            payload: {
              events: result.events,
              stateSnapshot: match.gameState.getSnapshot()
            }
          });
          if (match.player1.ws.readyState === WebSocket.OPEN) match.player1.ws.send(updateMsg);
          if (match.player2.ws.readyState === WebSocket.OPEN) match.player2.ws.send(updateMsg);
        } else {
          // Si no se pudo pasar turno, otorgar la victoria al rival por abandono AFK
          const winnerId = turnOwnerId === match.player1.user.id ? match.player2.user.id : match.player1.user.id;
          const duration = Math.round((now - match.startTime) / 1000);
          resolveMatchEnd(matchId, winnerId, 'Inactividad (AFK Timeout).', duration);
        }
      }
    }
  });
}, 15000);

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
