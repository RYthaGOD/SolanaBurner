import { db } from "./db";
import { lendingPool, loanPositions, collateralValuations, interestPayments } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { Connection, PublicKey, LAMPORTS_PER_SOL, Keypair } from "@solana/web3.js";
import * as anchor from "@solana/web3.js";
import {
  getLendingPoolAddress,
  getCollateralVaultAddress,
  depositToVault,
  withdrawFromVault,
  depositCollateral,
  borrowFromVault,
  repayLoanToVault,
} from "./lending-vault";

// Minimum market cap for collateral (5M USD)
const MIN_COLLATERAL_MARKET_CAP = 5_000_000;

// Interest rate configuration (annual percentage)
const DEFAULT_INTEREST_RATE = 10; // 10% APR

// Dynamic Loan-to-Value ratios based on market cap
const LTV_TIERS = [
  { minMarketCap: 0, maxMarketCap: 10_000_000, ltv: 20, liquidationThreshold: 30 },
  { minMarketCap: 10_000_000, maxMarketCap: 50_000_000, ltv: 35, liquidationThreshold: 50 },
  { minMarketCap: 50_000_000, maxMarketCap: 100_000_000, ltv: 50, liquidationThreshold: 65 },
  { minMarketCap: 100_000_000, maxMarketCap: 500_000_000, ltv: 60, liquidationThreshold: 75 },
  { minMarketCap: 500_000_000, maxMarketCap: Infinity, ltv: 70, liquidationThreshold: 85 },
];

// Default fallback values
const DEFAULT_LTV_RATIO = 20; // 20% LTV for tokens under 10M
const LIQUIDATION_THRESHOLD = 30; // Liquidate at 30% LTV for lowest tier

interface TokenInfo {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  priceSOL: number;
  marketCapUSD: number;
  liquidityUSD: number;
  volumeUSD24h: number;
}

/**
 * Get token info from Jupiter or DexScreener API
 */
