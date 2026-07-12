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
    window.appController = this;
    this.db = new CardDatabase();
    this.encyclopedia = null;
    this.deckBuilder = null;
    this.duel = null;
    this.onlineDuel = null;
    this.battlefieldEditor = null;
    this.currentUser = null;
    this.currentLeaderboardTab = 'general';
    this.currentTop3Tab = 'normal';
    this.currentDuelsTab = 'normal';
    this.currentHistoryTab = 'normal';
    
    // Screens DOM map
    this.screens = {
      login: document.getElementById('screen-login'),
      menu: document.getElementById('screen-menu'),
      encyclopedia: document.getElementById('screen-encyclopedia'),
      deckbuilder: document.getElementById('screen-deckbuilder'),
      decksList: document.getElementById('screen-decks-list'),
      duel: document.getElementById('screen-duel'),
      battlefields: document.getElementById('screen-battlefields'),
      queue: document.getElementById('screen-queue'),
      queueRanked: document.getElementById('screen-queue-ranked'),
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
      this.updateDashboard();
      this.navigateTo('menu');

      // Check for pending ranked promotions or reward unlocks in localStorage
      const pendingPromoStr = localStorage.getItem('pkmn_pending_promotion');
      if (pendingPromoStr) {
        try {
          const { title, img, message } = JSON.parse(pendingPromoStr);
          this.showAnnouncementModal(title, img, message);
          localStorage.removeItem('pkmn_pending_promotion');
          this.onlineDuel.pendingPromotion = null;
          return;
        } catch (e) {
          console.error(e);
        }
      }

      const pendingDemotionStr = localStorage.getItem('pkmn_pending_demotion');
      if (pendingDemotionStr) {
        try {
          const { title, img, message } = JSON.parse(pendingDemotionStr);
          this.showAnnouncementModal(title, img, message);
          localStorage.removeItem('pkmn_pending_demotion');
          this.onlineDuel.pendingDemotion = null;
          return;
        } catch (e) {
          console.error(e);
        }
      }

      const pendingUnlocksStr = localStorage.getItem('pkmn_pending_unlocks');
      if (pendingUnlocksStr) {
        try {
          const { title, img, message } = JSON.parse(pendingUnlocksStr);
          this.showAnnouncementModal(title, img, message);
          localStorage.removeItem('pkmn_pending_unlocks');
          this.onlineDuel.pendingUnlocks = null;
          return;
        } catch (e) {
          console.error(e);
        }
      }

      // Memory fallbacks
      if (this.onlineDuel.pendingPromotion) {
        const { title, img, message } = this.onlineDuel.pendingPromotion;
        this.showAnnouncementModal(title, img, message);
        this.onlineDuel.pendingPromotion = null;
      } else if (this.onlineDuel.pendingDemotion) {
        const { title, img, message } = this.onlineDuel.pendingDemotion;
        this.showAnnouncementModal(title, img, message);
        this.onlineDuel.pendingDemotion = null;
      } else if (this.onlineDuel.pendingUnlocks) {
        const { title, img, message } = this.onlineDuel.pendingUnlocks;
        this.showAnnouncementModal(title, img, message);
        this.onlineDuel.pendingUnlocks = null;
      }
    };
    this.duel.onGameStart = () => this.navigateTo('duel');
    this.onlineDuel.onGameStart = () => this.navigateTo('duel');
    console.log('[AppController] Modules initialized successfully.');

    // 3. Bind navigation events
    console.log('[AppController] Step 3: Binding navigation events...');
    this.bindNavigation();
    this.bindProfileEvents();

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
    } else if (screenId === 'decksList') {
      this.deckBuilder.renderDecksList();
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
    document.getElementById('btn-goto-deckbuilder')?.addEventListener('click', () => this.navigateTo('decksList'));
    document.getElementById('btn-back-decks-list')?.addEventListener('click', () => this.navigateTo('decksList'));
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

    // Duel Ranked flow
    document.getElementById('btn-play-ranked')?.addEventListener('click', () => {
      document.getElementById('modal-deck-selector-title').textContent = 'Elige tu Mazo para el Competitivo Ranked';
      document.getElementById('modal-deck-selector-desc').textContent = 'Selecciona cuál de tus mazos usarás para entrar en la cola de emparejamiento competitivo.';
      document.getElementById('opponent-deck-select-container').style.display = 'none';

      const startBtn = document.getElementById('btn-start-duel-match');
      const newStartBtn = startBtn.cloneNode(true);
      startBtn.parentNode.replaceChild(newStartBtn, startBtn);

      newStartBtn.addEventListener('click', () => {
        this.onlineDuel.startRankedMatchFlow();
      });

      this.onlineDuel.openDeckSelector();
    });

    // Cancel Ranked Queue
    document.getElementById('btn-cancel-queue-ranked')?.addEventListener('click', () => {
      this.onlineDuel.leaveRankedQueue();
    });

    // Public login buttons to browse without login
    document.getElementById('btn-login-leaderboard')?.addEventListener('click', () => this.showLeaderboard());

    // Menu options for Leaderboard and History
    document.getElementById('btn-goto-leaderboard')?.addEventListener('click', () => {
      // Reset to general leaderboard on fresh menu click
      this.currentLeaderboardTab = 'general';
      const tabGen = document.getElementById('btn-leaderboard-tab-general');
      const tabRanked = document.getElementById('btn-leaderboard-tab-ranked');
      const rankedHeader = document.getElementById('ranked-leaderboard-header');
      const tableTitle = document.getElementById('leaderboard-table-title');
      
      if (tabGen) tabGen.classList.add('active');
      if (tabRanked) tabRanked.classList.remove('active');
      if (rankedHeader) rankedHeader.style.display = 'none';
      if (tableTitle) tableTitle.textContent = 'Top 250 General';
      
      this.showLeaderboard();
    });
    document.getElementById('btn-goto-history')?.addEventListener('click', () => {
      this.currentHistoryTab = 'normal';
      const tabNorm = document.getElementById('btn-history-tab-normal');
      const tabRanked = document.getElementById('btn-history-tab-ranked');
      if (tabNorm) tabNorm.classList.add('active');
      if (tabRanked) tabRanked.classList.remove('active');
      
      const searchInput = document.getElementById('input-history-search');
      if (searchInput) searchInput.value = '';
      const clearBtn = document.getElementById('btn-clear-history-search');
      if (clearBtn) clearBtn.style.display = 'none';

      this.showHistory();
    });

    // History search listeners
    const searchInput = document.getElementById('input-history-search');
    searchInput?.addEventListener('input', () => {
      this.renderHistory();
    });

    const clearSearchBtn = document.getElementById('btn-clear-history-search');
    clearSearchBtn?.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
        this.renderHistory();
      }
    });

    // Dashboard Top 3 mini-tabs
    document.querySelectorAll('#top3-tabs .mini-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('#top3-tabs .mini-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.currentTop3Tab = tab.getAttribute('data-tab');
        this.updateDashboardTop3();
      });
    });

    // Dashboard Recent Duels mini-tabs
    document.querySelectorAll('#duels-tabs .mini-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('#duels-tabs .mini-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.currentDuelsTab = tab.getAttribute('data-tab');
        this.updateDashboardRecentDuels();
      });
    });

    // History tabs
    document.getElementById('btn-history-tab-normal')?.addEventListener('click', () => {
      document.getElementById('btn-history-tab-normal').classList.add('active');
      document.getElementById('btn-history-tab-ranked').classList.remove('active');
      this.currentHistoryTab = 'normal';
      this.showHistory();
    });

    document.getElementById('btn-history-tab-ranked')?.addEventListener('click', () => {
      document.getElementById('btn-history-tab-normal').classList.remove('active');
      document.getElementById('btn-history-tab-ranked').classList.add('active');
      this.currentHistoryTab = 'ranked';
      this.showHistory();
    });

    // Leaderboard Tabs conmuter
    document.getElementById('btn-leaderboard-tab-general')?.addEventListener('click', () => {
      document.getElementById('btn-leaderboard-tab-general').classList.add('active');
      document.getElementById('btn-leaderboard-tab-ranked').classList.remove('active');
      document.getElementById('ranked-leaderboard-header').style.display = 'none';
      document.getElementById('leaderboard-table-title').textContent = 'Top 250 General';
      this.currentLeaderboardTab = 'general';
      this.showLeaderboard();
    });

    document.getElementById('btn-leaderboard-tab-ranked')?.addEventListener('click', () => {
      document.getElementById('btn-leaderboard-tab-general').classList.remove('active');
      document.getElementById('btn-leaderboard-tab-ranked').classList.add('active');
      document.getElementById('ranked-leaderboard-header').style.display = 'flex';
      document.getElementById('leaderboard-table-title').textContent = 'Liga Competitiva';
      this.currentLeaderboardTab = 'ranked';
      this.showLeaderboard();
    });

    // Ranked filters events
    document.getElementById('select-ranked-filter-category')?.addEventListener('change', () => {
      // Sincronizar clases activas en las tarjetas superiores
      const category = document.getElementById('select-ranked-filter-category').value;
      document.querySelectorAll('.ranked-category-card').forEach(card => {
        if (card.getAttribute('data-category') === category) {
          card.classList.add('active');
        } else {
          card.classList.remove('active');
        }
      });
      this.showLeaderboard();
    });
    document.getElementById('select-ranked-filter-level')?.addEventListener('change', () => this.showLeaderboard());
    
    document.getElementById('btn-clear-ranked-filters')?.addEventListener('click', () => {
      const selectCat = document.getElementById('select-ranked-filter-category');
      const selectLvl = document.getElementById('select-ranked-filter-level');
      if (selectCat) selectCat.value = 'all';
      if (selectLvl) selectLvl.value = 'all';
      document.querySelectorAll('.ranked-category-card').forEach(c => c.classList.remove('active'));
      this.showLeaderboard();
    });

    document.querySelectorAll('.ranked-category-card').forEach(card => {
      card.addEventListener('click', () => {
        const category = card.getAttribute('data-category');
        const selectCat = document.getElementById('select-ranked-filter-category');
        if (selectCat) selectCat.value = category;
        
        document.querySelectorAll('.ranked-category-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        
        this.showLeaderboard();
      });
    });

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

    document.getElementById('btn-change-avatar')?.addEventListener('click', () => {
      this.avatarSelectorSource = 'menu';
      this.openAvatarSelector();
    });

    // Help and rules modal events
    document.getElementById('btn-show-help-modal')?.addEventListener('click', () => {
      document.querySelectorAll('#modal-help-guide .help-tab-btn').forEach(b => {
        if (b.getAttribute('data-tab') === 'online') b.classList.add('active');
        else b.classList.remove('active');
      });
      document.querySelectorAll('#modal-help-guide .help-tab-panel').forEach(p => {
        if (p.id === 'help-panel-online') p.style.display = 'block';
        else p.style.display = 'none';
      });
      document.getElementById('modal-help-guide').classList.add('active');
    });

    document.querySelectorAll('#modal-help-guide .help-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#modal-help-guide .help-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('#modal-help-guide .help-tab-panel').forEach(p => p.style.display = 'none');
        
        btn.classList.add('active');
        const tab = btn.getAttribute('data-tab');
        const targetPanel = document.getElementById(`help-panel-${tab}`);
        if (targetPanel) targetPanel.style.display = 'block';
      });
    });

    // Announcement Close
    document.getElementById('btn-close-announcement')?.addEventListener('click', () => {
      document.getElementById('modal-announcement').classList.remove('active');
    });

    // Close all modal overlays on close button click
    document.querySelectorAll('.modal-overlay .modal-close-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.target.closest('.modal-overlay').classList.remove('active');
      });
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
    const menuAvatar = document.getElementById('menu-user-avatar');

    if (profileWidget && usernameEl && userVictoriesEl && this.currentUser) {
      usernameEl.textContent = this.currentUser.name;
      userVictoriesEl.textContent = this.currentUser.normal_victories;
      if (menuAvatar && this.currentUser.avatar) {
        menuAvatar.src = 'Assets/' + this.currentUser.avatar;
      }
      profileWidget.style.display = 'block';
    }

    // Refresh decks in builder
    this.deckBuilder.loadSavedDecks();

    this.updateRankedProfileUI();
    this.updateDashboard();
    this.navigateTo('menu');
  }

  async openAvatarSelector() {
    try {
      const token = localStorage.getItem('pkmn_session_token');
      const res = await fetch('/api/profile/icons', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch profile icons');
      const icons = await res.json();
      
      const grid = document.getElementById('avatar-grid');
      if (!grid) return;
      grid.innerHTML = '';

      // Ordenar determinísticamente con el default (pikachu-.webp) al principio
      const defaultAvatar = 'pikachu-.webp';
      const sortedIcons = icons.filter(x => x !== defaultAvatar).sort();
      sortedIcons.unshift(defaultAvatar);

      const normalVictories = this.currentUser ? (this.currentUser.normal_victories || 0) : 0;
      
      sortedIcons.forEach((iconName, index) => {
        const option = document.createElement('div');
        option.className = 'avatar-option';
        option.style.cursor = 'pointer';
        option.style.padding = '5px';
        option.style.borderRadius = '8px';
        option.style.border = '2px solid transparent';
        option.style.display = 'flex';
        option.style.alignItems = 'center';
        option.style.justifyContent = 'center';
        option.style.background = 'rgba(255,255,255,0.05)';
        option.style.transition = 'all 0.2s';

        const isLocked = index > 0 && normalVictories < index * 3;
        
        if (isLocked) {
          option.classList.add('locked');
          option.title = `Bloqueado (Requiere ${index * 3} victorias en Online Normal. Tienes ${normalVictories})`;
        } else if (this.currentUser && this.currentUser.avatar === 'Icons/' + iconName) {
          option.style.borderColor = 'var(--color-primary)';
          option.style.background = 'rgba(59, 76, 202, 0.2)';
        }
        
        option.innerHTML = `<img src="Assets/Icons/${iconName}" style="width: 75px; height: 75px; object-fit: contain;">`;
        
        option.addEventListener('click', async () => {
          if (isLocked) {
            window.customAlert('Avatar Bloqueado', `Este avatar requiere ${index * 3} victorias en Online Normal (tienes ${normalVictories}).`);
            return;
          }
          
          if (this.avatarSelectorSource === 'profile') {
            this.tempSelectedAvatar = 'Icons/' + iconName;
            const profileAvatarImg = document.getElementById('profile-large-avatar');
            if (profileAvatarImg) profileAvatarImg.src = 'Assets/Icons/' + iconName;
            document.getElementById('modal-avatar-selector').classList.remove('active');
            return;
          }
          
          try {
            const updateRes = await fetch('/api/user/update-avatar', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({ avatar: 'Icons/' + iconName })
            });
            if (updateRes.ok) {
              const result = await updateRes.json();
              this.currentUser.avatar = result.avatar;
              
              const menuAvatar = document.getElementById('menu-user-avatar');
              if (menuAvatar) menuAvatar.src = 'Assets/' + result.avatar;
              
              document.getElementById('modal-avatar-selector').classList.remove('active');
            } else {
              window.customAlert('Error', 'No se pudo actualizar el avatar.');
            }
          } catch (err) {
            console.error(err);
            window.customAlert('Error', 'Error al conectar con el servidor.');
          }
        });
        
        grid.appendChild(option);
      });
      
      document.getElementById('modal-avatar-selector').classList.add('active');
    } catch (err) {
      console.error(err);
      window.customAlert('Error', 'No se pudieron cargar los avatares.');
    }
  }

  async updateUserRankIcon() {
    if (!this.currentUser) return;
    try {
      const token = localStorage.getItem('pkmn_session_token');
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/leaderboard', { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.personal) {
          const pos = data.personal.position;
          let rankIcon = '⭐';
          if (pos === 1) rankIcon = '👑';
          else if (pos === 2) rankIcon = '💎';
          else if (pos === 3) rankIcon = '🥇';
          else if (pos === 4) rankIcon = '🥈';
          else if (pos === 5) rankIcon = '🥉';
          else if (pos >= 6 && pos <= 250) rankIcon = '🏆';
          else rankIcon = '⭐';

          const menuRankIconEl = document.getElementById('menu-user-rank-icon');
          if (menuRankIconEl) {
            menuRankIconEl.textContent = rankIcon;
            menuRankIconEl.title = `Puesto #${pos} en la clasificación general`;
          }
        }
      }
    } catch (err) {
      console.warn('Failed to update user rank icon:', err);
    }
  }

  async updateRankedProfileUI() {
    if (!this.currentUser) return;
    try {
      const token = localStorage.getItem('pkmn_session_token');
      const res = await fetch('/api/ranked/stats', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const stats = await res.json();
        this.currentUser = stats;

        // Update victories count under avatar dynamically
        const userVictoriesEl = document.getElementById('menu-user-victories');
        if (userVictoriesEl) {
          userVictoriesEl.textContent = stats.normal_victories;
        }

        const kpiTitle = document.getElementById('menu-ranked-title');
        const kpiStreak = document.getElementById('menu-ranked-streak');
        const kpiProgress = document.getElementById('menu-ranked-progress');
        const kpiTrophy = document.getElementById('menu-ranked-trophy');

        if (kpiTitle && kpiStreak && kpiProgress && kpiTrophy) {
          const category = stats.ranked_category || 'Principiante';
          const level = stats.ranked_level === 0 || category === 'Maestro' ? '' : ` ${stats.ranked_level}`;
          kpiTitle.textContent = `${category}${level}`;

          const TROPHY_IMAGES = {
            'Principiante': 'Assets/Trofeos/1-Principiante-1-3.png',
            'Great': 'Assets/Trofeos/2-Great-1-4.png',
            'Experto': 'Assets/Trofeos/3-Experto-1-5.png',
            'Veterano': 'Assets/Trofeos/4-Veterano-1-5.png',
            'Ultra': 'Assets/Trofeos/5-Ultra-1-5.png',
            'Maestro': 'Assets/Trofeos/6-Maestro.png'
          };
          kpiTrophy.src = TROPHY_IMAGES[category] || 'Assets/Trofeos/1-Principiante-1-3.png';

          const RANK_LIMITS = { 'Principiante': 3, 'Great': 4, 'Experto': 5, 'Veterano': 5, 'Ultra': 5, 'Maestro': 0 };
          const limit = RANK_LIMITS[category] || 0;
          if (category === 'Maestro') {
            kpiStreak.textContent = `V: ${stats.master_ranked_wins || 0}`;
            kpiProgress.style.width = '100%';
          } else {
            const wins = stats.consecutive_wins || 0;
            kpiStreak.textContent = `Racha: ${wins}/${limit}`;
            const pct = (wins / limit) * 100;
            kpiProgress.style.width = `${pct}%`;
          }
        }
      }
    } catch (err) {
      console.warn('Failed to update ranked profile UI:', err);
    }
  }

  bindProfileEvents() {
    document.getElementById('btn-edit-profile')?.addEventListener('click', () => {
      this.showDetailedProfileModal();
    });

    document.getElementById('btn-close-detailed-profile')?.addEventListener('click', () => {
      this.hideEmblemGlobalTooltip();
      document.getElementById('modal-detailed-profile').classList.remove('active');
    });

    document.getElementById('btn-close-emblem-picker')?.addEventListener('click', () => {
      document.getElementById('modal-emblem-picker').classList.remove('active');
    });

    document.getElementById('profile-avatar-edit-btn')?.addEventListener('click', () => {
      this.openAvatarSelectorForProfile();
    });

    document.getElementById('btn-save-profile-settings')?.addEventListener('click', () => {
      this.saveProfileChanges();
    });

    document.querySelectorAll('.featured-emblem-slot').forEach(slot => {
      slot.addEventListener('click', (e) => {
        const targetSlot = e.currentTarget.getAttribute('data-slot');
        this.openEmblemPickerForSlot(parseInt(targetSlot));
      });
    });

    document.querySelectorAll('.filter-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
        e.currentTarget.classList.add('active');
        const filterValue = e.currentTarget.getAttribute('data-filter');
        this.filterEmblemsGallery(filterValue);
      });
    });

    document.getElementById('btn-unequip-emblem')?.addEventListener('click', () => {
      if (this.currentActiveSlotForPicker !== undefined) {
        this.unequipFeaturedSlot(this.currentActiveSlotForPicker);
        document.getElementById('modal-emblem-picker').classList.remove('active');
      }
    });
  }

  openAvatarSelectorForProfile() {
    this.avatarSelectorSource = 'profile';
    this.openAvatarSelector();
  }

  async showDetailedProfileModal() {
    if (!this.currentUser) return;
    
    try {
      const token = localStorage.getItem('pkmn_session_token');
      
      // 1. Obtener la información del perfil del servidor
      const resProfile = await fetch('/api/user/profile', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!resProfile.ok) throw new Error('No se pudo obtener el perfil de usuario');
      const profile = await resProfile.json();
      
      // Actualizar el estado actual con los datos frescos
      this.currentUser = profile;

      // 2. Obtener la lista de emblemas
      const resEmblems = await fetch('/api/user/emblems', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!resEmblems.ok) throw new Error('No se pudieron obtener los emblemas del usuario');
      const emblems = await resEmblems.json();
      this.currentEmblemsList = emblems;

      // 3. Inicializar los valores en el DOM del modal
      document.getElementById('profile-large-avatar').src = 'Assets/' + (profile.avatar || 'Icons/pikachu-.webp');
      this.tempSelectedAvatar = profile.avatar || 'Icons/pikachu-.webp';
      
      document.getElementById('profile-username-tag').textContent = `${profile.name} #${profile.id.substring(0, 4).toUpperCase()}`;
      
      // Inicializar el selector de títulos en base a los emblemas desbloqueados
      const titleSelect = document.getElementById('profile-title-select');
      titleSelect.innerHTML = '<option value="Novato">Novato</option>';
      
      const unlockedTitles = emblems.filter(e => e.unlocked_at !== null).map(e => e.emblem_id);
      unlockedTitles.forEach(title => {
        const opt = document.createElement('option');
        opt.value = title;
        opt.textContent = title;
        titleSelect.appendChild(opt);
      });
      
      // Si el título seleccionado ya no es válido, por defecto es Novato
      titleSelect.value = profile.title && (profile.title === 'Novato' || unlockedTitles.includes(profile.title)) ? profile.title : 'Novato';

      // 4. Inicializar slots de emblemas destacados
      this.tempFeaturedEmblems = [
        profile.featured_emblem_1,
        profile.featured_emblem_2,
        profile.featured_emblem_3
      ];
      this.updateFeaturedEmblemsSlotsUI();

      // 5. Poblar las estadísticas
      document.getElementById('profile-stat-casual-played').textContent = profile.casual_played || 0;
      document.getElementById('profile-stat-casual-won').textContent = profile.casual_won || 0;
      
      const casualWR = profile.casual_played > 0 ? ((profile.casual_won / profile.casual_played) * 100).toFixed(1) : '0.0';
      document.getElementById('profile-stat-casual-wr').textContent = `${casualWR}% WR`;

      document.getElementById('profile-stat-ranked-played').textContent = profile.ranked_played || 0;
      document.getElementById('profile-stat-ranked-won').textContent = profile.ranked_won || 0;
      
      const rankedWR = profile.ranked_played > 0 ? ((profile.ranked_won / profile.ranked_played) * 100).toFixed(1) : '0.0';
      document.getElementById('profile-stat-ranked-wr').textContent = `${rankedWR}% WR`;

      document.getElementById('profile-stat-max-damage').textContent = profile.max_damage || 0;
      
      const maxStreak = Math.max(profile.max_win_streak_casual || 0, profile.max_win_streak_ranked || 0);
      document.getElementById('profile-stat-max-streak').textContent = maxStreak;

      document.getElementById('profile-stat-fav-deck').textContent = profile.most_used_deck || 'Ninguno';

      // 6. Poblar y filtrar la galería de emblemas
      const unlockedCount = emblems.filter(e => e.unlocked_at !== null).length;
      document.getElementById('unlocked-emblems-counter').textContent = unlockedCount;
      
      // Guardar filtro activo
      const activeFilterBtn = document.querySelector('.filter-tab.active');
      const activeFilter = activeFilterBtn ? activeFilterBtn.getAttribute('data-filter') : 'all';
      this.filterEmblemsGallery(activeFilter);

      // Mostrar el modal
      document.getElementById('modal-detailed-profile').classList.add('active');
    } catch (err) {
      console.error(err);
      window.customAlert('Error', 'No se pudo abrir el perfil: ' + err.message);
    }
  }

  updateFeaturedEmblemsSlotsUI() {
    for (let i = 1; i <= 3; i++) {
      const slotEl = document.querySelector(`.featured-emblem-slot[data-slot="${i}"]`);
      const plusIcon = slotEl.querySelector('.slot-empty-icon');
      const imgEl = slotEl.querySelector('.slot-emblem-img');
      const emblemId = this.tempFeaturedEmblems[i - 1];

      if (emblemId) {
        // Encontrar la configuración del emblema para obtener el archivo de imagen
        const dbEmblems = this.currentEmblemsList || [];
        const emblemObj = dbEmblems.find(e => e.emblem_id === emblemId);
        if (emblemObj && emblemObj.image_file) {
          imgEl.src = `Assets/emblems/Jugador/${emblemObj.image_file}`;
          imgEl.style.display = 'block';
          plusIcon.style.display = 'none';
          slotEl.classList.add('equipped');
          slotEl.title = `Destacado: ${emblemId}. Clic para cambiar.`;
        } else {
          imgEl.style.display = 'none';
          plusIcon.style.display = 'block';
          slotEl.classList.remove('equipped');
          slotEl.title = 'Clic para destacar emblema';
        }
      } else {
        imgEl.style.display = 'none';
        plusIcon.style.display = 'block';
        slotEl.classList.remove('equipped');
        slotEl.title = 'Clic para destacar emblema';
      }
    }
  }

  openEmblemPickerForSlot(slotNum) {
    this.currentActiveSlotForPicker = slotNum;
    const pickerGrid = document.getElementById('picker-emblems-grid');
    if (!pickerGrid) return;
    
    pickerGrid.innerHTML = '';
    
    // Obtener los emblemas que el usuario ya haya desbloqueado
    const unlockedEmblems = (this.currentEmblemsList || []).filter(e => e.unlocked_at !== null);

    if (unlockedEmblems.length === 0) {
      pickerGrid.innerHTML = '<div style="grid-column: 1 / span 5; text-align: center; color: var(--color-text-muted); padding: 15px; font-size: 0.85rem;">No has desbloqueado ningún emblema aún. ¡Sigue jugando para conseguirlos!</div>';
    } else {
      unlockedEmblems.forEach(emblem => {
        const card = document.createElement('div');
        card.className = 'picker-emblem-card';
        card.title = `${emblem.emblem_id}: ${emblem.description}`;
        card.innerHTML = `<img src="Assets/emblems/Jugador/${emblem.image_file}" alt="${emblem.emblem_id}">`;
        card.addEventListener('click', () => {
          this.equipEmblemToSlot(emblem.emblem_id, slotNum);
          document.getElementById('modal-emblem-picker').classList.remove('active');
        });
        pickerGrid.appendChild(card);
      });
    }

    // Mostrar el modal picker
    document.getElementById('modal-emblem-picker').classList.add('active');
  }

  equipEmblemToSlot(emblemId, slotNum) {
    // Evitar que el mismo emblema sea equipado en múltiples ranuras
    const index = this.tempFeaturedEmblems.indexOf(emblemId);
    if (index !== -1) {
      // Si ya estaba en otro slot, lo removemos de allí
      this.tempFeaturedEmblems[index] = null;
    }

    this.tempFeaturedEmblems[slotNum - 1] = emblemId;
    this.updateFeaturedEmblemsSlotsUI();
  }

  unequipFeaturedSlot(slotNum) {
    this.tempFeaturedEmblems[slotNum - 1] = null;
    this.updateFeaturedEmblemsSlotsUI();
  }

  filterEmblemsGallery(filter) {
    const grid = document.getElementById('profile-emblems-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const emblems = this.currentEmblemsList || [];

    // Mapear los emblemas en un formato con la bandera de desbloqueo, ordenados (obtenidos primero)
    const processedEmblems = emblems.map(e => ({
      ...e,
      isUnlocked: e.unlocked_at !== null
    }));

    // Ordenar: Obtenidos primero (true antes que false)
    processedEmblems.sort((a, b) => {
      if (a.isUnlocked && !b.isUnlocked) return -1;
      if (!a.isUnlocked && b.isUnlocked) return 1;
      return a.emblem_id.localeCompare(b.emblem_id);
    });

    // Filtrar según la categoría seleccionada
    const filtered = processedEmblems.filter(e => {
      if (filter === 'all') return true;
      if (filter === 'unlocked') return e.isUnlocked;
      return e.category === filter;
    });

    if (filtered.length === 0) {
      grid.innerHTML = '<div style="grid-column: 1 / span 5; text-align: center; color: var(--color-text-muted); padding: 30px; font-size: 0.9rem;">Ningún emblema coincide con el filtro seleccionado.</div>';
      return;
    }

    filtered.forEach(emblem => {
      const item = document.createElement('div');
      item.className = `emblem-card-item ${emblem.isUnlocked ? 'unlocked' : 'locked'}`;
      item.innerHTML = `<img class="emblem-card-img" src="Assets/emblems/Jugador/${emblem.image_file}" alt="${emblem.emblem_id}">`;

      item.addEventListener('mouseenter', () => {
        this.showEmblemGlobalTooltip(item, emblem);
      });
      item.addEventListener('mouseleave', () => {
        this.hideEmblemGlobalTooltip();
      });

      grid.appendChild(item);
    });
  }

  showEmblemGlobalTooltip(item, emblem) {
    const tooltip = document.getElementById('emblem-global-tooltip');
    if (!tooltip) return;

    const statusText = emblem.isUnlocked ? 'LOGRADO' : 'BLOQUEADO';
    const statusClass = emblem.isUnlocked ? 'unlocked' : 'locked';
    const pct = Math.min(100, Math.floor((emblem.progress / emblem.target_value) * 100));

    tooltip.innerHTML = `
      <div class="emblem-tooltip-title">
        <span>${emblem.emblem_id}</span>
        <span class="emblem-tooltip-status ${statusClass}">${statusText}</span>
      </div>
      <div class="emblem-tooltip-desc">${emblem.description}</div>
      <div class="emblem-tooltip-progress-container">
        <div class="emblem-tooltip-progress-bar" style="width: ${pct}%;"></div>
      </div>
      <div class="emblem-tooltip-progress-text">Progreso: ${emblem.progress} / ${emblem.target_value}</div>
    `;

    tooltip.style.display = 'block';

    const rect = item.getBoundingClientRect();
    const container = document.querySelector('.profile-modal-container');
    if (!container) return;
    const containerRect = container.getBoundingClientRect();

    const left = rect.left - containerRect.left + (rect.width / 2);
    const top = rect.top - containerRect.top;

    const tooltipWidth = 215;
    const modalWidth = containerRect.width;
    let leftOffset = left;
    if (left - (tooltipWidth / 2) < 15) {
      leftOffset = (tooltipWidth / 2) + 15;
    } else if (left + (tooltipWidth / 2) > modalWidth - 15) {
      leftOffset = modalWidth - (tooltipWidth / 2) - 15;
    }

    tooltip.style.left = `${leftOffset}px`;

    // Si está muy arriba (primera o segunda fila), posicionar tooltip por debajo
    if (top < 140) {
      tooltip.style.top = `${rect.bottom - containerRect.top + 8}px`;
      tooltip.style.transform = 'translateX(-50%) translateY(0)';
    } else {
      tooltip.style.top = `${top - 8}px`;
      tooltip.style.transform = 'translateX(-50%) translateY(-100%)';
    }
  }

  hideEmblemGlobalTooltip() {
    const tooltip = document.getElementById('emblem-global-tooltip');
    if (tooltip) {
      tooltip.style.display = 'none';
    }
  }

  async saveProfileChanges() {
    const titleSelect = document.getElementById('profile-title-select');
    const selectedTitle = titleSelect ? titleSelect.value : 'Novato';

    const requestBody = {
      avatar: this.tempSelectedAvatar,
      title: selectedTitle,
      featured_emblem_1: this.tempFeaturedEmblems[0] || null,
      featured_emblem_2: this.tempFeaturedEmblems[1] || null,
      featured_emblem_3: this.tempFeaturedEmblems[2] || null
    };

    try {
      const token = localStorage.getItem('pkmn_session_token');
      const res = await fetch('/api/user/profile/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(requestBody)
      });

      if (res.ok) {
        // Actualizar datos locales
        this.currentUser.avatar = requestBody.avatar;
        this.currentUser.title = requestBody.title;
        this.currentUser.featured_emblem_1 = requestBody.featured_emblem_1;
        this.currentUser.featured_emblem_2 = requestBody.featured_emblem_2;
        this.currentUser.featured_emblem_3 = requestBody.featured_emblem_3;

        // Actualizar UI del menú lateral
        const menuAvatar = document.getElementById('menu-user-avatar');
        if (menuAvatar) menuAvatar.src = 'Assets/' + requestBody.avatar;

        // Cerrar el modal
        document.getElementById('modal-detailed-profile').classList.remove('active');
        
        await window.customAlert('Éxito', '¡Tu perfil ha sido actualizado correctamente!');
      } else {
        const errorData = await res.json();
        window.customAlert('Error', 'No se pudo guardar la configuración: ' + (errorData.error || 'error desconocido'));
      }
    } catch (err) {
      console.error(err);
      window.customAlert('Error', 'Error de red al guardar el perfil: ' + err.message);
    }
  }

  async updateDashboard() {
    await this.updateDashboardStatus();
    await this.updateDashboardTop3();
    await this.updateDashboardRecentDuels();
    this.updateRankedProfileUI();
    this.updateUserRankIcon();

    // Check for any pending promotions or unlocks saved in localStorage
    const pendingPromoStr = localStorage.getItem('pkmn_pending_promotion');
    if (pendingPromoStr) {
      try {
        const { title, img, message } = JSON.parse(pendingPromoStr);
        this.showAnnouncementModal(title, img, message);
        localStorage.removeItem('pkmn_pending_promotion');
        if (this.onlineDuel) this.onlineDuel.pendingPromotion = null;
      } catch (e) {
        console.error(e);
      }
    } else {
      const pendingDemotionStr = localStorage.getItem('pkmn_pending_demotion');
      if (pendingDemotionStr) {
        try {
          const { title, img, message } = JSON.parse(pendingDemotionStr);
          this.showAnnouncementModal(title, img, message);
          localStorage.removeItem('pkmn_pending_demotion');
          if (this.onlineDuel) this.onlineDuel.pendingDemotion = null;
        } catch (e) {
          console.error(e);
        }
      } else {
        const pendingUnlocksStr = localStorage.getItem('pkmn_pending_unlocks');
        if (pendingUnlocksStr) {
          try {
            const { title, img, message } = JSON.parse(pendingUnlocksStr);
            this.showAnnouncementModal(title, img, message);
            localStorage.removeItem('pkmn_pending_unlocks');
            if (this.onlineDuel) this.onlineDuel.pendingUnlocks = null;
          } catch (e) {
            console.error(e);
          }
        }
      }
    }
  }

  async updateDashboardStatus() {
    try {
      const resStatus = await fetch('/api/server-status');
      if (resStatus.ok) {
        const dataStatus = await resStatus.json();
        const playersEl = document.getElementById('news-stat-players');
        const queueNormalEl = document.getElementById('news-stat-queue-normal');
        const queueRankedEl = document.getElementById('news-stat-queue-ranked');
        
        if (playersEl) playersEl.textContent = dataStatus.onlinePlayers;
        if (queueNormalEl) queueNormalEl.textContent = dataStatus.inQueue;
        if (queueRankedEl) queueRankedEl.textContent = dataStatus.inRankedQueue;
        
        const queueCountEl = document.getElementById('queue-online-count');
        if (queueCountEl) queueCountEl.textContent = dataStatus.inQueue;

        const queueRankedCountEl = document.getElementById('queue-ranked-online-count');
        if (queueRankedCountEl) queueRankedCountEl.textContent = dataStatus.inRankedQueue;
      }
    } catch (err) {
      console.warn('Failed to update dashboard status:', err);
    }
  }

  async updateDashboardTop3() {
    try {
      const top3ListEl = document.getElementById('news-top3-list');
      if (!top3ListEl) return;

      top3ListEl.innerHTML = '<div class="news-loading">Cargando...</div>';

      if (this.currentTop3Tab === 'ranked') {
        const res = await fetch('/api/ranked/leaderboard?category=all&level=all');
        if (res.ok) {
          const data = await res.json();
          top3ListEl.innerHTML = '';
          const top3 = data.leaderboard.slice(0, 3);
          if (top3.length === 0) {
            top3ListEl.innerHTML = '<div class="news-loading">No hay datos aún</div>';
          } else {
            const TROPHY_IMAGES = {
              'Principiante': 'Assets/Trofeos/1-Principiante-1-3.png',
              'Great': 'Assets/Trofeos/2-Great-1-4.png',
              'Experto': 'Assets/Trofeos/3-Experto-1-5.png',
              'Veterano': 'Assets/Trofeos/4-Veterano-1-5.png',
              'Ultra': 'Assets/Trofeos/5-Ultra-1-5.png',
              'Maestro': 'Assets/Trofeos/6-Maestro.png'
            };
            top3.forEach((player, idx) => {
              const div = document.createElement('div');
              div.className = `news-item top-${idx + 1}`;
              
              const trophyImg = TROPHY_IMAGES[player.ranked_category] || TROPHY_IMAGES['Principiante'];
              const badgeHtml = `<img class="ranked-trophy-cell-img" src="${trophyImg}" alt="Rango" style="width: 20px; height: 20px; margin-right: 4px; vertical-align: middle;">`;
              
              const lvlText = player.ranked_category === 'Maestro' ? '' : ` ${player.ranked_level}`;
              const valText = player.ranked_category === 'Maestro' 
                ? `V: ${player.master_ranked_wins}` 
                : `${player.ranked_category}${lvlText}`;

              div.innerHTML = `
                <span><strong>#${idx + 1}</strong> ${player.name}</span>
                <span class="news-item-win" style="display: flex; align-items: center; color: #ffcb05; font-weight: bold;">${badgeHtml} ${valText}</span>
              `;
              top3ListEl.appendChild(div);
            });
          }
        }
      } else {
        const res = await fetch('/api/leaderboard');
        if (res.ok) {
          const data = await res.json();
          top3ListEl.innerHTML = '';
          const top3 = data.leaderboard.slice(0, 3);
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
    } catch (err) {
      console.warn('Failed to update Top 3 dashboard:', err);
    }
  }

  async updateDashboardRecentDuels() {
    try {
      const duelsListEl = document.getElementById('news-duels-list');
      if (!duelsListEl) return;

      duelsListEl.innerHTML = '<div class="news-loading">Cargando...</div>';

      const resRecent = await fetch(`/api/recent-battles?type=${this.currentDuelsTab}`);
      if (resRecent.ok) {
        const dataRecent = await resRecent.json();
        duelsListEl.innerHTML = '';
        if (dataRecent.length === 0) {
          duelsListEl.innerHTML = '<div class="news-loading">No hay combates recientes</div>';
        } else {
          dataRecent.forEach(battle => {
            const div = document.createElement('div');
            div.className = 'news-item';
            
            let p1Subtext = '';
            let p2Subtext = '';
            if (battle.is_ranked) {
              const p1Lvl = battle.winner_category === 'Maestro' ? '' : ` ${battle.winner_level}`;
              const p2Lvl = battle.loser_category === 'Maestro' ? '' : ` ${battle.loser_level}`;
              p1Subtext = `<div style="font-size:0.7rem; color:var(--color-text-muted); margin-top:2px;">${battle.winner_category}${p1Lvl}</div>`;
              p2Subtext = `<div style="font-size:0.7rem; color:var(--color-text-muted); margin-top:2px;">${battle.loser_category}${p2Lvl}</div>`;
            }
            
            div.innerHTML = `
              <div style="text-align:left; flex: 1;">
                <span class="news-item-vs"><strong class="winner-highlight">${battle.winner_name}</strong> vs ${battle.loser_name}</span>
                <div style="display: flex; gap: 15px;">
                  ${p1Subtext}
                  ${p2Subtext}
                </div>
              </div>
            `;
            duelsListEl.appendChild(div);
          });
        }
      }
    } catch (err) {
      console.warn('Failed to update recent duels dashboard:', err);
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

      const tbody = document.getElementById('leaderboard-tbody');
      tbody.innerHTML = '';

      const trophyImgEl = document.getElementById('leaderboard-user-avatar-trophy');
      const emojiEl = document.getElementById('leaderboard-user-avatar-emoji');
      const rankedDetailsEl = document.getElementById('leaderboard-user-ranked-details');
      const categoryEl = document.getElementById('leaderboard-user-category');
      const levelEl = document.getElementById('leaderboard-user-level');
      const victoriesLabelEl = document.getElementById('leaderboard-user-victories-label');
      
      const TROPHY_IMAGES = {
        'Principiante': 'Assets/Trofeos/1-Principiante-1-3.png',
        'Great': 'Assets/Trofeos/2-Great-1-4.png',
        'Experto': 'Assets/Trofeos/3-Experto-1-5.png',
        'Veterano': 'Assets/Trofeos/4-Veterano-1-5.png',
        'Ultra': 'Assets/Trofeos/5-Ultra-1-5.png',
        'Maestro': 'Assets/Trofeos/6-Maestro.png'
      };

      if (this.currentLeaderboardTab === 'ranked') {
        const catFilter = document.getElementById('select-ranked-filter-category').value || 'all';
        const lvlFilter = document.getElementById('select-ranked-filter-level').value || 'all';
        
        const res = await fetch(`/api/ranked/leaderboard?category=${catFilter}&level=${lvlFilter}`, { headers });
        if (!res.ok) throw new Error('Failed to fetch ranked leaderboard');
        
        const data = await res.json();
        const { leaderboard, summary, personal } = data;

        // 1. Update upper category count badges
        if (summary) {
          document.getElementById('count-cat-principiante').textContent = summary['Principiante'] || 0;
          document.getElementById('count-cat-great').textContent = summary['Great'] || 0;
          document.getElementById('count-cat-experto').textContent = summary['Experto'] || 0;
          document.getElementById('count-cat-veterano').textContent = summary['Veterano'] || 0;
          document.getElementById('count-cat-ultra').textContent = summary['Ultra'] || 0;
          document.getElementById('count-cat-maestro').textContent = summary['Maestro'] || 0;
        }

        // 2. Update metric header label
        document.getElementById('leaderboard-th-metric').textContent = 'Rendimiento';

        // 3. Update sidebar stats
        if (emojiEl) emojiEl.style.display = 'none';
        if (trophyImgEl) trophyImgEl.style.display = 'block';
        if (rankedDetailsEl) rankedDetailsEl.style.display = 'block';
        if (victoriesLabelEl) victoriesLabelEl.textContent = 'Victorias Ranked';

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
            if (categoryEl) categoryEl.textContent = personal.ranked_category;
            if (levelEl) levelEl.textContent = personal.ranked_category === 'Maestro' ? '' : `Nivel ${personal.ranked_level}`;
            if (trophyImgEl) trophyImgEl.src = TROPHY_IMAGES[personal.ranked_category] || TROPHY_IMAGES['Principiante'];
          }
        } else {
          rankNameEl.textContent = 'Invitado';
          rankEmailEl.textContent = 'Inicia sesión para ver tu rango';
          rankPosEl.textContent = '#--';
          rankVicEl.textContent = '0';
          if (categoryEl) categoryEl.textContent = 'Principiante';
          if (levelEl) levelEl.textContent = 'Nivel 1';
          if (trophyImgEl) trophyImgEl.src = TROPHY_IMAGES['Principiante'];
        }

        // 4. Render items
        if (leaderboard.length === 0) {
          const row = document.createElement('tr');
          row.innerHTML = `<td colspan="3" style="text-align: center; color: var(--color-text-muted); padding: 30px;">Ningún entrenador en este rango actualmente.</td>`;
          tbody.appendChild(row);
        } else {
          leaderboard.forEach((player, index) => {
            const row = document.createElement('tr');
            const trophyImg = TROPHY_IMAGES[player.ranked_category] || TROPHY_IMAGES['Principiante'];
            
            const badgeHtml = `<div style="display:flex; align-items:center; gap:8px;"><img class="ranked-trophy-cell-img" src="${trophyImg}" alt="Rango"> <span>#${index + 1}</span></div>`;
            
            const lvlText = player.ranked_category === 'Maestro' ? '' : ` - Nivel ${player.ranked_level}`;
            const coachHtml = `
              <strong>${player.name}</strong>
              <div style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 4px;">
                ${player.ranked_category}${lvlText} | Partidas Ranked: ${player.total_games || 0}
              </div>
            `;

            let performanceText = '';
            if (player.ranked_category === 'Maestro') {
              performanceText = `V: ${player.master_ranked_wins || 0}`;
            } else {
              const RANK_LIMITS = { 'Principiante': 3, 'Great': 4, 'Experto': 5, 'Veterano': 5, 'Ultra': 5 };
              const limit = RANK_LIMITS[player.ranked_category] || 3;
              performanceText = `Racha: ${player.consecutive_wins || 0}/${limit}`;
            }

            row.innerHTML = `
              <td style="padding: 15px; font-weight: 700;">${badgeHtml}</td>
              <td style="padding: 15px;">${coachHtml}</td>
              <td style="padding: 15px; text-align: right; font-weight: 700; color: #ffcb05;">${performanceText}</td>
            `;
            tbody.appendChild(row);
          });
        }
      } else {
        // General leaderboard path
        const res = await fetch('/api/leaderboard', { headers });
        if (!res.ok) throw new Error('Failed to fetch leaderboard list');

        const data = await res.json();
        const { leaderboard, personal } = data;

        // Reset metric header label
        document.getElementById('leaderboard-th-metric').textContent = 'Victorias';

        // Update sidebar stats
        if (emojiEl) emojiEl.style.display = 'block';
        if (trophyImgEl) trophyImgEl.style.display = 'none';
        if (rankedDetailsEl) rankedDetailsEl.style.display = 'none';
        if (victoriesLabelEl) victoriesLabelEl.textContent = 'Victorias';

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
            
            // Update leaderboard left sidebar emoji based on position
            let rankIcon = '⭐';
            const pos = personal.position;
            if (pos === 1) rankIcon = '👑';
            else if (pos === 2) rankIcon = '💎';
            else if (pos === 3) rankIcon = '🥇';
            else if (pos === 4) rankIcon = '🥈';
            else if (pos === 5) rankIcon = '🥉';
            else if (pos >= 6 && pos <= 250) rankIcon = '🏆';
            else rankIcon = '⭐';
            if (emojiEl) emojiEl.textContent = rankIcon;
          }
        } else {
          rankNameEl.textContent = 'Invitado';
          rankEmailEl.textContent = 'Inicia sesión para ver tu rango';
          rankPosEl.textContent = '#--';
          rankVicEl.textContent = '0';
        }

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
                <div style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 4px;">Partidas Normales: ${player.total_games || 0}</div>
              </td>
              <td style="padding: 15px; text-align: right; font-weight: 700; color: var(--color-primary);">${player.victories}</td>
            `;
            tbody.appendChild(row);
          });
        }
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

      this.loadedHistory = await res.json();
      this.renderHistory();

      this.navigateTo('history');
    } catch (err) {
      console.error(err);
      await window.customAlert('Error de Conexión', 'Error de conexión al recuperar el historial.');
    }
  }

  renderHistory() {
    const history = this.loadedHistory || [];
    const tbody = document.getElementById('history-tbody');
    const emptyMsg = document.getElementById('history-empty-message');
    const searchInput = document.getElementById('input-history-search');
    const clearBtn = document.getElementById('btn-clear-history-search');

    if (tbody) tbody.innerHTML = '';

    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';

    if (clearBtn) {
      clearBtn.style.display = searchTerm ? 'block' : 'none';
    }

    // 1. Filtrar por pestaña (normal vs ranked)
    let filtered = history.filter(battle => {
      const isRanked = !!battle.is_ranked;
      return this.currentHistoryTab === 'ranked' ? isRanked : !isRanked;
    });

    // 2. Filtrar por búsqueda si hay término
    if (searchTerm) {
      filtered = filtered.filter(battle => {
        // Rival
        const opponentMatch = battle.opponent_name.toLowerCase().includes(searchTerm);
        
        // Resultado ("won"/"lost" y traducido "ganado"/"perdido")
        const outcomeText = battle.result === 'won' ? 'ganado' : 'perdido';
        const outcomeMatch = outcomeText.includes(searchTerm) || battle.result.toLowerCase().includes(searchTerm);

        // Fecha formateada en es-ES
        const date = new Date(battle.created_at).toLocaleDateString('es-ES', {
          year: 'numeric', month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit'
        }).toLowerCase();
        const dateMatch = date.includes(searchTerm);

        return opponentMatch || outcomeMatch || dateMatch;
      });
    }

    if (!tbody) return;

    if (filtered.length === 0) {
      emptyMsg.style.display = 'block';
      if (searchTerm) {
        emptyMsg.textContent = 'No se encontraron combates que coincidan con la búsqueda.';
      } else {
        emptyMsg.textContent = this.currentHistoryTab === 'ranked'
          ? 'No has disputado ninguna batalla ranked todavía.'
          : 'No has disputado ninguna batalla online normal todavía.';
      }
    } else {
      emptyMsg.style.display = 'none';
      filtered.forEach(battle => {
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

        let opponentDetailsHtml = `<strong>${battle.opponent_name}</strong>`;
        if (battle.is_ranked) {
          const oppLvlText = battle.opponent_category === 'Maestro' ? '' : ` (Nivel ${battle.opponent_level})`;
          opponentDetailsHtml += `<div style="font-size:0.75rem; color:var(--color-text-muted); margin-top:2px;">${battle.opponent_category}${oppLvlText}</div>`;
        }

        row.innerHTML = `
          <td style="padding: 15px;">${opponentDetailsHtml}</td>
          <td style="padding: 15px;"><span class="history-outcome ${outcomeClass}">${outcomeText}</span></td>
          <td style="padding: 15px;">${durationText}</td>
          <td style="padding: 15px; text-align: right; color: var(--color-text-muted);">${date}</td>
        `;
        tbody.appendChild(row);
      });
    }
  }

  showAnnouncementModal(title, imgSrc, message) {
    const modal = document.getElementById('modal-announcement');
    const titleEl = document.getElementById('announcement-title');
    const imgEl = document.getElementById('announcement-img');
    const msgEl = document.getElementById('announcement-message');

    if (modal && titleEl && imgEl && msgEl) {
      titleEl.textContent = title;
      imgEl.src = imgSrc;
      msgEl.innerHTML = message;
      modal.classList.add('active');
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
