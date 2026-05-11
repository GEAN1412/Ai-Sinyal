/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from "react";
import { 
  TrendingUp, 
  TrendingDown, 
  Activity, 
  BarChart3, 
  BrainCircuit, 
  RefreshCw, 
  AlertCircle,
  Clock,
  Navigation,
  Globe,
  Coins,
  Building2,
  Newspaper,
  ExternalLink,
  Database,
  FileText,
  History
} from "lucide-react";
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Bar,
  BarChart
} from "recharts";
import { motion, AnimatePresence } from "motion/react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import axios from "axios";
import { format } from "date-fns";
import { generateSignal, type MarketData, type TradeSignal, type NewsItem } from "./lib/gemini";
import { MarketResumeCard } from "./components/MarketResume";
import { cn, formatCurrency } from "./lib/utils";

type MarketType = "crypto" | "forex" | "saham";

const CATEGORIES = [
  { id: "crypto", label: "Crypto", icon: <Coins className="w-4 h-4" /> },
  { id: "forex", label: "Forex", icon: <Globe className="w-4 h-4" /> },
  { id: "saham", label: "Indonesian Stocks", icon: <Building2 className="w-4 h-4" /> },
];

const SYMBOLS: Record<MarketType, { label: string; value: string }[]> = {
  crypto: [
    { label: "Bitcoin (BTC/USDT)", value: "BTCUSDT" },
    { label: "Ethereum (ETH/USDT)", value: "ETHUSDT" },
    { label: "Solana (SOL/USDT)", value: "SOLUSDT" },
    { label: "BNB (BNB/USDT)", value: "BNBUSDT" },
  ],
  forex: [
    { label: "XAU/USD (Gold)", value: "XAUUSD=X" },
    { label: "XAG/USD (Silver)", value: "XAGUSD=X" },
    { label: "GBP/JPY", value: "GBPJPY=X" },
    { label: "AUD/JPY", value: "AUDJPY=X" },
    { label: "NZD/JPY", value: "NZDJPY=X" },
    { label: "USD/JPY", value: "USDJPY=X" },
    { label: "CAD/JPY", value: "CADJPY=X" },
    { label: "EUR/JPY", value: "EURJPY=X" },
    { label: "CHF/JPY", value: "CHFJPY=X" },
    { label: "IDR/USD", value: "IDRUSD=X" },
  ],
  saham: [
    { label: "Bank BCA (BBCA)", value: "BBCA.JK" },
    { label: "Bank BRI (BBRI)", value: "BBRI.JK" },
    { label: "Telkom Indonesia (TLKM)", value: "TLKM.JK" },
    { label: "Astra International (ASII)", value: "ASII.JK" },
    { label: "GoTo Gojek Tokopedia (GOTO)", value: "GOTO.JK" },
    { label: "Bank Mandiri (BMRI)", value: "BMRI.JK" },
    { label: "IHSG Index (^JKSE)", value: "^JKSE" },
  ]
};

const INTERVALS = [
  { label: "1m", value: "1m" },
  { label: "5m", value: "5m" },
  { label: "15m", value: "15m" },
  { label: "1h", value: "1h" },
  { label: "4h", value: "4h" },
  { label: "1d", value: "1d" },
];

