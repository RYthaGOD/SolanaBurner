# Memecoin Credit System

A decentralized lending and borrowing platform that allows users to lend SOL for interest or borrow SOL against memecoin/SPL token collateral.

## Features

### For Lenders
- **Deposit SOL** into a lending pool stored in secure PDA vaults
- **Earn 10% APR** on deposited funds
- **Withdraw anytime** (subject to pool liquidity)
- Track total deposits, available balance, and interest earned

### For Borrowers
- **Borrow SOL** against memecoin/SPL token collateral
- **Dynamic LTV ratios** based on collateral market cap
- **Automatic liquidation protection** with health monitoring
- **Flexible repayment** - partial or full loan repayment

## Dynamic Loan-to-Value (LTV) Ratios

The system uses tiered LTV ratios based on collateral token market capitalization to manage risk:

| Market Cap Range | LTV Ratio | Liquidation Threshold |
|-----------------|-----------|----------------------|
| < $10M | 20% | 30% |
| $10M - $50M | 35% | 50% |
| $50M - $100M | 50% | 65% |
| $100M - $500M | 60% | 75% |
| > $500M | 70% | 85% |

### Example
- If you have a token worth 100 SOL with a $30M market cap:
  - You can borrow up to **35 SOL** (35% LTV)
  - Your position will be liquidated if LTV reaches **50%** (due to price drops)

## How It Works

### Lending Flow
1. Connect your Solana wallet
2. Navigate to Dashboard → Lending
3. Enter amount of SOL to deposit
4. Confirm transaction
5. Start earning 10% APR immediately

### Borrowing Flow
1. Connect your Solana wallet
2. Navigate to Dashboard → Lending → Borrow tab
3. Enter your memecoin token mint address
4. Click "Check" to verify eligibility (must have ≥$5M market cap)
5. Enter collateral amount and desired borrow amount
6. System shows your LTV and liquidation threshold
7. Confirm transaction to receive borrowed SOL
8. Your collateral is held in a secure PDA vault

### Repayment
1. View your active loans in the "Your Active Loans" section
2. Enter repayment amount (partial or full)
3. Confirm transaction
4. Collateral is returned proportionally as debt is repaid

## Architecture

### Backend Components

#### Lending Service (`server/lending-service.ts`)
- `depositToPool()` - Deposit SOL to lending pool
- `withdrawFromPool()` - Withdraw SOL from pool
- `createLoan()` - Create new loan with collateral
- `repayLoan()` - Repay loan and retrieve collateral
- `isTokenEligibleAsCollateral()` - Check if token meets requirements
- `updateLoanValuation()` - Update collateral value and health
- `liquidateLoan()` - Liquidate under-collateralized position
- `monitorAllLoans()` - Background job for health monitoring

#### PDA Vault System (`server/lending-vault.ts`)
- Secure on-chain storage using Program Derived Addresses
- `getLendingPoolPDA()` - Get lending pool vault address
- `getCollateralVaultPDA()` - Get collateral vault for borrower/token
- `depositToVault()` - Deposit SOL to lending pool vault
- `depositCollateral()` - Deposit tokens to collateral vault
- `borrowFromVault()` - Borrow SOL from pool
- `repayLoanToVault()` - Repay loan and retrieve collateral

### Database Schema

#### `lending_pool`
Stores lender deposits and vault information
- `lenderWalletAddress` - Lender's wallet
- `depositedSOL` - Total deposited amount
- `availableSOL` - Amount available for loans
- `totalEarnedInterest` - Cumulative interest earned
- `vaultPDA` - On-chain vault address

#### `loan_positions`
Tracks active loans
- `borrowerWalletAddress` - Borrower's wallet
- `borrowedSOL` - Initial loan amount
- `outstandingSOL` - Current debt (principal + interest)
- `collateralTokenMint` - Collateral token address
- `collateralAmount` - Amount of tokens locked
- `collateralValueSOL` - Current collateral value
- `loanToValueRatio` - Current LTV percentage
- `liquidationThreshold` - LTV at which liquidation occurs
- `collateralVaultPDA` - On-chain collateral vault address

