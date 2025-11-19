/**
 * DeepSeek AI integration for lending protocol decisions
 * Analyzes token risk, collateral safety, and provides lending recommendations
 */

interface TokenRiskAnalysis {
  riskScore: number; // 0-100 (0 = safest, 100 = highest risk)
  recommendation: "approve" | "reject" | "caution";
  reasoning: string;
  concerns: string[];
  strengths: string[];
  suggestedLTV?: number;
  distributionRisk: "low" | "medium" | "high";
  metadataQuality: "poor" | "fair" | "good" | "excellent";
}

/**
 * Analyze token using DeepSeek AI for risk assessment
 */
export async function analyzeTokenRiskWithDeepSeek(
  tokenMint: string,
  tokenInfo: any,
  holderDistribution?: any
): Promise<TokenRiskAnalysis> {
  try {
    const hasDeepSeek = !!process.env.DEEPSEEK_API_KEY;
    
    if (!hasDeepSeek) {
      console.log("DeepSeek API key not configured, using basic analysis");
      return performBasicRiskAnalysis(tokenInfo, holderDistribution);
    }

    // Prepare data for AI analysis
    const analysisPrompt = buildRiskAnalysisPrompt(tokenInfo, holderDistribution);
    
    // Call DeepSeek API
    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: "You are a DeFi risk analyst specializing in token collateral assessment for lending protocols. Analyze tokens for lending risk based on market data, holder distribution, and metadata quality. Provide structured JSON responses only."
          },
          {
            role: "user",
            content: analysisPrompt
          }
        ],
        temperature: 0.3,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      console.error("DeepSeek API error:", response.status);
      return performBasicRiskAnalysis(tokenInfo, holderDistribution);
    }

    const data = await response.json();
    const aiResponse = data.choices[0]?.message?.content;

    if (!aiResponse) {
      return performBasicRiskAnalysis(tokenInfo, holderDistribution);
    }

    // Parse AI response
    const analysis = parseAIResponse(aiResponse);
    
    console.log(`✅ DeepSeek Risk Analysis for ${tokenInfo.symbol}:`, analysis.recommendation, `(${analysis.riskScore}/100)`);
    
    return analysis;
  } catch (error) {
    console.error("Error in DeepSeek risk analysis:", error);
    return performBasicRiskAnalysis(tokenInfo, holderDistribution);
  }
}

/**
 * Build comprehensive risk analysis prompt for DeepSeek
 */
function buildRiskAnalysisPrompt(tokenInfo: any, holderDistribution?: any): string {
  const holderInfo = holderDistribution ? `
Holder Distribution:
- Total Holders: ${holderDistribution.totalHolders || 'unknown'}
- Top 10 Concentration: ${holderDistribution.top10Percent || 'unknown'}%
- Top 50 Concentration: ${holderDistribution.top50Percent || 'unknown'}%
` : "Holder distribution data not available";

  return `Analyze this token for use as collateral in a lending protocol:

Token: ${tokenInfo.symbol} (${tokenInfo.name})
Market Cap: $${tokenInfo.marketCapUSD?.toLocaleString() || 'unknown'}
Liquidity: $${tokenInfo.liquidityUSD?.toLocaleString() || 'unknown'}
24h Volume: $${tokenInfo.volumeUSD24h?.toLocaleString() || 'unknown'}
${holderInfo}

Assess the following risks:
1. **Centralization Risk**: Is token ownership too concentrated?
2. **Liquidity Risk**: Can large positions be liquidated without slippage?
3. **Volatility Risk**: Is the token too volatile for safe collateral?
4. **Market Manipulation Risk**: Signs of wash trading or artificial volume?
5. **Metadata Quality**: Is the token properly documented and legitimate?

Respond ONLY with valid JSON in this exact format:
{
  "riskScore": <0-100>,
  "recommendation": "<approve|reject|caution>",
  "reasoning": "<brief explanation>",
  "concerns": ["<concern 1>", "<concern 2>"],
  "strengths": ["<strength 1>", "<strength 2>"],
  "suggestedLTV": <0-70>,
  "distributionRisk": "<low|medium|high>",
  "metadataQuality": "<poor|fair|good|excellent>"
}`;
}

/**
 * Parse AI response into structured format
 */
function parseAIResponse(aiResponse: string): TokenRiskAnalysis {
  try {
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = aiResponse.trim();
    if (jsonStr.includes("```json")) {
      jsonStr = jsonStr.split("```json")[1].split("```")[0].trim();
    } else if (jsonStr.includes("```")) {
      jsonStr = jsonStr.split("```")[1].split("```")[0].trim();
    }

    const parsed = JSON.parse(jsonStr);
    
    return {
      riskScore: Math.min(100, Math.max(0, parsed.riskScore || 50)),
      recommendation: parsed.recommendation || "caution",
      reasoning: parsed.reasoning || "AI analysis completed",
      concerns: Array.isArray(parsed.concerns) ? parsed.concerns : [],
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
      suggestedLTV: parsed.suggestedLTV,
      distributionRisk: parsed.distributionRisk || "medium",
      metadataQuality: parsed.metadataQuality || "fair",
    };
  } catch (error) {
    console.error("Error parsing AI response:", error);
    // Return safe defaults if parsing fails
    return {
      riskScore: 50,
      recommendation: "caution",
      reasoning: "Unable to parse AI analysis, using default assessment",
      concerns: ["AI analysis parsing failed"],
      strengths: [],
      distributionRisk: "medium",
      metadataQuality: "fair",
    };
  }
}

