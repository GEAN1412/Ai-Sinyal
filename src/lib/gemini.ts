import { GoogleGenAI } from "@google/genai";
import { format } from "date-fns";

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
    // Priority: process.env.GEMINI_API_KEY (platform handled) -> localStorage (user override)
    const apiKey = (process.env.GEMINI_API_KEY as string) || localStorage.getItem("GEMINI_API_KEY");

    if (!apiKey) {
      throw new Error("API Key Gemini tidak ditemukan.");
    }

    const ai = new GoogleGenAI({ apiKey });
    
    const currentPrice = data[data.length - 1].close;
    const recentHistory = data.slice(-40).map((d) => ({
      time: format(d.time, 'HH:mm'),
      price: d.close,
    }));

    const newsContext = news && news.length > 0 
      ? `Berita Utama Terbaru:\n${news.slice(0, 5).map((n) => `- ${n.title} (${n.publisher})`).join('\n')}`
      : "Tidak ada berita spesifik.";

    const prompt = `
      As a professional financial analyst, analyze this data for ${symbol}.
      
      Last 40 price points:
      ${JSON.stringify(recentHistory)}
      
      ${newsContext}

      Current Price: ${currentPrice}

      Provide a trading signal in JSON format exactly with this structure:
      {
        "action": "BUY" | "SELL" | "HOLD",
        "price": number,
        "confidence": number,
        "reasoning": "brief explanation in Indonesian language (Bahasa Indonesia)",
        "targets": [number, number],
        "stopLoss": number
      }
    `;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });
      
      const text = response.text;
      
      if (!text) {
        throw new Error("AI tidak memberikan respon teks.");
      }

      const aiResult = JSON.parse(text);
      
      return {
        symbol,
        ...aiResult,
        timestamp: Date.now()
      };
    } catch (modelError: any) {
      console.warn("AI Analysis failed:", modelError.message);
      
      // Handle permission errors more gracefully
      if (modelError.message?.includes("permission") || modelError.message?.includes("403")) {
        throw new Error("Akses Gemini Ditolak (403). Pastikan API Key ditingkatkan ke akun berbayar atau pilih kunci yang benar.");
      }
      
      if (modelError.message?.includes("not found") || modelError.message?.includes("404")) {
         throw new Error("Model AI tidak ditemukan. Silakan hubungi admin aplikasi.");
      }

      throw new Error(modelError.message || "Gagal memproses permintaan AI");
    }
  } catch (error: any) {
    console.error("AI Signal Generation Error:", error.message);
    
    const message = error.message.replace(/^Gagal Analisa AI: /g, "");
    
    if (message.includes("API_KEY_INVALID") || message.includes("not valid")) {
      throw new Error("API Key Gemini tidak valid.");
    }
    
    throw new Error(`Gagal Analisa AI: ${message}`);
  }
};
