// ======== CUUTRUYEN.NET ADAPTER ========
// Support for cuutruyen.net with canvas-scrambled images

const CUUTRUYEN_CONFIG = {
    baseUrl: 'https://cuutruyen.net',
    apiBase: 'https://api-cuutruyen.imaobee.com', // Guessed API endpoint
    pattern: /cuutruyen\.net/i
};

/**
 * Extract chapter links from cuutruyen.net
 */
function extractCuutruyenChapterLinks(doc, baseUrl) {
    const linkSelectors = [
        '.chapter-list a.chapter-link',
        'a[href*="/chapters/"]',
        '.chapters-wrapper a[href*="/chapters/"]'
    ];

    const links = new Map();

    for (const selector of linkSelectors) {
        const elements = doc.querySelectorAll(selector);
        if (elements.length === 0) continue;

        for (let a of elements) {
            const href = a.getAttribute('href') || a.href;
            if (!href || href.includes('javascript')) continue;

            const abs = absoluteUrl(baseUrl, href);
            if (!abs || !abs.includes('/chapters/')) continue;

            const text = (a.textContent || a.innerText || '').trim();
            if (!text || text.length < 2) continue;

            links.set(abs, normalizeChapterTitle(text));
        }
    }

    return Array.from(links.entries()).map(([url, title]) => ({ url, title }));
}

/**
 * Extract page IDs from cuutruyen chapter HTML
 * Returns array like {id: "2159517", chapterUrl: "..."}
 */
function extractCuutruyenPageIds(doc) {
    const pageElements = doc.querySelectorAll('[data-id]');
    const pages = [];

    for (const elem of pageElements) {
        const id = elem.getAttribute('data-id');
        const index = elem.getAttribute('data-index');
        if (id && index !== null) {
            pages.push({
                id,
                index: parseInt(index) || 0
            });
        }
    }

    return pages.sort((a, b) => a.index - b.index);
}

/**
 * Get image URL for a cuutruyen page
 * Tries multiple methods to get unscrambled image
 */
async function getCuutruyenImageUrl(pageId, chapterUrl) {
    // Method 1: Try direct API call
    try {
        const match = chapterUrl.match(/mangas\/(\d+)\/chapters\/(\d+)/);
        if (match) {
            const [, mangaId, chapterId] = match;
            const apiUrl = `https://cuutruyen.net/api/chapters/${chapterId}/pages/${pageId}`;
            
            const resp = await fetch(apiUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            if (resp.ok) {
                const data = await resp.json();
                if (data.url) return data.url;
            }
        }
    } catch (e) {
        console.warn(`[Cuutruyen] API fetch failed: ${e.message}`);
    }

    // Method 2: Construct URL from storage CDN pattern
    // Based on meta tags in HTML: https://storage-ct.lrclib.net/file/cuutruyen/...
    try {
        const imageUrl = `https://storage-ct.lrclib.net/file/cuutruyen/images/${pageId}.jpg`;
        const resp = await fetch(imageUrl, { method: 'HEAD' });
        if (resp.ok) return imageUrl;
    } catch (e) {
        // Ignore
    }

    return null;
}

/**
 * Main download handler for cuutruyen
 */
async function downloadCuutruyenChapter(chapterUrl, serverUrl, config = {}) {
    console.log(`[Cuutruyen] Starting download: ${chapterUrl}`);

    try {
        // Fetch chapter HTML
        const chapterDoc = await fetchDocument(chapterUrl);

        // Extract manga/chapter titles from page
        const titleElem = chapterDoc.querySelector('h1, .chapter-title, .manga-title');
        const title = (titleElem?.textContent || '').trim() || 'Unknown';

        // Extract page IDs
        const pages = extractCuutruyenPageIds(chapterDoc);
        if (pages.length === 0) {
            throw new Error('No pages found in chapter');
        }

        console.log(`[Cuutruyen] Found ${pages.length} pages`);

        // Download each page
        for (const page of pages) {
            const imageUrl = await getCuutruyenImageUrl(page.id, chapterUrl);
            if (!imageUrl) {
                console.warn(`[Cuutruyen] Could not get URL for page ${page.id}`);
                continue;
            }

            const pageNum = String(page.index + 1).padStart(3, '0');
            const fileName = `${pageNum}.jpg`;
            const savePath = getChapterSavePath(title, fileName);

            // Send to server
            try {
                const result = await fetch(`${serverUrl}/download`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        imageUrl,
                        savePath,
                        referer: chapterUrl,
                        mangaTitle: title,
                        chapterTitle: title,
                        pageIndex: page.index
                    })
                });

                if (!result.ok) {
                    throw new Error(`Server error: ${result.status}`);
                }

                console.log(`[Cuutruyen] Downloaded page ${pageNum}/${pages.length}`);
            } catch (err) {
                console.error(`[Cuutruyen] Failed to download page ${pageNum}: ${err.message}`);
            }

            // Rate limit
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        console.log(`[Cuutruyen] Chapter download complete!`);
        return { success: true, pages: pages.length };

    } catch (error) {
        console.error(`[Cuutruyen] Download failed: ${error.message}`);
        throw error;
    }
}

/**
 * Check if URL is from cuutruyen.net
 */
function isCuutruyenUrl(url) {
    return CUUTRUYEN_CONFIG.pattern.test(url);
}
