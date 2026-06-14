// js/app.js

import { CardDatabase } from './database.js';
import { Encyclopedia } from './encyclopedia.js';
import { DeckBuilder } from './deckbuilder.js';
import { Duel } from './duel.js';
import { BattlefieldEditor } from './battlefieldEditor.js';
import { OnlineDuel } from './onlineDuel.js';

// Define custom alert/confirm modals globally
window.customAlert = function(title, message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('modal-alert');
    const titleEl = document.getElementById('alert-title');
    const msgEl = document.getElementById('alert-message');
    const okBtn = document.getElementById('btn-alert-ok');
    const closeBtn = modal?.querySelector('.modal-close-btn');

    if (!modal || !titleEl || !msgEl || !okBtn) {
      alert(message);
      resolve();
      return;
    }

    titleEl.textContent = title;
    msgEl.textContent = message;

    const cleanup = () => {
      modal.classList.remove('active');
      okBtn.removeEventListener('click', onOk);
      closeBtn?.removeEventListener('click', onOk);
      modal.removeEventListener('click', onOverlayClick);
    };

    const onOk = () => {
      cleanup();
      resolve();
    };

    const onOverlayClick = (e) => {
      if (e.target === modal) {
        onOk();
      }
    };

    okBtn.addEventListener('click', onOk);
    closeBtn?.addEventListener('click', onOk);
    modal.addEventListener('click', onOverlayClick);

    modal.classList.add('active');
  });
};

window.customConfirm = function(title, message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('modal-confirm');
    const titleEl = document.getElementById('confirm-title');
    const msgEl = document.getElementById('confirm-message');
    const okBtn = document.getElementById('btn-confirm-ok');
    const cancelBtn = document.getElementById('btn-confirm-cancel');

    if (!modal || !titleEl || !msgEl || !okBtn || !cancelBtn) {
      const res = confirm(message);
      resolve(res);
      return;
    }

    titleEl.textContent = title;
    msgEl.textContent = message;

    const cleanup = () => {
      modal.classList.remove('active');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
    };

    const onOk = () => {
      cleanup();
      resolve(true);
    };

    const onCancel = () => {
      cleanup();
      resolve(false);
    };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);

    modal.classList.add('active');
  });
};

class AppController {
  constructor() {
    this.db = new CardDatabase();
    this.encyclopedia = null;
    this.deckBuilder = null;
    this.duel = null;
    this.onlineDuel = null;
    this.battlefieldEditor = null;
    this.currentUser = null;
    
    // Screens DOM map
    this.screens = {
      login: document.getElementById('screen-login'),
      menu: document.getElementById('screen-menu'),
      encyclopedia: document.getElementById('screen-encyclopedia'),
      deckbuilder: document.getElementById('screen-deckbuilder'),
      duel: document.getElementById('screen-duel'),
      battlefields: document.getElementById('screen-battlefields'),
      queue: document.getElementById('screen-queue'),
      leaderboard: document.getElementById('screen-leaderboard'),
      history: document.getElementById('screen-history'),
      privateWaiting: document.getElementById('screen-private-waiting')
    };
  }

