import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import cors from "cors";
import yahooFinanceModule from "yahoo-finance2";
const yf = new (yahooFinanceModule as any)();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration for Yahoo Finance - remove invalid setGlobalConfig call
if (yf.setGlobalConfig) {
  yf.setGlobalConfig({
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
function normalizeForYahoo(symbol: string, type?: string): string {
  let s = symbol.toUpperCase().trim();
  
  // Custom mappings for common failures
  const mappings: Record<string, string> = {
    "GOLD": "GC=F",
    "SILVER": "SI=F",
    "XAUUSD=X": "GC=F",
    "XAGUSD=X": "SI=F",
    "BTCUSDT": "BTC-USD",
    "ETHUSDT": "ETH-USD",
    "XRPUSDT": "XRP-USD",
    "SOLUSDT": "SOL-USD",
    "BNBUSDT": "BNB-USD",
    "DOGEUSDT": "DOGE-USD",
    "ADAUSDT": "ADA-USD"
  };

  if (mappings[s]) return mappings[s];

  // IHSG Index
  if (s === "IHSG" || s === "COMPOSITE") return "^JKSE";

  // Forex normalization: EURJPY -> EURJPY=X
  if (type === "forex" || (s.length === 6 && !s.includes(".") && !s.includes("-") && !s.includes("="))) {
    if (!s.endsWith("=X")) return `${s}=X`;
  }

  // Indonesian Stocks fallback
  if (type === "saham" && s.length === 4 && !s.includes(".") && !s.startsWith("^")) {
    return `${s}.JK`;
  }

  // Crypto normalization
  if (s.endsWith("USDT")) {
    return s.replace("USDT", "-USD");
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
          targetSymbol = normalizeForYahoo(symbol as string, type as string);
          // Continue to the Yahoo Finance block below
        }
      }

      // Yahoo Finance Block (or fallback for crypto)
      if (type !== "crypto" || targetSymbol.includes("-USD") || targetSymbol.includes("-BTC")) {
        // Ensure symbol is Yahoo-friendly
        targetSymbol = normalizeForYahoo(targetSymbol, type as string);

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
            const queryOptions: any = {
              period1,
              period2: new Date(),
              interval: intervalMap[interval as string] || '1h',
            };

            // Use chart for everything as it's more robust in v2/v3
            result = await yf.chart(targetSymbol, queryOptions, { validateResult: false });

            // Fallback for Gold if Spot fails
            if ((!result || !result.quotes || result.quotes.length === 0) && targetSymbol === "GC=F") {
               const altSymbol = "XAUUSD=X";
               result = await yf.chart(altSymbol, queryOptions, { validateResult: false });
            }

            // Fallback for Silver if Spot fails
            if ((!result || !result.quotes || result.quotes.length === 0) && targetSymbol === "XAGUSD=X") {
               const altSymbol = "SI=F"; // Silver Futures as fallback
               result = await yf.chart(altSymbol, queryOptions, { validateResult: false });
            }

            if (!result || !result.quotes) return [];

            const quotes = result.quotes || [];
            
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
      // Normalize before fetching
      targetSymbol = normalizeForYahoo(targetSymbol, "saham");

      // Validate symbol: don't even try if it's clearly crypto-like or index from frontend
      if (targetSymbol.includes("-USD") || targetSymbol.includes("-BTC")) {
         return res.json(null);
      }

      // Fetch deep financial modules with robust error handling
      let summary: any = null;
      try {
        summary = await yf.quoteSummary(targetSymbol, {
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
        // Yahoo Finance can fetch multiple quotes at once
        const yahooSymbols = symbolList.map(s => normalizeForYahoo(s, category as string));
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
                const q = await yf.quote(s) as any;
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

  // Vite middleware setup
  if (process.env.NODE_ENV !== "production") {
    console.log("Initializing Vite dev server...");
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      if (req.path.startsWith('/api')) return res.status(404).json({ error: 'API not found' });
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
