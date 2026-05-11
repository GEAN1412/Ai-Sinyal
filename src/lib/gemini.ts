import axios from "axios";

export interface MarketData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TradeSignal {
  symbol: string;
  action: "BUY" | "SELL" | "HOLD";
  price: number;
  confidence: number;
  reasoning: string;
  targets: number[];
  stopLoss: number;
  timestamp: number;
}

export interface NewsItem {
  title: string;
  publisher: string;
  link?: string;
}

export const generateSignal = async (symbol: string, data: MarketData[], news?: NewsItem[]): Promise<TradeSignal | null> => {
  if (!data || data.length === 0) return null;

  try {
    const response = await axios.post("/api/generate-signal", {
      symbol,
      data,
      news
    });
    return response.data;
  } catch (error: any) {
    console.error("AI Signal Generation Error:", error.response?.data || error.message);
    if (error.response?.data?.error) {
        throw new Error(error.response.data.error);
    }
    return null;
  }
};
