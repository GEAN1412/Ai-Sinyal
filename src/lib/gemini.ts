import { GoogleGenAI, Type } from "@google/genai";

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

// Initialize AI if key is available
const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

export const generateSignal = async (symbol: string, data: MarketData[], news?: NewsItem[]): Promise<TradeSignal | null> => {
  if (!data || data.length === 0) return null;
  if (!ai) {
    console.error("AI service not initialized (missing API key)");
    return null;
  }

  const currentPrice = data[data.length - 1].close;
  const recentHistory = data.slice(-20).map((d: any) => ({
    time: new Date(d.time).toISOString(),
    close: d.close,
    high: d.high,
    low: d.low
  }));

  const newsContext = news && news.length > 0 
    ? `Berita Utama Terbaru:\n${news.slice(0, 5).map((n: any) => `- ${n.title} (${n.publisher})`).join('\n')}`
    : "Tidak ada berita spesifik ditemukan.";

  const prompt = `
    Sebagai analis finansial profesional, analisis data pasar dan berita berikut untuk ${symbol}.
    
    Riwayat harga terakhir (20 interval terakhir):
    ${JSON.stringify(recentHistory, null, 2)}
    
    ${newsContext}

    Harga Saat Ini: ${currentPrice}

    Berdasarkan analisis teknikal DAN sentimen berita fundamental, berikan sinyal trading.
    Berikan respon dalam format JSON yang ketat.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            action: { type: Type.STRING, enum: ["BUY", "SELL", "HOLD"] },
            price: { type: Type.NUMBER },
            confidence: { type: Type.NUMBER },
            reasoning: { type: Type.STRING },
            targets: { type: Type.ARRAY, items: { type: Type.NUMBER } },
            stopLoss: { type: Type.NUMBER }
          },
          required: ["action", "price", "confidence", "reasoning", "targets", "stopLoss"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("Empty response from AI");
    
    const aiResult = JSON.parse(text);
    
    return {
      symbol,
      ...aiResult,
      timestamp: Date.now()
    };
  } catch (error) {
    console.error("AI Signal Generation Error:", error);
    // Re-throw with clear message for the UI if needed, but here we return null to fail gracefully
    if (error instanceof Error && error.message.includes("API key not valid")) {
        throw new Error("API Key Gemini tidak valid atau belum dikonfigurasi dengan benar di AI Studio Settings.");
    }
    return null;
  }
};
