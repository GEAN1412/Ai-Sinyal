import { GoogleGenAI } from "@google/genai";

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
    const recentHistory = data.slice(-20).map((d) => ({
      time: new Date(d.time).toISOString(),
      close: d.close,
      high: d.high,
      low: d.low
    }));

    const newsContext = news && news.length > 0 
      ? `Berita Utama Terbaru:\n${news.slice(0, 5).map((n) => `- ${n.title} (${n.publisher})`).join('\n')}`
      : "Tidak ada berita spesifik ditemukan.";

    const prompt = `
      Sebagai analis finansial profesional, analisis data pasar dan berita berikut untuk ${symbol}.
      
      Riwayat harga terakhir (20 interval terakhir):
      ${JSON.stringify(recentHistory, null, 2)}
      
      ${newsContext}

      Harga Saat Ini: ${currentPrice}

      Berdasarkan analisis teknikal DAN sentimen berita fundamental, berikan sinyal trading.
      Berikan respon dalam format JSON yang ketat dengan kolom berikut:
      {
        "action": "BUY" | "SELL" | "HOLD",
        "price": number (harga entri saat ini),
        "confidence": number (0-100),
        "reasoning": string (penjelasan singkat dalam Bahasa Indonesia, sebutkan faktor teknikal dan fundamental),
        "targets": [number, number] (level take profit),
        "stopLoss": number
      }
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json"
      }
    });

    if (!response.text) {
      throw new Error("Gagal mendapatkan respon dari AI.");
    }

    const aiResult = JSON.parse(response.text);
    
    return {
      symbol,
      ...aiResult,
      timestamp: Date.now()
    };
  } catch (error: any) {
    console.error("AI Signal Generation Error:", error.message);
    if (error.message?.includes("API_KEY_INVALID") || error.message?.includes("API key not valid")) {
      throw new Error("API Key Gemini tidak valid. Silakan periksa di menu Settings.");
    }
    throw error;
  }
};
