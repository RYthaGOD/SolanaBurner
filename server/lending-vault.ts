import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  Keypair,
  LAMPORTS_PER_SOL,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
} from "@solana/spl-token";
import * as crypto from "crypto";

// Program ID would be your deployed Solana program
// For now, we use a placeholder - in production, deploy an Anchor program
const LENDING_PROGRAM_ID = new PublicKey("Lend11111111111111111111111111111111111111");

// PDA Seeds
const LENDING_POOL_SEED = "lending_pool";
const VAULT_AUTHORITY_SEED = "vault_authority";
const COLLATERAL_VAULT_SEED = "collateral_vault";

interface VaultAccounts {
  lendingPoolPDA: PublicKey;
  vaultAuthorityPDA: PublicKey;
  collateralVaultPDA: PublicKey;
  bump: number;
}

/**
 * Derive PDA for lending pool
 */
export async function getLendingPoolPDA(): Promise<[PublicKey, number]> {
  return await PublicKey.findProgramAddress(
    [Buffer.from(LENDING_POOL_SEED)],
    LENDING_PROGRAM_ID
  );
}

/**
 * Derive PDA for vault authority (controls the vaults)
 */
export async function getVaultAuthorityPDA(): Promise<[PublicKey, number]> {
  return await PublicKey.findProgramAddress(
    [Buffer.from(VAULT_AUTHORITY_SEED)],
    LENDING_PROGRAM_ID
  );
}

/**
 * Derive PDA for collateral vault for a specific loan
 */
export async function getCollateralVaultPDA(
  borrower: PublicKey,
  tokenMint: PublicKey
): Promise<[PublicKey, number]> {
  return await PublicKey.findProgramAddress(
    [
      Buffer.from(COLLATERAL_VAULT_SEED),
      borrower.toBuffer(),
      tokenMint.toBuffer(),
    ],
    LENDING_PROGRAM_ID
  );
}

/**
 * Get all vault accounts for a transaction
 */
export async function getVaultAccounts(
  borrower: PublicKey,
  tokenMint: PublicKey
): Promise<VaultAccounts> {
  const [lendingPoolPDA, poolBump] = await getLendingPoolPDA();
  const [vaultAuthorityPDA, authorityBump] = await getVaultAuthorityPDA();
  const [collateralVaultPDA, vaultBump] = await getCollateralVaultPDA(borrower, tokenMint);

  return {
    lendingPoolPDA,
    vaultAuthorityPDA,
    collateralVaultPDA,
    bump: vaultBump,
  };
}

/**
 * Initialize lending pool vault (one-time setup)
 */
export async function initializeLendingPool(
  connection: Connection,
  payer: Keypair
): Promise<string> {
  const [lendingPoolPDA, bump] = await getLendingPoolPDA();
  const [vaultAuthorityPDA] = await getVaultAuthorityPDA();

  // Check if already initialized
  const accountInfo = await connection.getAccountInfo(lendingPoolPDA);
  if (accountInfo) {
    console.log("Lending pool already initialized");
    return "";
  }

  // Create initialization instruction
  // In production, this would call your Anchor program's initialize instruction
  const initInstruction = new TransactionInstruction({
    programId: LENDING_PROGRAM_ID,
    keys: [
      { pubkey: lendingPoolPDA, isSigner: false, isWritable: true },
      { pubkey: vaultAuthorityPDA, isSigner: false, isWritable: false },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([0]), // Instruction discriminator for initialize
  });

  const transaction = new Transaction().add(initInstruction);
  
  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [payer],
      { commitment: "confirmed" }
    );
    
    console.log("Lending pool initialized:", signature);
    return signature;
  } catch (error) {
    console.error("Error initializing lending pool:", error);
    throw error;
  }
}

/**
 * Deposit SOL to lending pool vault
 */
export async function depositToVault(
  connection: Connection,
  lender: Keypair,
  amountSOL: number
): Promise<string> {
  const [lendingPoolPDA] = await getLendingPoolPDA();
  const [vaultAuthorityPDA] = await getVaultAuthorityPDA();

  const lamports = amountSOL * LAMPORTS_PER_SOL;

  // Create deposit instruction
  // In production, this calls your program's deposit instruction
  const depositInstruction = new TransactionInstruction({
    programId: LENDING_PROGRAM_ID,
    keys: [
      { pubkey: lender.publicKey, isSigner: true, isWritable: true },
      { pubkey: lendingPoolPDA, isSigner: false, isWritable: true },
      { pubkey: vaultAuthorityPDA, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      Buffer.from([1]), // Instruction discriminator for deposit
      Buffer.from(new BigUint64Array([BigInt(lamports)]).buffer),
    ]),
  });

  const transaction = new Transaction().add(depositInstruction);

  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [lender],
      { commitment: "confirmed" }
    );

    console.log(`Deposited ${amountSOL} SOL to vault:`, signature);
    return signature;
  } catch (error) {
    console.error("Error depositing to vault:", error);
    throw error;
  }
}