async function getTokenInfo(tokenMint: string): Promise<TokenInfo | null> {
  try {
    // Try DexScreener API first
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);
    if (!response.ok) {
      console.error(`DexScreener API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (!data.pairs || data.pairs.length === 0) {
      console.error("No pairs found for token");
      return null;
    }

    // Get the pair with highest liquidity
    const pair = data.pairs.reduce((prev: any, current: any) => 
      (current.liquidity?.usd || 0) > (prev.liquidity?.usd || 0) ? current : prev
    );

    const priceUSD = parseFloat(pair.priceUsd || "0");
    const solPriceUSD = await getSOLPriceUSD();
    const priceSOL = priceUSD / solPriceUSD;

    return {
      mint: tokenMint,
      symbol: pair.baseToken.symbol || "UNKNOWN",
      name: pair.baseToken.name || "Unknown Token",
      decimals: 9, // Most Solana tokens use 9 decimals
      priceSOL: priceSOL,
      marketCapUSD: parseFloat(pair.marketCap || "0"),
      liquidityUSD: parseFloat(pair.liquidity?.usd || "0"),
      volumeUSD24h: parseFloat(pair.volume?.h24 || "0"),
    };
  } catch (error) {
    console.error("Error fetching token info:", error);
    return null;
  }
}

/**
 * Get current SOL price in USD
 */
async function getSOLPriceUSD(): Promise<number> {
  try {
    const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");
    const data = await response.json();
    return data.solana.usd || 0;
  } catch (error) {
    console.error("Error fetching SOL price:", error);
    return 0;
  }
}

/**
 * Lender deposits SOL into the lending pool (via PDA vault)
 */
export async function depositToPool(
  lenderWalletAddress: string,
  depositedSOL: string,
  txSignature: string,
  connection?: Connection,
  lenderKeypair?: Keypair
): Promise<{ success: boolean; poolId?: string; error?: string }> {
  try {
    // Get vault PDA address
    const vaultPDA = await getLendingPoolAddress();

    // If connection and keypair provided, execute on-chain deposit
    if (connection && lenderKeypair) {
      try {
        const vaultTxSignature = await depositToVault(
          connection,
          lenderKeypair,
          parseFloat(depositedSOL)
        );
        console.log("On-chain deposit successful:", vaultTxSignature);
      } catch (error) {
        console.error("On-chain deposit failed, continuing with database only:", error);
        // Continue with database update even if on-chain fails (can retry later)
      }
    }

    // Check if lender already has a pool entry
    const existingPools = await db
      .select()
      .from(lendingPool)
      .where(
        and(
          eq(lendingPool.lenderWalletAddress, lenderWalletAddress),
          eq(lendingPool.isActive, true)
        )
      );

    if (existingPools.length > 0) {
      // Update existing pool
      const pool = existingPools[0];
      const newDepositedSOL = (parseFloat(pool.depositedSOL) + parseFloat(depositedSOL)).toFixed(9);
      const newAvailableSOL = (parseFloat(pool.availableSOL) + parseFloat(depositedSOL)).toFixed(9);

      await db
        .update(lendingPool)
        .set({
          depositedSOL: newDepositedSOL,
          availableSOL: newAvailableSOL,
          vaultPDA: vaultPDA,
          updatedAt: new Date(),
        })
        .where(eq(lendingPool.id, pool.id));

      return { success: true, poolId: pool.id };
    } else {
      // Create new pool entry
      const result = await db.insert(lendingPool).values({
        lenderWalletAddress,
        depositedSOL,
        availableSOL: depositedSOL,
        totalEarnedInterest: "0",
        depositTxSignature: txSignature,
        vaultPDA: vaultPDA,
        isActive: true,
      }).returning();

      return { success: true, poolId: result[0].id };
    }
  } catch (error: any) {
    console.error("Error depositing to pool:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Lender withdraws SOL from the lending pool
 */
export async function withdrawFromPool(
  lenderWalletAddress: string,
  withdrawSOL: string
): Promise<{ success: boolean; availableSOL?: string; error?: string }> {
  try {
    const pools = await db
      .select()
      .from(lendingPool)
      .where(
        and(
          eq(lendingPool.lenderWalletAddress, lenderWalletAddress),
          eq(lendingPool.isActive, true)
        )
      );

    if (pools.length === 0) {
      return { success: false, error: "No active lending pool found" };
    }

    const pool = pools[0];
    const availableAmount = parseFloat(pool.availableSOL);
    const withdrawAmount = parseFloat(withdrawSOL);

    if (withdrawAmount > availableAmount) {
      return { 
        success: false, 
        error: `Insufficient available balance. Available: ${availableAmount} SOL` 
      };
    }

    const newAvailableSOL = (availableAmount - withdrawAmount).toFixed(9);
    const newDepositedSOL = (parseFloat(pool.depositedSOL) - withdrawAmount).toFixed(9);

    await db
      .update(lendingPool)
      .set({
        depositedSOL: newDepositedSOL,
        availableSOL: newAvailableSOL,
        updatedAt: new Date(),
      })
      .where(eq(lendingPool.id, pool.id));

    return { success: true, availableSOL: newAvailableSOL };
  } catch (error: any) {
    console.error("Error withdrawing from pool:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Check if token is eligible as collateral (market cap >= 5M)
 */
export async function isTokenEligibleAsCollateral(tokenMint: string): Promise<{
  eligible: boolean;
  tokenInfo?: TokenInfo;
  reason?: string;
}> {
  const tokenInfo = await getTokenInfo(tokenMint);
  
  if (!tokenInfo) {
    return { eligible: false, reason: "Could not fetch token information" };
  }

  if (tokenInfo.marketCapUSD < MIN_COLLATERAL_MARKET_CAP) {
    return {
      eligible: false,
      tokenInfo,
      reason: `Market cap ($${tokenInfo.marketCapUSD.toLocaleString()}) is below minimum requirement ($${MIN_COLLATERAL_MARKET_CAP.toLocaleString()})`,
    };
  }

  return { eligible: true, tokenInfo };
}

/**
 * Get LTV ratio and liquidation threshold based on market cap
 */
export function getLTVForMarketCap(marketCapUSD: number): {
  ltv: number;
  liquidationThreshold: number;
} {
  for (const tier of LTV_TIERS) {
    if (marketCapUSD >= tier.minMarketCap && marketCapUSD < tier.maxMarketCap) {
      return { ltv: tier.ltv, liquidationThreshold: tier.liquidationThreshold };
    }
  }
  // Fallback to lowest tier
  return { ltv: DEFAULT_LTV_RATIO, liquidationThreshold: LIQUIDATION_THRESHOLD };
}

/**
 * Calculate maximum borrowable amount based on collateral and market cap
 */
export function calculateMaxBorrowAmount(
  collateralValueSOL: number,
  marketCapUSD: number
): number {
  const { ltv } = getLTVForMarketCap(marketCapUSD);
  return (collateralValueSOL * ltv) / 100;
}

/**
 * Calculate current LTV ratio
 */
export function calculateLTV(borrowedAmount: number, collateralValueSOL: number): number {
  if (collateralValueSOL === 0) return 100;
  return (borrowedAmount / collateralValueSOL) * 100;
}

/**
 * Calculate health factor (> 1.0 is healthy)
 */
export function calculateHealthFactor(currentLTV: number, liquidationThreshold: number): number {
  if (currentLTV === 0) return 999;
  return liquidationThreshold / currentLTV;
}

/**
 * Get total available liquidity in the lending pool
 */
export async function getTotalAvailableLiquidity(): Promise<number> {
  try {
    const result = await db
      .select({
        total: sql<string>`SUM(${lendingPool.availableSOL})`,
      })
      .from(lendingPool)
      .where(eq(lendingPool.isActive, true));

    return parseFloat(result[0]?.total || "0");
  } catch (error) {
    console.error("Error getting total liquidity:", error);
    return 0;
  }
}

/**
 * Borrower takes out a loan against memecoin collateral (via PDA vaults)
 */
export async function createLoan(
  borrowerWalletAddress: string,
  borrowSOL: string,
  collateralTokenMint: string,
  collateralAmount: string,
  txSignature: string,
  connection?: Connection,
  borrowerKeypair?: Keypair
): Promise<{ success: boolean; loanId?: string; error?: string }> {
  try {
    // 1. Verify collateral eligibility
    const eligibility = await isTokenEligibleAsCollateral(collateralTokenMint);
    if (!eligibility.eligible || !eligibility.tokenInfo) {
      return { success: false, error: eligibility.reason || "Token not eligible" };
    }

    const tokenInfo = eligibility.tokenInfo;
    
    // 2. Calculate collateral value
    const collateralAmountNum = parseFloat(collateralAmount);
    const collateralValueSOL = collateralAmountNum * tokenInfo.priceSOL;
    
    // 3. Check if borrow amount is within LTV limits
    const borrowAmount = parseFloat(borrowSOL);
    const { ltv, liquidationThreshold } = getLTVForMarketCap(tokenInfo.marketCapUSD);
    const maxBorrowAmount = calculateMaxBorrowAmount(collateralValueSOL, tokenInfo.marketCapUSD);
    
    if (borrowAmount > maxBorrowAmount) {
      return {
        success: false,
        error: `Borrow amount (${borrowAmount} SOL) exceeds maximum (${maxBorrowAmount.toFixed(4)} SOL) at ${ltv}% LTV (market cap: $${tokenInfo.marketCapUSD.toLocaleString()})`,
      };
    }

    // 4. Check pool liquidity
    const availableLiquidity = await getTotalAvailableLiquidity();
    if (borrowAmount > availableLiquidity) {
      return {
        success: false,
        error: `Insufficient pool liquidity. Available: ${availableLiquidity} SOL`,
      };
    }

    // 5. Get collateral vault PDA
    const collateralVaultPDA = await getCollateralVaultAddress(
      borrowerWalletAddress,
      collateralTokenMint
    );

    // 6. If on-chain execution enabled, deposit collateral and borrow
    if (connection && borrowerKeypair) {
      try {
        // Deposit collateral to vault
        const collateralTx = await depositCollateral(
          connection,
          borrowerKeypair,
          new PublicKey(collateralTokenMint),
          parseFloat(collateralAmount)
        );
        console.log("Collateral deposited on-chain:", collateralTx);

        // Borrow SOL from vault
        const borrowTx = await borrowFromVault(
          connection,
          borrowerKeypair,
          new PublicKey(collateralTokenMint),
          borrowAmount
        );
        console.log("Borrowed SOL on-chain:", borrowTx);
      } catch (error) {
        console.error("On-chain loan creation failed:", error);
        return { success: false, error: "On-chain transaction failed" };
      }
    }

    // 7. Create loan position in database
    const ltvRatio = calculateLTV(borrowAmount, collateralValueSOL);
    
    const result = await db.insert(loanPositions).values({
      borrowerWalletAddress,
      borrowedSOL: borrowSOL,
      outstandingSOL: borrowSOL, // Initially same as borrowed amount
      interestRate: DEFAULT_INTEREST_RATE.toString(),
      collateralTokenMint,
      collateralTokenSymbol: tokenInfo.symbol,
      collateralTokenName: tokenInfo.name,
      collateralAmount,
      collateralValueSOL: collateralValueSOL.toFixed(9),
      collateralMarketCapUSD: tokenInfo.marketCapUSD.toFixed(2),
      loanToValueRatio: ltvRatio.toFixed(2),
      collateralVaultPDA: collateralVaultPDA,
      liquidationThreshold: liquidationThreshold.toString(),
      borrowTxSignature: txSignature,
      currentCollateralValueSOL: collateralValueSOL.toFixed(9),
      currentLTV: ltvRatio.toFixed(2),
      isActive: true,
    }).returning();

    const loanId = result[0].id;

    // 6. Record initial collateral valuation
    const healthFactor = calculateHealthFactor(ltvRatio, LIQUIDATION_THRESHOLD);
    await db.insert(collateralValuations).values({
      loanId,
      tokenMint: collateralTokenMint,
      priceSOL: tokenInfo.priceSOL.toFixed(9),
      marketCapUSD: tokenInfo.marketCapUSD.toFixed(2),
      liquidityUSD: tokenInfo.liquidityUSD.toFixed(2),
      volumeUSD24h: tokenInfo.volumeUSD24h.toFixed(2),
      collateralValueSOL: collateralValueSOL.toFixed(9),
      ltvRatio: ltvRatio.toFixed(2),
      healthFactor: healthFactor.toFixed(4),
    });

    // 7. Update lending pool - reduce available liquidity
    await reducePoolLiquidity(borrowAmount);

    return { success: true, loanId };
  } catch (error: any) {
    console.error("Error creating loan:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Reduce pool liquidity when a loan is created
 */
async function reducePoolLiquidity(amount: number): Promise<void> {
  // Get all active pools ordered by available balance
  const pools = await db
    .select()
    .from(lendingPool)
    .where(eq(lendingPool.isActive, true))
    .orderBy(lendingPool.availableSOL);

  let remaining = amount;

  for (const pool of pools) {
    if (remaining <= 0) break;

    const available = parseFloat(pool.availableSOL);
    const toDeduct = Math.min(available, remaining);

    await db
      .update(lendingPool)
      .set({
        availableSOL: (available - toDeduct).toFixed(9),
        updatedAt: new Date(),
      })
      .where(eq(lendingPool.id, pool.id));

    remaining -= toDeduct;
  }
}

/**
 * Borrower repays a loan
 */
export async function repayLoan(
  loanId: string,
  repaymentAmount: string,
  txSignature: string
): Promise<{ success: boolean; remainingDebt?: string; error?: string }> {
  try {
    const loans = await db
      .select()
      .from(loanPositions)
      .where(eq(loanPositions.id, loanId));

    if (loans.length === 0) {
      return { success: false, error: "Loan not found" };
    }

    const loan = loans[0];
    if (!loan.isActive) {
      return { success: false, error: "Loan is not active" };
    }

    const outstanding = parseFloat(loan.outstandingSOL);
    const repayment = parseFloat(repaymentAmount);

    if (repayment > outstanding) {
      return {
        success: false,
        error: `Repayment amount (${repayment} SOL) exceeds outstanding debt (${outstanding} SOL)`,
      };
    }

    const newOutstanding = outstanding - repayment;
    const isFullyRepaid = newOutstanding === 0;

    // Update loan position
    await db
      .update(loanPositions)
      .set({
        outstandingSOL: newOutstanding.toFixed(9),
        isActive: !isFullyRepaid,
        repaidAt: isFullyRepaid ? new Date() : loan.repaidAt,
        repaymentTxSignature: isFullyRepaid ? txSignature : loan.repaymentTxSignature,
        updatedAt: new Date(),
      })
      .where(eq(loanPositions.id, loanId));

    // Return liquidity to pool
    await returnLiquidityToPool(repayment);

    return { 
      success: true, 
      remainingDebt: newOutstanding.toFixed(9),
    };
  } catch (error: any) {
    console.error("Error repaying loan:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Return liquidity to pool when loan is repaid
 */
async function returnLiquidityToPool(amount: number): Promise<void> {
  // Get all active pools ordered by deposited amount (return to largest pools first)
  const pools = await db
    .select()
    .from(lendingPool)
    .where(eq(lendingPool.isActive, true))
    .orderBy(sql`${lendingPool.depositedSOL} DESC`);

  if (pools.length === 0) return;

  // Distribute proportionally based on pool size
  const totalDeposited = pools.reduce((sum, p) => sum + parseFloat(p.depositedSOL), 0);

  for (const pool of pools) {
    const poolShare = parseFloat(pool.depositedSOL) / totalDeposited;
    const returnAmount = amount * poolShare;

    await db
      .update(lendingPool)
      .set({
        availableSOL: (parseFloat(pool.availableSOL) + returnAmount).toFixed(9),
        updatedAt: new Date(),
      })
      .where(eq(lendingPool.id, pool.id));
  }
}

/**
 * Update collateral valuation for a loan
 */
export async function updateLoanValuation(loanId: string): Promise<{
  success: boolean;
  needsLiquidation?: boolean;
  healthFactor?: number;
  error?: string;
}> {
  try {
    const loans = await db
      .select()
      .from(loanPositions)
      .where(eq(loanPositions.id, loanId));

    if (loans.length === 0) {
      return { success: false, error: "Loan not found" };
    }

    const loan = loans[0];
    if (!loan.isActive) {
      return { success: false, error: "Loan is not active" };
    }

    // Get current token price
    const tokenInfo = await getTokenInfo(loan.collateralTokenMint);
    if (!tokenInfo) {
      return { success: false, error: "Could not fetch token info" };
    }

    // Calculate current collateral value
    const collateralAmountNum = parseFloat(loan.collateralAmount);
    const currentValueSOL = collateralAmountNum * tokenInfo.priceSOL;
    
    // Calculate current LTV
    const outstanding = parseFloat(loan.outstandingSOL);
    const currentLTV = calculateLTV(outstanding, currentValueSOL);
    const healthFactor = calculateHealthFactor(currentLTV, LIQUIDATION_THRESHOLD);

    // Update loan position
    await db
      .update(loanPositions)
      .set({
        currentCollateralValueSOL: currentValueSOL.toFixed(9),
        currentLTV: currentLTV.toFixed(2),
        lastHealthCheckAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(loanPositions.id, loanId));

    // Record valuation
    await db.insert(collateralValuations).values({
      loanId,
      tokenMint: loan.collateralTokenMint,
      priceSOL: tokenInfo.priceSOL.toFixed(9),
      marketCapUSD: tokenInfo.marketCapUSD.toFixed(2),
      liquidityUSD: tokenInfo.liquidityUSD.toFixed(2),
      volumeUSD24h: tokenInfo.volumeUSD24h.toFixed(2),
      collateralValueSOL: currentValueSOL.toFixed(9),
      ltvRatio: currentLTV.toFixed(2),
      healthFactor: healthFactor.toFixed(4),
    });

    // Check if liquidation is needed
    const needsLiquidation = currentLTV >= LIQUIDATION_THRESHOLD;

    return {
      success: true,
      needsLiquidation,
      healthFactor,
    };
  } catch (error: any) {
    console.error("Error updating loan valuation:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Liquidate an under-collateralized loan
 */
export async function liquidateLoan(loanId: string, txSignature: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const loans = await db
      .select()
      .from(loanPositions)
      .where(eq(loanPositions.id, loanId));

    if (loans.length === 0) {
      return { success: false, error: "Loan not found" };
    }

    const loan = loans[0];
    if (!loan.isActive) {
      return { success: false, error: "Loan is not active" };
    }

    if (loan.isLiquidated) {
      return { success: false, error: "Loan already liquidated" };
    }

    // Verify liquidation is warranted
    const currentLTV = parseFloat(loan.currentLTV || "0");
    if (currentLTV < LIQUIDATION_THRESHOLD) {
      return { 
        success: false, 
        error: `Loan is healthy (LTV: ${currentLTV}%, Threshold: ${LIQUIDATION_THRESHOLD}%)` 
      };
    }

    // Mark loan as liquidated
    await db
      .update(loanPositions)
      .set({
        isLiquidated: true,
        liquidatedAt: new Date(),
        liquidationTxSignature: txSignature,
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(loanPositions.id, loanId));

    // Collateral is seized - in a real system, this would transfer the collateral tokens
    // to the lending pool or sell them to recover funds

    return { success: true };
  } catch (error: any) {
    console.error("Error liquidating loan:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Get all active loans for a borrower
 */
export async function getBorrowerLoans(borrowerWallet: string) {
  return await db
    .select()
    .from(loanPositions)
    .where(
      and(
        eq(loanPositions.borrowerWalletAddress, borrowerWallet),
        eq(loanPositions.isActive, true)
      )
    );
}

/**
 * Get lending pool stats for a lender
 */
export async function getLenderPoolStats(lenderWallet: string) {
  return await db
    .select()
    .from(lendingPool)
    .where(
      and(
        eq(lendingPool.lenderWalletAddress, lenderWallet),
        eq(lendingPool.isActive, true)
      )
    );
}

/**
 * Get all loans that need health check
 */
export async function getLoansNeedingHealthCheck(): Promise<typeof loanPositions.$inferSelect[]> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  
  return await db
    .select()
    .from(loanPositions)
    .where(
      and(
        eq(loanPositions.isActive, true),
        sql`${loanPositions.lastHealthCheckAt} < ${oneHourAgo}`
      )
    );
}

/**
 * Background job to monitor all active loans
 */
export async function monitorAllLoans(): Promise<void> {
  console.log("Starting loan health monitoring...");
  
  const loansToCheck = await getLoansNeedingHealthCheck();
  console.log(`Found ${loansToCheck.length} loans needing health check`);

  for (const loan of loansToCheck) {
    const result = await updateLoanValuation(loan.id);
    
    if (result.success && result.needsLiquidation) {
      console.log(`⚠️ Loan ${loan.id} needs liquidation! Health factor: ${result.healthFactor}`);
      // In production, this would trigger an automated liquidation process
    }
  }
}
