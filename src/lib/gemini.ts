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
    const userApiKey = localStorage.getItem("GEMINI_API_KEY");
    const apiKey = userApiKey || (process.env.GEMINI_API_KEY as string);

    if (!apiKey) {
      throw new Error("API Key Gemini tidak ditemukan. Silakan masukkan di menu Settings.");
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

      Provide a trading signal in JSON format:
      {
        "action": "BUY" | "SELL" | "HOLD",
        "price": number,
        "confidence": number (0-100),
        "reasoning": "brief explanation in Indonesian",
        "targets": [tp1, tp2],
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
      throw new Error(`Gagal Analisa AI: ${modelError.message}`);
    }
  } catch (error: any) {
    console.error("AI Signal Generation Error:", error.message);
    if (error.message?.includes("API_KEY_INVALID") || error.message?.includes("API key not valid")) {
      throw new Error("API Key Gemini tidak valid. Pastikan Anda menyalin API KEY (biasanya diawali 'AIza') dari Google AI Studio, bukan NAMA MODEL.");
    }
    if (error.message?.includes("not found") || error.message?.includes("404")) {
      throw new Error("Model AI tidak ditemukan. Silakan periksa apakah API Key Anda memiliki akses ke model Gemini.");
    }
    throw new Error(`Gagal Analisa AI: ${error.message}`);
  }
};