/**
 * Withdraw SOL from lending pool vault
 */
export async function withdrawFromVault(
  connection: Connection,
  lender: Keypair,
  amountSOL: number
): Promise<string> {
  const [lendingPoolPDA] = await getLendingPoolPDA();
  const [vaultAuthorityPDA] = await getVaultAuthorityPDA();

  const lamports = amountSOL * LAMPORTS_PER_SOL;

  // Create withdraw instruction
  const withdrawInstruction = new TransactionInstruction({
    programId: LENDING_PROGRAM_ID,
    keys: [
      { pubkey: lender.publicKey, isSigner: true, isWritable: true },
      { pubkey: lendingPoolPDA, isSigner: false, isWritable: true },
      { pubkey: vaultAuthorityPDA, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      Buffer.from([2]), // Instruction discriminator for withdraw
      Buffer.from(new BigUint64Array([BigInt(lamports)]).buffer),
    ]),
  });

  const transaction = new Transaction().add(withdrawInstruction);

  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [lender],
      { commitment: "confirmed" }
    );

    console.log(`Withdrew ${amountSOL} SOL from vault:`, signature);
    return signature;
  } catch (error) {
    console.error("Error withdrawing from vault:", error);
    throw error;
  }
}

/**
 * Create collateral vault and transfer tokens
 */
export async function depositCollateral(
  connection: Connection,
  borrower: Keypair,
  tokenMint: PublicKey,
  amount: number
): Promise<string> {
  const [collateralVaultPDA, bump] = await getCollateralVaultPDA(
    borrower.publicKey,
    tokenMint
  );
  const [vaultAuthorityPDA] = await getVaultAuthorityPDA();

  // Get borrower's token account
  const borrowerTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    borrower.publicKey
  );

  // Get or create vault token account
  const vaultTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    vaultAuthorityPDA,
    true // Allow PDA owner
  );

  const transaction = new Transaction();

  // Check if vault token account exists, create if not
  try {
    await getAccount(connection, vaultTokenAccount);
  } catch (error) {
    // Account doesn't exist, create it
    transaction.add(
      createAssociatedTokenAccountInstruction(
        borrower.publicKey, // payer
        vaultTokenAccount,
        vaultAuthorityPDA, // owner (PDA)
        tokenMint
      )
    );
  }

  // Create deposit collateral instruction
  const depositCollateralInstruction = new TransactionInstruction({
    programId: LENDING_PROGRAM_ID,
    keys: [
      { pubkey: borrower.publicKey, isSigner: true, isWritable: true },
      { pubkey: borrowerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: collateralVaultPDA, isSigner: false, isWritable: true },
      { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
      { pubkey: vaultAuthorityPDA, isSigner: false, isWritable: false },
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      Buffer.from([3]), // Instruction discriminator for deposit collateral
      Buffer.from(new BigUint64Array([BigInt(amount)]).buffer),
    ]),
  });

  transaction.add(depositCollateralInstruction);

  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [borrower],
      { commitment: "confirmed" }
    );

    console.log(`Deposited ${amount} tokens as collateral:`, signature);
    return signature;
  } catch (error) {
    console.error("Error depositing collateral:", error);
    throw error;
  }
}

/**
 * Borrow SOL against collateral
 */
export async function borrowFromVault(
  connection: Connection,
  borrower: Keypair,
  tokenMint: PublicKey,
  borrowAmountSOL: number
): Promise<string> {
  const [lendingPoolPDA] = await getLendingPoolPDA();
  const [collateralVaultPDA] = await getCollateralVaultPDA(
    borrower.publicKey,
    tokenMint
  );
  const [vaultAuthorityPDA] = await getVaultAuthorityPDA();

  const lamports = borrowAmountSOL * LAMPORTS_PER_SOL;

  // Create borrow instruction
  const borrowInstruction = new TransactionInstruction({
    programId: LENDING_PROGRAM_ID,
    keys: [
      { pubkey: borrower.publicKey, isSigner: true, isWritable: true },
      { pubkey: lendingPoolPDA, isSigner: false, isWritable: true },
      { pubkey: collateralVaultPDA, isSigner: false, isWritable: true },
      { pubkey: vaultAuthorityPDA, isSigner: false, isWritable: false },
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      Buffer.from([4]), // Instruction discriminator for borrow
      Buffer.from(new BigUint64Array([BigInt(lamports)]).buffer),
    ]),
  });

  const transaction = new Transaction().add(borrowInstruction);

  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [borrower],
      { commitment: "confirmed" }
    );

    console.log(`Borrowed ${borrowAmountSOL} SOL:`, signature);
    return signature;
  } catch (error) {
    console.error("Error borrowing from vault:", error);
    throw error;
  }
}

/**
 * Repay loan and get collateral back
 */
