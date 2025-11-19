/**
 * Daily fee distribution system
 * Distributes protocol fees to lenders every 24 hours
 */

import { db } from "./db";
import { lendingPool, protocolTreasury, protocolFeeTransactions } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

interface FeeDistribution {
  lenderAddress: string;
  poolShare: number; // Percentage of total pool
  feeAmount: number; // SOL amount
}

/**
 * Calculate and distribute protocol fees to all lenders
 * Called daily by cron job
 */
export async function distributeDailyFeesToLenders(): Promise<{
  success: boolean;
  totalDistributed: number;
  distributions: FeeDistribution[];
  error?: string;
}> {
  try {
    console.log("🏦 Starting daily fee distribution to lenders...");

    // 1. Get protocol treasury stats
    const PROTOCOL_TREASURY_ADDRESS = process.env.PROTOCOL_TREASURY_ADDRESS || "ProtocolTreasuryAddressHere111111111111111";
    
    const treasuries = await db
      .select()
      .from(protocolTreasury)
      .where(eq(protocolTreasury.treasuryAddress, PROTOCOL_TREASURY_ADDRESS));

    if (treasuries.length === 0) {
      console.log("No protocol fees to distribute yet");
      return {
        success: true,
        totalDistributed: 0,
        distributions: [],
      };
    }

    const treasury = treasuries[0];
    
    // 2. Calculate fees available for distribution
    // Protocol keeps 20% of fees, distributes 80% to lenders
    const DISTRIBUTION_PERCENTAGE = 0.8; // 80% to lenders
    const totalRevenue = parseFloat(treasury.totalRevenue);
    const feesToDistribute = totalRevenue * DISTRIBUTION_PERCENTAGE;

    if (feesToDistribute < 0.001) {
      console.log("Insufficient fees to distribute (< 0.001 SOL)");
      return {
        success: true,
        totalDistributed: 0,
        distributions: [],
      };
    }

    console.log(`Total protocol revenue: ${totalRevenue} SOL`);
    console.log(`Distributing: ${feesToDistribute} SOL (80%)`);
    console.log(`Protocol retains: ${totalRevenue * 0.2} SOL (20%)`);

    // 3. Get all active lenders and their pool shares
    const activePools = await db
      .select()
      .from(lendingPool)
      .where(eq(lendingPool.isActive, true));

    if (activePools.length === 0) {
      console.log("No active lenders to distribute fees to");
      return {
        success: true,
        totalDistributed: 0,
        distributions: [],
      };
    }

    // 4. Calculate total deposits across all lenders
    const totalDeposited = activePools.reduce((sum, pool) => {
      return sum + parseFloat(pool.depositedSOL);
    }, 0);

    if (totalDeposited === 0) {
      console.log("No deposits in lending pool");
      return {
        success: true,
        totalDistributed: 0,
        distributions: [],
      };
    }

    // 5. Calculate and record distributions for each lender
    const distributions: FeeDistribution[] = [];
    
    for (const pool of activePools) {
      const poolDeposit = parseFloat(pool.depositedSOL);
      const poolShare = poolDeposit / totalDeposited;
      const feeAmount = feesToDistribute * poolShare;

      // Update lender's earned interest
      const newEarnedInterest = (parseFloat(pool.totalEarnedInterest) + feeAmount).toFixed(9);
      
      await db
        .update(lendingPool)
        .set({
          totalEarnedInterest: newEarnedInterest,
          updatedAt: new Date(),
        })
        .where(eq(lendingPool.id, pool.id));

      distributions.push({
        lenderAddress: pool.lenderWalletAddress,
        poolShare: poolShare * 100,
        feeAmount,
      });

      console.log(`  ✓ ${pool.lenderWalletAddress.slice(0, 8)}... received ${feeAmount.toFixed(6)} SOL (${(poolShare * 100).toFixed(2)}% share)`);
    }

    // 6. Record distribution event
    const txSignature = `fee_distribution_${Date.now()}`;
    
    await db.insert(protocolFeeTransactions).values({
      feeType: "interest_spread",
      feeAmount: feesToDistribute.toFixed(9),
      txSignature,
    });

    // 7. Update treasury to reflect distributed fees
    await db
      .update(protocolTreasury)
      .set({
        lastFeeCollection: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(protocolTreasury.id, treasury.id));

    console.log(`✅ Distributed ${feesToDistribute.toFixed(6)} SOL to ${distributions.length} lenders`);

    return {
      success: true,
      totalDistributed: feesToDistribute,
      distributions,
    };
  } catch (error: any) {
    console.error("❌ Error distributing fees to lenders:", error);
    return {
      success: false,
      totalDistributed: 0,
      distributions: [],
      error: error.message,
    };
  }
}

/**
 * Calculate current APY for lenders based on protocol performance
 * This gives lenders visibility into their expected returns
 */
export async function calculateCurrentLenderAPY(): Promise<number> {
  try {
    const PROTOCOL_TREASURY_ADDRESS = process.env.PROTOCOL_TREASURY_ADDRESS || "ProtocolTreasuryAddressHere111111111111111";
    
    // Get total deposits
    const activePools = await db
      .select()
      .from(lendingPool)
      .where(eq(lendingPool.isActive, true));

    const totalDeposited = activePools.reduce((sum, pool) => {
      return sum + parseFloat(pool.depositedSOL);
    }, 0);

    if (totalDeposited === 0) return 0;

    // Get protocol revenue
    const treasuries = await db
      .select()
      .from(protocolTreasury)
      .where(eq(protocolTreasury.treasuryAddress, PROTOCOL_TREASURY_ADDRESS));

    if (treasuries.length === 0) return 8; // Return base APY

    const treasury = treasuries[0];
    const totalRevenue = parseFloat(treasury.totalRevenue);
    
    // Calculate effective APY
    // Lenders get 80% of protocol revenue
    const lenderRevenue = totalRevenue * 0.8;
    const apy = (lenderRevenue / totalDeposited) * 100;

    // Cap at reasonable limits
    return Math.min(50, Math.max(5, apy));
  } catch (error) {
    console.error("Error calculating lender APY:", error);
    return 8; // Return default APY
  }
}

/**
 * Get fee distribution history for transparency
 */
export async function getFeeDistributionHistory(days: number = 30) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const distributions = await db
      .select()
      .from(protocolFeeTransactions)
      .where(
        sql`${protocolFeeTransactions.feeType} = 'interest_spread' 
            AND ${protocolFeeTransactions.createdAt} >= ${cutoffDate}`
      )
      .orderBy(sql`${protocolFeeTransactions.createdAt} DESC`);

    return distributions;
  } catch (error) {
    console.error("Error fetching distribution history:", error);
    return [];
  }
}