export default function App() {
  const [category, setCategory] = useState<MarketType>("crypto");
  const [symbol, setSymbol] = useState(SYMBOLS.crypto[0].value);
  const [interval, setInterval] = useState("1h");
  const [data, setData] = useState<MarketData[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [signal, setSignal] = useState<TradeSignal | null>(null);
  const [loading, setLoading] = useState(false);
  const [newsLoading, setNewsLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [fundamentals, setFundamentals] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDashboard, setShowDashboard] = useState(true);

  const fetchFundamentals = useCallback(async () => {
    if (category !== "saham" || !symbol || symbol.startsWith("^")) {
      setFundamentals(null);
      return;
    }
    try {
      const res = await axios.get("/api/stock-fundamentals", { params: { symbol } });
      setFundamentals(res.data);
    } catch (err) {
      console.error("Fundamental fetch error:", err);
    }
  }, [symbol, category]);

  const fetchData = useCallback(async () => {
    if (!symbol || symbol.length < 3 && !symbol.startsWith("^")) {
      setData([]);
      return;
    }
    setLoading(true);
    fetchFundamentals();
    try {
      const marketRes = await axios.get(`/api/market-data`, {
        params: { symbol, interval, limit: 100, type: category }
      });
      setData(marketRes.data || []);
      setError(null);
    } catch (err: any) {
      const message = err.response?.data?.error || "Gagal mengambil data pasar.";
      setError(message);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [symbol, interval, category]);

  const fetchNews = useCallback(async () => {
    if (!symbol || symbol.length < 3 && !symbol.startsWith("^")) {
      setNews([]);
      return;
    }
    setNewsLoading(true);
    try {
      const newsRes = await axios.get(`/api/news`, {
        params: { symbol, type: category }
      });
      setNews(newsRes.data || []);
    } catch (err) {
      console.error("News fetch error:", err);
    } finally {
      setNewsLoading(false);
    }
  }, [symbol, category]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchNews();
  }, [fetchNews]);

  // Handle category change
  useEffect(() => {
    setSymbol(SYMBOLS[category][0].value);
    setSignal(null);
  }, [category]);

  const handleAnalyze = async () => {
    if (data.length === 0) return;
    setAnalyzing(true);
    try {
      const newSignal = await generateSignal(symbol, data, news);
      setSignal(newSignal);
    } catch (err) {
      setError("Analisis AI gagal. Cobalah sesaat lagi.");
    } finally {
      setAnalyzing(false);
    }
  };

  const currentPrice = data[data.length - 1]?.close || 0;
  const priceChange = data.length > 1 && data[data.length - 2]?.close ? currentPrice - data[data.length - 2].close : 0;
  const priceChangePct = data.length > 1 && data[data.length - 2]?.close ? (priceChange / data[data.length - 2].close) * 100 : 0;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-emerald-500/30">
      {/* Header */}
      <header className="border-b border-white/10 bg-black/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-emerald-500/10 rounded-lg">
              <BrainCircuit className="w-6 h-6 text-emerald-500" />
            </div>
            <h1 className="font-bold text-xl tracking-tight hidden sm:block">
              AI Trade <span className="text-emerald-500">Signal Bot</span>
            </h1>
          </div>
          
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="hidden md:flex bg-white/5 border border-white/10 rounded-xl p-1 gap-1">
              {CATEGORIES.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setCategory(cat.id as MarketType)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all",
                    category === cat.id ? "bg-emerald-500 text-black shadow-lg" : "text-white/40 hover:text-white"
                  )}
                >
                  {cat.icon}
                  {cat.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <div className="relative group">
                <input 
                  type="text" 
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  placeholder="Input Kode (e.g. BBCA.JK)"
                  className="bg-white/5 border border-white/10 rounded-lg pl-3 pr-8 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all font-mono w-48"
                />
                <Navigation className="w-3 h-3 text-white/20 absolute right-3 top-1/2 -translate-y-1/2 group-focus-within:text-emerald-500 transition-colors" />
              </div>
              
              <select 
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all font-mono max-w-[40px]"
              >
                {SYMBOLS[category].map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>

            <select 
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
            >
              {INTERVALS.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
            </select>
            <button 
              onClick={() => setShowDashboard(!showDashboard)}
              className={cn(
                "p-2 rounded-lg transition-colors",
                showDashboard ? "bg-emerald-500/20 text-emerald-500" : "bg-white/5 text-white/40 hover:text-white"
              )}
              title="Toggle Dashboard"
            >
              <BarChart3 className="w-5 h-5" />
            </button>
            <button 
              onClick={fetchData}
              disabled={loading}
              className="p-2 hover:bg-white/5 rounded-lg transition-colors group"
            >
              <RefreshCw className={cn("w-4 h-4 text-white/60 group-hover:text-white", loading && "animate-spin")} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Dashboards Ringkasan */}
        <AnimatePresence mode="popLayout">
          {showDashboard && (
            <motion.div 
              key="dashboard"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="flex flex-col md:flex-row gap-4 mb-2">
                <MarketResumeCard 
                  title="Crypto Trending" 
                  category="crypto" 
                  symbols={["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "ADAUSDT", "DOGEUSDT"]} 
                />
                <MarketResumeCard 
                  title="Forex & Gold" 
                  category="forex" 
                  symbols={["XAUUSD=X", "USDJPY=X", "EURJPY=X", "GBPJPY=X", "AUDJPY=X", "CADJPY=X"]} 
                />
                <MarketResumeCard 
                  title="Saham ID (IHSG)" 
                  category="saham" 
                  symbols={["^JKSE", "BBCA.JK", "BBRI.JK", "TLKM.JK", "BMRI.JK", "ASII.JK"]} 
                />
              </div>
            </motion.div>
          )}

          {/* Fundamental Analysis for Saham */}
          {category === "saham" && fundamentals && (
            <motion.div 
              key={`fund-${fundamentals.symbol}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white/5 border border-white/10 rounded-2xl p-6 overflow-hidden relative"
            >
              <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none">
                <FileText className="w-48 h-48" />
              </div>
              
              <div className="flex items-center gap-2 mb-6">
                <div className="p-2 bg-blue-500/20 rounded-lg">
                  <Database className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <h3 className="text-white font-bold">Analisis Fundamental</h3>
                  <p className="text-white/40 text-[10px] uppercase tracking-widest font-bold">Data Keuangan Historis</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                {[
                  { label: "Price to Book (PBV)", value: fundamentals.pbv, suffix: "x" },
                  { label: "Price / Earnings (PER)", value: fundamentals.per, suffix: "x" },
                  { label: "Earn. Per Share (EPS)", value: fundamentals.eps, prefix: "Rp " },
                  { label: "Dividend Yield", value: (fundamentals.dividendYield * 100).toFixed(2), suffix: "%" },
                ].map((stat, i) => (
                  <div key={i} className="bg-white/5 p-4 rounded-xl border border-white/5">
                    <div className="text-white/40 text-[10px] font-bold uppercase tracking-wider mb-1">{stat.label}</div>
                    <div className="text-xl font-mono font-bold text-white">
                      {typeof stat.value === 'number' ? `${stat.prefix || ''}${stat.value.toLocaleString('id-ID')}${stat.suffix || ''}` : stat.value}
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-6">
                <div>
                  <h4 className="text-white/80 text-xs font-bold uppercase tracking-widest mb-4 flex items-center gap-2">
                    <TrendingUp className="w-3 h-3 text-emerald-400" />
                    Riwayat Laba Bersih (3-4 Tahun Terakhir)
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm font-mono">
                      <thead>
                        <tr className="text-white/30 border-b border-white/5">
                          <th className="pb-2 font-medium">Tahun</th>
                          <th className="pb-2 font-medium text-right">Laba Bersih</th>
                          <th className="pb-2 font-medium text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fundamentals.earningsHistory?.map((h: any, idx: number) => {
                          const year = new Date(h.date).getFullYear();
                          const prev = fundamentals.earningsHistory?.[idx + 1];
                          const growth = prev ? ((h.netIncome - prev.netIncome) / Math.abs(prev.netIncome)) * 100 : null;
                          return (
                            <tr key={`${year}-${idx}`} className="border-b border-white/5 last:border-0">
                              <td className="py-3 text-white/60">{year}</td>
                              <td className="py-3 text-right text-white font-bold">
                                {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', notation: 'compact' }).format(h.netIncome)}
                              </td>
                              <td className={cn(
                                "py-3 text-right font-bold text-[10px]",
                                growth === null ? "text-white/40" : (growth > 0 ? "text-emerald-400" : "text-rose-400")
                              )}>
                                {growth !== null ? `${growth > 0 ? '▲' : '▼'} ${Math.abs(growth).toFixed(1)}%` : '-'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="pt-4 border-t border-white/10">
                  <h4 className="text-white/80 text-xs font-bold uppercase tracking-widest mb-4 flex items-center gap-2">
                    <History className="w-3 h-3 text-blue-400" />
                    Kas & Utang (Neraca)
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm font-mono">
                      <thead>
                        <tr className="text-white/30 border-b border-white/5">
                          <th className="pb-2 font-medium">Tahun</th>
                          <th className="pb-2 font-medium text-right">Kas & Setara Kas</th>
                          <th className="pb-2 font-medium text-right">Total Utang</th>
                          <th className="pb-2 font-medium text-right">Cash/Debt Ratio</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fundamentals.balanceHistory?.map((h: any, idx: number) => {
                          const year = new Date(h.date).getFullYear();
                          return (
                            <tr key={`${year}-${idx}`} className="border-b border-white/5 last:border-0">
                              <td className="py-3 text-white/60">{year}</td>
                            <td className="py-3 text-right text-emerald-400">
                              {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', notation: 'compact' }).format(h.cash)}
                            </td>
                            <td className="py-3 text-right text-rose-400">
                              {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', notation: 'compact' }).format(h.totalDebt)}
                            </td>
                            <td className="py-3 text-right text-white">
                              {(h.cash / (h.totalDebt || 1)).toFixed(2)}x
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error Alert */}
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex items-center gap-3 text-red-400"
          >
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p className="text-sm">{error}</p>
          </motion.div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Chart Area */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6 overflow-hidden">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-3xl font-bold font-mono tracking-tighter">
                    {formatCurrency(currentPrice, symbol, category)}
                  </h2>
                  <div className={cn(
                    "flex items-center gap-1 text-sm font-medium mt-1",
                    priceChange >= 0 ? "text-emerald-500" : "text-rose-500"
                  )}>
                    {priceChange >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                    {priceChange >= 0 ? "+" : ""}{priceChangePct.toFixed(2)}%
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-xs uppercase tracking-widest text-white/40 font-semibold">Volume (24h)</span>
                  <span className="font-mono text-sm">
                    {data.length > 0 ? (data[data.length - 1].volume).toLocaleString() : "0"}
                  </span>
                </div>
              </div>

              <div className="h-[400px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data}>
                    <defs>
                      <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={priceChange >= 0 ? "#10b981" : "#f43f5e"} stopOpacity={0.3}/>
                        <stop offset="95%" stopColor={priceChange >= 0 ? "#10b981" : "#f43f5e"} stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis 
                      dataKey="time" 
                      stroke="rgba(255,255,255,0.3)" 
                      fontSize={11}
                      tickFormatter={(val) => format(val, 'HH:mm')}
                      minTickGap={30}
                    />
                    <YAxis 
                      domain={['auto', 'auto']} 
                      orientation="right"
                      stroke="rgba(255,255,255,0.3)" 
                      fontSize={11}
                      tickFormatter={(val) => {
                        const formatted = formatCurrency(val, symbol, category);
                        // Removing the currency symbol for ticks to keep it clean, but preserving the locale formatting
                        return formatted.replace(/[^\d.,]/g, '').trim();
                      }}
                    />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#141414', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                      labelStyle={{ color: 'rgba(255,255,255,0.5)' }}
                      labelFormatter={(val) => format(val, 'MMM dd, yyyy HH:mm')}
                      itemStyle={{ color: '#fff', fontWeight: 'bold' }}
                      formatter={(val: number) => [formatCurrency(val, symbol, category), "Price"]}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="close" 
                      stroke={priceChange >= 0 ? "#10b981" : "#f43f5e"} 
                      strokeWidth={2}
                      fillOpacity={1} 
                      fill="url(#colorPrice)" 
                      animationDuration={1000}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: "High", value: Math.max(...data.map(d => d.high), 0), icon: <Activity className="w-4 h-4" /> },
                { label: "Low", value: Math.min(...data.map(d => d.low), 9999999), icon: <Activity className="w-4 h-4 rotate-180" /> },
                { label: "Average", value: data.reduce((acc, d) => acc + d.close, 0) / (data.length || 1), icon: <BarChart3 className="w-4 h-4" /> },
                { label: "Data Points", value: data.length, icon: <Clock className="w-4 h-4" /> },
              ].map((stat, i) => (
                <div key={i} className="bg-white/5 border border-white/10 p-4 rounded-xl">
                  <div className="flex items-center gap-2 text-white/40 text-xs uppercase tracking-widest mb-1 font-semibold">
                    {stat.icon}
                    {stat.label}
                  </div>
                  <div className="font-mono font-bold">
                    {typeof stat.value === 'number' && stat.label !== 'Data Points' 
                      ? formatCurrency(stat.value, symbol, category)
                      : stat.value}
                  </div>
                </div>
              ))}
            </div>

            {/* News Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/10 rounded-lg">
                  <Newspaper className="w-5 h-5 text-blue-500" />
                </div>
                <h3 className="font-bold text-lg tracking-tight">Berita Terkait {symbol}</h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {newsLoading ? (
                  [1, 2, 3, 4].map((i) => (
                    <div key={i} className="animate-pulse bg-white/5 border border-white/10 p-4 rounded-xl h-24" />
                  ))
                ) : news.length > 0 ? news.map((item, i) => (
                  <motion.a
                    key={i}
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="group bg-white/5 border border-white/10 p-4 rounded-xl hover:border-white/20 transition-all block"
                  >
                    <div className="flex flex-col h-full justify-between gap-3">
                      <div className="space-y-2">
                        <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                          <span className="text-blue-400">{item.publisher}</span>
                        </div>
                        <h4 className="text-sm font-semibold line-clamp-2 leading-relaxed group-hover:text-blue-400 transition-colors">
                          {item.title}
                        </h4>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-white/30 font-semibold uppercase tracking-tighter pt-2 border-t border-white/5">
                        Lihat Selengkapnya
                        <ExternalLink className="w-3 h-3 transition-transform group-hover:translate-x-1" />
                      </div>
                    </div>
                  </motion.a>
                )) : (
                  <div className="col-span-full py-12 text-center border border-dashed border-white/10 rounded-2xl">
                    <p className="text-xs text-white/20 uppercase tracking-[0.3em] font-bold">Tidak ada berita terbaru ditemukan</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* AI Signal Sidebar */}
          <div className="space-y-6">
            <button 
              onClick={handleAnalyze}
              disabled={analyzing || loading}
              className="w-full h-14 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:bg-white/10 text-black font-bold rounded-2xl flex items-center justify-center gap-3 transition-all transform active:scale-[0.98] shadow-lg shadow-emerald-500/20"
            >
              {analyzing ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  MENGANALISIS PASAR...
                </>
              ) : (
                <>
                  <BrainCircuit className="w-5 h-5" />
                  MINTA SINYAL AI
                </>
              )}
            </button>

            <AnimatePresence mode="wait">
              {signal ? (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-white/5 border border-white/10 rounded-3xl overflow-hidden shadow-2xl relative"
                >
                  {/* Confidence Badge */}
                  <div className="absolute top-4 right-4 bg-black/40 backdrop-blur-sm px-2 py-1 rounded-full border border-white/10 flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[10px] uppercase tracking-tighter font-bold text-white/80">
                      {signal.confidence}% Confidence
                    </span>
                  </div>

                  <div className={cn(
                    "h-2",
                    signal.action === "BUY" ? "bg-emerald-500" : signal.action === "SELL" ? "bg-rose-500" : "bg-amber-500"
                  )} />
                  
                  <div className="p-6 space-y-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-white/40 text-xs font-bold uppercase tracking-[0.2em] mb-1 italic">Rekomendasi</h3>
                        <div className={cn(
                          "text-4xl font-black italic tracking-tighter",
                          signal.action === "BUY" ? "text-emerald-500" : signal.action === "SELL" ? "text-rose-500" : "text-amber-500"
                        )}>
                          {signal.action}
                        </div>
                      </div>
                      <div className="text-right">
                        <h3 className="text-white/40 text-xs font-bold uppercase tracking-[0.2em] mb-1 italic">Harga Entri</h3>
                        <div className="text-2xl font-mono font-bold">{formatCurrency(signal.price, symbol, category)}</div>
                      </div>
                    </div>

                    <div className="bg-black/40 rounded-2xl p-4 border border-white/5">
                      <h4 className="text-[10px] font-bold uppercase tracking-widest text-emerald-500 mb-2 flex items-center gap-2">
                        <AlertCircle className="w-3 h-3" />
                        Analisis AI
                      </h4>
                      <p className="text-sm leading-relaxed text-white/80">
                        {signal.reasoning}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-emerald-500/5 border border-emerald-500/20 p-3 rounded-xl">
                        <div className="text-emerald-500/50 text-[10px] font-bold uppercase tracking-wider mb-1">Take Profit</div>
                        <div className="space-y-1">
                          {signal.targets.map((t, idx) => (
                            <div key={idx} className="font-mono text-sm text-emerald-400 font-bold flex items-center gap-2">
                              <TrendingUp className="w-3 h-3" />
                              {formatCurrency(t, symbol, category)}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="bg-rose-500/5 border border-rose-500/20 p-3 rounded-xl text-right">
                        <div className="text-rose-500/50 text-[10px] font-bold uppercase tracking-wider mb-1">Stop Loss</div>
                        <div className="font-mono text-sm text-rose-400 font-bold flex items-center justify-end gap-2">
                          {formatCurrency(signal.stopLoss, symbol, category)}
                          <TrendingDown className="w-3 h-3" />
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-[10px] text-white/20 font-bold uppercase tracking-widest pt-2">
                      <Clock className="w-3 h-3" />
                      Waktu Sinyal: {format(signal.timestamp, 'HH:mm:ss')}
                    </div>
                  </div>
                </motion.div>
              ) : (
                <div className="bg-white/5 border border-dashed border-white/10 rounded-3xl p-12 flex flex-col items-center justify-center text-center gap-4">
                  <div className="p-4 bg-white/5 rounded-full">
                    <Navigation className="w-8 h-8 text-white/10" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-widest mb-1">Belum Ada Sinyal</h3>
                    <p className="text-xs text-white/30 leading-relaxed max-w-[200px]">
                      Klik tombol di atas untuk menganalisis pergerakan harga saat ini.
                    </p>
                  </div>
                </div>
              )}
            </AnimatePresence>

            <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-2xl">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="text-[10px] text-amber-500/80 leading-relaxed uppercase font-bold tracking-tight">
                  <span className="text-amber-500">DISCLAIMER:</span> Trading aset finansial memiliki risiko tinggi. Sinyal AI hanya sebagai alat bantu. Gunakan strategi manajemen risiko yang ketat.
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
      
      {/* Background Decor */}
      <div className="fixed inset-0 pointer-events-none opacity-20 overflow-hidden -z-10">
        <div className="absolute -top-1/4 -right-1/4 w-1/2 h-1/2 bg-emerald-500/30 blur-[120px] rounded-full" />
        <div className="absolute -bottom-1/4 -left-1/4 w-1/2 h-1/2 bg-rose-500/20 blur-[120px] rounded-full" />
      </div>
    </div>
  );
}
