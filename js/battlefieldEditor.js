// js/battlefieldEditor.js

export class BattlefieldEditor {
  constructor(db) {
    this.db = db;
    this.images = [];
    this.positionsData = {};
    this.currentTheme = null;
    this.currentPositions = {};
    this.selectedSlotId = null;

    // Default template coordinates in percentage (797x480 board)
    // Card size default: width: 9%, height: 21%
    this.cardWidth = 9;
    this.cardHeight = 21;

    this.reversedPlaymats = [
      '4.png',
      '5.png',
      'id-11134207-7rbk6-m7j5avl665jp15.jpg'
    ];
  }

  init() {
    this.setupUI();
  }

  // Get default coordinates template (standard or reversed)
  getDefaultTemplate(isReversed = false) {
    const w = this.cardWidth;
    const h = this.cardHeight;
    const template = {};

    if (!isReversed) {
      // OPPONENT (Top side)
      // Bench (spaced horizontally)
      template['opponent-bench-0'] = { left: 24.5, top: 6, width: w, height: h };
      template['opponent-bench-1'] = { left: 35.0, top: 6, width: w, height: h };
      template['opponent-bench-2'] = { left: 45.5, top: 6, width: w, height: h };
      template['opponent-bench-3'] = { left: 56.0, top: 6, width: w, height: h };
      template['opponent-bench-4'] = { left: 66.5, top: 6, width: w, height: h };

      // Active
      template['opponent-active'] = { left: 45.5, top: 28, width: w, height: h };

      // Deck & Discard (Right)
      template['opponent-deck'] = { left: 86.0, top: 6, width: w, height: h };
      template['opponent-discard'] = { left: 86.0, top: 28, width: w, height: h };

      // Trainer (Left of deck)
      template['opponent-trainer'] = { left: 74.5, top: 28, width: w, height: h };

      // Prizes (Left, 2 columns of 3)
      template['opponent-prize-0'] = { left: 5.0, top: 6, width: w, height: h };
      template['opponent-prize-1'] = { left: 14.5, top: 6, width: w, height: h };
      template['opponent-prize-2'] = { left: 5.0, top: 20, width: w, height: h };
      template['opponent-prize-3'] = { left: 14.5, top: 20, width: w, height: h };
      template['opponent-prize-4'] = { left: 5.0, top: 34, width: w, height: h };
      template['opponent-prize-5'] = { left: 14.5, top: 34, width: w, height: h };

      // PLAYER (Bottom side)
      // Active
      template['player-active'] = { left: 45.5, top: 51, width: w, height: h };

      // Bench (spaced horizontally)
      template['player-bench-0'] = { left: 24.5, top: 73, width: w, height: h };
      template['player-bench-1'] = { left: 35.0, top: 73, width: w, height: h };
      template['player-bench-2'] = { left: 45.5, top: 73, width: w, height: h };
      template['player-bench-3'] = { left: 56.0, top: 73, width: w, height: h };
      template['player-bench-4'] = { left: 66.5, top: 73, width: w, height: h };

      // Deck & Discard (Right)
      template['player-deck'] = { left: 86.0, top: 73, width: w, height: h };
      template['player-discard'] = { left: 86.0, top: 51, width: w, height: h };

      // Trainer
      template['player-trainer'] = { left: 74.5, top: 51, width: w, height: h };

      // Prizes (Left)
      template['player-prize-0'] = { left: 5.0, top: 51, width: w, height: h };
      template['player-prize-1'] = { left: 14.5, top: 51, width: w, height: h };
      template['player-prize-2'] = { left: 5.0, top: 65, width: w, height: h };
      template['player-prize-3'] = { left: 14.5, top: 65, width: w, height: h };
      template['player-prize-4'] = { left: 5.0, top: 79, width: w, height: h };
      template['player-prize-5'] = { left: 14.5, top: 79, width: w, height: h };

      // Shared Stadium (Center-left)
      template['stadium'] = { left: 32.5, top: 39.5, width: w, height: h };
    } else {
      // REVERSED TEMPLATE (Horizontal Mirror: left = 100 - w - original_left)
      // OPPONENT (Top side)
      // Bench (spaced horizontally)
      template['opponent-bench-0'] = { left: 66.5, top: 6, width: w, height: h };
      template['opponent-bench-1'] = { left: 56.0, top: 6, width: w, height: h };
      template['opponent-bench-2'] = { left: 45.5, top: 6, width: w, height: h };
      template['opponent-bench-3'] = { left: 35.0, top: 6, width: w, height: h };
      template['opponent-bench-4'] = { left: 24.5, top: 6, width: w, height: h };

      // Active
      template['opponent-active'] = { left: 45.5, top: 28, width: w, height: h };

      // Deck & Discard (Left)
      template['opponent-deck'] = { left: 5.0, top: 6, width: w, height: h };
      template['opponent-discard'] = { left: 5.0, top: 28, width: w, height: h };

      // Trainer
      template['opponent-trainer'] = { left: 16.5, top: 28, width: w, height: h };

      // Prizes (Right)
      template['opponent-prize-0'] = { left: 86.0, top: 6, width: w, height: h };
      template['opponent-prize-1'] = { left: 76.5, top: 6, width: w, height: h };
      template['opponent-prize-2'] = { left: 86.0, top: 20, width: w, height: h };
      template['opponent-prize-3'] = { left: 76.5, top: 20, width: w, height: h };
      template['opponent-prize-4'] = { left: 86.0, top: 34, width: w, height: h };
      template['opponent-prize-5'] = { left: 76.5, top: 34, width: w, height: h };

      // PLAYER (Bottom side)
      // Active
      template['player-active'] = { left: 45.5, top: 51, width: w, height: h };

      // Bench (spaced horizontally)
      template['player-bench-0'] = { left: 66.5, top: 73, width: w, height: h };
      template['player-bench-1'] = { left: 56.0, top: 73, width: w, height: h };
      template['player-bench-2'] = { left: 45.5, top: 73, width: w, height: h };
      template['player-bench-3'] = { left: 35.0, top: 73, width: w, height: h };
      template['player-bench-4'] = { left: 24.5, top: 73, width: w, height: h };

      // Deck & Discard (Left)
      template['player-deck'] = { left: 5.0, top: 73, width: w, height: h };
      template['player-discard'] = { left: 5.0, top: 51, width: w, height: h };

      // Trainer
      template['player-trainer'] = { left: 16.5, top: 51, width: w, height: h };

      // Prizes (Right)
      template['player-prize-0'] = { left: 86.0, top: 51, width: w, height: h };
      template['player-prize-1'] = { left: 76.5, top: 51, width: w, height: h };
      template['player-prize-2'] = { left: 86.0, top: 65, width: w, height: h };
      template['player-prize-3'] = { left: 76.5, top: 65, width: w, height: h };
      template['player-prize-4'] = { left: 86.0, top: 79, width: w, height: h };
      template['player-prize-5'] = { left: 76.5, top: 79, width: w, height: h };

      // Shared Stadium (Center-right)
      template['stadium'] = { left: 58.5, top: 39.5, width: w, height: h };
    }

    return template;
  }

