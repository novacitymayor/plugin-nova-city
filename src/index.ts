import type {
  Action,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  Plugin,
  Provider,
} from "@elizaos/core";
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  parseAbi,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";

const API = "https://virtual-genesis-world.lovable.app/api/public/city/lots";
const TREASURY = "0x85AA8E9B45603F10847B1AD2Ff280DB59b380c16" as const;
const USDT = "0x55d398326f99059fF775485246999027B3197955" as const;

const ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);

type Lot = {
  id: number;
  district: string;
  type: string;
  name: string;
  price_usdt: number;
  available: boolean;
};

async function getLots(): Promise<Lot[]> {
  const response = await fetch(API);
  if (!response.ok) throw new Error("Nova City API unavailable");
  const body = (await response.json()) as { lots?: Lot[] };
  return body.lots ?? [];
}

const cityProvider: Provider = {
  name: "NOVA_CITY_LOTS",
  get: async () => {
    const freeLots = (await getLots()).filter((lot) => lot.available).slice(0, 10);

    return {
      text:
        "Nova AI World — available lots paid in USDT on BSC: " +
        freeLots
          .map(
            (lot) =>
              `lot ${lot.id}: ${lot.type}, ${lot.district}, ${lot.price_usdt} USDT`,
          )
          .join("; "),
    };
  },
} as Provider;

const buyLot: Action = {
  name: "BUY_NOVA_LOT",
  similes: ["BUY_LAND_NOVA", "PURCHASE_NOVA_LOT"],
  description: "Buys a Nova AI World lot using USDT on BNB Smart Chain.",
  validate: async (runtime: IAgentRuntime) =>
    Boolean(runtime.getSetting("EVM_PRIVATE_KEY")),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: unknown,
    _options?: unknown,
    callback?: HandlerCallback,
  ) => {
    try {
      const key = String(runtime.getSetting("EVM_PRIVATE_KEY"));
      const account = privateKeyToAccount(
        (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`,
      );

      const publicClient = createPublicClient({
        chain: bsc,
        transport: http(),
      });
      const walletClient = createWalletClient({
        account,
        chain: bsc,
        transport: http(),
      });

      const lots = (await getLots()).filter((lot) => lot.available);
      const requestedLot = String(message.content?.text ?? "").match(
        /(?:lot|lote)\s*#?\s*(\d+)/i,
      );
      const lot = requestedLot
        ? lots.find((item) => item.id === Number(requestedLot[1]))
        : [...lots].sort((a, b) => a.price_usdt - b.price_usdt)[0];

      if (!lot) {
        await callback?.({ text: "No available Nova City lot found." });
        return false;
      }

      const bnbBalance = await publicClient.getBalance({
        address: account.address,
      });
      if (bnbBalance < parseUnits("0.0005", 18)) {
        await callback?.({
          text: "This wallet needs at least 0.0005 BNB on BSC for network gas.",
        });
        return false;
      }

      const amount = parseUnits(String(lot.price_usdt), 18);
      const usdtBalance = await publicClient.readContract({
        address: USDT,
        abi: ABI,
        functionName: "balanceOf",
        args: [account.address],
      });

      if (usdtBalance < amount) {
        await callback?.({
          text: `Lot ${lot.id} costs ${lot.price_usdt} USDT. Wallet balance: ${formatUnits(usdtBalance, 18)} USDT.`,
        });
        return false;
      }

      const txHash = await walletClient.writeContract({
        address: USDT,
        abi: ABI,
        functionName: "transfer",
        args: [TREASURY, amount],
      });

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
      });

      if (receipt.status !== "success") {
        await callback?.({ text: `Transaction reverted: ${txHash}` });
        return false;
      }

      const confirmation = await fetch(API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lotId: lot.id, txHash }),
      });
      const result = await confirmation.json();

      if (!confirmation.ok) {
        await callback?.({
          text: `USDT was sent, but registration was rejected: ${JSON.stringify(result)}`,
        });
        return false;
      }

      await callback?.({
        text: `Lot ${lot.id} confirmed in Nova AI World. Transaction: ${txHash}`,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await callback?.({ text: `Nova lot purchase failed: ${message}` });
      return false;
    }
  },
  examples: [],
} as Action;

export const novaCityPlugin: Plugin = {
  name: "nova-city",
  description: "Nova AI World land purchases through USDT on BSC",
  actions: [buyLot],
  providers: [cityProvider],
};

export default novaCityPlugin;