export async function repayLoanToVault(
  connection: Connection,
  borrower: Keypair,
  tokenMint: PublicKey,
  repayAmountSOL: number
): Promise<string> {
  const [lendingPoolPDA] = await getLendingPoolPDA();
  const [collateralVaultPDA] = await getCollateralVaultPDA(
    borrower.publicKey,
    tokenMint
  );
  const [vaultAuthorityPDA] = await getVaultAuthorityPDA();

  const lamports = repayAmountSOL * LAMPORTS_PER_SOL;

  // Get token accounts
  const vaultTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    vaultAuthorityPDA,
    true
  );
  const borrowerTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    borrower.publicKey
  );

  // Create repay instruction
  const repayInstruction = new TransactionInstruction({
    programId: LENDING_PROGRAM_ID,
    keys: [
      { pubkey: borrower.publicKey, isSigner: true, isWritable: true },
      { pubkey: lendingPoolPDA, isSigner: false, isWritable: true },
      { pubkey: collateralVaultPDA, isSigner: false, isWritable: true },
      { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
      { pubkey: borrowerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: vaultAuthorityPDA, isSigner: false, isWritable: false },
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      Buffer.from([5]), // Instruction discriminator for repay
      Buffer.from(new BigUint64Array([BigInt(lamports)]).buffer),
    ]),
  });

  const transaction = new Transaction().add(repayInstruction);

  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [borrower],
      { commitment: "confirmed" }
    );

    console.log(`Repaid ${repayAmountSOL} SOL:`, signature);
    return signature;
  } catch (error) {
    console.error("Error repaying loan:", error);
    throw error;
  }
}

/**
 * Liquidate under-collateralized position
 */
export async function liquidatePosition(
  connection: Connection,
  liquidator: Keypair,
  borrower: PublicKey,
  tokenMint: PublicKey
): Promise<string> {
  const [lendingPoolPDA] = await getLendingPoolPDA();
  const [collateralVaultPDA] = await getCollateralVaultPDA(borrower, tokenMint);
  const [vaultAuthorityPDA] = await getVaultAuthorityPDA();

  // Get token accounts
  const vaultTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    vaultAuthorityPDA,
    true
  );
  const liquidatorTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    liquidator.publicKey
  );

  const transaction = new Transaction();

  // Create liquidator token account if it doesn't exist
  try {
    await getAccount(connection, liquidatorTokenAccount);
  } catch (error) {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        liquidator.publicKey,
        liquidatorTokenAccount,
        liquidator.publicKey,
        tokenMint
      )
    );
  }

  // Create liquidation instruction
  const liquidateInstruction = new TransactionInstruction({
    programId: LENDING_PROGRAM_ID,
    keys: [
      { pubkey: liquidator.publicKey, isSigner: true, isWritable: true },
      { pubkey: borrower, isSigner: false, isWritable: false },
      { pubkey: lendingPoolPDA, isSigner: false, isWritable: true },
      { pubkey: collateralVaultPDA, isSigner: false, isWritable: true },
      { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
      { pubkey: liquidatorTokenAccount, isSigner: false, isWritable: true },
      { pubkey: vaultAuthorityPDA, isSigner: false, isWritable: false },
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([6]), // Instruction discriminator for liquidate
  });

  transaction.add(liquidateInstruction);

  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [liquidator],
      { commitment: "confirmed" }
    );

    console.log("Position liquidated:", signature);
    return signature;
  } catch (error) {
    console.error("Error liquidating position:", error);
    throw error;
  }
}

/**
 * Get vault balance
 */
export async function getVaultBalance(
  connection: Connection,
  vaultPDA: PublicKey
): Promise<number> {
  try {
    const balance = await connection.getBalance(vaultPDA);
    return balance / LAMPORTS_PER_SOL;
  } catch (error) {
    console.error("Error getting vault balance:", error);
    return 0;
  }
}

/**
 * Get collateral token balance in vault
 */
export async function getCollateralBalance(
  connection: Connection,
  tokenMint: PublicKey,
  vaultAuthorityPDA: PublicKey
): Promise<number> {
  try {
    const vaultTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      vaultAuthorityPDA,
      true
    );
    const accountInfo = await getAccount(connection, vaultTokenAccount);
    return Number(accountInfo.amount);
  } catch (error) {
    console.error("Error getting collateral balance:", error);
    return 0;
  }
}

/**
 * Get lending pool PDA address as string for database storage
 */
export async function getLendingPoolAddress(): Promise<string> {
  const [lendingPoolPDA] = await getLendingPoolPDA();
  return lendingPoolPDA.toBase58();
}

/**
 * Get collateral vault address as string for database storage
 */
export async function getCollateralVaultAddress(
  borrower: string,
  tokenMint: string
): Promise<string> {
  const borrowerPubkey = new PublicKey(borrower);
  const tokenMintPubkey = new PublicKey(tokenMint);
  const [collateralVaultPDA] = await getCollateralVaultPDA(
    borrowerPubkey,
    tokenMintPubkey
  );
  return collateralVaultPDA.toBase58();
}
