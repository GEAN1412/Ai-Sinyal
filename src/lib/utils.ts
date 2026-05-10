import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const formatCurrency = (val: number, sym: string, cat: "crypto" | "forex" | "saham") => {
  const symbolUpper = sym.toUpperCase();
  
  // Saham Indonesia or IHSG or specified IDR pairs
  if (cat === "saham" || symbolUpper.endsWith(".JK") || symbolUpper === "^JKSE" || symbolUpper.includes("IDR")) {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(val);
  }

  // Detect currency from symbol for Forex
  let currency = "USD";
  let locale = "en-US";

  if (cat === "forex") {
    const symbolClean = symbolUpper.replace("=X", "");
    if (symbolClean.endsWith("JPY") || symbolClean.startsWith("JPY")) {
      currency = "JPY";
      locale = "ja-JP";
    } else if (symbolClean.endsWith("EUR") || symbolClean.startsWith("EUR")) {
      currency = "EUR";
      locale = "de-DE";
    } else if (symbolClean.endsWith("GBP") || symbolClean.startsWith("GBP")) {
      currency = "GBP";
      locale = "en-GB";
    } else if (symbolClean.endsWith("CHF") || symbolClean.startsWith("CHF")) {
      currency = "CHF";
      locale = "de-CH";
    } else if (symbolClean === "XAUUSD" || symbolClean === "GOLD") {
      currency = "USD"; 
      locale = "en-US";
    }
  }

  // Fraction digits handling: more precision for small numbers (crypto/forex)
  let minFraction = 2;
  let maxFraction = 2;
  
  if (cat === "forex" || cat === "crypto") {
    if (val < 0.001) {
      minFraction = 6;
      maxFraction = 6;
    } else if (val < 1) {
      minFraction = 4;
      maxFraction = 4;
    } else if (val < 10) {
      minFraction = 3;
      maxFraction = 3;
    }
  }
  
  if (currency === "JPY") {
    minFraction = 3;
    maxFraction = 3;
  }

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency,
    minimumFractionDigits: minFraction,
    maximumFractionDigits: maxFraction,
  }).format(val);
};
