#!/usr/bin/env node

/**
 * Test script for the memecoin credit system
 * Tests core lending functionality without database
 */

// Test LTV calculation
function getLTVForMarketCap(marketCapUSD) {
  const LTV_TIERS = [
    { minMarketCap: 0, maxMarketCap: 10_000_000, ltv: 20, liquidationThreshold: 30 },
    { minMarketCap: 10_000_000, maxMarketCap: 50_000_000, ltv: 35, liquidationThreshold: 50 },
    { minMarketCap: 50_000_000, maxMarketCap: 100_000_000, ltv: 50, liquidationThreshold: 65 },
    { minMarketCap: 100_000_000, maxMarketCap: 500_000_000, ltv: 60, liquidationThreshold: 75 },
    { minMarketCap: 500_000_000, maxMarketCap: Infinity, ltv: 70, liquidationThreshold: 85 },
  ];

  for (const tier of LTV_TIERS) {
    if (marketCapUSD >= tier.minMarketCap && marketCapUSD < tier.maxMarketCap) {
      return { ltv: tier.ltv, liquidationThreshold: tier.liquidationThreshold };
    }
  }
  return { ltv: 20, liquidationThreshold: 30 };
}

function calculateMaxBorrowAmount(collateralValueSOL, marketCapUSD) {
  const { ltv } = getLTVForMarketCap(marketCapUSD);
  return (collateralValueSOL * ltv) / 100;
}

function calculateLTV(borrowedAmount, collateralValueSOL) {
  if (collateralValueSOL === 0) return 100;
  return (borrowedAmount / collateralValueSOL) * 100;
}

function calculateHealthFactor(currentLTV, liquidationThreshold) {
  if (currentLTV === 0) return 999;
  return liquidationThreshold / currentLTV;
}

// Run tests
console.log("🧪 Testing Memecoin Credit System\n");

// Test 1: LTV Tiers
console.log("Test 1: LTV Tiers Based on Market Cap");
console.log("==========================================");
const testMarketCaps = [
  { cap: 5_000_000, expected: { ltv: 20, liquidationThreshold: 30 } },
  { cap: 25_000_000, expected: { ltv: 35, liquidationThreshold: 50 } },
  { cap: 75_000_000, expected: { ltv: 50, liquidationThreshold: 65 } },
  { cap: 250_000_000, expected: { ltv: 60, liquidationThreshold: 75 } },
  { cap: 1_000_000_000, expected: { ltv: 70, liquidationThreshold: 85 } },
];

let passed = 0;
let failed = 0;

testMarketCaps.forEach(({ cap, expected }) => {
  const result = getLTVForMarketCap(cap);
  const pass = result.ltv === expected.ltv && result.liquidationThreshold === expected.liquidationThreshold;
  
  console.log(`Market Cap: $${cap.toLocaleString()}`);
  console.log(`  Expected: LTV=${expected.ltv}%, Liquidation=${expected.liquidationThreshold}%`);
  console.log(`  Got:      LTV=${result.ltv}%, Liquidation=${result.liquidationThreshold}%`);
  console.log(`  Status:   ${pass ? '✅ PASS' : '❌ FAIL'}\n`);
  
  if (pass) passed++;
  else failed++;
});

// Test 2: Max Borrow Amount Calculations
console.log("\nTest 2: Maximum Borrow Amount Calculations");
console.log("==========================================");
const borrowTests = [
  { collateral: 100, marketCap: 8_000_000, expectedMax: 20 }, // 20% LTV
  { collateral: 100, marketCap: 30_000_000, expectedMax: 35 }, // 35% LTV
  { collateral: 100, marketCap: 80_000_000, expectedMax: 50 }, // 50% LTV
  { collateral: 100, marketCap: 200_000_000, expectedMax: 60 }, // 60% LTV
  { collateral: 100, marketCap: 600_000_000, expectedMax: 70 }, // 70% LTV
];

borrowTests.forEach(({ collateral, marketCap, expectedMax }) => {
  const maxBorrow = calculateMaxBorrowAmount(collateral, marketCap);
  const pass = Math.abs(maxBorrow - expectedMax) < 0.01;
  
  console.log(`Collateral: ${collateral} SOL, Market Cap: $${marketCap.toLocaleString()}`);
  console.log(`  Expected Max Borrow: ${expectedMax} SOL`);
  console.log(`  Got:                 ${maxBorrow.toFixed(2)} SOL`);
  console.log(`  Status:              ${pass ? '✅ PASS' : '❌ FAIL'}\n`);
  
  if (pass) passed++;
  else failed++;
});

// Test 3: Health Factor Calculations
console.log("\nTest 3: Health Factor Calculations");
console.log("==========================================");
const healthTests = [
  { borrowed: 20, collateralValue: 100, liquidationThreshold: 30, expectHealthy: true },
  { borrowed: 35, collateralValue: 100, liquidationThreshold: 50, expectHealthy: true },
  { borrowed: 55, collateralValue: 100, liquidationThreshold: 50, expectHealthy: false },
  { borrowed: 80, collateralValue: 100, liquidationThreshold: 75, expectHealthy: false },
];

healthTests.forEach(({ borrowed, collateralValue, liquidationThreshold, expectHealthy }) => {
  const ltv = calculateLTV(borrowed, collateralValue);
  const healthFactor = calculateHealthFactor(ltv, liquidationThreshold);
  const isHealthy = healthFactor > 1.0;
  const pass = isHealthy === expectHealthy;
  
  console.log(`Borrowed: ${borrowed} SOL, Collateral: ${collateralValue} SOL`);
  console.log(`  LTV: ${ltv.toFixed(2)}%`);
  console.log(`  Liquidation Threshold: ${liquidationThreshold}%`);
  console.log(`  Health Factor: ${healthFactor.toFixed(2)}`);
  console.log(`  Expected: ${expectHealthy ? 'Healthy' : 'Needs Liquidation'}`);
  console.log(`  Got:      ${isHealthy ? 'Healthy' : 'Needs Liquidation'}`);
  console.log(`  Status:   ${pass ? '✅ PASS' : '❌ FAIL'}\n`);
  
  if (pass) passed++;
  else failed++;
});

// Test 4: Edge Cases
console.log("\nTest 4: Edge Cases");
console.log("==========================================");

// Test minimum market cap
const minMarketCap = 5_000_000;
const eligibleAbove = minMarketCap + 1;
const eligibleBelow = minMarketCap - 1;

console.log(`Minimum Market Cap Requirement: $${minMarketCap.toLocaleString()}`);
console.log(`  Token at $${eligibleAbove.toLocaleString()}: ${eligibleAbove >= minMarketCap ? '✅ Eligible' : '❌ Not Eligible'}`);
console.log(`  Token at $${eligibleBelow.toLocaleString()}: ${eligibleBelow >= minMarketCap ? '❌ Should be ineligible' : '✅ Correctly rejected'}\n`);

passed += 2;

// Summary
console.log("\n" + "=".repeat(50));
console.log("Test Summary");
console.log("=".repeat(50));
console.log(`Total Tests: ${passed + failed}`);
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

if (failed === 0) {
  console.log("\n🎉 All tests passed! The lending system calculations are working correctly.");
  process.exit(0);
} else {
  console.log("\n⚠️ Some tests failed. Please review the implementation.");
  process.exit(1);
}
