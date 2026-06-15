// js/database.js

export class CardDatabase {
  constructor() {
    this.sets = [];
    this.cardsBySet = {};
  }

  // Load sets and default cards (Base Set is loaded by default)
  async init() {
    console.log('[CardDatabase] Starting init...');
    try {
      console.log('[CardDatabase] Fetching /Sets/en.json...');
      const response = await fetch('/Sets/en.json');
      if (!response.ok) {
        throw new Error('Failed to load sets list');
      }
      this.sets = await response.json();
      console.log(`[CardDatabase] Loaded ${this.sets.length} sets. Preloading base1...`);
      
      // Preload Base Set (base1) cards as it's the core set
      await this.loadSetCards('base1');
      console.log('[CardDatabase] Base set base1 preloaded successfully.');
      
      // Load all other sets in the background for global card search
      this.preloadAllSets();

      return true;
    } catch (error) {
      console.error('Error initializing database:', error);
      return false;
    }
  }

  // Preloads all remaining sets asynchronously in batches in the background
  async preloadAllSets() {
    const setIds = this.sets.map(s => s.id).filter(id => id !== 'base1');
    const chunkSize = 5;
    for (let i = 0; i < setIds.length; i += chunkSize) {
      const chunk = setIds.slice(i, i + chunkSize);
      await Promise.all(chunk.map(id => this.loadSetCards(id)));
    }
    console.log('Background loading of all card sets completed successfully.');
  }

  // Fetch cards for a specific set and cache them
  async loadSetCards(setId) {
    if (this.cardsBySet[setId]) {
      return this.cardsBySet[setId];
    }

    try {
      const response = await fetch(`/cards/en/${setId}.json`);
      if (!response.ok) {
        throw new Error(`Failed to load cards for set ${setId}`);
      }
      const cards = await response.json();
      
      // Inject set information into each card for convenience
      cards.forEach(card => {
        card.setId = setId;
      });

      this.cardsBySet[setId] = cards;
      return cards;
    } catch (error) {
      console.error(`Error loading cards for set ${setId}:`, error);
      return [];
    }
  }

  // Get all cached cards flat list
  getAllLoadedCards() {
    let allCards = [];
    for (const setId in this.cardsBySet) {
      allCards = allCards.concat(this.cardsBySet[setId]);
    }
    return allCards;
  }

  // Get a single card by its ID from cached data
  getCardById(cardId) {
    const all = this.getAllLoadedCards();
    return all.find(c => c.id === cardId);
  }

  // Maps card to local image source or returns the internet URL
  getCardImage(card) {
    if (!card) return '';

    // Safeguard against dummy or incomplete card objects
    if (!card.id) {
      return '';
    }

    // If it belongs to Base Set, resolve to local images folder
    if (card.setId === 'base1' || card.id.startsWith('base1-')) {
      let cleanName = card.name ? card.name.toLowerCase() : '';
      cleanName = cleanName
        .replace(" ♂", "-male")
        .replace(" ♀", "-female")
        .replace("'", "")
        .replace(/[^a-z0-9]/g, "-")
        .replace(/-+/g, "-")
        .trim();
      
      if (cleanName.endsWith('-')) {
        cleanName = cleanName.slice(0, -1);
      }

      return `/Sets/Base/${cleanName}-base-set-bs-${card.number || 0}.jpg`;
    }

    // Default remote image URL
    return card.images?.small || card.images?.large || '';
  }

  // Generates complete HTML img tag with fallback for error resilience
  getCardImgHtml(card, className = "card-img") {
    if (!card || !card.id) {
      return `<div class="card-back ${className}"></div>`;
    }
    const localSrc = this.getCardImage(card);
    const remoteSrc = card.images?.small || '';
    
    // If it's Base Set, use local as primary and remote as backup
    if (card.setId === 'base1') {
      return `<img src="${localSrc}" alt="${card.name || 'Card'}" class="${className}" onerror="this.onerror=null; this.src='${remoteSrc}';" loading="lazy">`;
    }
    
    // Otherwise, use remote directly
    return `<img src="${remoteSrc}" alt="${card.name || 'Card'}" class="${className}" loading="lazy">`;
  }
}
