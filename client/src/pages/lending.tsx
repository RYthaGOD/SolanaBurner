import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Wallet, 
  TrendingUp, 
  AlertCircle, 
  CheckCircle, 
  Coins,
  Shield,
  Info,
  DollarSign,
  BarChart3,
  Activity
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { LendingPool, LoanPosition } from "@shared/schema";

export default function Lending() {
  const { publicKey, connected } = useWallet();
  const { toast } = useToast();
  
  // Lender state
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [isDepositing, setIsDepositing] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  
  // Borrower state
  const [collateralToken, setCollateralToken] = useState("");
  const [collateralAmount, setCollateralAmount] = useState("");
  const [borrowAmount, setBorrowAmount] = useState("");
  const [isBorrowing, setIsBorrowing] = useState(false);
  const [tokenEligibility, setTokenEligibility] = useState<any>(null);
  const [isCheckingToken, setIsCheckingToken] = useState(false);
  
  // Repayment state
  const [selectedLoan, setSelectedLoan] = useState<string>("");
  const [repayAmount, setRepayAmount] = useState("");
  const [isRepaying, setIsRepaying] = useState(false);

  // Fetch lender pool stats
  const { data: poolStats, isLoading: isLoadingPool } = useQuery<LendingPool[]>({
    queryKey: ["/api/lending/pool", publicKey?.toString()],
    enabled: connected && !!publicKey,
  });

  // Fetch borrower loans
  const { data: loans, isLoading: isLoadingLoans } = useQuery<LoanPosition[]>({
    queryKey: ["/api/lending/loans", publicKey?.toString()],
    enabled: connected && !!publicKey,
  });

  // Fetch total available liquidity
  const { data: liquidityData } = useQuery<{ totalAvailableSOL: number }>({
    queryKey: ["/api/lending/liquidity"],
  });

  const handleDeposit = async () => {
    if (!publicKey || !depositAmount) return;
    
    setIsDepositing(true);
    try {
      // In a real implementation, this would create and sign a transaction
      const txSignature = "mock_deposit_" + Date.now();
      
      const response = await apiRequest("/api/lending/deposit", {
        method: "POST",
        body: JSON.stringify({
          lenderWalletAddress: publicKey.toString(),
          depositedSOL: depositAmount,
          txSignature,
        }),
      });

      if (response.success) {
        toast({
          title: "Deposit Successful",
          description: `Deposited ${depositAmount} SOL to lending pool`,
        });
        setDepositAmount("");
      } else {
        throw new Error(response.error);
      }
    } catch (error: any) {
      toast({
        title: "Deposit Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsDepositing(false);
    }
  };

  const handleWithdraw = async () => {
    if (!publicKey || !withdrawAmount) return;
    
    setIsWithdrawing(true);
    try {
      const response = await apiRequest("/api/lending/withdraw", {
        method: "POST",
        body: JSON.stringify({
          lenderWalletAddress: publicKey.toString(),
          withdrawSOL: withdrawAmount,
        }),
      });

      if (response.success) {
        toast({
          title: "Withdrawal Successful",
          description: `Withdrew ${withdrawAmount} SOL from lending pool`,
        });
        setWithdrawAmount("");
      } else {
        throw new Error(response.error);
      }
    } catch (error: any) {
      toast({
        title: "Withdrawal Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsWithdrawing(false);
    }
  };

  const checkCollateralEligibility = async () => {
    if (!collateralToken) return;
    
    setIsCheckingToken(true);
    try {
      const response = await apiRequest(`/api/lending/check-collateral/${collateralToken}`);
      setTokenEligibility(response);
      
      if (!response.eligible) {
        toast({
          title: "Token Not Eligible",
          description: response.reason,
          variant: "destructive",
        });
      } else {
        // Fetch LTV info
        const ltvInfo = await apiRequest(`/api/lending/ltv-info/${collateralToken}`);
        setTokenEligibility({ ...response, ltvInfo });
        
        toast({
          title: "Token Eligible",
          description: `Market cap: $${response.tokenInfo.marketCapUSD.toLocaleString()} | LTV: ${ltvInfo.ltv}%`,
        });
      }
    } catch (error: any) {
      toast({
        title: "Error Checking Token",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsCheckingToken(false);
    }
  };

  const handleBorrow = async () => {
    if (!publicKey || !collateralToken || !collateralAmount || !borrowAmount) return;
    
    setIsBorrowing(true);
    try {
      // In a real implementation, this would create and sign a transaction
      const txSignature = "mock_borrow_" + Date.now();
      
      const response = await apiRequest("/api/lending/borrow", {
        method: "POST",
        body: JSON.stringify({
          borrowerWalletAddress: publicKey.toString(),
          borrowSOL: borrowAmount,
          collateralTokenMint: collateralToken,
          collateralAmount,
          txSignature,
        }),
      });

      if (response.success) {
        toast({
          title: "Loan Created",
          description: `Borrowed ${borrowAmount} SOL against your collateral`,
        });
        setCollateralToken("");
        setCollateralAmount("");
        setBorrowAmount("");
        setTokenEligibility(null);
      } else {
        throw new Error(response.error);
      }
    } catch (error: any) {
      toast({
        title: "Borrow Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsBorrowing(false);
    }
  };

  const handleRepay = async () => {
    if (!selectedLoan || !repayAmount) return;
    
    setIsRepaying(true);
    try {
      // In a real implementation, this would create and sign a transaction
      const txSignature = "mock_repay_" + Date.now();
      
      const response = await apiRequest("/api/lending/repay", {
        method: "POST",
        body: JSON.stringify({
          loanId: selectedLoan,
          repaymentAmount: repayAmount,
          txSignature,
        }),
      });

      if (response.success) {
        toast({
          title: "Repayment Successful",
          description: `Repaid ${repayAmount} SOL. Remaining debt: ${response.remainingDebt} SOL`,
        });
        setRepayAmount("");
      } else {
        throw new Error(response.error);
      }
    } catch (error: any) {
      toast({
        title: "Repayment Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsRepaying(false);
    }
  };

  if (!connected) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-6 w-6" />
              Memecoin Credit System
            </CardTitle>
            <CardDescription>
              Lend SOL to earn interest or borrow against your memecoin holdings
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Connect Your Wallet</AlertTitle>
              <AlertDescription>
                Please connect your Solana wallet to access the lending system.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Coins className="h-8 w-8 text-primary" />
            Memecoin Credit System
          </h1>
          <p className="text-muted-foreground mt-2">
            Decentralized lending and borrowing with memecoin collateral
          </p>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Total Liquidity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {liquidityData?.totalAvailableSOL.toFixed(2) || "0.00"} SOL
            </div>
            <p className="text-xs text-muted-foreground mt-1">Available to borrow</p>
          </CardContent>
        </Card>

        {poolStats && poolStats.length > 0 && (
          <>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Your Deposits</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {poolStats[0].depositedSOL} SOL
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Available: {poolStats[0].availableSOL} SOL
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Interest Earned</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  +{poolStats[0].totalEarnedInterest} SOL
                </div>
                <p className="text-xs text-muted-foreground mt-1">10% APR</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Main Content */}
      <Tabs defaultValue="lend" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="lend">
            <TrendingUp className="h-4 w-4 mr-2" />
            Lend
          </TabsTrigger>
          <TabsTrigger value="borrow">
            <DollarSign className="h-4 w-4 mr-2" />
            Borrow
          </TabsTrigger>
        </TabsList>

        {/* Lend Tab */}
        <TabsContent value="lend" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Deposit Card */}
            <Card>
              <CardHeader>
                <CardTitle>Deposit SOL</CardTitle>
                <CardDescription>
                  Earn 10% APR by lending SOL to borrowers
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="deposit-amount">Amount (SOL)</Label>
                  <Input
                    id="deposit-amount"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                  />
                </div>
                <Button 
                  onClick={handleDeposit} 
                  disabled={isDepositing || !depositAmount}
                  className="w-full"
                >
                  {isDepositing ? "Processing..." : "Deposit"}
                </Button>

                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription className="text-sm">
                    Your SOL will be stored in a secure PDA vault and loaned out to borrowers. 
                    You can withdraw at any time (subject to available liquidity).
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>

            {/* Withdraw Card */}
            <Card>
              <CardHeader>
                <CardTitle>Withdraw SOL</CardTitle>
                <CardDescription>
                  Withdraw your deposited SOL plus interest earned
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="withdraw-amount">Amount (SOL)</Label>
                  <Input
                    id="withdraw-amount"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                  />
                  {poolStats && poolStats.length > 0 && (
                    <p className="text-sm text-muted-foreground">
                      Available to withdraw: {poolStats[0].availableSOL} SOL
                    </p>
                  )}
                </div>
                <Button 
                  onClick={handleWithdraw} 
                  disabled={isWithdrawing || !withdrawAmount}
                  className="w-full"
                  variant="outline"
                >
                  {isWithdrawing ? "Processing..." : "Withdraw"}
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Borrow Tab */}
        <TabsContent value="borrow" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Borrow Card */}
            <Card>
              <CardHeader>
                <CardTitle>Borrow Against Collateral</CardTitle>
                <CardDescription>
                  Use your memecoins as collateral to borrow SOL
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="collateral-token">Collateral Token Mint</Label>
                  <div className="flex gap-2">
                    <Input
                      id="collateral-token"
                      placeholder="Token mint address"
                      value={collateralToken}
                      onChange={(e) => setCollateralToken(e.target.value)}
                    />
                    <Button
                      onClick={checkCollateralEligibility}
                      disabled={isCheckingToken || !collateralToken}
                      variant="outline"
                    >
                      Check
                    </Button>
                  </div>
                </div>

                {tokenEligibility && tokenEligibility.eligible && (
                  <Alert>
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <AlertTitle>Token Eligible</AlertTitle>
                    <AlertDescription className="space-y-2">
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <strong>Symbol:</strong> {tokenEligibility.tokenInfo.symbol}
                        </div>
                        <div>
                          <strong>Market Cap:</strong> ${tokenEligibility.tokenInfo.marketCapUSD.toLocaleString()}
                        </div>
                        <div>
                          <strong>LTV:</strong> {tokenEligibility.ltvInfo?.ltv}%
                        </div>
                        <div>
                          <strong>Liquidation:</strong> {tokenEligibility.ltvInfo?.liquidationThreshold}%
                        </div>
                      </div>
                    </AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <Label htmlFor="collateral-amount">Collateral Amount</Label>
                  <Input
                    id="collateral-amount"
                    type="number"
                    placeholder="0"
                    value={collateralAmount}
                    onChange={(e) => setCollateralAmount(e.target.value)}
                    disabled={!tokenEligibility?.eligible}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="borrow-amount">Borrow Amount (SOL)</Label>
                  <Input
                    id="borrow-amount"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={borrowAmount}
                    onChange={(e) => setBorrowAmount(e.target.value)}
                    disabled={!tokenEligibility?.eligible}
                  />
                </div>

                <Button 
                  onClick={handleBorrow} 
                  disabled={isBorrowing || !tokenEligibility?.eligible || !collateralAmount || !borrowAmount}
                  className="w-full"
                >
                  {isBorrowing ? "Processing..." : "Borrow"}
                </Button>

                <Alert>
                  <Shield className="h-4 w-4" />
                  <AlertDescription className="text-sm">
                    <strong>Dynamic LTV:</strong> Your loan-to-value ratio depends on your collateral's market cap:
                    <ul className="list-disc list-inside mt-2 space-y-1">
                      <li>&lt;10M: 20% LTV</li>
                      <li>10-50M: 35% LTV</li>
                      <li>50-100M: 50% LTV</li>
                      <li>100-500M: 60% LTV</li>
                      <li>&gt;500M: 70% LTV</li>
                    </ul>
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>

            {/* Active Loans Card */}
            <Card>
              <CardHeader>
                <CardTitle>Your Active Loans</CardTitle>
                <CardDescription>
                  Manage and repay your outstanding loans
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {isLoadingLoans ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Loading loans...
                  </div>
                ) : loans && loans.length > 0 ? (
                  <div className="space-y-4">
                    {loans.map((loan) => (
                      <Card key={loan.id} className="p-4">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">
                              {loan.collateralTokenSymbol || "Token"}
                            </span>
                            <Badge variant={parseFloat(loan.currentLTV || "0") > parseFloat(loan.liquidationThreshold) ? "destructive" : "default"}>
                              LTV: {loan.currentLTV}%
                            </Badge>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div>
                              <span className="text-muted-foreground">Borrowed:</span>{" "}
                              {loan.borrowedSOL} SOL
                            </div>
                            <div>
                              <span className="text-muted-foreground">Outstanding:</span>{" "}
                              {loan.outstandingSOL} SOL
                            </div>
                          </div>
                          <Progress 
                            value={parseFloat(loan.currentLTV || "0")} 
                            max={parseFloat(loan.liquidationThreshold)}
                            className="h-2"
                          />
                          <div className="flex gap-2">
                            <Input
                              type="number"
                              step="0.01"
                              placeholder="Repay amount"
                              value={selectedLoan === loan.id ? repayAmount : ""}
                              onChange={(e) => {
                                setSelectedLoan(loan.id);
                                setRepayAmount(e.target.value);
                              }}
                              className="flex-1"
                            />
                            <Button
                              onClick={handleRepay}
                              disabled={isRepaying || selectedLoan !== loan.id || !repayAmount}
                              size="sm"
                            >
                              Repay
                            </Button>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    No active loans
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
