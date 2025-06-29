import { readFileSync } from 'fs';
import { parse } from 'csv-parse/sync';

// Get CSV file path from command line arguments
const csvFilePath = process.argv[2];

if (!csvFilePath) {
    console.error('Usage: tsx script.py.ts <csv-file-path>');
    process.exit(1);
}

try {
    // Read and parse the CSV file
    const fileContent = readFileSync(csvFilePath, 'utf-8');
    const records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true
    });
    
    console.log('Hello, World!');
    console.log(`Successfully read CSV file: ${csvFilePath}`);
    console.log(`Number of records: ${records.length}`);
    console.log('First few records:', records.slice(0, 3));
    
} catch (error) {
    console.error('Error reading CSV file:', error.message);
    process.exit(1);
}
