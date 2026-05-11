import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import yfModule from "yahoo-finance2";
import { GoogleGenerativeAI } from "@google/generative-ai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Yahoo Finance instance correctly as per v2/v3 requirements
const yf = new (yfModule as any)();

if (yf && typeof (yf as any).setGlobalConfig === 'function') {
  (yf as any).setGlobalConfig({
    validation: { logErrors: false, errorHandler: () => {} }
  });
}

// Simple in-memory cache
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 60 * 1000; // 1 minute

const CACHE_TTL_NEWS = 10 * 60 * 1000; // 10 minutes

function getFromCache(key: string, ttl = CACHE_TTL) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < ttl) {
    return cached.data;
  }
  return null;
}

// Helper to normalize symbols for Yahoo Finance
function normalizeForYahoo(symbol: string): string {
  let s = symbol.toUpperCase().trim();
  
  // Custom mappings for common failures
  const mappings: Record<string, string> = {
    "XAUUSD=X": "GC=F", // Gold Mapping to Futures as it's more reliable for historical data
    "GOLD": "GC=F",
    "BTCUSDT": "BTC-USD",
    "ETHUSDT": "ETH-USD",
    "XRPUSDT": "XRP-USD",
    "SOLUSDT": "SOL-USD",
    "BNBUSDT": "BNB-USD",
    "DOGEUSDT": "DOGE-USD",
    "ADAUSDT": "ADA-USD"
  };

  if (mappings[s]) return mappings[s];

  // Crypto normalization: BTCUSDT -> BTC-USD (regex for broader support)
  if (s.endsWith("USDT")) {
    return s.replace("USDT", "-USD");
  }

  // Generic crypto fallback if no common separators
  if (!s.includes("-") && !s.includes(".") && !s.includes("=") && s.length >= 3 && !s.startsWith("^")) {
    if (["BTC", "ETH", "SOL", "BNB", "DOGE", "ADA", "XRP"].includes(s)) {
      return `${s}-USD`;
    }
  }
  return s;
}

