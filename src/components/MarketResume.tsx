import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { TrendingUp, TrendingDown, RefreshCcw } from 'lucide-react';
import { cn, formatCurrency } from '../lib/utils';

interface MarketData {
  symbol: string;
  price: number;
  change: number;
}

interface SummaryProps {
  title: string;
  category: string;
  symbols: string[];
}

export const MarketResumeCard: React.FC<SummaryProps> = ({ title, category, symbols }) => {
  const [data, setData] = useState<MarketData[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSummary = async (retries = 2) => {
    try {
      const res = await axios.get('/api/market-summary', {
        params: { symbols: symbols.join(','), category },
        timeout: 15000 // 15s timeout
      });
      setData(res.data);
    } catch (err: any) {
      console.error(`Failed to fetch ${title} summary:`, err.message);
      if (retries > 0) {
        console.log(`Retrying ${title} summary... (${retries} left)`);
        setTimeout(() => fetchSummary(retries - 1), 2000);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Stagger initial fetch to avoid simultaneous pressure
    const delay = Math.random() * 2000;
    const timer = setTimeout(() => {
      fetchSummary();
    }, delay);
    
    const interval = setInterval(fetchSummary, 45000); // 45s auto-refresh (relaxed from 30s)
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex-1">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white/60 text-xs font-bold uppercase tracking-widest flex items-center gap-2">
          {title}
          {loading && <RefreshCcw className="w-3 h-3 animate-spin text-white/40" />}
        </h3>
      </div>
      <div className="space-y-3">
        {data.map((item, idx) => (
          <div key={idx} className="flex items-center justify-between group cursor-pointer hover:bg-white/5 p-1 rounded-lg transition-all">
            <span className="font-mono text-xs font-bold text-white/80 uppercase">
                {(item.symbol || '').replace('=X', '').replace('.JK', '').replace('USDT', '')}
            </span>
            <div className="text-right">
              <div className="font-mono text-sm font-bold">{formatCurrency(item.price, item.symbol, category as any)}</div>
              <div className={cn(
                "text-[10px] font-bold flex items-center justify-end gap-1",
                item.change >= 0 ? "text-emerald-400" : "text-rose-400"
              )}>
                {item.change >= 0 ? <TrendingUp className="w-2 h-2" /> : <TrendingDown className="w-2 h-2" />}
                {Math.abs(item.change).toFixed(2)}%
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