#### `collateral_valuations`
Historical tracking of collateral value and health
- `loanId` - Reference to loan position
- `priceSOL` - Token price in SOL
- `marketCapUSD` - Token market cap
- `collateralValueSOL` - Total collateral value
- `ltvRatio` - Loan-to-value ratio
- `healthFactor` - Health factor (>1.0 is healthy)

#### `interest_payments`
Tracks interest payments on loans
- `loanId` - Reference to loan position
- `borrowerWalletAddress` - Borrower's wallet
- `interestAmount` - Interest paid
- `paymentTxSignature` - Transaction signature

### API Endpoints

#### Lender Endpoints
- `GET /api/lending/pool/:lenderWallet` - Get lender's pool stats
- `POST /api/lending/deposit` - Deposit SOL to pool
- `POST /api/lending/withdraw` - Withdraw SOL from pool
- `GET /api/lending/liquidity` - Get total available liquidity

#### Borrower Endpoints
- `GET /api/lending/check-collateral/:tokenMint` - Check token eligibility
- `GET /api/lending/ltv-info/:tokenMint` - Get LTV info for token
- `POST /api/lending/borrow` - Create new loan
- `POST /api/lending/repay` - Repay existing loan
- `GET /api/lending/loans/:borrowerWallet` - Get borrower's active loans

#### System Endpoints
- `POST /api/lending/update-valuation/:loanId` - Update loan health
- `POST /api/lending/liquidate` - Liquidate under-collateralized loan

### Frontend Components

#### Lending Page (`client/src/pages/lending.tsx`)
- Tabbed interface for Lend/Borrow views
- Real-time pool statistics
- Lender deposit/withdraw forms
- Borrower collateral verification
- Active loan management with health visualization
- Repayment interface

## Security Features

### Collateral Requirements
- Minimum market cap: **$5,000,000 USD**
- Tokens must be tradeable on DexScreener
- Real-time price data from DexScreener API

### Risk Management
- **Dynamic LTV** based on token stability (market cap)
- **Health monitoring** runs every hour
- **Automatic liquidation** when LTV exceeds threshold
- **PDA vaults** prevent unauthorized access to funds

### Interest Rate
- Fixed **10% APR** on all loans
- Interest compounds continuously
- Paid to lenders proportionally based on pool share

## Automated Monitoring

The system includes a background job that runs **every hour** to:
1. Check all active loans
2. Update collateral valuations
3. Calculate current LTV and health factors
4. Flag loans that need liquidation
5. Record valuation history

This is initialized in `server/index.ts` via:
```typescript
await scheduler.initializeLendingMonitor();
```

## Testing

Run the test suite to verify lending calculations:
```bash
node test-lending-system.mjs
```

Tests cover:
- LTV tier calculations
- Maximum borrow amount calculations
- Health factor calculations
- Edge cases and requirements

## Future Enhancements

- [ ] Deploy Anchor program for on-chain execution
- [ ] Implement actual token collateral transfers
- [ ] Add interest compounding logic
- [ ] Support multiple collateral tokens per loan
- [ ] Add liquidation auctions
- [ ] Implement flash loans
- [ ] Add governance token for lenders
- [ ] Support cross-collateral loans

## Usage Example

### As a Lender
```typescript
// Deposit 100 SOL
await depositToPool("YourWallet...", "100", "txSignature...");

// Earn 10% APR = 10 SOL per year
// Withdraw anytime (if liquidity available)
await withdrawFromPool("YourWallet...", "110");
```

### As a Borrower
```typescript
// Check if your memecoin is eligible
const eligibility = await isTokenEligibleAsCollateral("TokenMint...");
// eligible: true, tokenInfo: { marketCapUSD: 25000000, ... }

// Create loan (35% LTV for $25M market cap)
await createLoan(
  "YourWallet...",
  "35",                    // Borrow 35 SOL
  "TokenMint...",          // Collateral token
  "1000000",               // Collateral amount
  "txSignature..."
);

// Repay later
await repayLoan("loanId...", "35", "txSignature...");
```

## License

MIT License - See LICENSE file for details