function setCache(key: string, data: any) {
  cache.set(key, { data, timestamp: Date.now() });
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  const apiKey = process.env.GEMINI_API_KEY;
  const ai = apiKey ? new GoogleGenerativeAI(apiKey) : null;

  // API Routes
  app.get("/api/market-data", async (req, res) => {
    const { symbol = "BTCUSDT", interval = "1h", limit = "50", type = "crypto" } = req.query;
    
    // Avoid fetching for very short strings (typing state)
    if (!symbol || (symbol as string).length < 3 && !((symbol as string).startsWith("^"))) {
      return res.json([]);
    }

    const cacheKey = `market-${symbol}-${interval}-${type}`;
    const cachedData = getFromCache(cacheKey);
    if (cachedData) return res.json(cachedData);
    
    let targetSymbol = (symbol as string).toUpperCase();

    try {
      // Logic to decide which provider to use first
      const isStockOrIndex = targetSymbol.includes(".") || targetSymbol.startsWith("^");
      const isForex = targetSymbol.endsWith("=X") || type === "forex";
      
      if (type === "crypto" && !isStockOrIndex && !isForex) {
        try {
          // Normalize for Binance
          let binanceSymbol = (symbol as string).toUpperCase();
          if (binanceSymbol.includes("-USD")) {
            binanceSymbol = binanceSymbol.replace("-USD", "USDT");
          }
          
          const response = await axios.get(`https://api.binance.com/api/v3/klines`, {
            params: {
              symbol: binanceSymbol,
              interval,
              limit,
            },
            timeout: 5000,
          });
          
          const formattedData = response.data.map((item: any) => ({
            time: item[0],
            open: parseFloat(item[1]),
            high: parseFloat(item[2]),
            low: parseFloat(item[3]),
            close: parseFloat(item[4]),
            volume: parseFloat(item[5]),
          }));
          setCache(cacheKey, formattedData);
          return res.json(formattedData);
        } catch (binanceError) {
          console.warn(`Binance fetch failed for ${symbol}, trying Yahoo fallback...`);
          targetSymbol = normalizeForYahoo(symbol as string);
          // Continue to the Yahoo Finance block below
        }
      }

      // Yahoo Finance Block (or fallback for crypto)
      if (type !== "crypto" || targetSymbol.includes("-USD") || targetSymbol.includes("-BTC")) {
        if (!yf) throw new Error("Yahoo Finance service unavailable");

        // Ensure symbol is Yahoo-friendly
        targetSymbol = normalizeForYahoo(targetSymbol);

        // Auto-fix common issues for Indonesian stocks (standard BEI tickers are 4 letters)
        if (type === "saham" && targetSymbol.length === 4 && !targetSymbol.includes(".") && !targetSymbol.startsWith("^")) {
          targetSymbol = `${targetSymbol}.JK`;
        }

        const intervalMap: any = {
          "1m": "1m",
          "5m": "5m",
          "15m": "15m",
          "1h": "1h",
          "4h": "1h", 
          "1d": "1d",
        };

        const period1 = new Date();
        if (interval === '1m') {
          period1.setDate(period1.getDate() - 3); // 1m data is very limited
        } else if (interval === '5m' || interval === '15m') {
          period1.setDate(period1.getDate() - 15); // 15 days
        } else if (interval === '1h' || interval === '4h') {
          period1.setDate(period1.getDate() - 60); // 60 days
        } else {
          period1.setDate(period1.getDate() - 365); // 1 year for daily
        }

        // Use Promise.race for a simple timeout
        const dataPromise = (async () => {
          try {
            let result: any;
            if (interval === '1d') {
              result = await yf.historical(targetSymbol, { period1: period1 }, { validateResult: false });
            } else {
              const queryOptions: any = {
                period1: period1,
                interval: intervalMap[interval as string] || '1h',
              };
              result = await yf.chart(targetSymbol, queryOptions, { validateResult: false });
            }

            // Fallback for Gold if Spot fails
            if ((!result || (interval === '1d' ? result.length === 0 : !result.quotes || result.quotes.length === 0)) && targetSymbol === "GC=F") {
              // This is already the fallback symbol, if it fails maybe try XAUUSD=X even if it's less reliable for historical
               const altSymbol = "XAUUSD=X";
               if (interval === '1d') {
                result = await yf.historical(altSymbol, { period1: period1 }, { validateResult: false });
               } else {
                result = await yf.chart(altSymbol, { period1: period1, interval: intervalMap[interval as string] || '1h' }, { validateResult: false });
               }
            }

            if (!result) return [];

            const quotes = interval === '1d' ? result : (result.quotes || []);
            
            return quotes.map((q: any) => ({
              time: q.date.getTime(),
              open: q.open,
              high: q.high,
              low: q.low,
              close: q.close,
              volume: q.volume || 0,
            })).filter((q: any) => q.close !== null);
          } catch (e) {
            console.warn(`Yahoo Finance fetch failed for ${targetSymbol}:`, (e as any).message);
            return [];
          }
        })();

        const timeoutPromise = new Promise<any[]>((_, reject) => 
          setTimeout(() => reject(new Error("Timeout (API slow)")), 8000)
        );

        const data: any = await Promise.race([dataPromise, timeoutPromise]);
        
        if (!data || data.length === 0) {
          return res.json([]); // Return empty instead of 404
        }

        const finalData = data.slice(-(parseInt(limit as string)));
        setCache(cacheKey, finalData);
        return res.json(finalData);
      }
    } catch (error: any) {
      console.error(`Error fetching market data for ${symbol}:`, error.message);
      // More graceful error handling
      res.status(200).json([]); 
    }
  });

  app.get("/api/news", async (req, res) => {
    const { symbol, type = "crypto" } = req.query;
    
    if (!symbol || (symbol as string).length < 3) {
      return res.json([]);
    }

    const cacheKey = `news-${symbol}`;
    const cachedData = getFromCache(cacheKey, CACHE_TTL_NEWS);
    if (cachedData) return res.json(cachedData);

    let searchSymbol = symbol as string;
    
    // Transform symbol for news search if it's crypto
    if (type === "crypto") {
      // Binance BTCUSDT -> BTC-USD for Yahoo News
      if (searchSymbol.endsWith("USDT")) {
        searchSymbol = searchSymbol.replace("USDT", "-USD");
      } else if (searchSymbol.endsWith("BTC")) {
        searchSymbol = searchSymbol.replace("BTC", "-BTC");
      }
    } else if (type === "saham" && !searchSymbol.includes(".") && !searchSymbol.startsWith("^")) {
      searchSymbol = `${searchSymbol}.JK`;
    }

    // For Indonesian stocks, try searching with keywords to get local news if possible
    const searchQuery = (type === "saham" && searchSymbol.endsWith(".JK")) 
      ? `${searchSymbol} saham Indonesia berita` 
      : searchSymbol;

    try {
      if (!yf) throw new Error("Yahoo Finance service unavailable");
      
      // Use search which is more tolerant than specific news modules
      const result: any = await yf.search(searchQuery);
      
      const news = result.news?.map((n: any) => ({
        title: n.title,
        link: n.link,
        publisher: n.publisher,
        providerPublishTime: n.providerPublishTime,
        thumbnail: n.thumbnail?.resolutions?.[0]?.url
      })) || [];

      setCache(cacheKey, news);
      res.json(news);
    } catch (error: any) {
      console.error(`Error fetching news for ${searchSymbol}:`, error.message);
      // Don't 500 the whole thing if news fails, just return empty list
      res.json([]);
    }
  });

  app.get("/api/stock-fundamentals", async (req, res) => {
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: "Symbol required" });

    let targetSymbol = (symbol as string).toUpperCase();
    if (targetSymbol.length === 4 && !targetSymbol.includes(".") && !targetSymbol.startsWith("^")) {
      targetSymbol = `${targetSymbol}.JK`;
    }

    const cacheKey = `fundamentals-${targetSymbol}`;
    const cachedData = getFromCache(cacheKey, 3600); // Cache fundamentals for 1 hour
    if (cachedData) return res.json(cachedData);

    try {
      if (!yf) throw new Error("Yahoo Finance unavailable");

      // Normalize before fetching
      targetSymbol = normalizeForYahoo(targetSymbol);

      // Validate symbol: don't even try if it's clearly crypto-like or index from frontend
      if (targetSymbol.includes("-USD") || targetSymbol.includes("-BTC")) {
         return res.json(null);
      }

      // Fetch deep financial modules with robust error handling
      let summary: any = null;
      try {
        summary = await (yf as any).quoteSummary(targetSymbol, {
          modules: [
            "defaultKeyStatistics",
            "financialData",
            "incomeStatementHistory",
            "balanceSheetHistory",
            "summaryDetail"
          ]
        });
      } catch (e: any) {
        console.warn(`Quote summary failed for ${targetSymbol}:`, e.message);
        // If it's a specific "No fundamentals data found" error, we just return null gracefully
        return res.json(null);
      }

      if (!summary) {
        return res.json(null);
      }

      const stats = summary.defaultKeyStatistics || {};
      const finData = summary.financialData || {};
      const incomeHistory = summary.incomeStatementHistory?.incomeStatementHistory || [];
      const balanceHistory = summary.balanceSheetHistory?.balanceSheetHistory || [];
      const detail = summary.summaryDetail || {};

      const result = {
        symbol: targetSymbol,
        per: detail.trailingPE || stats.trailingPE || "N/A",
        pbv: stats.priceToBook || "N/A",
        eps: stats.trailingEps || "N/A",
        dividendYield: detail.dividendYield || stats.dividendYield || 0,
        // History for the last 3-4 years
        earningsHistory: Array.isArray(incomeHistory) ? incomeHistory.map((h: any) => ({
          date: h.endDate,
          netIncome: h.netIncome
        })) : [],
        balanceHistory: Array.isArray(balanceHistory) ? balanceHistory.map((h: any) => ({
          date: h.endDate,
          cash: h.cash,
          shortTermDebt: h.shortTermDebt || 0,
          longTermDebt: h.longTermDebt || 0,
          totalDebt: (h.shortTermDebt || 0) + (h.longTermDebt || 0)
        })) : []
      };

      setCache(cacheKey, result);
      res.json(result);
    } catch (error: any) {
      console.error(`Fundamental error for ${targetSymbol}:`, error.message);
      // Return null instead of 500 to keep the UI clean
      res.json(null);
    }
  });

  app.get("/api/market-summary", async (req, res) => {
    const { symbols, category } = req.query;
    if (!symbols || !category) return res.status(400).json({ error: "Missing parameters" });

    const symbolList = (symbols as string).split(",");
    const cacheKey = `summary-${category}-${symbols}`;
    const cachedData = getFromCache(cacheKey, 30); // Short cache for summary (30s)
    if (cachedData) return res.json(cachedData);

    try {
      if (category === "crypto") {
        const results = await Promise.all(symbolList.map(async (s) => {
          try {
            const resp = await axios.get("https://api.binance.com/api/v3/ticker/24hr", {
              params: { symbol: s }
            });
            return {
              symbol: s,
              price: parseFloat(resp.data.lastPrice),
              change: parseFloat(resp.data.priceChangePercent)
            };
          } catch (e) {
            return { symbol: s, price: 0, change: 0, error: true };
          }
        }));
        setCache(cacheKey, results);
        return res.json(results);
      } else {
        if (!yf) throw new Error("Yahoo Finance service unavailable");
        
        // Yahoo Finance can fetch multiple quotes at once
        const yahooSymbols = symbolList.map(s => normalizeForYahoo(s));
        try {
          const quotes = await yf.quote(yahooSymbols);
          const results = quotes.map((q: any) => ({
            symbol: q.symbol || "",
            price: q.regularMarketPrice ?? 0,
            change: q.regularMarketChangePercent ?? 0
          }));
          setCache(cacheKey, results);
          return res.json(results);
        } catch (yahooErr: any) {
          console.warn("Yahoo quote summary failed, falling back to sequential:", yahooErr.message);
          // Fallback to sequential if batch fails
          const results = await Promise.all(yahooSymbols.map(async (s) => {
             try {
                const q = await yf.quote(s);
                return {
                  symbol: s,
                  price: q.regularMarketPrice ?? 0,
                  change: q.regularMarketChangePercent ?? 0
                };
             } catch (e) {
                return { symbol: s, price: 0, change: 0, error: true };
             }
          }));
          setCache(cacheKey, results);
          return res.json(results);
        }
      }
    } catch (error: any) {
      console.error("Market summary error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Proxy for Forex (example using exchangerate-api or similar if needed)
  // For now, let's just use Binance for Crypto focus but label it generically.

  app.get("/api/health", (req, res) => res.json({ status: "ok" }));

  app.post("/api/generate-signal", async (req, res) => {
    const { symbol, data, news } = req.body;
    
    if (!data || data.length === 0) {
      return res.status(400).json({ error: "Missing data" });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "Gemini API key not configured on server" });
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

    try {
      if (!ai) {
        throw new Error("AI service not initialized (missing API key)");
      }
      const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json"
        }
      });

      const text = result.response.text() || "{}";
      const aiResult = JSON.parse(text);
      
      res.json({
        symbol,
        ...aiResult,
        timestamp: Date.now()
      });
    } catch (error: any) {
      console.error("AI Signal Generation Error:", error.message);
      res.status(500).json({ error: "AI Analysis failed: " + error.message });
    }
  });

  // Since it's a Vercel function, we don't need app.listen or static serving here
  return app;
}

const appPromise = startServer();

export default async (req: any, res: any) => {
  const app = await appPromise;
  return app(req, res);
};
