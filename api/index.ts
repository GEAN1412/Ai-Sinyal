import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import cors from "cors";
import yfModule from "yahoo-finance2";

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
    "XAUUSD=X": "GC=F", 
    "GOLD": "GC=F",
    "SILVER": "SI=F",
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
  app.use(cors());

  // Logging middleware
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });
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
               const altSymbol = "XAUUSD=X";
               if (interval === '1d') {
                result = await yf.historical(altSymbol, { period1: period1 }, { validateResult: false });
               } else {
                result = await yf.chart(altSymbol, { period1: period1, interval: intervalMap[interval as string] || '1h' }, { validateResult: false });
               }
            }

            // Fallback for Silver if Spot fails
            if ((!result || (interval === '1d' ? result.length === 0 : !result.quotes || result.quotes.length === 0)) && targetSymbol === "XAGUSD=X") {
               const altSymbol = "SI=F"; // Silver Futures as fallback
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

    console.log(`Fetching ${category} summary for: ${symbols}`);

    try {
      if (category === "crypto") {
        const results = await Promise.all(symbolList.map(async (s) => {
          try {
            const resp = await axios.get("https://api.binance.com/api/v3/ticker/24hr", {
              params: { symbol: s },
              timeout: 5000
            });
            return {
              symbol: s,
              price: parseFloat(resp.data.lastPrice),
              change: parseFloat(resp.data.priceChangePercent)
            };
          } catch (e: any) {
            console.error(`Binance summary error for ${s}:`, e.message);
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
          // Add timeout for Yahoo
          const quotes = await Promise.race([
            yf.quote(yahooSymbols),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Yahoo Quote Timeout")), 10000))
          ]) as any;

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
             } catch (e: any) {
                return { symbol: s, price: 0, change: 0, error: true };
             }
          }));
          setCache(cacheKey, results);
          return res.json(results);
        }
      }
    } catch (error: any) {
      console.error("Market summary total error:", error.message);
      res.status(500).json({ error: error.message || "Unknown error" });
    }
  });

  app.get("/api/health", (req, res) => res.json({ status: "ok" }));

  if (process.env.NODE_ENV !== "production" && process.env.VERCEL !== "1") {
    console.log("Initializing Vite dev server...");
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else if (process.env.VERCEL !== "1") {
    // Local production only
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      if (req.path.startsWith('/api')) return res.status(404).json({ error: 'API not found' });
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Only listen if not in serverless environment
  if (process.env.VERCEL !== "1") {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server listening on http://0.0.0.0:${PORT}`);
    });
  }

  return app;
}

const appPromise = startServer();

export default async (req: any, res: any) => {
  const app = await appPromise;
  return app(req, res);
};
