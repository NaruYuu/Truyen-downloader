let scannedChapters = [];

function absoluteUrl(base, href) {
    try {
        return new URL(href, base).href;
    } catch (e) {
        return null;
    }
}

async function fetchDocument(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch ${url} failed ${res.status}`);
    const text = await res.text();
    return new DOMParser().parseFromString(text, 'text/html');
}

function normalizeChapterTitle(raw) {
    if (!raw) return 'Chapter';
    let t = raw.trim();

    // Loại bỏ metadata kiểu "Shirotako Translation • 153 lượt xem ..."
    if (t.includes('•') && t.match(/[0-9]+ lượt xem/)) {
        t = t.split('•')[0].trim();
    }

    // Nếu có quá nhiều dòng (HTML text), lấy dòng đầu hoặc dòng chứa chap
    const lines = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length > 1) {
        const byChap = lines.find(l => /chap(?:ter)?\s*\d+/i.test(l) || /ch(?:ương)?\s*\d+/i.test(l));
        if (byChap) t = byChap;
        else t = lines[0];
    }

    // Loại bỏ đoạn không cần thiết (liên quan số view/time)
    t = t.replace(/\s*\|\s*$/, '');
    t = t.replace(/\s*\d+\s+lượt xem.*$/i, '').trim();

    return t || 'Chapter';
}

function extractMoetruyenChapterLinks(doc, baseUrl) {
    const linkSelector = '#chapters .chapter-list a.chapter-link, .chapter-list li.chapter a, .chapter-list a';
    const links = Array.from(doc.querySelectorAll(linkSelector));
    const unique = new Map();

    for (let a of links) {
        if (!a.href || a.href.includes('javascript') || a.href.includes('#')) continue;
        const abs = absoluteUrl(baseUrl, a.getAttribute('href'));
        if (!abs) continue;

        const chapterNum = a.querySelector('.chapter-num')?.innerText?.trim();
        const chapterTitle = a.querySelector('.chapter-title')?.innerText?.trim();

        let title = '';
        if (chapterNum && chapterTitle) title = `${chapterNum} ${chapterTitle}`;
        else if (chapterTitle) title = chapterTitle;
        else if (chapterNum) title = chapterNum;
        else title = normalizeChapterTitle(a.innerText || a.getAttribute('title') || abs);

        title = normalizeChapterTitle(title);

        if (!unique.has(abs)) unique.set(abs, { title, url: abs });
    }
    return Array.from(unique.values());
}

function getMoetruyenPageCount(doc) {
    const pageLinks = Array.from(doc.querySelectorAll('nav.chapter-list-pagination a[href*="chapterPage="]'));
    let max = 1;
    for (let a of pageLinks) {
        const m = a.href.match(/chapterPage=(\d+)/);
        if (m) {
            const n = parseInt(m[1], 10);
            if (n > max) max = n;
        }
    }
    return max;
}

function findMoetruyenCover(doc) {
    return doc.querySelector('meta[property="og:image"]')?.content
        || doc.querySelector('meta[name="twitter:image"]')?.content
        || doc.querySelector('.manga-detail-cover img')?.src
        || doc.querySelector('.manga-cover img')?.src
        || null;
}

async function getMoetruyenMangaInfoByHtml(url) {
    try {
        let mangaUrl = url.replace(/\/?chapters\/[^\/?#]+.*$/, '');
        if (!mangaUrl.includes('/manga/')) mangaUrl = url;

        const firstDoc = await fetchDocument(mangaUrl);
        const chapters = new Map();

        function addChaptersFrom(doc) {
            for (let ch of extractMoetruyenChapterLinks(doc, mangaUrl)) {
                if (!chapters.has(ch.url)) chapters.set(ch.url, ch);
            }
        }

        addChaptersFrom(firstDoc);
        const pageCount = getMoetruyenPageCount(firstDoc);

        for (let p = 2; p <= pageCount; p++) {
            let pageUrl = `${mangaUrl}?chapterPage=${p}#chapters`;
            try {
                const doc = await fetchDocument(pageUrl);
                addChaptersFrom(doc);
            } catch (e) {
                console.warn('Moetruyen pagination fetch failed', e.message);
                break;
            }
        }

        const allChapters = Array.from(chapters.values());
        if (allChapters.length === 0) return null;

        // Sort by chapter number if possible, otherwise keep as collected
        const parseNum = (s) => {
            const m = s.match(/chapters\/(\d+(?:\.\d+)?)/i) || s.match(/ch(?:ap)?\.?(\d+(?:\.\d+)?)/i);
            return m ? parseFloat(m[1]) : Number.POSITIVE_INFINITY;
        };
        allChapters.sort((a, b) => parseNum(a.url) - parseNum(b.url));

        const title = firstDoc.querySelector('h1')?.innerText.trim() || firstDoc.querySelector('meta[property="og:title"]')?.content || 'Manga';
        const cover = findMoetruyenCover(firstDoc);

        return { title, cover, chapters: allChapters };
    } catch (e) {
        console.warn('Moetruyen HTML fallback failed', e.message);
        return null;
    }
}

