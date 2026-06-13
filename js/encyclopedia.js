// js/encyclopedia.js

export class Encyclopedia {
  constructor(db) {
    this.db = db;
    this.selectedSetId = 'base1';
    
    // DOM Elements
    this.setsContainer = document.getElementById('sets-list-container');
    this.cardsGrid = document.getElementById('cards-grid-container');
    
    // Basic Filters
    this.searchInput = document.getElementById('search-card');
    this.searchText = document.getElementById('search-card-text');
    this.searchEvolves = document.getElementById('search-card-evolves');
    
    // Advanced Filters panel
    this.btnToggleAdvanced = document.getElementById('btn-toggle-advanced-filters');
    this.advancedPanel = document.getElementById('advanced-filters-panel');
    
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
    
    // Collapsible sets state
    this.collapsedSeries = new Set();
    
    // Sets search and sort elements
    this.searchSetsInput = document.getElementById('search-sets');
    this.sortSetsSelect = document.getElementById('sort-sets');
    this.chkGlobalSearch = document.getElementById('chk-global-search');
    
    // Zoom Modal DOM
    this.modal = document.getElementById('modal-card-detail');
    this.modalImg = document.getElementById('zoom-card-img');
    this.modalName = document.getElementById('zoom-card-name');
    this.modalMeta = document.getElementById('zoom-card-meta');
    this.modalAbilities = document.getElementById('zoom-card-abilities');
    this.modalAttacks = document.getElementById('zoom-card-attacks');
    this.modalWeakness = document.getElementById('zoom-card-weakness');
    this.modalResistance = document.getElementById('zoom-card-resistance');
    this.modalRetreat = document.getElementById('zoom-card-retreat');
    this.modalFlavor = document.getElementById('zoom-card-flavor');
  }

