"use client";

import { useState, useEffect } from "react";
import { useWalletContext } from "@/providers/wallet.provider";
import { useUserContext } from "@/providers/user.provider";

import { UserProfile } from "@/@types/user.entity";

interface DashboardData {
  profile: UserProfile | null;
  chatCount: number;
  address: string | null;
  walletName: string | null;
  loading: boolean;
}

export function useDashboard(): DashboardData {
  const { walletAddress: address, walletName } = useWalletContext();
  const { profile, loading: profileLoading } = useUserContext();

  const [chatCount, setChatCount] = useState(0);
  const [chatsLoading, setChatsLoading] = useState(true);

  useEffect(() => {
    const loadChats = async () => {
      if (!address) {
        setChatCount(0);
        setChatsLoading(false);
        return;
      }
    };

    loadChats();
  }, [address]);

  return {
    profile,
    chatCount,
    address,
    walletName,
    loading: profileLoading || chatsLoading,
  };
}
