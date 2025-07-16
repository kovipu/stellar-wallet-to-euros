import { readFileSync, writeFileSync, existsSync } from "fs";
import { stringify } from "csv-stringify/sync";
import { Horizon } from "@stellar/stellar-sdk";

const horizonServer = new Horizon.Server("https://horizon.stellar.org");

// TypeScript types for payment operations
interface WalletTransaction {
  transactionType:
    | "create_account"
    | "payment_received"
    | "payment_sent"
    | "path_payment_received"
    | "path_payment_sent"
    | "blend_deposit"
    | "blend_withdraw"
    | "swap"
    | "swap_fee";
  fromAddress: string;
  toAddress: string;
  amount: string;
  currency: string;
  timestamp: string;
  // For swaps
  sentAmount?: string;
  sentCurrency?: string;
  receivedAmount?: string;
  receivedCurrency?: string;
}

interface TransactionWithEuroValue extends WalletTransaction {
  euroValue: string;
}

interface CacheEntry {
  price: number;
  timestamp: number;
}

interface CacheData {
  [key: string]: CacheEntry;
}

// Cache file path
const CACHE_FILE = "price_cache.json";

// Function to load cache from file
function loadCache(): CacheData {
  if (existsSync(CACHE_FILE)) {
    try {
      const cacheData = readFileSync(CACHE_FILE, "utf-8");
      return JSON.parse(cacheData);
    } catch (error) {
      console.warn("Could not read price cache, starting fresh.");
      return {};
    }
  }
  return {};
}

// Function to save cache to file
function saveCache(cache: CacheData): void {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
  } catch (error) {
    console.warn("Failed to save price cache:", (error as Error).message);
  }
}

// Function to get cache key
function getCacheKey(currency: string, date: string): string {
  return `${currency}_${date}`;
}

// Function to check if cache entry is still valid (24 hours)
function isCacheValid(entry: CacheEntry): boolean {
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  return Date.now() - entry.timestamp < maxAge;
}

// Function to fetch Euro value from CoinGecko with caching
async function getEuroValue(
  currency: string,
  amount: number,
  datetime: string,
  cache: CacheData,
): Promise<string> {
  const date = new Date(datetime);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  let price = 0;

  if (currency === "USDC") {
    const dateStr = `${year}-${month}-${day}`;
    const cacheKey = getCacheKey(currency, dateStr);

    if (cache[cacheKey] && isCacheValid(cache[cacheKey])) {
      price = cache[cacheKey].price;
    } else {
      const response = await fetch(
        `https://api.frankfurter.app/${dateStr}?from=USD&to=EUR`,
      );
      const data = await response.json();
      price = data.rates.EUR;
      cache[cacheKey] = { price, timestamp: Date.now() };
    }
  } else if (currency === "XLM") {
    if (amount < 0.01) return "0";
    const dateStr = `${day}-${month}-${year}`;
    const cacheKey = getCacheKey(currency, dateStr);

    if (cache[cacheKey] && isCacheValid(cache[cacheKey])) {
      price = cache[cacheKey].price;
    } else {
      const response = await fetch(
        `https://api.coingecko.com/api/v3/coins/stellar/history?date=${dateStr}`,
      );
      const data = await response.json();
      if (!data?.market_data?.current_price?.eur)
        throw Error("CoinGecko query failed. Probably rate limited.");
      price = data.market_data.current_price.eur;
      cache[cacheKey] = { price, timestamp: Date.now() };
    }
  } else if (currency === "EURC") {
    return amount.toFixed(2).replace(".", ",");
  }

  const value = price * amount;
  return value.toFixed(2).replace(".", ",");
}