  async start() {
    console.log('[AppController] Starting application...');
    // 1. Initialize DB
    console.log('[AppController] Step 1: Initializing DB...');
    const dbSuccess = await this.db.init();
    if (!dbSuccess) {
      console.error('[AppController] DB initialization failed!');
      await window.customAlert('Error', 'Error cargando la base de datos de cartas. Asegúrate de ejecutar el servidor local y recargar la página.');
      return;
    }
    console.log('[AppController] DB initialized successfully.');

    // 2. Initialize modules
    console.log('[AppController] Step 2: Initializing modules...');
    this.encyclopedia = new Encyclopedia(this.db);
    this.deckBuilder = new DeckBuilder(this.db);
    this.duel = new Duel(this.db, this.deckBuilder);
    this.onlineDuel = new OnlineDuel(this.db, this.deckBuilder, this);
    this.battlefieldEditor = new BattlefieldEditor(this.db);

    console.log('[AppController] Calling init on modules...');
    this.encyclopedia.init();
    this.deckBuilder.init();
    this.duel.init();
    this.onlineDuel.init();
    this.battlefieldEditor.init();

    // Bind setup callbacks for game exits
    this.duel.onGameExit = () => {
      const chatPanel = document.getElementById('online-chat-panel');
      if (chatPanel) chatPanel.style.display = 'none';
      this.navigateTo('menu');
    };
    this.onlineDuel.onGameExit = () => {
      const chatPanel = document.getElementById('online-chat-panel');
      if (chatPanel) chatPanel.style.display = 'none';
      this.navigateTo('menu');
    };
    this.duel.onGameStart = () => this.navigateTo('duel');
    this.onlineDuel.onGameStart = () => this.navigateTo('duel');
    console.log('[AppController] Modules initialized successfully.');

    // 3. Bind navigation events
    console.log('[AppController] Step 3: Binding navigation events...');
    this.bindNavigation();

    // 4. Setup Auth Forms
    console.log('[AppController] Step 4: Setting up Auth Forms...');
    this.setupMockLogin();
    await this.initGoogleAuth();

    // 5. Check active session
    console.log('[AppController] Step 5: Checking active session...');
    await this.checkSession();

    // 5b. Start dashboard update polling
    this.dashboardInterval = setInterval(() => {
      this.updateDashboard();
    }, 15000);

    // 6. Hide loading overlay
    console.log('[AppController] Step 6: Hiding loading overlay...');
    const loader = document.getElementById('loading-overlay');
    if (loader) {
      loader.classList.remove('active');
      setTimeout(() => loader.remove(), 500); // Clean up DOM
    }
    console.log('[AppController] Application started successfully.');
  }

  navigateTo(screenId) {
    // Deactivate all screens
    Object.values(this.screens).forEach(screen => {
      if (screen) screen.classList.remove('active');
    });

    // Activate target screen
    const targetScreen = this.screens[screenId];
    if (targetScreen) {
      targetScreen.classList.add('active');
    }

    // Handle screen specific transitions/re-renders
    if (screenId === 'encyclopedia') {
      this.encyclopedia.onShow();
    } else if (screenId === 'deckbuilder') {
      this.deckBuilder.onShow();
    } else if (screenId === 'battlefields') {
      this.battlefieldEditor.onShow();
    } else if (screenId === 'menu') {
      this.updateDashboard();
    }
  }

  populateDeckSelect(selectElementId) {
    const select = document.getElementById(selectElementId);
    if (!select) return;
    select.innerHTML = '';
    const saved = this.deckBuilder.savedDecks;
    for (const id in saved) {
      const deck = saved[id];
      const opt = document.createElement('option');
      opt.value = deck.id;
      opt.textContent = deck.name;
      select.appendChild(opt);
    }
  }

