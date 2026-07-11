// scratch/testRankedMatchmaking.js
// Prueba unitaria de las reglas de matchmaking ranked

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

const tests = [
  // 1. Misma categoría
  { p1: { category: 'Principiante', level: 1 }, p2: { category: 'Principiante', level: 1 }, expected: true, name: "Principiante 1 vs Principiante 1" },
  { p1: { category: 'Principiante', level: 1 }, p2: { category: 'Principiante', level: 3 }, expected: true, name: "Principiante 1 vs Principiante 3" },
  { p1: { category: 'Great', level: 2 }, p2: { category: 'Great', level: 4 }, expected: true, name: "Great 2 vs Great 4" },
  { p1: { category: 'Maestro', level: 0, masterWins: 10 }, p2: { category: 'Maestro', level: 0, masterWins: 0 }, expected: true, name: "Maestro 10 wins vs Maestro 0 wins" },

  // 2. Principiante 3 vs Great 1
  { p1: { category: 'Principiante', level: 3 }, p2: { category: 'Great', level: 1 }, expected: true, name: "Principiante 3 vs Great 1" },
  { p1: { category: 'Great', level: 1 }, p2: { category: 'Principiante', level: 3 }, expected: true, name: "Great 1 vs Principiante 3" },
  { p1: { category: 'Principiante', level: 2 }, p2: { category: 'Great', level: 1 }, expected: false, name: "Principiante 2 vs Great 1" },
  { p1: { category: 'Principiante', level: 3 }, p2: { category: 'Great', level: 2 }, expected: false, name: "Principiante 3 vs Great 2" },

  // 3. Great 4 vs Experto 1
  { p1: { category: 'Great', level: 4 }, p2: { category: 'Experto', level: 1 }, expected: true, name: "Great 4 vs Experto 1" },
  { p1: { category: 'Experto', level: 1 }, p2: { category: 'Great', level: 4 }, expected: true, name: "Experto 1 vs Great 4" },
  { p1: { category: 'Great', level: 3 }, p2: { category: 'Experto', level: 1 }, expected: false, name: "Great 3 vs Experto 1" },
  { p1: { category: 'Great', level: 4 }, p2: { category: 'Experto', level: 2 }, expected: false, name: "Great 4 vs Experto 2" },

  // 4. Experto 5 vs Veterano 1
  { p1: { category: 'Experto', level: 5 }, p2: { category: 'Veterano', level: 1 }, expected: true, name: "Experto 5 vs Veterano 1" },
  { p1: { category: 'Veterano', level: 1 }, p2: { category: 'Experto', level: 5 }, expected: true, name: "Veterano 1 vs Experto 5" },
  { p1: { category: 'Experto', level: 4 }, p2: { category: 'Veterano', level: 1 }, expected: false, name: "Experto 4 vs Veterano 1" },
  { p1: { category: 'Experto', level: 5 }, p2: { category: 'Veterano', level: 2 }, expected: false, name: "Experto 5 vs Veterano 2" },

  // 5. Veterano 5 vs Ultra 1
  { p1: { category: 'Veterano', level: 5 }, p2: { category: 'Ultra', level: 1 }, expected: true, name: "Veterano 5 vs Ultra 1" },
  { p1: { category: 'Ultra', level: 1 }, p2: { category: 'Veterano', level: 5 }, expected: true, name: "Ultra 1 vs Veterano 5" },
  { p1: { category: 'Veterano', level: 4 }, p2: { category: 'Ultra', level: 1 }, expected: false, name: "Veterano 4 vs Ultra 1" },
  { p1: { category: 'Veterano', level: 5 }, p2: { category: 'Ultra', level: 2 }, expected: false, name: "Veterano 5 vs Ultra 2" },

  // 6. Ultra 5 vs Maestro (max Maestro 5)
  { p1: { category: 'Ultra', level: 5 }, p2: { category: 'Maestro', level: 0, masterWins: 0 }, expected: true, name: "Ultra 5 vs Maestro (0 wins)" },
  { p1: { category: 'Ultra', level: 5 }, p2: { category: 'Maestro', level: 0, masterWins: 5 }, expected: true, name: "Ultra 5 vs Maestro (5 wins)" },
  { p1: { category: 'Maestro', level: 0, masterWins: 3 }, p2: { category: 'Ultra', level: 5 }, expected: true, name: "Maestro (3 wins) vs Ultra 5" },
  { p1: { category: 'Ultra', level: 5 }, p2: { category: 'Maestro', level: 0, masterWins: 6 }, expected: false, name: "Ultra 5 vs Maestro (6 wins)" },
  { p1: { category: 'Ultra', level: 4 }, p2: { category: 'Maestro', level: 0, masterWins: 2 }, expected: false, name: "Ultra 4 vs Maestro (2 wins)" },

  // 7. Combinaciones prohibidas/lejanas
  { p1: { category: 'Principiante', level: 1 }, p2: { category: 'Experto', level: 1 }, expected: false, name: "Principiante 1 vs Experto 1" },
  { p1: { category: 'Veterano', level: 5 }, p2: { category: 'Maestro', level: 0, masterWins: 0 }, expected: false, name: "Veterano 5 vs Maestro (0 wins)" }
];

let failed = 0;
console.log("Running canPlayRanked tests...");
tests.forEach((t, i) => {
  const result = canPlayRanked(t.p1, t.p2);
  if (result === t.expected) {
    console.log(`[PASS] Test #${i+1}: ${t.name}`);
  } else {
    console.error(`[FAIL] Test #${i+1}: ${t.name}. Expected ${t.expected}, got ${result}`);
    failed++;
  }
});

console.log(`\nTests finished. Success: ${tests.length - failed}/${tests.length}`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log("All tests passed!");
  process.exit(0);
}
