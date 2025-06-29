import { readFileSync } from 'fs';
import { parse } from 'csv-parse/sync';

// TypeScript types for payment operations
interface PaymentOperation {
    TYPE: 'received' | 'sent';
    '': string; // Empty column
    ACCOUNT: string;
    AMOUNT: string; // e.g., "0.0000012 XLM", "2.29 USDC"
    DATE: string; // e.g., "June 29, 2025, 2:30 p.m."
}

interface CoinGeckoResponse {
    [key: string]: {
        eur: number;
    };
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

// Function to fetch Euro value from CoinGecko
async function getEuroValue(currency: string, amount: number, datetime: string): Promise<number> {
    const normalized = datetime.replace('p.m.', 'PM').replace('a.m.', 'AM');
    const date = new Date(normalized);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0'); // getMonth() returns 0-11
    const day = String(date.getDate()).padStart(2, '0');

    if (currency === 'USDC') {
        const date = `${year}-${month}-${day}`;
        const response = await fetch(`https://api.frankfurter.app/${date}?amount=${amount}&from=USD&to=EUR`);
        const data = await response.json();
        return data.rates.EUR;
    }
    if (currency === 'XLM') {
        const date = `${day}-${month}-${year}`
        const response = await fetch(`https://api.coingecko.com/api/v3/coins/stellar/history?date=${date}`);
        const data = await response.json();
        const eurPrice = data.market_data.current_price.eur;
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
    try {
        // Read and parse the CSV file
        const fileContent = readFileSync(csvFilePath, 'utf-8');
        const records: PaymentOperation[] = parse(fileContent, {
            columns: true,
            skip_empty_lines: true
        });
        
        console.log(`Successfully read CSV file: ${csvFilePath}`);
        console.log(`Number of records: ${records.length}`);
        
        // Process each transaction
        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            const currency = extractCurrency(record.AMOUNT);
            const amount = extractAmount(record.AMOUNT);
            
            console.log(`\nProcessing transaction ${i + 1}/${records.length}:`);
            console.log(`  Type: ${record.TYPE}`);
            console.log(`  Amount: ${amount} – ${currency}`);
            console.log(`  Date: ${record.DATE}`);
            
            const euroValue = await getEuroValue(currency, amount, record.DATE);
            console.log(`  Euro Value: €${euroValue.toFixed(2)}`);
            
            // Add a small delay to avoid rate limiting
            if (i < records.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
    } catch (error) {
        console.error('Error reading CSV file:', (error as Error).message);
        process.exit(1);
    }
}

main();
