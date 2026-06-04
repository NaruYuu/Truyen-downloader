#!/usr/bin/env node
/**
 * Test script to verify cuutruyen.net support is working
 * Usage: node test-cuutruyen.js <chapter_url>
 */

const https = require('https');
const http = require('http');

// Test with a real cuutruyen chapter
const testUrl = 'https://cuutruyen.net/mangas/481/chapters/87569';

async function fetchPage(url) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        protocol.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

async function extractPageIds(html) {
    // Find all elements with data-id attribute
    const regex = /data-id="(\d+)"\s+data-index="(\d+)"/g;
    const matches = [];
    let match;
    
    while ((match = regex.exec(html)) !== null) {
        matches.push({
            id: match[1],
            index: parseInt(match[2])
        });
    }
    
    return matches.sort((a, b) => a.index - b.index);
}

async function testCuutruyenExtraction() {
    console.log('🔍 Testing cuutruyen.net chapter extraction...\n');
    console.log(`📡 Fetching: ${testUrl}\n`);
    
    try {
        const html = await fetchPage(testUrl);
        console.log(`✅ Fetched ${(html.length / 1024).toFixed(2)}KB of HTML\n`);
        
        const pageIds = await extractPageIds(html);
        console.log(`📖 Found ${pageIds.length} pages\n`);
        
        if (pageIds.length === 0) {
            console.warn('⚠️ No page IDs found! The HTML structure might have changed.');
            return;
        }
        
        pageIds.forEach((page, i) => {
            const imageUrl = `https://storage-ct.lrclib.net/file/cuutruyen/images/${page.id}.jpg`;
            console.log(`  Page ${i + 1}: ID=${page.id} → ${imageUrl}`);
        });
        
        console.log('\n✅ Test completed successfully!');
        console.log('💡 Tip: Use these URLs with the server /download endpoint');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

testCuutruyenExtraction();
