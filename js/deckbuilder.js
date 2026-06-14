// js/deckbuilder.js

export class DeckBuilder {
  constructor(db) {
    this.db = db;
    this.currentDeck = {
      id: '',
      name: 'Mazo de Fuego',
      cards: [] // Array of { cardId: string, count: number }
    };
    this.savedDecks = {};
    
    // DOM Elements
    this.dbCardsGrid = document.getElementById('db-cards-grid');
    
    // Basic Filters
    this.dbSearchInput = document.getElementById('db-search-card');
    this.dbSearchText = document.getElementById('db-search-card-text');
    this.dbSearchEvolves = document.getElementById('db-search-card-evolves');
    
    // Advanced Filters panel
    this.dbBtnToggleAdvanced = document.getElementById('db-btn-toggle-advanced-filters');
    this.dbAdvancedPanel = document.getElementById('db-advanced-filters-panel');
    
    // Filter selection states
    this.selectedEnergyTypes = new Set();
    this.selectedCardSupertypes = new Set();
    this.selectedSubtypes = new Set();
    this.selectedRarities = new Set();
    this.selectedExpansions = new Set();
    this.selectedWeaknessTypes = new Set();
    this.selectedResistanceTypes = new Set();
    this.selectedAttackEnergyTypes = new Set();
    
    // Slider values
    this.psMax = 340;
    this.retreatMax = 5;
    this.attackMax = 5;
    
    this.deckNameInput = document.getElementById('deck-name-input');
    this.deckListTbody = document.getElementById('deck-list-tbody');
    this.savedDecksDropdown = document.getElementById('saved-decks-dropdown');
    
    // Validation selectors
    this.valPanel = document.getElementById('deck-validation-messages');
    
    // Summary counts
    this.countTotal = document.getElementById('deck-count-total');
    this.countPkmn = document.getElementById('deck-count-pkmn');
    this.countTrainer = document.getElementById('deck-count-trainer');
    this.countEnergy = document.getElementById('deck-count-energy');

    // Modals
    this.modalIO = document.getElementById('modal-deck-io');
    this.textareaIO = document.getElementById('deck-io-textarea');
  }

  init() {
    this.loadSavedDecks();

    // Event bindings
    const onCatalogFilter = () => this.renderCatalog();
    this.dbSearchInput?.addEventListener('input', onCatalogFilter);
    this.dbSearchText?.addEventListener('input', onCatalogFilter);
    this.dbSearchEvolves?.addEventListener('input', onCatalogFilter);

    // Bind energy selection grids
    this.bindEnergyGrid('db-filter-energy-types', this.selectedEnergyTypes);
    this.bindEnergyGrid('db-filter-weakness-types', this.selectedWeaknessTypes);
    this.bindEnergyGrid('db-filter-resistance-types', this.selectedResistanceTypes);
    this.bindEnergyGrid('db-filter-attack-energy-types', this.selectedAttackEnergyTypes);

    // Bind card type pills (supertypes)
    this.bindSupertypes();

    // Bind checklist search inputs
    this.bindChecklistSearch('db-search-subtype-input', 'db-filter-card-subtypes');
    this.bindChecklistSearch('db-search-rarity-input', 'db-filter-card-rarities');
    this.bindChecklistSearch('db-search-expansion-input', 'db-filter-card-expansions');

    // Bind single sliders
    this.bindSingleSlider('db-filter-ps-max', 'db-val-ps-max', 'psMax', ' PS', '0 a ');
    this.bindSingleSlider('db-filter-retreat-max', 'db-val-retreat-max', 'retreatMax', '', '0 a ');
    this.bindSingleSlider('db-filter-attack-max', 'db-val-attack-max', 'attackMax', '', '0 a ');

    // Advanced Panel Toggle
    this.dbBtnToggleAdvanced?.addEventListener('click', () => {
      const isCollapsed = this.dbAdvancedPanel.style.display === 'none' || this.dbAdvancedPanel.style.display === '';
      if (isCollapsed) {
        this.dbAdvancedPanel.style.display = 'block';
        this.dbBtnToggleAdvanced.classList.add('active');
        const arrow = this.dbBtnToggleAdvanced.querySelector('.arrow-indicator');
        if (arrow) arrow.textContent = '▲';
      } else {
        this.dbAdvancedPanel.style.display = 'none';
        this.dbBtnToggleAdvanced.classList.remove('active');
        const arrow = this.dbBtnToggleAdvanced.querySelector('.arrow-indicator');
        if (arrow) arrow.textContent = '▼';
      }
    });

    // Reset Filters Button
    document.getElementById('db-btn-reset-filters')?.addEventListener('click', () => {
      this.resetAllFilters();
    });

    document.getElementById('btn-new-deck')?.addEventListener('click', () => this.createNewDeck());
    document.getElementById('btn-save-deck')?.addEventListener('click', () => this.saveCurrentDeck());
    
    this.savedDecksDropdown?.addEventListener('change', (e) => {
      this.loadDeck(e.target.value);
    });

    // Import/Export bindings
    document.getElementById('btn-import-deck')?.addEventListener('click', () => this.openImportModal());
    document.getElementById('btn-export-deck')?.addEventListener('click', () => this.openExportModal());
    this.modalIO?.querySelector('.modal-close-btn')?.addEventListener('click', () => this.closeIOModal());
    document.getElementById('btn-deck-io-submit')?.addEventListener('click', () => this.submitIOAction());

    // Bind box cover option clicks
    const boxSelector = document.getElementById('deck-box-selector');
    if (boxSelector) {
      boxSelector.addEventListener('click', (e) => {
        const option = e.target.closest('.box-option');
        if (!option) return;
        if (this.currentDeck.isStarter) {
          window.customAlert?.('Info', 'No puedes cambiar el diseño de caja de un mazo inicial.');
          return;
        }
        
        // Update boxImage in currentDeck
        const boxName = option.dataset.box;
        this.currentDeck.boxImage = boxName;
        
        // Visual updates
        boxSelector.querySelectorAll('.box-option').forEach(opt => {
          if (opt.dataset.box === boxName) {
            opt.classList.add('active');
          } else {
            opt.classList.remove('active');
          }
        });
      });
    }
  }