  // Snaps coordinates to the raw detected points in positions.json if nearby
  snapToRawPoints(template, rawData) {
    const snapped = { ...template };
    const radius = 12.0; // 12% max snapping distance

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

    // Snap opponent bench
    const oppBenchSlots = ['opponent-bench-0', 'opponent-bench-1', 'opponent-bench-2', 'opponent-bench-3', 'opponent-bench-4'];
    snapGroup(oppBenchSlots, rawData.opp_bench);

    // Snap player bench
    const playBenchSlots = ['player-bench-0', 'player-bench-1', 'player-bench-2', 'player-bench-3', 'player-bench-4'];
    snapGroup(playBenchSlots, rawData.play_bench);

    // Snap opponent core items (Active, prizes, deck, discard, trainer)
    const oppCoreSlots = ['opponent-active', 'opponent-deck', 'opponent-discard', 'opponent-trainer', 'opponent-prize-0', 'opponent-prize-1', 'opponent-prize-2', 'opponent-prize-3', 'opponent-prize-4', 'opponent-prize-5'];
    snapGroup(oppCoreSlots, rawData.opp_core);

    // Snap player core items
    const playCoreSlots = ['player-active', 'player-deck', 'player-discard', 'player-trainer', 'player-prize-0', 'player-prize-1', 'player-prize-2', 'player-prize-3', 'player-prize-4', 'player-prize-5'];
    snapGroup(playCoreSlots, rawData.play_core);

    return snapped;
  }

