const db = require('../server/db.js');

async function assertState(user, expectedCat, expectedLvl, expectedWins, expectedLosses, expectedMasterWins, stepName) {
  const fresh = await db.findUserById(user.id);
  if (!fresh) {
    throw new Error(`[FAIL] ${stepName}: User not found in DB`);
  }
  
  const ok = fresh.ranked_category === expectedCat &&
             fresh.ranked_level === expectedLvl &&
             fresh.consecutive_wins === expectedWins &&
             fresh.consecutive_losses === expectedLosses &&
             fresh.master_ranked_wins === expectedMasterWins;
             
  if (ok) {
    console.log(`[PASS] ${stepName}: Category=${fresh.ranked_category}, Level=${fresh.ranked_level}, Wins=${fresh.consecutive_wins}, Losses=${fresh.consecutive_losses}, MasterWins=${fresh.master_ranked_wins}`);
  } else {
    console.error(`[FAIL] ${stepName}:
      Expected: Category=${expectedCat}, Level=${expectedLvl}, Wins=${expectedWins}, Losses=${expectedLosses}, MasterWins=${expectedMasterWins}
      Actual:   Category=${fresh.ranked_category}, Level=${fresh.ranked_level}, Wins=${fresh.consecutive_wins}, Losses=${fresh.consecutive_losses}, MasterWins=${fresh.master_ranked_wins}`);
    process.exit(1);
  }
}