/**
 * Perform basic risk analysis without AI (fallback)
 */
function performBasicRiskAnalysis(
  tokenInfo: any,
  holderDistribution?: any
): TokenRiskAnalysis {
  const concerns: string[] = [];
  const strengths: string[] = [];
  let riskScore = 50; // Start at medium risk

  // Market cap analysis
  const marketCap = tokenInfo.marketCapUSD || 0;
  if (marketCap < 5_000_000) {
    concerns.push("Market cap below $5M minimum");
    riskScore += 20;
  } else if (marketCap < 10_000_000) {
    concerns.push("Low market cap (<$10M)");
    riskScore += 10;
  } else if (marketCap > 100_000_000) {
    strengths.push("Large market cap (>$100M)");
    riskScore -= 10;
  }

  // Liquidity analysis
  const liquidity = tokenInfo.liquidityUSD || 0;
  if (liquidity < 50_000) {
    concerns.push("Low liquidity (<$50k)");
    riskScore += 15;
  } else if (liquidity > 500_000) {
    strengths.push("Strong liquidity (>$500k)");
    riskScore -= 10;
  }

  // Volume analysis
  const volume = tokenInfo.volumeUSD24h || 0;
  if (volume < liquidity * 0.1) {
    concerns.push("Low trading volume");
    riskScore += 10;
  } else if (volume > liquidity * 2) {
    concerns.push("Suspiciously high volume (possible wash trading)");
    riskScore += 15;
  }

  // Holder distribution analysis
  const distributionRisk = holderDistribution?.top10Percent > 70 
    ? "high" 
    : holderDistribution?.top10Percent > 50 
      ? "medium" 
      : "low";

  if (distributionRisk === "high") {
    concerns.push("Highly concentrated ownership (>70% in top 10)");
    riskScore += 20;
  }

  // Determine recommendation
  riskScore = Math.min(100, Math.max(0, riskScore));
  const recommendation = riskScore > 70 
    ? "reject" 
    : riskScore > 40 
      ? "caution" 
      : "approve";

  // Suggest LTV based on risk
  const suggestedLTV = Math.max(20, Math.min(70, 70 - Math.floor(riskScore / 2)));

  return {
    riskScore,
    recommendation,
    reasoning: `Basic risk analysis: ${riskScore}/100 risk score`,
    concerns,
    strengths,
    suggestedLTV,
    distributionRisk,
    metadataQuality: tokenInfo.name && tokenInfo.symbol ? "fair" : "poor",
  };
}

/**
 * Get holder distribution data from Solana blockchain
 * This is a placeholder - would need actual RPC calls to get real data
 */
export async function getHolderDistribution(tokenMint: string): Promise<any> {
  // TODO: Implement actual holder distribution fetching via Solana RPC
  // For now, return placeholder data
  return {
    totalHolders: 1000,
    top10Percent: 45,
    top50Percent: 75,
  };
}

/**
 * Enhanced collateral eligibility check with AI risk analysis
 */
export async function checkCollateralEligibilityWithAI(
  tokenMint: string,
  tokenInfo: any
): Promise<{
  eligible: boolean;
  reason?: string;
  riskAnalysis: TokenRiskAnalysis;
  adjustedLTV?: number;
}> {
  // Get holder distribution
  const holderDistribution = await getHolderDistribution(tokenMint);
  
  // Perform AI risk analysis
  const riskAnalysis = await analyzeTokenRiskWithDeepSeek(
    tokenMint,
    tokenInfo,
    holderDistribution
  );

  // Make decision based on AI recommendation
  if (riskAnalysis.recommendation === "reject") {
    return {
      eligible: false,
      reason: `Token rejected by AI: ${riskAnalysis.reasoning}. Concerns: ${riskAnalysis.concerns.join(", ")}`,
      riskAnalysis,
    };
  }

  if (riskAnalysis.riskScore > 75) {
    return {
      eligible: false,
      reason: `Risk score too high (${riskAnalysis.riskScore}/100). Protocol safety threshold exceeded.`,
      riskAnalysis,
    };
  }

  // Eligible but may have adjusted LTV based on risk
  return {
    eligible: true,
    riskAnalysis,
    adjustedLTV: riskAnalysis.suggestedLTV,
  };
}