  // Set up screen elements and bindings
  setupUI() {
    // Dropdown slot selection
    const slotSelect = document.getElementById('editor-select-slot');
    slotSelect?.addEventListener('change', (e) => {
      this.selectSlot(e.target.value);
    });

    // Save and Reset buttons
    document.getElementById('btn-save-battlefield')?.addEventListener('click', () => this.savePositions());
    document.getElementById('btn-reset-battlefield')?.addEventListener('click', () => this.resetToDefault());

    // Sliders
    const sliders = ['x', 'y', 'w', 'h'];
    sliders.forEach(s => {
      const el = document.getElementById(`slider-${s}`);
      el?.addEventListener('input', (e) => {
        this.updateSelectedSlotFromSlider(s, parseFloat(e.target.value));
      });
    });
  }

  // Call this when showing the screen
  async onShow() {
    await this.loadBattlefields();
    if (this.images.length > 0) {
      this.loadTheme(this.images[0]);
    }
  }

  // Fetch battlefield images & current JSON positions
  async loadBattlefields() {
    try {
      // 1. Fetch images list
      const imgRes = await fetch('/api/battlefields');
      this.images = await imgRes.json();

      // 2. Fetch positions JSON
      const posRes = await fetch('/cards/Battlefields/positions.json');
      this.positionsData = await posRes.json();

      // Render the sidebar list
      const listContainer = document.getElementById('battlefields-list-container');
      if (listContainer) {
        listContainer.innerHTML = '';
        this.images.forEach(img => {
          const item = document.createElement('div');
          item.className = 'battlefield-thumb-item';
          if (img === this.currentTheme) item.classList.add('active');

          const hasCustom = this.positionsData[img] && Object.keys(this.positionsData[img]).includes('player-active');

          item.innerHTML = `
            <img src="/cards/Battlefields/${img}" alt="${img}">
            <div class="battlefield-thumb-info">
              <div class="battlefield-thumb-name">${img}</div>
              <div class="battlefield-thumb-status">${hasCustom ? 'Configurado Custom' : 'Configuración Automática'}</div>
            </div>
          `;

          item.addEventListener('click', () => {
            document.querySelectorAll('.battlefield-thumb-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            this.loadTheme(img);
          });

          listContainer.appendChild(item);
        });
      }
    } catch (err) {
      console.error('Error loading battlefields:', err);
    }
  }

  // Load a playmat theme background and position overlay slots
  loadTheme(themeName) {
    this.currentTheme = themeName;
    this.selectedSlotId = null;

    // Reset dropdown & sliders
    const slotSelect = document.getElementById('editor-select-slot');
    if (slotSelect) slotSelect.value = '';
    document.getElementById('editor-sliders-container')?.classList.add('disabled');

    // Determine configuration
    const saved = this.positionsData[themeName];
    const isReversed = this.reversedPlaymats.includes(themeName);
    const defaultTpl = this.getDefaultTemplate(isReversed);

    if (saved && saved['player-active']) {
      // Precise configuration exists
      this.currentPositions = { ...saved };
    } else {
      // No custom configuration yet: use defaults and snap to raw points if available
      if (saved) {
        this.currentPositions = this.snapToRawPoints(defaultTpl, saved);
      } else {
        this.currentPositions = defaultTpl;
      }
    }

    // Render Editor Board background & slot overlay divs
    const board = document.getElementById('editor-board');
    if (board) {
      board.style.backgroundImage = `url('/cards/Battlefields/${themeName}')`;
      board.innerHTML = ''; // Clear previous

      // Create a div overlay for each slot
      Object.keys(this.currentPositions).forEach(slotId => {
        const coords = this.currentPositions[slotId];
        const slotDiv = document.createElement('div');
        slotDiv.className = 'editor-slot';
        slotDiv.id = `editor-slot-${slotId}`;
        slotDiv.textContent = this.getSlotDisplayName(slotId);
        
        // Apply position
        this.applySlotCSS(slotDiv, coords);

        // Click handler to select
        slotDiv.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          this.selectSlot(slotId);
          this.startDrag(e, slotId, slotDiv);
        });

        board.appendChild(slotDiv);
      });
    }
  }

  applySlotCSS(element, coords) {
    element.style.left = `${coords.left}%`;
    element.style.top = `${coords.top}%`;
    element.style.width = `${coords.width}%`;
    element.style.height = `${coords.height}%`;
  }

  getSlotDisplayName(slotId) {
    if (slotId === 'player-active') return 'Activo Tú';
    if (slotId === 'opponent-active') return 'Activo Gary';
    if (slotId === 'player-trainer') return 'Trainer Tú';
    if (slotId === 'opponent-trainer') return 'Trainer Gary';
    if (slotId === 'player-deck') return 'Mazo Tú';
    if (slotId === 'player-discard') return 'Descarte Tú';
    if (slotId === 'opponent-deck') return 'Mazo Gary';
    if (slotId === 'opponent-discard') return 'Descarte Gary';
    if (slotId === 'stadium') return 'Estadio';
    if (slotId.startsWith('player-bench-')) return `Banca T${parseInt(slotId.split('-')[2]) + 1}`;
    if (slotId.startsWith('opponent-bench-')) return `Banca G${parseInt(slotId.split('-')[2]) + 1}`;
    if (slotId.startsWith('player-prize-')) return `Premio T${parseInt(slotId.split('-')[2]) + 1}`;
    if (slotId.startsWith('opponent-prize-')) return `Premio G${parseInt(slotId.split('-')[2]) + 1}`;
    return slotId;
  }

  // Select overlay slot and sync values to UI inputs
  selectSlot(slotId) {
    this.selectedSlotId = slotId;

    // Remove previous selection highlight
    document.querySelectorAll('.editor-slot').forEach(el => el.classList.remove('selected'));

    if (!slotId) {
      document.getElementById('editor-sliders-container')?.classList.add('disabled');
      const select = document.getElementById('editor-select-slot');
      if (select) select.value = '';
      return;
    }

    // Highlight selected slot div
    const activeDiv = document.getElementById(`editor-slot-${slotId}`);
    if (activeDiv) activeDiv.classList.add('selected');

    // Update select dropdown
    const select = document.getElementById('editor-select-slot');
    if (select) select.value = slotId;

    // Load coordinates into sliders
    const coords = this.currentPositions[slotId];
    if (coords) {
      document.getElementById('editor-sliders-container')?.classList.remove('disabled');

      this.updateSliderUI('x', coords.left);
      this.updateSliderUI('y', coords.top);
      this.updateSliderUI('w', coords.width);
      this.updateSliderUI('h', coords.height);
    }
  }

  updateSliderUI(type, val) {
    const slider = document.getElementById(`slider-${type}`);
    const label = document.getElementById(`val-slider-${type}`);
    if (slider) slider.value = val;
    if (label) label.textContent = `${val.toFixed(1)}%`;
  }

  // Update position from slider controls
  updateSelectedSlotFromSlider(type, val) {
    if (!this.selectedSlotId) return;

    const coords = this.currentPositions[this.selectedSlotId];
    if (!coords) return;

    if (type === 'x') coords.left = val;
    else if (type === 'y') coords.top = val;
    else if (type === 'w') coords.width = val;
    else if (type === 'h') coords.height = val;

    // Update label text
    const label = document.getElementById(`val-slider-${type}`);
    if (label) label.textContent = `${val.toFixed(1)}%`;

    // Apply styles to editor board overlay element
    const slotDiv = document.getElementById(`editor-slot-${this.selectedSlotId}`);
    if (slotDiv) {
      this.applySlotCSS(slotDiv, coords);
    }
  }

  // Handles drag interactions
  startDrag(e, slotId, slotDiv) {
    const board = document.getElementById('editor-board');
    if (!board) return;

    const boardRect = board.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;

    const initialLeft = this.currentPositions[slotId].left;
    const initialTop = this.currentPositions[slotId].top;

    const onMouseMove = (moveEvent) => {
      const dxPixels = moveEvent.clientX - startX;
      const dyPixels = moveEvent.clientY - startY;

      // Convert change in pixels to percentage relative to board size
      const dxPercent = (dxPixels / boardRect.width) * 100;
      const dyPercent = (dyPixels / boardRect.height) * 100;

      let newLeft = initialLeft + dxPercent;
      let newTop = initialTop + dyPercent;

      // Bound to board boundary
      newLeft = Math.max(0, Math.min(100 - this.currentPositions[slotId].width, newLeft));
      newTop = Math.max(0, Math.min(100 - this.currentPositions[slotId].height, newTop));

      // Clean decimals
      newLeft = Math.round(newLeft * 2) / 2; // 0.5 step
      newTop = Math.round(newTop * 2) / 2;

      this.currentPositions[slotId].left = newLeft;
      this.currentPositions[slotId].top = newTop;

      // Apply
      this.applySlotCSS(slotDiv, this.currentPositions[slotId]);

      // Sync sliders
      this.updateSliderUI('x', newLeft);
      this.updateSliderUI('y', newTop);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  // Save current slots layout to server positions.json file
  async savePositions() {
    if (!this.currentTheme) return;

    try {
      const response = await fetch('/api/save-positions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          theme: this.currentTheme,
          positions: this.currentPositions
        })
      });

      const resData = await response.json();
      if (resData.success) {
        await window.customAlert('Guardado Exitoso', `¡Coordenadas de ${this.currentTheme} guardadas exitosamente!`);
        // Reload settings
        await this.loadBattlefields();
      } else {
        await window.customAlert('Error al Guardar', 'Error al guardar: ' + (resData.error || 'Respuesta desconocida'));
      }
    } catch (err) {
      console.error(err);
      await window.customAlert('Error de Red', 'Error de conexión al guardar las coordenadas.');
    }
  }

  // Reset current theme coordinates to default template/snapped
  async resetToDefault() {
    if (!this.currentTheme) return;

    const confirmReset = await window.customConfirm('Restablecer Diseño', `¿Estás seguro de que quieres restablecer el diseño de ${this.currentTheme} a la plantilla original?`);
    if (confirmReset) {
      const isReversed = this.reversedPlaymats.includes(this.currentTheme);
      const defaultTpl = this.getDefaultTemplate(isReversed);

      // Re-fetch raw points from loaded positionsData if present
      const savedRaw = this.positionsData[this.currentTheme];
      
      if (savedRaw && (savedRaw.opp_bench || savedRaw.play_bench)) {
        // If savedRaw is raw detected points, snap them
        this.currentPositions = this.snapToRawPoints(defaultTpl, savedRaw);
      } else {
        this.currentPositions = defaultTpl;
      }

      // Re-load view
      this.loadTheme(this.currentTheme);
    }
  }
}