  onShow() {
    this.renderRarityList();
    this.renderExpansionList();
    this.renderSubtypeList();
    this.renderCatalog();
    this.renderDeckWorkspace();
  }

  bindEnergyGrid(containerId, setTarget) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const buttons = container.querySelectorAll('.energy-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        if (btn.classList.contains('active')) {
          btn.classList.remove('active');
          setTarget.delete(type);
        } else {
          btn.classList.add('active');
          setTarget.add(type);
        }
        this.renderCatalog();
      });
    });
  }

  bindSupertypes() {
    const container = document.getElementById('db-filter-card-supertypes');
    if (!container) return;
    const buttons = container.querySelectorAll('.pill-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const st = btn.dataset.supertype;
        if (btn.classList.contains('active')) {
          btn.classList.remove('active');
          this.selectedCardSupertypes.delete(st);
        } else {
          btn.classList.add('active');
          this.selectedCardSupertypes.add(st);
        }
        this.renderCatalog();
      });
    });
  }

  bindSingleSlider(inputId, valId, propName, suffix = '', prefix = '') {
    const input = document.getElementById(inputId);
    const valText = document.getElementById(valId);
    if (!input) return;
    
    const update = () => {
      const val = parseInt(input.value);
      this[propName] = val;
      if (valText) {
        valText.textContent = `${prefix}${val}${suffix}`;
      }
    };
    
    input.addEventListener('input', () => {
      update();
      this.renderCatalog();
    });
    
    update();
  }

  bindChecklistSearch(inputId, containerId) {
    const input = document.getElementById(inputId);
    const container = document.getElementById(containerId);
    if (!input || !container) return;
    
    input.addEventListener('input', () => {
      const query = input.value.toLowerCase().trim();
      const labels = container.querySelectorAll('label');
      labels.forEach(label => {
        const text = label.textContent.toLowerCase();
        if (text.includes(query)) {
          label.style.display = 'flex';
        } else {
          label.style.display = 'none';
        }
      });
    });
  }

  renderExpansionList() {
    const container = document.getElementById('db-filter-card-expansions');
    if (!container || !this.db.sets) return;
    container.innerHTML = '';
    
    const sortedSets = [...this.db.sets].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    
    sortedSets.forEach(set => {
      const label = document.createElement('label');
      
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.value = set.id;
      chk.addEventListener('change', () => {
        if (chk.checked) {
          this.selectedExpansions.add(set.id);
        } else {
          this.selectedExpansions.delete(set.id);
        }
        this.renderCatalog();
      });
      
      label.appendChild(chk);
      label.appendChild(document.createTextNode(` ${set.name}`));
      container.appendChild(label);
    });
  }

  renderRarityList() {
    const container = document.getElementById('db-filter-card-rarities');
    if (!container) return;
    container.innerHTML = '';
    
    const allCards = this.db.getAllLoadedCards();
    const rarities = new Set();
    allCards.forEach(c => {
      if (c.rarity) rarities.add(c.rarity);
    });
    
    if (rarities.size === 0) {
      const defaultRarities = ["Common", "Uncommon", "Rare", "Rare Holo", "Promo"];
      defaultRarities.forEach(r => rarities.add(r));
    }
    
    const sortedRarities = Array.from(rarities).sort();
    
    sortedRarities.forEach(rarity => {
      const label = document.createElement('label');
      
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.value = rarity;
      chk.addEventListener('change', () => {
        if (chk.checked) {
          this.selectedRarities.add(rarity);
        } else {
          this.selectedRarities.delete(rarity);
        }
        this.renderCatalog();
      });
      
      label.appendChild(chk);
      label.appendChild(document.createTextNode(` ${rarity}`));
      container.appendChild(label);
    });
  }

  renderSubtypeList() {
    const container = document.getElementById('db-filter-card-subtypes');
    if (!container) return;
    container.innerHTML = '';
    
    const allCards = this.db.getAllLoadedCards();
    const subtypes = new Set();
    allCards.forEach(c => {
      if (c.subtypes) {
        c.subtypes.forEach(s => subtypes.add(s));
      }
    });
    
    if (subtypes.size === 0) {
      const defaultSubtypes = [
        'Basic', 'Stage 1', 'Stage 2', 'MEGA', 'EX', 'ex', 'GX', 'V', 'VMAX', 'VSTAR',
        'Item', 'Supporter', 'Stadium', 'Pokémon Tool', 'Special'
      ];
      defaultSubtypes.forEach(s => subtypes.add(s));
    }
    
    const sortedSubtypes = Array.from(subtypes).sort();
    
    const SUBTYPE_TRANSLATIONS = {
      'Basic': 'Básico (Basic)',
      'Stage 1': 'Fase 1 (Stage 1)',
      'Stage 2': 'Fase 2 (Stage 2)',
      'MEGA': 'Megaevolución (MEGA)',
      'EX': 'EX',
      'ex': 'ex',
      'GX': 'GX',
      'V': 'V',
      'VMAX': 'VMAX',
      'VSTAR': 'VSTAR',
      'BREAK': 'BREAK',
      'Baby': 'Bebé (Baby)',
      'TAG TEAM': 'Relevo (TAG TEAM)',
      'Item': 'Objeto (Item)',
      'Supporter': 'Partidario (Supporter)',
      'Stadium': 'Estadio (Stadium)',
      'Pokémon Tool': 'Herramienta Pokémon',
      'Technical Machine': 'Máquina Técnica',
      'Special': 'Especial (Special)'
    };
    
    sortedSubtypes.forEach(sub => {
      const label = document.createElement('label');
      const textNode = SUBTYPE_TRANSLATIONS[sub] || sub;
      
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.value = sub;
      chk.addEventListener('change', () => {
        if (chk.checked) {
          this.selectedSubtypes.add(sub);
        } else {
          this.selectedSubtypes.delete(sub);
        }
        this.renderCatalog();
      });
      
      label.appendChild(chk);
      label.appendChild(document.createTextNode(` ${textNode}`));
      container.appendChild(label);
    });
  }

  resetAllFilters() {
    if (this.dbSearchInput) this.dbSearchInput.value = '';
    if (this.dbSearchText) this.dbSearchText.value = '';
    if (this.dbSearchEvolves) this.dbSearchEvolves.value = '';
    
    this.selectedEnergyTypes.clear();
    this.selectedCardSupertypes.clear();
    this.selectedSubtypes.clear();
    this.selectedRarities.clear();
    this.selectedExpansions.clear();
    this.selectedWeaknessTypes.clear();
    this.selectedResistanceTypes.clear();
    this.selectedAttackEnergyTypes.clear();
    
    document.querySelectorAll('#db-filter-energy-types .energy-btn.active, #db-filter-weakness-types .energy-btn.active, #db-filter-resistance-types .energy-btn.active, #db-filter-attack-energy-types .energy-btn.active').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#db-filter-card-supertypes .pill-btn.active').forEach(b => b.classList.remove('active'));
    
    document.querySelectorAll('#db-filter-card-subtypes input[type="checkbox"], #db-filter-card-rarities input[type="checkbox"], #db-filter-card-expansions input[type="checkbox"]').forEach(c => {
      c.checked = false;
    });
    
    document.querySelectorAll('#db-search-subtype-input, #db-search-rarity-input, #db-search-expansion-input').forEach(input => {
      input.value = '';
    });
    document.querySelectorAll('#db-filter-card-subtypes label, #db-filter-card-rarities label, #db-filter-card-expansions label').forEach(l => {
      l.style.display = 'flex';
    });
    
    const resetSlider = (maxId, defMax, valId, propName, suffix = '', prefix = '') => {
      const input = document.getElementById(maxId);
      const valText = document.getElementById(valId);
      if (input) {
        input.value = defMax;
        if (valText) valText.textContent = `${prefix}${defMax}${suffix}`;
        this[propName] = defMax;
      }
    };
    
    resetSlider('db-filter-ps-max', 340, 'db-val-ps-max', 'psMax', ' PS', '0 a ');
    resetSlider('db-filter-retreat-max', 5, 'db-val-retreat-max', 'retreatMax', '', '0 a ');
    resetSlider('db-filter-attack-max', 5, 'db-val-attack-max', 'attackMax', '', '0 a ');
    
    this.renderCatalog();
  }

  // Define two highly accurate starter decks for easy playing
  registerStarterDecks() {
    // Check if starter decks exist in localStorage, if not add them
    if (!this.savedDecks['starter-overgrowth']) {
      this.savedDecks['starter-overgrowth'] = {
        id: 'starter-overgrowth',
        name: 'Overgrowth (Grass/Water Starter)',
        isStarter: true,
        boxImage: 'pokeball.png',
        cards: [
          { cardId: 'base1-2', count: 2 },   // Blastoise (Stage 2)
          { cardId: 'base1-42', count: 3 },  // Wartortle (Stage 1)
          { cardId: 'base1-63', count: 4 },  // Squirtle (Basic)
          { cardId: 'base1-30', count: 3 },  // Ivysaur (Stage 1)
          { cardId: 'base1-44', count: 4 },  // Bulbasaur (Basic)
          { cardId: 'base1-69', count: 4 },  // Weedle (Basic)
          { cardId: 'base1-33', count: 3 },  // Kakuna (Stage 1)
          { cardId: 'base1-17', count: 1 },  // Beedrill (Stage 2)
          { cardId: 'base1-91', count: 4 },  // Bill
          { cardId: 'base1-88', count: 2 },  // Professor Oak
          { cardId: 'base1-94', count: 4 },  // Potion
          { cardId: 'base1-95', count: 2 },  // Switch
          { cardId: 'base1-99', count: 14 }, // Grass Energy
          { cardId: 'base1-102', count: 14 } // Water Energy
        ]
      };
    }

    if (!this.savedDecks['starter-zap']) {
      this.savedDecks['starter-zap'] = {
        id: 'starter-zap',
        name: 'Zap! (Lightning/Psychic Starter)',
        isStarter: true,
        boxImage: 'pokeball.png',
        cards: [
          { cardId: 'base1-1', count: 2 },   // Alakazam (Stage 2)
          { cardId: 'base1-32', count: 3 },  // Kadabra (Stage 1)
          { cardId: 'base1-43', count: 4 },  // Abra (Basic)
          { cardId: 'base1-58', count: 4 },  // Pikachu (Basic)
          { cardId: 'base1-14', count: 1 },  // Raichu (Stage 2)
          { cardId: 'base1-53', count: 4 },  // Magnemite (Basic)
          { cardId: 'base1-9', count: 2 },   // Magneton (Stage 1)
          { cardId: 'base1-10', count: 2 },  // Mewtwo (Basic)
          { cardId: 'base1-31', count: 2 },  // Jynx (Basic)
          { cardId: 'base1-91', count: 4 },  // Bill
          { cardId: 'base1-93', count: 2 },  // Gust of Wind
          { cardId: 'base1-92', count: 4 },  // Energy Removal
          { cardId: 'base1-100', count: 14 },// Lightning Energy
          { cardId: 'base1-101', count: 12 } // Psychic Energy
        ]
      };
    }

    this.saveDecksToStorage();
  }

  async loadSavedDecks() {
    const token = localStorage.getItem('pkmn_session_token');
    if (token) {
      try {
        const res = await fetch('/api/decks', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const decksArray = await res.json();
          this.savedDecks = {};
          decksArray.forEach(d => {
            const cardsObj = typeof d.cards === 'string' ? JSON.parse(d.cards) : d.cards;
            this.savedDecks[d.id] = {
              id: d.id,
              name: d.name,
              cards: cardsObj,
              isStarter: !!d.is_starter,
              boxImage: d.box_image || 'pokeball.png'
            };
          });
          this.loadDeckSelectorDropdown();
          this.loadFirstDeck();
          return;
        }
      } catch (err) {
        console.error('Failed to load decks from server, using local:', err);
      }
    }

    // Offline / Guest fallback
    try {
      const saved = localStorage.getItem('pkmn_tcg_decks');
      this.savedDecks = saved ? JSON.parse(saved) : {};
      for (const id in this.savedDecks) {
        if (!this.savedDecks[id].boxImage) {
          this.savedDecks[id].boxImage = 'pokeball.png';
        }
      }
    } catch (e) {
      console.error('Failed to parse saved decks:', e);
      this.savedDecks = {};
    }
    this.registerStarterDecks();
    this.loadDeckSelectorDropdown();
    this.loadFirstDeck();
  }

  saveDecksToStorage() {
    localStorage.setItem('pkmn_tcg_decks', JSON.stringify(this.savedDecks));
  }

  loadDeckSelectorDropdown() {
    if (!this.savedDecksDropdown) return;
    this.savedDecksDropdown.innerHTML = '';
    
    for (const id in this.savedDecks) {
      const d = this.savedDecks[id];
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.name + (d.isStarter ? ' [Starter]' : '');
      this.savedDecksDropdown.appendChild(opt);
    }
  }

  loadFirstDeck() {
    const ids = Object.keys(this.savedDecks);
    if (ids.length > 0) {
      this.loadDeck(ids[0]);
    } else {
      this.createNewDeck();
    }
  }

  createNewDeck() {
    this.currentDeck = {
      id: 'custom-' + Date.now(),
      name: 'Mazo Personalizado ' + (Object.keys(this.savedDecks).length + 1),
      cards: [],
      boxImage: 'pokeball.png'
    };
    this.renderDeckWorkspace();
  }

  loadDeck(deckId) {
    const deck = this.savedDecks[deckId];
    if (deck) {
      this.currentDeck = JSON.parse(JSON.stringify(deck)); // Deep copy
      this.renderDeckWorkspace();
    }
  }

  async saveCurrentDeck() {
    const name = this.deckNameInput?.value.trim() || 'Mazo Sin Nombre';
    this.currentDeck.name = name;

    // Save locally in memory
    this.savedDecks[this.currentDeck.id] = this.currentDeck;

    const token = localStorage.getItem('pkmn_session_token');
    if (token) {
      try {
        await fetch('/api/decks/save', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            id: this.currentDeck.id,
            name: this.currentDeck.name,
            cards: this.currentDeck.cards,
            boxImage: this.currentDeck.boxImage || 'pokeball.png'
          })
        });
      } catch (err) {
        console.error('Failed to save deck to server:', err);
      }
    } else {
      this.saveDecksToStorage();
    }

    this.loadDeckSelectorDropdown();
    
    // Select the saved deck
    if (this.savedDecksDropdown) {
      this.savedDecksDropdown.value = this.currentDeck.id;
    }

    // Update alerts & workspace
    this.renderDeckWorkspace();
  }

  // Renders the available cards catalog (Base set cards list)
  renderCatalog() {
    if (!this.dbCardsGrid) return;
    this.dbCardsGrid.innerHTML = '';

    const cards = this.db.getAllLoadedCards();
    const searchVal = this.dbSearchInput?.value.toLowerCase().trim() || '';
    const textVal = this.dbSearchText?.value.toLowerCase().trim() || '';
    const evolvesVal = this.dbSearchEvolves?.value.toLowerCase().trim() || '';

    const filtered = cards.filter(card => {
      // 1. Name match
      if (searchVal && !card.name.toLowerCase().includes(searchVal)) return false;
      
      // 2. Text match (in rules, abilities, and attacks)
      if (textVal) {
        let matchesText = false;
        
        if (card.rules && card.rules.some(r => r.toLowerCase().includes(textVal))) {
          matchesText = true;
        }
        
        if (card.abilities && card.abilities.some(a => 
          (a.name && a.name.toLowerCase().includes(textVal)) || 
          (a.text && a.text.toLowerCase().includes(textVal))
        )) {
          matchesText = true;
        }
        
        if (card.attacks && card.attacks.some(a => 
          (a.name && a.name.toLowerCase().includes(textVal)) || 
          (a.text && a.text.toLowerCase().includes(textVal))
        )) {
          matchesText = true;
        }
        
        if (!matchesText) return false;
      }
      
      // 3. Evolves From match
      if (evolvesVal) {
        if (!card.evolvesFrom || !card.evolvesFrom.toLowerCase().includes(evolvesVal)) return false;
      }
      
      // 4. Energy Type match
      if (this.selectedEnergyTypes.size > 0) {
        if (!card.types || !card.types.some(t => this.selectedEnergyTypes.has(t)) || card.supertype !== 'Pokémon') return false;
      }
      
      // 5. Card Supertype match (Pokémon, Trainer, Energy)
      if (this.selectedCardSupertypes.size > 0) {
        let matchesSuper = false;
        if (this.selectedCardSupertypes.has('Pokémon') && card.supertype === 'Pokémon') {
          matchesSuper = true;
        }
        if (this.selectedCardSupertypes.has('Trainer') && card.supertype === 'Trainer') {
          matchesSuper = true;
        }
        if (this.selectedCardSupertypes.has('Energy') && card.supertype === 'Energy') {
          matchesSuper = true;
        }
        if (!matchesSuper) return false;
      }

      // 5b. Subtype match
      if (this.selectedSubtypes.size > 0) {
        if (!card.subtypes || !card.subtypes.some(s => this.selectedSubtypes.has(s))) return false;
      }
      
      // 6. Rarity match
      if (this.selectedRarities.size > 0) {
        if (!card.rarity || !this.selectedRarities.has(card.rarity)) return false;
      }
      
      // 7. Expansion (Set) match
      if (this.selectedExpansions.size > 0) {
        if (!card.setId || !this.selectedExpansions.has(card.setId)) return false;
      }
      
      // 8. PS (HP) match (only relevant for Pokémon unless sliders are at default)
      const isPkmn = card.supertype === 'Pokémon';
      const psModified = this.psMax < 340;
      if (psModified) {
        if (!isPkmn) return false;
        const hp = parseInt(card.hp) || 0;
        if (hp > this.psMax) return false;
      }
      
      // 9. Retreat Cost match (only relevant for Pokémon unless sliders are at default)
      const retreatModified = this.retreatMax < 5;
      if (retreatModified) {
        if (!isPkmn) return false;
        const retreat = card.retreatCost ? card.retreatCost.length : 0;
        if (retreat > this.retreatMax) return false;
      }
      
      // 10. Total Attack Cost match (only relevant for Pokémon unless sliders are at default)
      const attackModified = this.attackMax < 5;
      if (attackModified) {
        if (!isPkmn) return false;
        if (!card.attacks || card.attacks.length === 0) {
          if (0 > this.attackMax) return false;
        } else {
          const hasMatchingAttack = card.attacks.some(a => {
            const costLen = a.cost ? a.cost.length : 0;
            return costLen <= this.attackMax;
          });
          if (!hasMatchingAttack) return false;
        }
      }
      
      // 11. Weakness match
      if (this.selectedWeaknessTypes.size > 0) {
        if (!card.weaknesses || !card.weaknesses.some(w => this.selectedWeaknessTypes.has(w.type))) return false;
      }
      
      // 12. Resistance match
      if (this.selectedResistanceTypes.size > 0) {
        if (!card.resistances || !card.resistances.some(r => this.selectedResistanceTypes.has(r.type))) return false;
      }
      
      // 13. Attack energy cost types match
      if (this.selectedAttackEnergyTypes.size > 0) {
        if (!card.attacks || !card.attacks.some(a => a.cost && a.cost.some(c => this.selectedAttackEnergyTypes.has(c)))) return false;
      }

      return true;
    });

    const maxShow = 150;
    const cardsToRender = filtered.slice(0, maxShow);

    if (filtered.length > maxShow) {
      const notice = document.createElement('div');
      notice.style.cssText = 'grid-column: 1/-1; width: 100%; text-align: center; background: rgba(255,203,5,0.08); border: 1px solid var(--color-primary); color: var(--color-primary); padding: 8px; border-radius: 6px; font-size: 0.8rem; font-weight: 500; margin-bottom: 10px;';
      notice.textContent = `Mostrando primeros ${maxShow} de ${filtered.length} cartas. Refina tu búsqueda.`;
      this.dbCardsGrid.appendChild(notice);
    }

    cardsToRender.forEach(card => {
      const cardEl = document.createElement('div');
      cardEl.className = 'card-item compact';
      cardEl.dataset.id = card.id;

      // Count of this card already in deck
      const inDeck = this.currentDeck.cards.find(c => c.cardId === card.id);
      const count = inDeck ? inDeck.count : 0;
      
      const countBadge = count > 0 
        ? `<div class="db-card-count-badge">${count}</div>` 
        : '';

      cardEl.innerHTML = `
        <div class="card-img-wrapper">
          ${this.db.getCardImgHtml(card)}
        </div>
        ${countBadge}
      `;

      cardEl.addEventListener('click', () => {
        this.addCardToDeck(card.id);
      });

      cardEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (window.showCardPreview) window.showCardPreview(card);
      });

      cardEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        if (window.showCardPreview) window.showCardPreview(card);
      });

      this.dbCardsGrid.appendChild(cardEl);
    });
  }

  // Work-in-progress deck table list & summary
  renderDeckWorkspace() {
    if (this.deckNameInput) {
      this.deckNameInput.value = this.currentDeck.name;
      // Disable editing name for starter decks
      if (this.currentDeck.isStarter) {
        this.deckNameInput.disabled = true;
        document.getElementById('btn-save-deck').style.display = 'none';
      } else {
        this.deckNameInput.disabled = false;
        document.getElementById('btn-save-deck').style.display = 'block';
      }
    }

    // Render box cover visual state
    const boxSelector = document.getElementById('deck-box-selector');
    if (boxSelector) {
      const activeBox = this.currentDeck.boxImage || 'pokeball.png';
      boxSelector.querySelectorAll('.box-option').forEach(opt => {
        if (opt.dataset.box === activeBox) {
          opt.classList.add('active');
        } else {
          opt.classList.remove('active');
        }
        
        if (this.currentDeck.isStarter) {
          opt.classList.add('disabled');
        } else {
          opt.classList.remove('disabled');
        }
      });
    }

    if (!this.deckListTbody) return;
    this.deckListTbody.innerHTML = '';

    let total = 0;
    let pkmnCount = 0;
    let trainerCount = 0;
    let energyCount = 0;

    // Resolve full card objects
    const resolvedCards = this.currentDeck.cards.map(entry => {
      const card = this.db.getCardById(entry.cardId);
      return { card, count: entry.count };
    }).filter(e => e.card !== undefined);

    // Sort: Pokemon first, then Trainer, then Energy
    resolvedCards.sort((a, b) => {
      const order = { 'Pokémon': 1, 'Trainer': 2, 'Energy': 3 };
      const superA = order[a.card.supertype] || 4;
      const superB = order[b.card.supertype] || 4;
      if (superA !== superB) return superA - superB;
      return a.card.name.localeCompare(b.card.name);
    });

    resolvedCards.forEach(entry => {
      const { card, count } = entry;
      total += count;

      if (card.supertype === 'Pokémon') pkmnCount += count;
      else if (card.supertype === 'Trainer') trainerCount += count;
      else if (card.supertype === 'Energy') energyCount += count;

      const row = document.createElement('tr');
      
      const typeStyle = card.types ? `var(--type-${card.types[0].toLowerCase()})` : `var(--type-${card.supertype.toLowerCase()})`;

      const setObj = this.db.sets.find(s => s.id === card.setId);
      const setName = setObj ? setObj.name : (card.setId || 'Unknown');

      row.innerHTML = `
        <td style="font-weight: 700;">${count}</td>
        <td><strong>${card.name}</strong></td>
        <td><span class="meta-tag type-tag" style="background-color: ${typeStyle}; font-size: 0.75rem; padding: 2px 6px;">${card.types ? card.types[0] : card.supertype}</span></td>
        <td>${card.number}/${setName}</td>
        <td>
          <button class="deck-remove-btn" data-id="${card.id}">-</button>
        </td>
      `;

      row.style.cursor = 'pointer';
      
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (window.showCardPreview) window.showCardPreview(card);
      });

      row.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        if (window.showCardPreview) window.showCardPreview(card);
      });

      // Decrement click handler (or delete)
      row.querySelector('.deck-remove-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeCardFromDeck(card.id);
      });

      this.deckListTbody.appendChild(row);
    });

    // Update counts UI
    this.countTotal.textContent = total;
    this.countPkmn.textContent = pkmnCount;
    this.countTrainer.textContent = trainerCount;
    this.countEnergy.textContent = energyCount;

    // Validate rules
    this.validateDeckRules(resolvedCards, total);
  }

  async addCardToDeck(cardId) {
    if (this.currentDeck.isStarter) {
      await window.customAlert('Mazo Protegido', 'Los mazos preconstruidos "Starter" son de sólo lectura. Haz clic en "Nuevo Mazo" para crear uno tuyo.');
      return;
    }

    const card = this.db.getCardById(cardId);
    if (!card) return;

    // Get current counts in deck
    const existing = this.currentDeck.cards.find(c => c.cardId === cardId);
    const count = existing ? existing.count : 0;
    
    // Check 4-copies limit rule (except Basic Energy)
    const isBasicEnergy = card.supertype === 'Energy' && card.subtypes?.includes('Basic');
    
    if (count >= 4 && !isBasicEnergy) {
      await window.customAlert('Límite de Cartas', `Regla TCG: No puedes tener más de 4 copias de la carta "${card.name}" en tu mazo.`);
      return;
    }

    // Check deck size
    const currentTotal = this.currentDeck.cards.reduce((sum, c) => sum + c.count, 0);
    if (currentTotal >= 60) {
      await window.customAlert('Límite de Tamaño', 'Regla TCG: Un mazo debe tener exactamente 60 cartas.');
      return;
    }

    if (existing) {
      existing.count++;
    } else {
      this.currentDeck.cards.push({ cardId, count: 1 });
    }

    // Refresh UI
    this.renderCatalog();
    this.renderDeckWorkspace();
  }

  async removeCardFromDeck(cardId) {
    if (this.currentDeck.isStarter) {
      await window.customAlert('Mazo Protegido', 'Los mazos preconstruidos "Starter" son de sólo lectura.');
      return;
    }

    const idx = this.currentDeck.cards.findIndex(c => c.cardId === cardId);
    if (idx !== -1) {
      this.currentDeck.cards[idx].count--;
      if (this.currentDeck.cards[idx].count <= 0) {
        this.currentDeck.cards.splice(idx, 1);
      }
    }

    this.renderCatalog();
    this.renderDeckWorkspace();
  }

  // Strict deck validation
  validateDeckRules(resolvedCards, total) {
    const errors = [];
    
    // 1. Deck size must be exactly 60
    if (total !== 60) {
      errors.push(`El mazo debe tener exactamente 60 cartas (actualmente tiene ${total}).`);
    }

    // 2. Must contain at least 1 Basic Pokemon
    const hasBasic = resolvedCards.some(e => e.card.supertype === 'Pokémon' && e.card.subtypes?.includes('Basic'));
    if (!hasBasic) {
      errors.push("El mazo debe contener al menos 1 Pokémon Básico (Basic) para poder jugar.");
    }

    // 3. Max 4 copies check (re-check in case user imported a bad deck)
    resolvedCards.forEach(e => {
      const isBasicEnergy = e.card.supertype === 'Energy' && e.card.subtypes?.includes('Basic');
      if (e.count > 4 && !isBasicEnergy) {
        errors.push(`Tienes demasiadas copias (${e.count}) de "${e.card.name}". Máximo permitido: 4.`);
      }
    });

    if (this.valPanel) {
      this.valPanel.innerHTML = '';
      if (errors.length > 0) {
        this.valPanel.className = 'validation-panel alert';
        this.valPanel.innerHTML = `
          <strong>El mazo no es legal para jugar:</strong>
          <ul style="margin-left: 15px; margin-top: 5px;">
            ${errors.map(err => `<li>${err}</li>`).join('')}
          </ul>
        `;
      } else {
        this.valPanel.className = 'validation-panel success';
        this.valPanel.innerHTML = '<strong>✓ El mazo es legal para jugar.</strong>';
      }
    }
  }

  // Import / Export Overlay logic
  openImportModal() {
    this.textareaIO.value = '';
    document.getElementById('deck-io-title').textContent = 'Importar Mazo';
    document.getElementById('deck-io-description').textContent = 'Pega el código JSON del mazo abajo y presiona confirmar:';
    this.modalIO.dataset.mode = 'import';
    this.modalIO.classList.add('active');
  }

  openExportModal() {
    const exportData = {
      name: this.currentDeck.name,
      cards: this.currentDeck.cards
    };
    this.textareaIO.value = JSON.stringify(exportData, null, 2);
    document.getElementById('deck-io-title').textContent = 'Exportar Mazo';
    document.getElementById('deck-io-description').textContent = 'Copia el código de texto a continuación para transferir tu mazo:';
    this.modalIO.dataset.mode = 'export';
    this.modalIO.classList.add('active');
    this.textareaIO.select();
  }

  closeIOModal() {
    this.modalIO?.classList.remove('active');
  }

  async submitIOAction() {
    const mode = this.modalIO.dataset.mode;
    if (mode === 'import') {
      try {
        const json = JSON.parse(this.textareaIO.value);
        if (!json.cards || !Array.isArray(json.cards)) {
          throw new Error('Formato inválido: Falta la lista de cartas.');
        }

        // Validate that card IDs exist in database
        const cleanedCards = json.cards.filter(c => {
          const valid = this.db.getCardById(c.cardId);
          if (!valid) console.warn(`Card ID not found during import: ${c.cardId}`);
          return valid !== undefined;
        });

        this.currentDeck = {
          id: 'custom-' + Date.now(),
          name: json.name || 'Mazo Importado',
          cards: cleanedCards,
          boxImage: json.boxImage || 'pokeball.png'
        };

        this.renderCatalog();
        this.renderDeckWorkspace();
        this.closeIOModal();
        await window.customAlert('Importación Exitosa', 'Mazo importado con éxito. Recuerda guardarlo para guardarlo permanentemente.');
      } catch (err) {
        await window.customAlert('Error de Formato', 'Error al importar mazo. Asegúrate de pegar el formato JSON correcto. Detalle: ' + err.message);
      }
    } else {
      this.closeIOModal();
    }
  }

  renderDecksList() {
    const grid = document.getElementById('decks-list-grid');
    if (!grid) return;
    grid.innerHTML = '';

    // 1. Render card "Crear Nuevo Mazo"
    const createCard = document.createElement('div');
    createCard.className = 'deck-card create-new';
    createCard.innerHTML = `
      <div class="create-icon">+</div>
      <h3>Crear Nuevo Mazo</h3>
    `;
    createCard.addEventListener('click', () => {
      this.createNewDeck();
      if (window.appController) window.appController.navigateTo('deckbuilder');
    });
    grid.appendChild(createCard);

    // 2. Render each saved deck
    for (const id in this.savedDecks) {
      const deck = this.savedDecks[id];
      const cardEl = document.createElement('div');
      cardEl.className = 'deck-card';
      
      const cardsCount = deck.cards.reduce((sum, entry) => sum + entry.count, 0);
      const boxImg = deck.boxImage || 'pokeball.png';
      
      // Categorize deck: check types in cards to build tags
      const energyTypes = new Set();
      deck.cards.forEach(entry => {
        const card = this.db.getCardById(entry.cardId);
        if (card && card.supertype === 'Energy') {
          const type = card.name.replace(' Energy', '');
          if (type && type !== 'Double Colorless') {
            energyTypes.add(type);
          }
        }
      });
      
      let tagsHtml = '';
      if (deck.isStarter) {
        tagsHtml += `<span class="deck-tag" style="background: rgba(255, 215, 0, 0.2); border-color: rgba(255, 215, 0, 0.4); color: #ffd700;">Starter</span>`;
      }
      energyTypes.forEach(type => {
        tagsHtml += `<span class="deck-tag">${type}</span>`;
      });
      if (energyTypes.size === 0 && !deck.isStarter) {
        tagsHtml += `<span class="deck-tag">Personalizado</span>`;
      }

      cardEl.innerHTML = `
        <img class="deck-box-img" src="cards/Decks/${boxImg}" alt="${deck.name}">
        <h3>${deck.name}</h3>
        <div class="deck-meta">${cardsCount} cartas</div>
        <div class="deck-tags">${tagsHtml}</div>
      `;

      cardEl.addEventListener('click', () => {
        this.loadDeck(deck.id);
        if (window.appController) window.appController.navigateTo('deckbuilder');
      });
      grid.appendChild(cardEl);
    }
  }
}