export async function processTransactions(
  operations: Horizon.ServerApi.OperationRecord[],
  accountId: string,
  cache: CacheData,
): Promise<TransactionWithEuroValue[]> {
  const records: WalletTransaction[] = operations.flatMap((p) => {
    if (p.type === "payment") {
      const isSent = p.from === accountId;

      // Remove dusting attacks.
      if (!isSent && parseFloat(p.amount) < 0.0001) return [];

      return [
        {
          transactionType: isSent ? "payment_sent" : "payment_received",
          fromAddress: p.from,
          toAddress: p.to,
          amount: p.amount,
          currency: p.asset_type === "native" ? "XLM" : p.asset_code!,
          timestamp: p.created_at,
        },
      ];
    } else if (p.type === "create_account") {
      return [
        {
          transactionType: "create_account",
          fromAddress: p.funder,
          toAddress: accountId,
          amount: p.starting_balance,
          currency: "XLM",
          timestamp: p.created_at,
        },
      ];
    } else if (
      p.type === "path_payment_strict_send" ||
      p.type === "path_payment_strict_receive"
    ) {
      // Detect swap: from asset != to asset
      const isSent = p.from === accountId;
      const sentAmount = isSent ? p.source_amount : p.amount;
      const sentCurrency = isSent
        ? p.source_asset_type === "native"
          ? "XLM"
          : p.source_asset_code!
        : p.asset_type === "native"
          ? "XLM"
          : p.asset_code!;
      const receivedAmount = isSent ? p.amount : p.source_amount;
      const receivedCurrency = isSent
        ? p.asset_type === "native"
          ? "XLM"
          : p.asset_code!
        : p.source_asset_type === "native"
          ? "XLM"
          : p.source_asset_code!;
      if (sentCurrency !== receivedCurrency) {
        // It's a swap
        return [
          {
            transactionType: p.from === p.to ? "swap" : "swap_fee",
            fromAddress: p.from,
            toAddress: p.to,
            amount: sentAmount, // for compatibility
            currency: sentCurrency,
            timestamp: p.created_at,
            sentAmount,
            sentCurrency,
            receivedAmount,
            receivedCurrency,
          },
        ];
      } else {
        // Fallback to old logic
        return [
          {
            transactionType: isSent
              ? "path_payment_sent"
              : "path_payment_received",
            fromAddress: p.from,
            toAddress: p.to,
            amount: sentAmount,
            currency: sentCurrency,
            timestamp: p.created_at,
          },
        ];
      }
    } else if (p.type === "invoke_host_function") {
      // Handle Blend deposit/withdrawal
      return p.asset_balance_changes
        .filter((change) => change.type === "transfer")
        .flatMap((change): WalletTransaction[] => {
          const isDeposit = change.from === accountId;
          const isWithdraw = change.to === accountId;
          if (!isDeposit && !isWithdraw) return [];
          return [
            {
              transactionType: isDeposit ? "blend_deposit" : "blend_withdraw",
              fromAddress: change.from,
              toAddress: change.to,
              amount: change.amount,
              currency:
                change.asset_type === "native"
                  ? "XLM"
                  : change.asset_code || "",
              timestamp: p.created_at || "",
            },
          ];
        });
    }
    throw Error(`unknown transaction type: ${p.type}`);
  });

  console.log(`Processing ${records.length} payment transactions.`);
  const transactionsWithEuroValues: TransactionWithEuroValue[] = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const currency = record.currency;
    const amount = parseFloat(record.amount);

    const euroValue = await getEuroValue(
      currency,
      amount,
      record.timestamp,
      cache,
    );

    console.log(`Processing transaction ${i + 1}/${records.length}`);
    console.log(
      `${record.transactionType}: ${amount} ${currency} ~= ${euroValue} €`,
    );

    transactionsWithEuroValues.push({
      ...record,
      euroValue,
    });
    await new Promise((resolve) => setTimeout(resolve, 100)); // Rate limit APIs
  }
  return transactionsWithEuroValues;
}

async function main() {
  const accountId = process.argv[2];

  if (!accountId) {
    console.error("Usage: tsx script.py.ts <stellar-account-id>");
    process.exit(1);
  }

  const cache = loadCache();
  console.log(`Loaded price cache with ${Object.keys(cache).length} entries.`);

  try {
    console.log(`Fetching transactions for account: ${accountId}`);
    const { records: operations } = await horizonServer
      .payments()
      .forAccount(accountId)
      .limit(200)
      .order("asc")
      .call();

    const transactionsWithEuroValues = await processTransactions(
      operations,
      accountId,
      cache,
    );

    const columns = [
      "Type",
      "From",
      "To",
      "Amount",
      "Currency",
      "Euro Value",
      "Timestamp",
      "Original Amount",
      "Original Currency",
    ];

    const outputCSV = stringify(
      transactionsWithEuroValues.map((t) => {
        if (t.transactionType === "swap") {
          return {
            Type: "swap",
            From: t.fromAddress,
            To: t.toAddress,
            Amount: t.receivedAmount,
            Currency: t.receivedCurrency,
            Timestamp: t.timestamp,
            "Euro Value": t.euroValue,
            "Original Amount": t.sentAmount,
            "Original Currency": t.sentCurrency,
          };
        } else {
          return {
            Type: t.transactionType,
            From: t.fromAddress,
            To: t.toAddress,
            Amount: t.amount,
            Currency: t.currency,
            Timestamp: t.timestamp,
            "Euro Value": t.euroValue,
          };
        }
      }),
      { columns, header: true },
    );
    const outputFileName = "transactions_with_euro_values.csv";
    writeFileSync(outputFileName, outputCSV, "utf-8");

    console.log(`\n✅ CSV file generated: ${outputFileName}`);
  } catch (error) {
    console.error("Error:", (error as Error).message);
  } finally {
    saveCache(cache);
    console.log(`Saved price cache with ${Object.keys(cache).length} entries.`);
  }
}

if (require.main === module) {
  main();
}