  init() {
    window.showCardPreview = (card) => this.openZoomModal(card);

    // Render sidebar sets list
    this.renderSetsList();

    // Render expansions, rarities, and subtypes checklists
    this.renderExpansionList();
    this.renderRarityList();
    this.renderSubtypeList();

    // Bind filters input change
    const onFilterChange = () => this.filterAndRenderCards();
    this.searchInput?.addEventListener('input', onFilterChange);
    this.searchText?.addEventListener('input', onFilterChange);
    this.searchEvolves?.addEventListener('input', onFilterChange);
    
    // Bind global search checkbox
    this.chkGlobalSearch?.addEventListener('change', () => {
      this.filterAndRenderCards();
    });

    // Bind energy selection grids
    this.bindEnergyGrid('filter-energy-types', this.selectedEnergyTypes);
    this.bindEnergyGrid('filter-weakness-types', this.selectedWeaknessTypes);
    this.bindEnergyGrid('filter-resistance-types', this.selectedResistanceTypes);
    this.bindEnergyGrid('filter-attack-energy-types', this.selectedAttackEnergyTypes);

    // Bind card type pills
    this.bindSupertypes();

    // Bind checklist search inputs
    this.bindChecklistSearch('search-subtype-input', 'filter-card-subtypes');
    this.bindChecklistSearch('search-rarity-input', 'filter-card-rarities');
    this.bindChecklistSearch('search-expansion-input', 'filter-card-expansions');

    // Bind single sliders
    this.bindSingleSlider('filter-ps-max', 'val-ps-max', 'psMax', ' PS', '0 a ');
    this.bindSingleSlider('filter-retreat-max', 'val-retreat-max', 'retreatMax', '', '0 a ');
    this.bindSingleSlider('filter-attack-max', 'val-attack-max', 'attackMax', '', '0 a ');

    // Advanced Panel Toggle
    this.btnToggleAdvanced?.addEventListener('click', () => {
      const isCollapsed = this.advancedPanel.style.display === 'none' || this.advancedPanel.style.display === '';
      if (isCollapsed) {
        this.advancedPanel.style.display = 'block';
        this.btnToggleAdvanced.classList.add('active');
        const arrow = this.btnToggleAdvanced.querySelector('.arrow-indicator');
        if (arrow) arrow.textContent = '▲';
      } else {
        this.advancedPanel.style.display = 'none';
        this.btnToggleAdvanced.classList.remove('active');
        const arrow = this.btnToggleAdvanced.querySelector('.arrow-indicator');
        if (arrow) arrow.textContent = '▼';
      }
    });

    // Reset Filters Button
    document.getElementById('btn-reset-filters')?.addEventListener('click', () => {
      this.resetAllFilters();
    });

    // Bind sets search & sort
    this.searchSetsInput?.addEventListener('input', () => this.renderSetsList());
    this.sortSetsSelect?.addEventListener('change', () => this.renderSetsList());

    // Modal close binds
    this.modal?.querySelector('.modal-close-btn')?.addEventListener('click', () => this.closeZoomModal());
    this.modal?.addEventListener('click', (e) => {
      if (e.target === this.modal) this.closeZoomModal();
    });
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
        this.filterAndRenderCards();
      });
    });
  }

  bindSupertypes() {
    const container = document.getElementById('filter-card-supertypes');
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
        this.filterAndRenderCards();
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
      this.filterAndRenderCards();
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
    const container = document.getElementById('filter-card-expansions');
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
        this.filterAndRenderCards();
      });
      
      label.appendChild(chk);
      label.appendChild(document.createTextNode(` ${set.name}`));
      container.appendChild(label);
    });
  }

  renderRarityList() {
    const container = document.getElementById('filter-card-rarities');
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
        this.filterAndRenderCards();
      });
      
      label.appendChild(chk);
      label.appendChild(document.createTextNode(` ${rarity}`));
      container.appendChild(label);
    });
  }

  renderSubtypeList() {
    const container = document.getElementById('filter-card-subtypes');
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
        this.filterAndRenderCards();
      });
      
      label.appendChild(chk);
      label.appendChild(document.createTextNode(` ${textNode}`));
      container.appendChild(label);
    });
  }

  resetAllFilters() {
    if (this.searchInput) this.searchInput.value = '';
    if (this.searchText) this.searchText.value = '';
    if (this.searchEvolves) this.searchEvolves.value = '';
    
    this.selectedEnergyTypes.clear();
    this.selectedCardSupertypes.clear();
    this.selectedSubtypes.clear();
    this.selectedRarities.clear();
    this.selectedExpansions.clear();
    this.selectedWeaknessTypes.clear();
    this.selectedResistanceTypes.clear();
    this.selectedAttackEnergyTypes.clear();
    
    document.querySelectorAll('.energy-btn.active').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.pill-btn.active').forEach(b => b.classList.remove('active'));
    
    document.querySelectorAll('.custom-multiselect-container input[type="checkbox"]').forEach(c => {
      c.checked = false;
    });
    
    document.querySelectorAll('#search-subtype-input, #search-rarity-input, #search-expansion-input').forEach(input => {
      input.value = '';
    });
    document.querySelectorAll('.custom-multiselect-container label').forEach(l => {
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
    
    resetSlider('filter-ps-max', 340, 'val-ps-max', 'psMax', ' PS', '0 a ');
    resetSlider('filter-retreat-max', 5, 'val-retreat-max', 'retreatMax', '', '0 a ');
    resetSlider('filter-attack-max', 5, 'val-attack-max', 'attackMax', '', '0 a ');
    
    this.filterAndRenderCards();
  }

  // Triggered when navigation shows this screen
  onShow() {
    this.renderRarityList();
    this.renderExpansionList();
    this.renderSubtypeList();
    this.filterAndRenderCards();
  }

  renderSetsList() {
    if (!this.setsContainer) return;
    this.setsContainer.innerHTML = '';

    const searchVal = this.searchSetsInput?.value.toLowerCase().trim() || '';
    const sortVal = this.sortSetsSelect?.value || 'release-desc';

    // 1. Filter sets
    let filteredSets = this.db.sets.filter(set => {
      if (!searchVal) return true;
      return set.name.toLowerCase().includes(searchVal) ||
             (set.series && set.series.toLowerCase().includes(searchVal)) ||
             (set.ptcgoCode && set.ptcgoCode.toLowerCase().includes(searchVal));
    });

    // 2. Sort sets
    filteredSets.sort((a, b) => {
      switch (sortVal) {
        case 'release-asc':
          return (a.releaseDate || '').localeCompare(b.releaseDate || '');
        case 'name-asc':
          return (a.name || '').localeCompare(b.name || '');
        case 'name-desc':
          return (b.name || '').localeCompare(a.name || '');
        case 'release-desc':
        default:
          return (b.releaseDate || '').localeCompare(a.releaseDate || '');
      }
    });

    // 3. Group by series (maintaining sorting order within each series)
    const grouped = {};
    const seriesOrder = [];
    
    filteredSets.forEach(set => {
      const seriesName = set.series || 'Other';
      if (!grouped[seriesName]) {
        grouped[seriesName] = [];
        seriesOrder.push(seriesName);
      }
      grouped[seriesName].push(set);
    });

    // 4. Render Group headers and collapsible containers
    seriesOrder.forEach(seriesName => {
      const isCollapsed = this.collapsedSeries.has(seriesName);

      // Create Header
      const headerEl = document.createElement('div');
      headerEl.className = `set-group-header ${isCollapsed ? 'collapsed' : ''}`;
      headerEl.innerHTML = `<span>${seriesName}</span><span class="group-caret">▼</span>`;
      this.setsContainer.appendChild(headerEl);

      // Create container
      const containerEl = document.createElement('div');
      containerEl.className = `set-group-container ${isCollapsed ? 'collapsed' : ''}`;
      this.setsContainer.appendChild(containerEl);

      // Toggle listener
      headerEl.addEventListener('click', () => {
        const currentlyCollapsed = this.collapsedSeries.has(seriesName);
        if (currentlyCollapsed) {
          this.collapsedSeries.delete(seriesName);
          headerEl.classList.remove('collapsed');
          containerEl.classList.remove('collapsed');
        } else {
          this.collapsedSeries.add(seriesName);
          headerEl.classList.add('collapsed');
          containerEl.classList.add('collapsed');
        }
      });

      // Create items under it
      grouped[seriesName].forEach(set => {
        const btn = document.createElement('button');
        btn.className = `set-list-item ${set.id === this.selectedSetId ? 'active' : ''}`;
        
        const img = set.images?.symbol 
          ? `<img src="${set.images.symbol}" class="set-logo-icon" alt="${set.name} symbol" onerror="this.style.display='none';">`
          : '';
          
        btn.innerHTML = `
          ${img}
          <div class="set-item-details">
            <span class="set-item-name">${set.name}</span>
            <span class="set-item-meta">${set.releaseDate ? set.releaseDate.substring(0, 4) : ''} • ${set.total} cartas</span>
          </div>
        `;

        btn.addEventListener('click', async () => {
          document.querySelectorAll('.set-list-item').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');

          this.selectedSetId = set.id;
          
          this.cardsGrid.innerHTML = '<div class="spinner-container"><div class="pokeball-spinner"></div><p>Cargando cartas...</p></div>';
          
          await this.db.loadSetCards(set.id);
          // Turn off global search when explicitly selecting a set for cleaner navigation
          if (this.chkGlobalSearch) {
            this.chkGlobalSearch.checked = false;
          }
          this.filterAndRenderCards();
        });

        containerEl.appendChild(btn);
      });
    });
  }

  updateSetBanner() {
    const banner = document.getElementById('selected-set-banner');
    const logoImg = document.getElementById('selected-set-logo');
    const nameTitle = document.getElementById('selected-set-name-title');
    const metaDesc = document.getElementById('selected-set-meta-desc');

    if (!banner) return;

    const isGlobal = this.chkGlobalSearch?.checked;
    if (isGlobal) {
      banner.style.display = 'none';
      return;
    }

    const set = this.db.sets.find(s => s.id === this.selectedSetId);
    if (set) {
      banner.style.display = 'flex';
      if (logoImg) {
        logoImg.src = set.images?.logo || '';
        logoImg.style.display = set.images?.logo ? 'block' : 'none';
      }
      if (nameTitle) {
        nameTitle.textContent = set.name;
      }
      if (metaDesc) {
        const year = set.releaseDate ? set.releaseDate.substring(0, 4) : '';
        metaDesc.textContent = `Serie: ${set.series || 'Otros'} • ${set.total} cartas • Lanzamiento: ${year}`;
      }
    } else {
      banner.style.display = 'none';
    }
  }

  // Filter cached cards and render grid
  filterAndRenderCards() {
    if (!this.cardsGrid) return;

    this.updateSetBanner();

    const isGlobal = this.chkGlobalSearch?.checked;
    const cards = isGlobal ? this.db.getAllLoadedCards() : (this.db.cardsBySet[this.selectedSetId] || []);
    
    const searchVal = this.searchInput?.value.toLowerCase().trim() || '';
    const textVal = this.searchText?.value.toLowerCase().trim() || '';
    const evolvesVal = this.searchEvolves?.value.toLowerCase().trim() || '';

    // Fix Freeze Bug: Don't render full database globally unless an active filter matches
    const hasActiveFilter = 
      searchVal.length >= 3 || 
      textVal.length >= 3 || 
      evolvesVal.length >= 3 || 
      this.selectedEnergyTypes.size > 0 || 
      this.selectedCardSupertypes.size > 0 || 
      this.selectedSubtypes.size > 0 || 
      this.selectedRarities.size > 0 || 
      this.selectedExpansions.size > 0 || 
      this.psMax < 340 || 
      this.retreatMax < 5 || 
      this.attackMax < 5 || 
      this.selectedWeaknessTypes.size > 0 || 
      this.selectedResistanceTypes.size > 0 || 
      this.selectedAttackEnergyTypes.size > 0;
    
    if (isGlobal && !hasActiveFilter) {
      this.cardsGrid.innerHTML = '<div class="placeholder-text" style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--color-text-muted);">Escribe al menos 3 letras en el buscador de cartas o selecciona un filtro para buscar en todos los sets.</div>';
      return;
    }

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

    this.renderCardsGrid(filtered);
  }

  renderCardsGrid(cards) {
    this.cardsGrid.innerHTML = '';

    if (cards.length === 0) {
      this.cardsGrid.innerHTML = '<div class="placeholder-text" style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--color-text-muted);">No se encontraron cartas en este filtro.</div>';
      return;
    }

    const isGlobal = this.chkGlobalSearch?.checked;

    // Performance protection: Limit visual DOM footprint to 200 items maximum
    const maxShow = 200;
    const cardsToRender = cards.slice(0, maxShow);

    if (cards.length > maxShow) {
      const notice = document.createElement('div');
      notice.style.cssText = 'grid-column: 1/-1; width: 100%; text-align: center; background: rgba(255,203,5,0.08); border: 1px solid var(--color-primary); color: var(--color-primary); padding: 8px 12px; border-radius: 8px; font-size: 0.85rem; margin-bottom: 15px; font-weight: 500;';
      notice.textContent = `Mostrando los primeros ${maxShow} resultados de un total de ${cards.length} encontrados. Refina tu búsqueda para ver más.`;
      this.cardsGrid.appendChild(notice);
    }

    cardsToRender.forEach(card => {
      const cardEl = document.createElement('div');
      
      // Rare Holo styling check for premium glow
      const isHolo = card.rarity && card.rarity.toLowerCase().includes('holo');
      cardEl.className = `card-item ${isHolo ? 'holo' : ''}`;
      cardEl.dataset.id = card.id;

      let setBadge = '';
      if (isGlobal) {
        const setInfo = this.db.sets.find(s => s.id === card.setId);
        const setName = setInfo ? setInfo.name : card.setId;
        setBadge = `<div style="position: absolute; bottom: 0; left: 0; width: 100%; padding: 4px 6px; background: rgba(15, 17, 26, 0.85); font-size: 0.65rem; color: var(--color-primary); font-weight:600; text-align: center; text-overflow: ellipsis; white-space: nowrap; overflow: hidden; border-bottom-left-radius: 6px; border-bottom-right-radius: 6px; z-index: 3; border-top: 1px solid var(--color-border);">${setName}</div>`;
      }

      cardEl.innerHTML = `
        <div class="card-img-wrapper">
          ${this.db.getCardImgHtml(card)}
        </div>
        ${setBadge}
      `;

      cardEl.addEventListener('click', () => this.openZoomModal(card));
      this.cardsGrid.appendChild(cardEl);
    });
  }

  // Card Zoom Modal logic
  openZoomModal(card) {
    if (!this.modal) return;

    // Set large image source and fallback handling
    this.modalImg.src = card.images?.large || card.images?.small || '';
    this.modalImg.onerror = () => {
      this.modalImg.src = card.images?.small || '';
      this.modalImg.onerror = null;
    };

    this.modalName.textContent = card.name;
    
    // Meta tags
    this.modalMeta.innerHTML = '';
    const tags = [card.supertype];
    if (card.subtypes) tags.push(...card.subtypes);
    if (card.hp) tags.push(`HP ${card.hp}`);
    if (card.level) tags.push(`LV. ${card.level}`);
    
    tags.forEach(tag => {
      const tagEl = document.createElement('span');
      tagEl.className = 'meta-tag';
      tagEl.textContent = tag;
      this.modalMeta.appendChild(tagEl);
    });

    // Add type tag if Pokémon or Energy has types
    if (card.types) {
      card.types.forEach(type => {
        const tagEl = document.createElement('span');
        tagEl.className = 'meta-tag type-tag';
        tagEl.textContent = type;
        tagEl.style.backgroundColor = `var(--type-${type.toLowerCase()})`;
        this.modalMeta.appendChild(tagEl);
      });
    }

    // Render Abilities / Pokémon Powers
    const abilitiesSec = document.getElementById('zoom-abilities-section');
    if (card.abilities && card.abilities.length > 0) {
      abilitiesSec.style.display = 'block';
      this.modalAbilities.innerHTML = card.abilities.map(ab => `
        <div class="zoom-ability-item">
          <strong style="color: var(--color-primary);">${ab.name}</strong> 
          <span class="meta-tag" style="font-size:0.7rem; padding: 1px 4px; margin-left: 5px;">${ab.type}</span>
          <p style="margin-top: 5px; line-height: 1.3;">${ab.text}</p>
        </div>
      `).join('');
    } else {
      abilitiesSec.style.display = 'none';
    }

    // Render Attacks or Rules
    const attacksSec = document.getElementById('zoom-attacks-section');
    if (card.attacks && card.attacks.length > 0) {
      attacksSec.style.display = 'block';
      attacksSec.querySelector('h3').textContent = 'Ataques';
      this.modalAttacks.innerHTML = card.attacks.map(atk => {
        const costBadges = atk.cost.map(c => `
          <span style="display:inline-block; width:14px; height:14px; border-radius:50%; background-color: var(--type-${c.toLowerCase()}); border:1px solid rgba(0,0,0,0.3); vertical-align:middle; margin-right:2px;" title="${c}"></span>
        `).join('');

        return `
          <div class="zoom-attack-item" style="margin-bottom: 8px;">
            <div class="zoom-attack-header">
              <span>${costBadges} <strong style="vertical-align:middle;">${atk.name}</strong></span>
              <strong style="color: var(--color-primary);">${atk.damage || ''}</strong>
            </div>
            <p style="margin-top: 4px; line-height: 1.3; font-size: 0.8rem; color: var(--color-text-muted);">${atk.text}</p>
          </div>
        `;
      }).join('');
    } else if (card.rules && card.rules.length > 0) {
      attacksSec.style.display = 'block';
      attacksSec.querySelector('h3').textContent = 'Reglas / Texto';
      this.modalAttacks.innerHTML = card.rules.map(rule => `
        <div class="zoom-attack-item">
          <p style="line-height: 1.4; font-size: 0.85rem;">${rule}</p>
        </div>
      `).join('');
    } else {
      attacksSec.style.display = 'none';
    }

    // Footer stats: Weakness, Resistance, Retreat
    this.modalWeakness.innerHTML = card.weaknesses ? card.weaknesses.map(w => `
      <span class="meta-tag type-tag" style="background-color: var(--type-${w.type.toLowerCase()}); padding:2px 6px;">${w.type} ${w.value}</span>
    `).join('') : '-';

    this.modalResistance.innerHTML = card.resistances ? card.resistances.map(r => `
      <span class="meta-tag type-tag" style="background-color: var(--type-${r.type.toLowerCase()}); padding:2px 6px;">${r.type} ${r.value}</span>
    `).join('') : '-';

    this.modalRetreat.textContent = card.retreatCost ? `${card.retreatCost.length} Incolora(s)` : '-';

    // Flavor text
    if (card.flavorText) {
      this.modalFlavor.textContent = `"${card.flavorText}"`;
      document.getElementById('zoom-flavor-section').style.display = 'block';
    } else {
      document.getElementById('zoom-flavor-section').style.display = 'none';
    }

    // Show modal overlay
    this.modal.classList.add('active');
  }

  closeZoomModal() {
    this.modal?.classList.remove('active');
    setTimeout(() => {
      this.modalImg.src = '';
    }, 300);
  }
}
