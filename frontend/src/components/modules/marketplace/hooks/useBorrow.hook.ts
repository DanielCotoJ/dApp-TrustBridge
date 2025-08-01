"use client";

import { useState, useEffect } from "react";
import { useWalletContext } from "@/providers/wallet.provider";
import { TOKENS, NETWORK_CONFIG } from "@/config/contracts";
import { signTransaction } from "@/components/modules/auth/helpers/stellar-wallet-kit.helper";
import { toast } from "sonner";
import { PoolContractV2, RequestType } from "@blend-capital/blend-sdk";
import { TransactionBuilder, xdr, rpc } from "@stellar/stellar-sdk";

interface UseBorrowProps {
  isOpen: boolean;
  onClose: () => void;
  poolId?: string;
}

export function useBorrow({ isOpen, onClose, poolId }: UseBorrowProps) {
  const { walletAddress } = useWalletContext();
  const [borrowAmount, setBorrowAmount] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [estimates, setEstimates] = useState({
    healthFactor: 0,
    requiredCollateral: 0,
    borrowAPY: 8.5,
    liquidationThreshold: 75,
  });

  // Real-time calculations as user types
  useEffect(() => {
    if (borrowAmount && Number(borrowAmount) > 0) {
      const amount = Number(borrowAmount);

      // Calculate real-time estimates
      const healthFactor = Math.max(0.1, 1.5 - amount / 10000); // Simplified calculation
      const requiredCollateral = amount * 1.2; // 120% collateralization

      setEstimates((prev) => ({
        ...prev,
        healthFactor: Math.round(healthFactor * 100) / 100,
        requiredCollateral: Math.round(requiredCollateral * 100) / 100,
      }));
    } else {
      setEstimates((prev) => ({
        ...prev,
        healthFactor: 0,
        requiredCollateral: 0,
      }));
    }
  }, [borrowAmount]);

  const handleBorrow = async () => {
    if (!walletAddress) {
      toast.error("Please connect your wallet first");
      return;
    }

    if (!borrowAmount || Number(borrowAmount) <= 0) {
      toast.error("Please enter a valid borrow amount");
      return;
    }

    if (!poolId) {
      toast.error(
        "TrustBridge pool not yet deployed. Please deploy the pool first.",
      );
      return;
    }

    setLoading(true);

    try {
      // Convert UI amount to contract format (USDC has 7 decimals on Stellar)
      const amountInt = BigInt(Number(borrowAmount) * 1e7);

      toast.info("Creating borrow transaction...");

      // Create RPC client
      const server = new rpc.Server(NETWORK_CONFIG.sorobanRpcUrl);

      // Get account information
      const account = await server.getAccount(walletAddress);

      // Create pool contract instance and borrow operation
      const pool = new PoolContractV2(poolId);
      const borrowOpXdr = pool.submit({
        from: walletAddress,
        spender: walletAddress,
        to: walletAddress,
        requests: [
          {
            request_type: RequestType.Borrow,
            address: TOKENS.USDC,
            amount: amountInt,
          },
        ],
      });

      // Convert XDR to operation
      const operation = xdr.Operation.fromXDR(borrowOpXdr, "base64");

      // Build transaction
      const transaction = new TransactionBuilder(account, {
        fee: "1000000", // Higher fee for Soroban operations
        networkPassphrase: NETWORK_CONFIG.networkPassphrase,
      })
        .addOperation(operation)
        .setTimeout(30)
        .build();

      // Simulate transaction to get SorobanData
      toast.info("Simulating transaction...");
      const simulationResult = await server.simulateTransaction(transaction);

      if (rpc.Api.isSimulationError(simulationResult)) {
        throw new Error(`Simulation failed: ${simulationResult.error}`);
      }

      // Update transaction with simulated data
      const assembledTx = rpc
        .assembleTransaction(transaction, simulationResult)
        .build();

      // Sign transaction with wallet
      toast.info("Please sign the transaction in your wallet...");
      const signedTx = await signTransaction(assembledTx.toXDR());

      if (!signedTx) {
        throw new Error("Transaction signing was cancelled or failed");
      }

      // Submit transaction to network
      toast.info("Submitting transaction to Stellar network...");
      const result = await server.sendTransaction(signedTx);

      // Wait for transaction confirmation
      toast.info("Transaction submitted! Waiting for confirmation...");

      // Wait for transaction confirmation
      let attempts = 0;
      const maxAttempts = 30;

      while (attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 2000));

        try {
          const txResult = await server.getTransaction(result.hash);

          if (txResult.status === "SUCCESS") {
            toast.success(`Successfully borrowed ${borrowAmount} USDC!`);

            // Log transaction details
            console.log("Borrow transaction completed:", {
              amount: borrowAmount,
              asset: "USDC",
              poolId: poolId,
              healthFactor: estimates.healthFactor,
              collateralRequired: estimates.requiredCollateral,
              transactionHash: result.hash,
            });

            onClose();
            return;
          } else if (txResult.status === "FAILED") {
            throw new Error(
              `Transaction failed: ${txResult.resultXdr || "Unknown error"}`,
            );
          }
        } catch (pollError) {
          console.warn("Error polling transaction status:", pollError);
        }

        attempts++;
      }

      throw new Error(
        "Transaction confirmation timeout. Please check transaction status manually.",
      );
    } catch (error: unknown) {
      console.error("Borrow transaction failed:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";

      // Handle specific Blend protocol errors
      let userFriendlyMessage = errorMessage;
      if (errorMessage.includes("Error(Contract, #1206)")) {
        userFriendlyMessage =
          "Pool is not currently active. The TrustBridge pool may need to be activated by the admin or require additional backstop funding. Please check back later or contact support.";
      } else if (errorMessage.includes("Error(Contract, #1202)")) {
        userFriendlyMessage =
          "Pool is not active yet. Please wait for pool activation.";
      } else if (errorMessage.includes("Error(Contract, #1203)")) {
        userFriendlyMessage =
          "USDC reserve is not enabled. Please contact support.";
      } else if (errorMessage.includes("Error(Contract, #1205)")) {
        userFriendlyMessage =
          "Insufficient pool liquidity for this borrow amount. Please try a smaller amount.";
      } else if (errorMessage.includes("Error(Contract, #1001)")) {
        userFriendlyMessage =
          "Insufficient collateral. Please supply more collateral before borrowing.";
      } else if (errorMessage.includes("Simulation failed")) {
        userFriendlyMessage =
          "Transaction simulation failed. Please ensure you have sufficient collateral and the pool is active.";
      }

      toast.error(`Borrow failed: ${userFriendlyMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const resetModal = () => {
    setBorrowAmount("");
    setEstimates({
      healthFactor: 0,
      requiredCollateral: 0,
      borrowAPY: 8.5,
      liquidationThreshold: 75,
    });
  };

  // Reset when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      resetModal();
    }
  }, [isOpen]);

  // Health factor calculations
  const isHealthy = estimates.healthFactor >= 1.2;
  const isAtRisk =
    estimates.healthFactor < 1.2 && estimates.healthFactor >= 1.0;
  const isDangerous =
    estimates.healthFactor < 1.0 && estimates.healthFactor > 0;

  // Check if borrow button should be disabled
  const isBorrowDisabled =
    loading ||
    !borrowAmount ||
    Number(borrowAmount) <= 0 ||
    !walletAddress ||
    !poolId ||
    (estimates.healthFactor > 0 && estimates.healthFactor < 1.0);

  return {
    // State
    borrowAmount,
    loading,
    estimates,

    // Actions
    setBorrowAmount,
    handleBorrow,

    // Computed values
    isHealthy,
    isAtRisk,
    isDangerous,
    isBorrowDisabled,

    // Wallet
    walletAddress,
  };
}