async function runTests() {
  console.log("Starting Ranked System Verification...");
  
  // Initialize DB and ensure tables exist
  await db.initDB();
  
  const testUserId = "test-ranked-user-id-9999";
  // Clean up if exists from previous run
  await db.query("DELETE FROM users WHERE id = ?", [testUserId]);
  
  // Register test user
  console.log("Registering test user...");
  let user = await db.registerOrLoginUser(testUserId, "test-ranked@pkmn.com", "Test Ranked Trainer");
  
  // Initial state assertion
  await assertState(user, 'Principiante', 1, 0, 0, 0, "Initial State");
  
  // Scenario 1: Promote from Principiante 1 to Principiante 2 (requires 3 wins)
  console.log("\n--- Scenario 1: Principiante 1 -> Principiante 2 (3 wins) ---");
  user = await db.updateRankedStats(testUserId, 'won');
  await assertState(user, 'Principiante', 1, 1, 0, 0, "Win 1");
  user = await db.updateRankedStats(testUserId, 'won');
  await assertState(user, 'Principiante', 1, 2, 0, 0, "Win 2");
  user = await db.updateRankedStats(testUserId, 'won');
  await assertState(user, 'Principiante', 2, 0, 0, 0, "Win 3 (Promote to Lvl 2)");
  
  // Scenario 2: Consecutive wins reset on loss
  console.log("\n--- Scenario 2: Win streak resets on loss ---");
  user = await db.updateRankedStats(testUserId, 'won');
  await assertState(user, 'Principiante', 2, 1, 0, 0, "Win 4");
  user = await db.updateRankedStats(testUserId, 'lost');
  await assertState(user, 'Principiante', 2, 0, 1, 0, "Loss (Streak Reset)");
  
  // Scenario 3: Promote through all Principiante levels to Great 1
  console.log("\n--- Scenario 3: Promote Principiante 2 -> Principiante 3 -> Great 1 ---");
  // Currently Principiante 2, 0 wins.
  // 3 wins to Principiante 3
  await db.updateRankedStats(testUserId, 'won');
  await db.updateRankedStats(testUserId, 'won');
  user = await db.updateRankedStats(testUserId, 'won');
  await assertState(user, 'Principiante', 3, 0, 0, 0, "Principiante 3");
  
  // 3 wins to Great 1
  await db.updateRankedStats(testUserId, 'won');
  await db.updateRankedStats(testUserId, 'won');
  user = await db.updateRankedStats(testUserId, 'won');
  await assertState(user, 'Great', 1, 0, 0, 0, "Great 1");
  
  // Scenario 4: Demote from Great 1 to Principiante 3 (requires 4 consecutive losses)
  console.log("\n--- Scenario 4: Great 1 -> Principiante 3 (4 losses) ---");
  user = await db.updateRankedStats(testUserId, 'lost');
  await assertState(user, 'Great', 1, 0, 1, 0, "Loss 1");
  user = await db.updateRankedStats(testUserId, 'lost');
  await assertState(user, 'Great', 1, 0, 2, 0, "Loss 2");
  user = await db.updateRankedStats(testUserId, 'lost');
  await assertState(user, 'Great', 1, 0, 3, 0, "Loss 3");
  user = await db.updateRankedStats(testUserId, 'lost');
  await assertState(user, 'Principiante', 3, 0, 0, 0, "Loss 4 (Demote to Principiante 3)");
  
  // Scenario 5: Re-climb to Great 1, then climb all the way to Maestro
  console.log("\n--- Scenario 5: Climb to Maestro ---");
  // Principiante 3 -> Great 1 (3 wins)
  await db.updateRankedStats(testUserId, 'won');
  await db.updateRankedStats(testUserId, 'won');
  await db.updateRankedStats(testUserId, 'won');
  // Great 1 -> Great 2 (4 wins)
  for (let i = 0; i < 4; i++) await db.updateRankedStats(testUserId, 'won');
  // Great 2 -> Great 3 (4 wins)
  for (let i = 0; i < 4; i++) await db.updateRankedStats(testUserId, 'won');
  // Great 3 -> Great 4 (4 wins)
  for (let i = 0; i < 4; i++) await db.updateRankedStats(testUserId, 'won');
  // Great 4 -> Experto 1 (4 wins)
  for (let i = 0; i < 4; i++) await db.updateRankedStats(testUserId, 'won');
  // Experto 1 -> Experto 5 (4 * 5 = 20 wins)
  for (let i = 0; i < 20; i++) await db.updateRankedStats(testUserId, 'won');
  // Experto 5 -> Veterano 1 (5 wins)
  for (let i = 0; i < 5; i++) await db.updateRankedStats(testUserId, 'won');
  // Veterano 1 -> Veterano 5 (4 * 5 = 20 wins)
  for (let i = 0; i < 20; i++) await db.updateRankedStats(testUserId, 'won');
  // Veterano 5 -> Ultra 1 (5 wins)
  for (let i = 0; i < 5; i++) await db.updateRankedStats(testUserId, 'won');
  // Ultra 1 -> Ultra 5 (4 * 5 = 20 wins)
  for (let i = 0; i < 20; i++) await db.updateRankedStats(testUserId, 'won');
  // Ultra 5 -> Maestro (5 wins)
  for (let i = 0; i < 5; i++) await db.updateRankedStats(testUserId, 'won');
  
  user = await db.findUserById(testUserId);
  await assertState(user, 'Maestro', 0, 0, 0, 0, "Maestro Reached");
  
  // Scenario 6: Wins in Maestro increase master_ranked_wins
  console.log("\n--- Scenario 6: Maestro Wins ---");
  user = await db.updateRankedStats(testUserId, 'won');
  await assertState(user, 'Maestro', 0, 0, 0, 1, "Maestro Win 1");
  user = await db.updateRankedStats(testUserId, 'won');
  await assertState(user, 'Maestro', 0, 0, 0, 2, "Maestro Win 2");
  
  // Scenario 7: Demote from Maestro to Ultra 5 (requires 10 consecutive losses)
  console.log("\n--- Scenario 7: Maestro -> Ultra 5 (10 losses) ---");
  for (let i = 1; i <= 9; i++) {
    user = await db.updateRankedStats(testUserId, 'lost');
    await assertState(user, 'Maestro', 0, 0, i, 2, `Maestro Loss ${i}`);
  }
  user = await db.updateRankedStats(testUserId, 'lost');
  await assertState(user, 'Ultra', 5, 0, 0, 2, "Maestro Loss 10 (Demoted to Ultra 5, preserved Master Wins)");

  // Scenario 8: Principiante 1 cannot demote
  console.log("\n--- Scenario 8: Principiante 1 cannot demote ---");
  // Set user rank manually to Principiante 1
  await db.query("UPDATE users SET ranked_category = 'Principiante', ranked_level = 1, consecutive_losses = 0 WHERE id = ?", [testUserId]);
  user = await db.findUserById(testUserId);
  await assertState(user, 'Principiante', 1, 0, 0, 2, "Reset to Principiante 1");
  
  // Loss 1, 2, 3
  await db.updateRankedStats(testUserId, 'lost');
  await db.updateRankedStats(testUserId, 'lost');
  user = await db.updateRankedStats(testUserId, 'lost');
  await assertState(user, 'Principiante', 1, 0, 0, 2, "Loss 3 (Remains Principiante 1)");
  
  // Clean up
  await db.query("DELETE FROM users WHERE id = ?", [testUserId]);
  console.log("\nAll Ranked System business logic tests PASSED successfully!");
  process.exit(0);
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