// API site config cho tải từ nguồn supports API (Moetruyen, TruyenQQ, v.v.)
const SITE_API_CONFIG = {
    'moetruyen.net': {
        getSeriesId: (url) => {
            // https://moetruyen.net/manga/219-.../chapters/198
            let m = url.match(/\/(manga|truyen)\/(\d+)/i);
            if (m) return m[2];
            let bySlug = url.match(/moetruyen\.net\/truyen\/([^\/\?#]+)/i)?.[1];
            return bySlug || null;
        },
        getMangaInfo: async (url) => {
            const seriesId = SITE_API_CONFIG['moetruyen.net'].getSeriesId(url);

            if (seriesId) {
                try {
                    // Lấy thông tin + chapters đầy đủ (range 999)
                    const [infoRes, chapRes] = await Promise.all([
                        fetch(`https://api.moetruyen.net/v1/mangas/${seriesId}`).then(r => r.ok ? r.json() : null),
                        fetch(`https://api.moetruyen.net/v1/chapters?manga=${seriesId}&limit=999`).then(r => r.ok ? r.json() : null)
                    ]);

                    const title = infoRes?.title || infoRes?.data?.title;
                    if (!title) throw new Error('No info');

                    const chaptersData =
                        (chapRes && Array.isArray(chapRes.data) && chapRes.data.length) ? chapRes.data
                        : (Array.isArray(infoRes.chapters) && infoRes.chapters.length) ? infoRes.chapters
                        : (Array.isArray(infoRes.data?.chapters) && infoRes.data.chapters.length) ? infoRes.data.chapters
                        : [];

                    if (!chaptersData || chaptersData.length === 0) throw new Error('No chap data');

                    const chapterItems = chaptersData.map(c => {
                        const chapId = c.id || c.chapter_id || c.number || c.slug;
                        const chapName = c.name || c.title || `Ch. ${c.chapter || c.number || ''}`;
                        if (!chapId) return null;
                        return {
                            title: chapName,
                            url: `api://moetruyen/chapter/${chapId}`
                        };
                    }).filter(Boolean);

                    if (chapterItems.length > 0) {
                        return {
                            title,
                            cover: infoRes.thumbnail || infoRes.cover || infoRes.data?.thumbnail || infoRes.data?.cover || null,
                            chapters: chapterItems
                        };
                    }

                } catch (e) {
                    console.warn('Moetruyen API lỗi, fallback HTML:', e.message);
                    // continue to HTML fallback
                }
            }

            // Fallback: parse HTML pagination for full chapter list
            const htmlResult = await getMoetruyenMangaInfoByHtml(url);
            if (htmlResult) return htmlResult;
            return null;
        },
        getChapterImages: async (chapterId) => {
            try {
                const r = await fetch(`https://api.moetruyen.net/v1/chapters/${chapterId}/images`);
                if (!r.ok) throw new Error(`No data from API ${r.status}`);
                const json = await r.json();
                return (json?.images || json?.data || []).map(img => (img.url || img)).filter(Boolean);
            } catch (e) {
                console.warn('Moetruyen chapter images API lỗi:', e.message);
                return [];
            }
        }
    }
};

// Cấu hình Selector (FoxTruyen, TruyenQQ...)
const SITE_CONFIG = {
    'common': {
        chapterListSelectors: [
            '.list-chapter li a', 
            '.works-chapter-list a', 
            '#list-chapter .chapter a',
            '.chapter-list a',
            '.col-xs-9 a',
            'div.chapter a', // Selector chung chung
            'table a',       // Selector bảng
            '.reader-dropdown-list a',
            '.episode-list a',
            '.manga-chapter-list a'
        ].join(', '),
        images: [
            '.chapter-image img', '#chapter_content img', '.chapter-content img', 
            '.read-content img', '.story-see-content img', '.page-chapter img',
            '.list-image-detail img', '#reader-area img', 'img[class*="chapter-img"]'   
        ].join(', '),
        detailLink: [
            '.breadcrumb li:nth-child(2) a', '.breadcrumb li:nth-child(3) a',
            'a.back-btn'
        ].join(', ')
    }
};

// Nút Quét
document.getElementById('btnScan').addEventListener('click', async () => {
    const status = document.getElementById('status');
    status.innerText = "Đang quét...";

    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const pageUrl = tab.url;

    // ưu tiên API nếu domain support
    let apiResult = null;
    for (const host in SITE_API_CONFIG) {
        if (pageUrl.includes(host)) {
            apiResult = await SITE_API_CONFIG[host].getMangaInfo(pageUrl);
            break;
        }
    }

    if (apiResult && apiResult.chapters?.length) {
        scannedChapters = apiResult.chapters;
        renderChapterList(scannedChapters);
        status.innerText = `✅ Tải API thành công: ${scannedChapters.length} chương.`;
        if (apiResult.cover) document.getElementById('cover').src = apiResult.cover;
        document.getElementById('btnDownload').disabled = false;
        return;
    }

    status.innerText = "Đang quét HTML...";

    chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: scanChaptersSmartly, 
        args: [SITE_CONFIG]
    }, (results) => {
        if (!results || !results[0] || !results[0].result || results[0].result.length === 0) {
            status.innerText = "⚠️ Không tìm thấy chương!";
            alert("Lỗi: Không tìm thấy danh sách chương trong HTML.");
            return;
        }
        scannedChapters = results[0].result;
        renderChapterList(scannedChapters);
        status.innerText = `✅ Tìm thấy ${scannedChapters.length} chương.`;
        document.getElementById('btnDownload').disabled = false;
    });
});

// Nút Tải
document.getElementById('btnDownload').addEventListener('click', async () => {
    const btn = document.getElementById('btnDownload');
    const status = document.getElementById('status');

    let baseFolder = document.getElementById('customFolder').value.trim() || 'D:\\TruyenQQ_Download';
    const checkboxes = document.querySelectorAll('#chapterList input[type="checkbox"]:checked');
    const selectedChapters = Array.from(checkboxes).map(cb => scannedChapters[parseInt(cb.value)]);

    if (selectedChapters.length === 0) {
        status.innerText = "⚠️ Chọn ít nhất 1 chương!"; return;
    }

    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Lấy tên truyện từ H1
    const res = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
            let h1 = document.querySelector('h1');
            return h1 ? h1.innerText.trim() : document.title.split('-')[0].trim();
        }
    });
    const mangaTitle = res[0].result;

    // Lấy URL cơ bản
    const baseLinkRes = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
            return window.location.href;
        }
    });
    const baseLink = baseLinkRes[0].result;

    status.innerText = "🚀 Đang tải ngầm...";
    status.style.color = "green";
    btn.disabled = true;

    // Gửi lệnh xuống Background
    chrome.runtime.sendMessage({
        action: 'START_DOWNLOAD_QUEUE',
        chapters: selectedChapters,
        baseFolder: baseFolder,
        mangaTitle: mangaTitle,
        baseLink: baseLink, // Thêm URL cơ bản vào đây
        config: SITE_CONFIG
    });

    alert(`Đã bắt đầu tải ${selectedChapters.length} chương!`);
});

