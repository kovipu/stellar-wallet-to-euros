import { readFileSync, writeFileSync, existsSync } from 'fs';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

// TypeScript types for payment operations
interface PaymentOperation {
    TYPE: 'received' | 'sent';
    '': string; // Empty column
    ACCOUNT: string;
    AMOUNT: string; // e.g., "0.0000012 XLM", "2.29 USDC"
    DATE: string; // e.g., "June 29, 2025, 2:30 p.m."
}

interface TransactionWithEuroValue extends PaymentOperation {
    euroValue: number;
    originalAmount: number;
    currency: string;
}

interface CacheEntry {
    date: string;
    currency: string;
    price: number;
    timestamp: number;
}

interface CacheData {
    [key: string]: CacheEntry;
}

// Cache file path
const CACHE_FILE = 'coingecko_cache.json';

// Function to load cache from file
function loadCache(): CacheData {
    if (existsSync(CACHE_FILE)) {
        try {
            const cacheData = readFileSync(CACHE_FILE, 'utf-8');
            return JSON.parse(cacheData);
        } catch (error) {
            console.warn('Failed to load cache, starting fresh');
            return {};
        }
    }
    return {};
}

// Function to save cache to file
function saveCache(cache: CacheData): void {
    try {
        writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
    } catch (error) {
        console.warn('Failed to save cache:', (error as Error).message);
    }
}

// Function to get cache key
function getCacheKey(currency: string, date: string): string {
    return `${currency}_${date}`;
}

// Function to check if cache entry is still valid (24 hours)
function isCacheValid(entry: CacheEntry): boolean {
    const now = Date.now();
    const cacheAge = now - entry.timestamp;
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
    return cacheAge < maxAge;
}

// Function to extract currency from amount string
function extractCurrency(amount: string): string {
    const parts = amount.trim().split(' ');
    return parts[parts.length - 1]; // Last part is the currency
}

// Function to extract numeric amount from amount string
function extractAmount(amount: string): number {
    const parts = amount.trim().split(' ');
    return parseFloat(parts[0]);
}

// Function to fetch Euro value from CoinGecko with caching
async function getEuroValue(currency: string, amount: number, datetime: string, cache: CacheData): Promise<number> {
    const normalized = datetime.replace('p.m.', 'PM').replace('a.m.', 'AM');
    const date = new Date(normalized);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    if (currency === 'USDC') {
        const date = `${year}-${month}-${day}`;
        const response = await fetch(`https://api.frankfurter.app/${date}?amount=${amount}&from=USD&to=EUR`);
        const data = await response.json();
        return data.rates.EUR;
    }
    
    if (currency === 'XLM') {
        if (amount < 0.01) {
            return 0;
        }
        const dateStr = `${day}-${month}-${year}`;
        const cacheKey = getCacheKey(currency, dateStr);
        
        // Check cache first
        if (cache[cacheKey] && isCacheValid(cache[cacheKey])) {
            console.log(`  Using cached XLM rate for ${dateStr}`);
            return cache[cacheKey].price * amount;
        }
        
        // Fetch from API
        console.log(`  Fetching XLM rate for ${dateStr}`);
        const response = await fetch(`https://api.coingecko.com/api/v3/coins/stellar/history?date=${dateStr}`);
        const data = await response.json();
        const eurPrice = data.market_data.current_price.eur;
        
        // Cache the result
        cache[cacheKey] = {
            date: dateStr,
            currency,
            price: eurPrice,
            timestamp: Date.now()
        };
        
        return eurPrice * amount;
    }
    return 0;
}

// Get CSV file path from command line arguments
const csvFilePath = process.argv[2];

if (!csvFilePath) {
    console.error('Usage: tsx script.py.ts <csv-file-path>');
    process.exit(1);
}

async function main() {
    // Load cache
    const cache = loadCache();
    console.log(`Loaded cache with ${Object.keys(cache).length} entries`);

    try {
        
        // Read and parse the CSV file
        const fileContent = readFileSync(csvFilePath, 'utf-8');
        const records: PaymentOperation[] = parse(fileContent, {
            columns: true,
            skip_empty_lines: true
        });
        
        console.log(`Successfully read CSV file: ${csvFilePath}`);
        console.log(`Number of records: ${records.length}`);
        
        const transactionsWithEuroValues: TransactionWithEuroValue[] = [];
        
        // Process each transaction
        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            const currency = extractCurrency(record.AMOUNT);
            const amount = extractAmount(record.AMOUNT);
            
            console.log(`Processing transaction ${i + 1}/${records.length}`);
            const euroValue = await getEuroValue(currency, amount, record.DATE, cache);
            
            // Store the transaction with Euro value
            transactionsWithEuroValues.push({
                ...record,
                euroValue,
                originalAmount: amount,
                currency
            });
            
            // Add a small delay to avoid rate limiting
            if (i < records.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        // Generate output CSV using csv-stringify
        const csvData = transactionsWithEuroValues.reverse().map(t => ({
            TYPE: t.TYPE,
            ACCOUNT: t.ACCOUNT,
            AMOUNT: t.originalAmount,
            CURRENCY: t.currency,
            DATE: t.DATE,
            EURO_VALUE: t.euroValue.toFixed(2).replace('.', ',')
        }));
        
        const outputCSV = stringify(csvData, { header: true });
        const outputFileName = 'transactions_with_euro_values.csv';
        writeFileSync(outputFileName, outputCSV, 'utf-8');
        
        console.log(`\n✅ CSV file generated: ${outputFileName}`);
        console.log(`📊 Total transactions processed: ${transactionsWithEuroValues.length}`);
        
        // Calculate totals
        const totalEuroValue = transactionsWithEuroValues.reduce((sum, t) => sum + t.euroValue, 0);
        console.log(`💰 Total Euro value: €${totalEuroValue.toFixed(2)}`);
        
    } catch (error) {
        console.error('Error:', (error as Error).message);
    }

    // Save updated cache
    saveCache(cache);
    console.log(`Saved cache with ${Object.keys(cache).length} entries`);
}

main();