/**
 * Preview next distribution (before it happens)
 * Useful for showing lenders what they'll earn
 */
export async function previewNextDistribution(): Promise<{
  estimatedTotal: number;
  estimatedPerLender: FeeDistribution[];
  nextDistributionDate: Date;
}> {
  try {
    const PROTOCOL_TREASURY_ADDRESS = process.env.PROTOCOL_TREASURY_ADDRESS || "ProtocolTreasuryAddressHere111111111111111";
    
    // Get protocol fees
    const treasuries = await db
      .select()
      .from(protocolTreasury)
      .where(eq(protocolTreasury.treasuryAddress, PROTOCOL_TREASURY_ADDRESS));

    const totalRevenue = treasuries.length > 0 ? parseFloat(treasuries[0].totalRevenue) : 0;
    const feesToDistribute = totalRevenue * 0.8;

    // Get lender pool shares
    const activePools = await db
      .select()
      .from(lendingPool)
      .where(eq(lendingPool.isActive, true));

    const totalDeposited = activePools.reduce((sum, pool) => {
      return sum + parseFloat(pool.depositedSOL);
    }, 0);

    const estimatedPerLender: FeeDistribution[] = activePools.map(pool => {
      const poolDeposit = parseFloat(pool.depositedSOL);
      const poolShare = totalDeposited > 0 ? poolDeposit / totalDeposited : 0;
      
      return {
        lenderAddress: pool.lenderWalletAddress,
        poolShare: poolShare * 100,
        feeAmount: feesToDistribute * poolShare,
      };
    });

    // Calculate next distribution date (next midnight UTC)
    const nextDistribution = new Date();
    nextDistribution.setUTCHours(24, 0, 0, 0);

    return {
      estimatedTotal: feesToDistribute,
      estimatedPerLender,
      nextDistributionDate: nextDistribution,
    };
  } catch (error) {
    console.error("Error previewing distribution:", error);
    return {
      estimatedTotal: 0,
      estimatedPerLender: [],
      nextDistributionDate: new Date(),
    };
  }
}