  bindNavigation() {
    // General back to menu buttons
    document.querySelectorAll('.btn-back-menu').forEach(btn => {
      btn.addEventListener('click', () => {
        if (this.currentUser) {
          this.navigateTo('menu');
        } else {
          this.navigateTo('login');
        }
      });
    });

    // Menu transitions
    document.getElementById('btn-goto-deckbuilder')?.addEventListener('click', () => this.navigateTo('deckbuilder'));
    document.getElementById('btn-goto-encyclopedia')?.addEventListener('click', () => {
      if (!this.currentUser) {
        this.navigateTo('login');
      } else {
        this.navigateTo('encyclopedia');
      }
    });
    document.getElementById('btn-goto-battlefields')?.addEventListener('click', () => this.navigateTo('battlefields'));

    // Duel Vs I.A. flow
    document.getElementById('btn-play-ia')?.addEventListener('click', () => {
      // Customize deck selector modal for AI game
      document.getElementById('modal-deck-selector-title').textContent = 'Elige tu Mazo de Duelo (Vs I.A.)';
      document.getElementById('modal-deck-selector-desc').textContent = 'Selecciona un mazo para ti y otro para el oponente de Inteligencia Artificial Gary.';
      document.getElementById('opponent-deck-select-container').style.display = 'block';

      // Re-bind duel confirmation button to I.A. mode
      const startBtn = document.getElementById('btn-start-duel-match');
      const newStartBtn = startBtn.cloneNode(true);
      startBtn.parentNode.replaceChild(newStartBtn, startBtn);

      newStartBtn.addEventListener('click', () => {
        this.duel.startMatchFlow();
      });

      this.duel.openDeckSelector();
    });

    // Duel Online flow
    document.getElementById('btn-play-online')?.addEventListener('click', () => {
      // Customize deck selector modal for Online match
      document.getElementById('modal-deck-selector-title').textContent = 'Elige tu Mazo para la Arena Online';
      document.getElementById('modal-deck-selector-desc').textContent = 'Selecciona cuál de tus mazos usarás para entrar en la cola de emparejamiento online.';
      document.getElementById('opponent-deck-select-container').style.display = 'none';

      // Re-bind confirmation button to Online mode
      const startBtn = document.getElementById('btn-start-duel-match');
      const newStartBtn = startBtn.cloneNode(true);
      startBtn.parentNode.replaceChild(newStartBtn, startBtn);

      newStartBtn.addEventListener('click', () => {
        this.onlineDuel.startMatchFlow();
      });

      this.onlineDuel.openDeckSelector();
    });

    // Public login buttons to browse without login
    document.getElementById('btn-login-leaderboard')?.addEventListener('click', () => this.showLeaderboard());

    // Menu options for Leaderboard and History
    document.getElementById('btn-goto-leaderboard')?.addEventListener('click', () => this.showLeaderboard());
    document.getElementById('btn-goto-history')?.addEventListener('click', () => this.showHistory());

    // Logout
    document.getElementById('btn-logout')?.addEventListener('click', () => this.logout());

    // Close private modals
    document.querySelectorAll('#modal-create-private .modal-close-btn, #modal-join-private .modal-close-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.target.closest('.modal-overlay').classList.remove('active');
      });
    });

    // Create Private Room modal trigger
    document.getElementById('btn-create-private')?.addEventListener('click', () => {
      this.populateDeckSelect('create-private-deck-select');
      document.getElementById('create-private-password-input').value = '';
      document.getElementById('modal-create-private').classList.add('active');
    });

    // Create Private Room submit trigger
    document.getElementById('btn-submit-create-private')?.addEventListener('click', () => {
      const deckId = document.getElementById('create-private-deck-select').value;
      const password = document.getElementById('create-private-password-input').value.trim();
      document.getElementById('modal-create-private').classList.remove('active');
      this.onlineDuel.createPrivateRoom(deckId, password);
    });

    // Join Private Room modal trigger
    document.getElementById('btn-join-private')?.addEventListener('click', () => {
      this.populateDeckSelect('join-private-deck-select');
      document.getElementById('join-private-room-id-input').value = '';
      document.getElementById('join-private-password-input').value = '';
      document.getElementById('modal-join-private').classList.add('active');
    });

    // Join Private Room submit trigger
    document.getElementById('btn-submit-join-private')?.addEventListener('click', () => {
      const roomId = document.getElementById('join-private-room-id-input').value.trim();
      const password = document.getElementById('join-private-password-input').value.trim();
      const deckId = document.getElementById('join-private-deck-select').value;

      if (!roomId) {
        window.customAlert('Datos incompletos', 'Por favor ingresa el ID de la sala privada.');
        return;
      }

      document.getElementById('modal-join-private').classList.remove('active');
      this.onlineDuel.joinPrivateRoom(roomId, password, deckId);
    });

    // Cancel Private Room Waiting
    document.getElementById('btn-cancel-private-waiting')?.addEventListener('click', () => {
      this.onlineDuel.cancelPrivateRoom();
    });
  }

  // Session verification on load
  async checkSession() {
    const token = localStorage.getItem('pkmn_session_token');
    if (!token) {
      this.navigateTo('login');
      return;
    }

    try {
      const res = await fetch('/api/auth/session', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        this.currentUser = data.user;
        window.CURRENT_USER_ID = this.currentUser.id;
        this.onLoginSuccess();
      } else {
        localStorage.removeItem('pkmn_session_token');
        this.navigateTo('login');
      }
    } catch (err) {
      console.error('Session check failed, redirecting to login.', err);
      this.navigateTo('login');
    }
  }

  // Google OAuth Client Setup
  async initGoogleAuth() {
    try {
      const res = await fetch('/api/auth/config');
      const data = await res.json();
      const clientId = data.googleClientId;

      if (!clientId || clientId === 'YOUR_GOOGLE_CLIENT_ID_PLACEHOLDER') {
        console.warn('Google Credentials not configured yet in .env file.');
      }

      window.handleCredentialResponse = async (response) => {
        try {
          const authRes = await fetch('/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential: response.credential })
          });
          if (authRes.ok) {
            const authData = await authRes.json();
            localStorage.setItem('pkmn_session_token', authData.token);
            this.currentUser = authData.user;
            window.CURRENT_USER_ID = this.currentUser.id;
            this.onLoginSuccess();
          } else {
            await window.customAlert('Acceso Google', 'Autenticación con Google rechazada.');
          }
        } catch (err) {
          console.error(err);
          await window.customAlert('Error de Red', 'Error de red al conectar con Google.');
        }
      };

      if (window.google) {
        window.google.accounts.id.initialize({
          client_id: clientId || 'YOUR_GOOGLE_CLIENT_ID_PLACEHOLDER',
          callback: window.handleCredentialResponse
        });
        window.google.accounts.id.renderButton(
          document.getElementById('google-signin-btn'),
          { theme: 'outline', size: 'large', width: 280 }
        );
      }
    } catch (err) {
      console.error('Failed to configure Google Auth Widget:', err);
    }
  }

  // Quick Mock Login
  setupMockLogin() {
    const btn = document.getElementById('btn-mock-login');
    const input = document.getElementById('mock-username');

    btn?.addEventListener('click', async () => {
      const name = input.value.trim();
      if (!name) {
        await window.customAlert('Acceso Rápido', 'Por favor ingresa un nombre para tu entrenador de prueba.');
        return;
      }

      try {
        const res = await fetch('/api/auth/mock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name })
        });
        if (res.ok) {
          const data = await res.json();
          localStorage.setItem('pkmn_session_token', data.token);
          this.currentUser = data.user;
          window.CURRENT_USER_ID = this.currentUser.id;
          this.onLoginSuccess();
          input.value = '';
        } else {
          await window.customAlert('Acceso Rápido', 'Error en inicio de sesión rápido.');
        }
      } catch (err) {
        console.error(err);
        await window.customAlert('Error de Red', 'Error conectando con el servidor de prueba.');
      }
    });
  }

  onLoginSuccess() {
    // Show profile in menu
    const profileWidget = document.getElementById('menu-user-profile');
    const usernameEl = document.getElementById('menu-username');
    const userVictoriesEl = document.getElementById('menu-user-victories');

    if (profileWidget && usernameEl && userVictoriesEl && this.currentUser) {
      usernameEl.textContent = this.currentUser.name;
      userVictoriesEl.textContent = this.currentUser.victories;
      profileWidget.style.display = 'block';
    }

    // Refresh decks in builder
    this.deckBuilder.loadSavedDecks();

    this.updateDashboard();
    this.navigateTo('menu');
  }

  async updateDashboard() {
    try {
      // 1. Fetch server status (players online / queue count)
      const resStatus = await fetch('/api/server-status');
      if (resStatus.ok) {
        const dataStatus = await resStatus.json();
        const playersEl = document.getElementById('news-stat-players');
        const queueEl = document.getElementById('news-stat-queue');
        if (playersEl) playersEl.textContent = dataStatus.onlinePlayers;
        if (queueEl) queueEl.textContent = dataStatus.inQueue;
        
        // También actualizar el contador de cola si el usuario está en screen-queue
        const queueCountEl = document.getElementById('queue-online-count');
        if (queueCountEl) queueCountEl.textContent = dataStatus.inQueue;
      }

      // 2. Fetch Top 3 from Leaderboard
      const resLeaderboard = await fetch('/api/leaderboard');
      if (resLeaderboard.ok) {
        const dataLeader = await resLeaderboard.json();
        const top3ListEl = document.getElementById('news-top3-list');
        if (top3ListEl) {
          top3ListEl.innerHTML = '';
          const top3 = dataLeader.leaderboard.slice(0, 3);
          if (top3.length === 0) {
            top3ListEl.innerHTML = '<div class="news-loading">No hay datos aún</div>';
          } else {
            top3.forEach((player, idx) => {
              const div = document.createElement('div');
              div.className = `news-item top-${idx + 1}`;
              let rankIcon = '';
              if (idx === 0) rankIcon = '👑 ';
              else if (idx === 1) rankIcon = '💎 ';
              else if (idx === 2) rankIcon = '🥇 ';
              
              div.innerHTML = `
                <span><strong>${rankIcon}#${idx + 1}</strong> ${player.name}</span>
                <span class="news-item-win">${player.victories} victorias</span>
              `;
              top3ListEl.appendChild(div);
            });
          }
        }
      }

      // 3. Fetch Recent Battles
      const resRecent = await fetch('/api/recent-battles');
      if (resRecent.ok) {
        const dataRecent = await resRecent.json();
        const duelsListEl = document.getElementById('news-duels-list');
        if (duelsListEl) {
          duelsListEl.innerHTML = '';
          if (dataRecent.length === 0) {
            duelsListEl.innerHTML = '<div class="news-loading">No hay combates recientes</div>';
          } else {
            dataRecent.forEach(battle => {
              const div = document.createElement('div');
              div.className = 'news-item';
              div.innerHTML = `
                <span class="news-item-vs"><strong>${battle.winner_name}</strong> vs ${battle.loser_name}</span>
                <span class="news-item-win">Ganó ${battle.winner_name}</span>
              `;
              duelsListEl.appendChild(div);
            });
          }
        }
      }
    } catch (err) {
      console.warn('Failed to update menu dashboard metrics:', err);
    }
  }

  async logout() {
    localStorage.removeItem('pkmn_session_token');
    this.currentUser = null;
    window.CURRENT_USER_ID = null;

    const profileWidget = document.getElementById('menu-user-profile');
    if (profileWidget) profileWidget.style.display = 'none';

    this.navigateTo('login');
  }

  // Load and render Leaderboard Top 250
  async showLeaderboard() {
    try {
      const token = localStorage.getItem('pkmn_session_token');
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/leaderboard', { headers });
      if (!res.ok) throw new Error('Failed to fetch leaderboard list');

      const data = await res.json();
      const { leaderboard, personal } = data;

      // Update sidebar stats
      const rankPosEl = document.getElementById('leaderboard-user-pos');
      const rankVicEl = document.getElementById('leaderboard-user-victories');
      const rankNameEl = document.getElementById('leaderboard-user-name');
      const rankEmailEl = document.getElementById('leaderboard-user-email');

      if (this.currentUser) {
        rankNameEl.textContent = this.currentUser.name;
        rankEmailEl.textContent = this.currentUser.email;
        if (personal) {
          rankPosEl.textContent = personal.position > 0 ? `#${personal.position}` : '#--';
          rankVicEl.textContent = personal.victories;
        }
      } else {
        rankNameEl.textContent = 'Invitado';
        rankEmailEl.textContent = 'Inicia sesión para ver tu rango';
        rankPosEl.textContent = '#--';
        rankVicEl.textContent = '0';
      }

      // Render table items
      const tbody = document.getElementById('leaderboard-tbody');
      tbody.innerHTML = '';

      if (leaderboard.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="3" style="text-align: center; color: var(--color-text-muted); padding: 30px;">Ningún entrenador ha conseguido victorias aún.</td>`;
        tbody.appendChild(row);
      } else {
        leaderboard.forEach((player, index) => {
          const pos = index + 1;
          const row = document.createElement('tr');

          let rowClass = '';
          let badgeHtml = `${pos}`;

          if (pos === 1) {
            rowClass = 'rank-row-1';
            badgeHtml = `<span class="rank-badge platinum">👑 Platino</span>`;
          } else if (pos === 2) {
            rowClass = 'rank-row-2';
            badgeHtml = `<span class="rank-badge diamond">💎 Diamante</span>`;
          } else if (pos === 3) {
            rowClass = 'rank-row-3';
            badgeHtml = `<span class="rank-badge gold">🥇 Oro</span>`;
          } else if (pos === 4) {
            rowClass = 'rank-row-4';
            badgeHtml = `<span class="rank-badge silver">🥈 Plata</span>`;
          } else if (pos === 5) {
            rowClass = 'rank-row-5';
            badgeHtml = `<span class="rank-badge bronze">🥉 Bronce</span>`;
          } else if (pos >= 6 && pos <= 10) {
            rowClass = 'rank-row-challenger';
          }

          if (rowClass) row.className = rowClass;

          row.innerHTML = `
            <td style="padding: 15px; font-weight: 700;">${badgeHtml}</td>
            <td style="padding: 15px;">
              <strong>${player.name}</strong>
              <div style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 4px;">Partidas jugadas: ${player.total_games || 0}</div>
            </td>
            <td style="padding: 15px; text-align: right; font-weight: 700; color: var(--color-primary);">${player.victories}</td>
          `;
          tbody.appendChild(row);
        });
      }

      this.navigateTo('leaderboard');
    } catch (err) {
      console.error(err);
      await window.customAlert('Error de Conexión', 'Error de conexión al cargar la tabla de clasificación.');
    }
  }

  // Load and render private battle history
  async showHistory() {
    try {
      const token = localStorage.getItem('pkmn_session_token');
      if (!token) {
        await window.customAlert('Historial', 'Debes iniciar sesión para consultar tu historial.');
        return;
      }

      const res = await fetch('/api/history', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to load private battles history');

      const history = await res.json();
      
      const tbody = document.getElementById('history-tbody');
      const emptyMsg = document.getElementById('history-empty-message');

      tbody.innerHTML = '';

      if (history.length === 0) {
        emptyMsg.style.display = 'block';
      } else {
        emptyMsg.style.display = 'none';
        history.forEach(battle => {
          const row = document.createElement('tr');
          const outcomeClass = battle.result === 'won' ? 'won' : 'lost';
          const outcomeText = battle.result === 'won' ? 'Ganado' : 'Perdido';

          const mins = Math.floor(battle.duration / 60);
          const secs = battle.duration % 60;
          const durationText = `${mins}:${secs.toString().padStart(2, '0')} min`;

          const date = new Date(battle.created_at).toLocaleDateString('es-ES', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
          });

          row.innerHTML = `
            <td style="padding: 15px;"><strong>${battle.opponent_name}</strong></td>
            <td style="padding: 15px;"><span class="history-outcome ${outcomeClass}">${outcomeText}</span></td>
            <td style="padding: 15px;">${durationText}</td>
            <td style="padding: 15px; text-align: right; color: var(--color-text-muted);">${date}</td>
          `;
          tbody.appendChild(row);
        });
      }

      this.navigateTo('history');
    } catch (err) {
      console.error(err);
      await window.customAlert('Error de Conexión', 'Error de conexión al recuperar el historial.');
    }
  }
}

// Auto-boot on load
console.log('[AppController] app.js script loaded.');
if (document.readyState === 'loading') {
  console.log('[AppController] Document is loading, adding DOMContentLoaded listener...');
  window.addEventListener('DOMContentLoaded', () => {
    console.log('[AppController] DOMContentLoaded event fired.');
    const app = new AppController();
    app.start();
  });
} else {
  console.log('[AppController] Document is already interactive/complete, running app immediately...');
  const app = new AppController();
  app.start();
}