document.getElementById('btnToggle').addEventListener('click', () => {
    const checkboxes = document.querySelectorAll('#chapterList input[type="checkbox"]');
    const isAllChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => cb.checked = !isAllChecked);
});

// Hàm quét thông minh (HTML)
async function scanChaptersSmartly(config) {
    function extractChapters(doc) {
        let results = [];
        const seenUrls = new Set();
        const uniqueChapters = [];

        // 1. Tìm theo Selector cấu hình
        let specificLinks = doc.querySelectorAll(config.common.chapterListSelectors);
        specificLinks.forEach(a => {
            if (!a.href || a.href.includes('#') || a.href.includes('javascript')) return;
            let url = a.href;
            if (!seenUrls.has(url)) {
                seenUrls.add(url);
                let title = a.innerText.trim() || a.getAttribute('title') || 'Chapter ' + (uniqueChapters.length + 1);
                uniqueChapters.push({ title: title, url: url });
            }
        });
        
        if (uniqueChapters.length > 0) return uniqueChapters;

        // 2. Tìm Vét cạn (Nếu selector thất bại)
        let allLinks = Array.from(doc.querySelectorAll('a'));
        allLinks.forEach(a => {
            let t = a.innerText.trim().toLowerCase();
            let href = a.href;
            // Điều kiện: Có chữ chap/chương + Có số
            if ((t.includes('chap') || t.includes('chương')) && /\d/.test(t) && !seenUrls.has(href)) {
                seenUrls.add(href);
                uniqueChapters.push({ title: a.innerText.trim(), url: href });
            }
        });
        return uniqueChapters;
    }

    let chaps = extractChapters(document);
    
    // Sắp xếp lại
    if (chaps.length > 1) {
        let getNum = (str) => { let match = str.match(/(\d+)(\.\d+)?/); return match ? parseFloat(match[0]) : 0; };
        let firstNum = getNum(chaps[0].title);
        let lastNum = getNum(chaps[chaps.length-1].title);
        if (firstNum > lastNum) chaps.reverse(); 
    }
    return chaps;
}

function renderChapterList(chapters) {
    const container = document.getElementById('chapterList');
    container.innerHTML = '';
    chapters.forEach((chap, index) => {
        const div = document.createElement('div');
        div.className = 'chap-item';
        let label = chap.title || `Chapter ${index + 1}`;
        if (chap.url && chap.url.startsWith('api://')) label += ' (API)';
        div.innerHTML = `<input type="checkbox" value="${index}" id="c${index}"><label for="c${index}"><span>${label}</span></label>`;
        container.appendChild(div);
    });
}