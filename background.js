// --- QUẢN LÝ OFFSCREEN (CƠ CHẾ KHÓA AN TOÀN) ---
let creatingOffscreenPromise = null;

async function setupParser() {
    const parserUrl = 'offscreen.html';

    // 1. Kiểm tra xem đã có chưa
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
    });

    if (existingContexts.length > 0) return;

    // 2. Nếu đang tạo dở thì chờ
    if (creatingOffscreenPromise) {
        await creatingOffscreenPromise;
        return;
    }

    // 3. Tạo mới
    creatingOffscreenPromise = (async () => {
        try {
            if (typeof chrome.offscreen !== 'undefined') {
                await chrome.offscreen.createDocument({
                    url: parserUrl,
                    reasons: ['DOM_PARSER'],
                    justification: 'Phân tích HTML'
                });
            } else {
                await chrome.windows.create({
                    url: parserUrl, type: 'popup', focused: false,
                    width: 10, height: 10, left: -1000, top: -1000, state: 'minimized'
                });
            }
        } catch (e) {
            if (!e.message.includes('Only a single offscreen')) {
                console.error('Lỗi tạo Offscreen:', e);
            }
        } finally {
            creatingOffscreenPromise = null;
        }
    })();

    await creatingOffscreenPromise;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const LOCAL_APP_BASE = 'http://127.0.0.1:3000';
const STORAGE_KEY_DOWNLOAD_QUEUE = 'lastDownloadSelection';

async function saveDownloadCommand(chapters, baseFolder, mangaTitle, baseLink) {
    try {
        await chrome.storage.local.set({
            [STORAGE_KEY_DOWNLOAD_QUEUE]: {
                mangaTitle,
                baseFolder,
                baseLink,
                chapters,
                timestamp: Date.now()
            }
        });
    } catch (e) {
        console.warn('Lỗi lưu truyện tải xuống:', e);
    }
}

async function localFileExists(savePath) {
    try {
        const response = await fetch(`${LOCAL_APP_BASE}/api/sync/check_file`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ savePath })
        });
        if (!response.ok) return false;
        const data = await response.json();
        return data.exists === true;
    } catch (e) {
        console.warn(`⚠️ Lỗi kiểm tra file cục bộ: ${e.message}`);
        return false;
    }
}

async function retrySaveFile(imageUrl, savePath, referer, cookies, mangaTitle, chapterTitle, pageIndex, maxAttempts = 3) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await sendToLocalApp(imageUrl, savePath, referer, cookies, mangaTitle, chapterTitle, pageIndex);
            const exists = await localFileExists(savePath);
            if (exists) return true;
            throw new Error('File vẫn chưa tồn tại sau khi gửi');
        } catch (e) {
            console.warn(`⚠️ Thử lại lưu file (${attempt}/${maxAttempts}) ${savePath}: ${e.message}`);
            await sleep(2000);
        }
    }
    return false;
}

// --- LẤY COOKIE ---
async function getCookies(url) {
    try {
        const domain = new URL(url).hostname;
        const cookies = await chrome.cookies.getAll({ domain: domain });
        return cookies.map(c => `${c.name}=${c.value}`).join('; ');
    } catch (e) { return ""; }
}

// --- LOGIC CHÍNH ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'START_DOWNLOAD_QUEUE') {
        processQueue(msg.chapters, msg.baseFolder, msg.mangaTitle, msg.config, msg.baseLink); // Thêm baseLink vào đây
        sendResponse({status: "Started"});
    }
    return true; 
});

async function processQueue(chapters, baseFolder, mangaTitle, config, baseLink) {
    console.log(`[Background] Bắt đầu tải ${chapters.length} chương...`);
    await saveDownloadCommand(chapters, baseFolder, mangaTitle, baseLink);
    
    await setupParser();
    await sleep(1000);

    let currentCookies = "";
    if (chapters.length > 0) {
        currentCookies = await getCookies(chapters[0].url);
    }

    for (let i = 0; i < chapters.length; i++) {
        const chap = chapters[i];
        console.log(`Đang xử lý: ${chap.title}`);

        try {
            // Kiểm tra Offscreen sống hay chết
            const hasOs = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
            if (hasOs.length === 0) {
                await setupParser();
                await sleep(1000);
            }

            let imageUrls = [];
            
            // Handle cuutruyen chapters
            if (chap.url && chap.url.includes('cuutruyen.net')) {
                console.log('[Cuutruyen] Processing chapter:', chap.url);
                imageUrls = await loadFromCuutruyenChapter(chap.url);
            } else if (chap.url && chap.url.startsWith('api://')) {
                const [source, type, id] = chap.url.replace('api://', '').split('/');
                if (source === 'moetruyen' && type === 'chapter') {
                    imageUrls = await loadFromMoetruyenChapter(id);
                } else {
                    // fallback: nếu định dạng khác vẫn parse bằng DOM
                    const response = await fetch(chap.url.replace('api://', 'https://'));
                    const htmlText = await response.text();
                    imageUrls = await Promise.race([
                        chrome.runtime.sendMessage({
                            action: 'PARSE_HTML', 
                            html: htmlText, 
                            config: config
                        }),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
                    ]);
                }
            } else {
                const response = await fetch(chap.url);
                const htmlText = await response.text();
                // Gửi sang Offscreen (Timeout 10s cho chắc)
                imageUrls = await Promise.race([
                    chrome.runtime.sendMessage({
                        action: 'PARSE_HTML', 
                        html: htmlText, 
                        config: config
                    }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
                ]);
            }

            if (imageUrls && Array.isArray(imageUrls) && imageUrls.length > 0) {
                console.log(`-> Tìm thấy ${imageUrls.length} ảnh.`);
                const chapterFolder = `${baseFolder}\\${sanitize(mangaTitle)}\\${sanitize(chap.title)}`;
                let chapterOk = false;
                const maxChapterAttempts = 3;

                for (let attempt = 1; attempt <= maxChapterAttempts; attempt++) {
                    const missingPages = [];

                    for (let j = 0; j < imageUrls.length; j++) {
                        const url = imageUrls[j];
                        let ext = 'jpg';
                        try { ext = url.split('.').pop().split('?')[0] || 'jpg'; } catch(e){}
                        if (ext.length > 4) ext = 'jpg';

                        const fullPath = `${chapterFolder}\\${j + 1}.${ext}`;
                        if (await localFileExists(fullPath)) continue;
                        missingPages.push({ url, fullPath, pageIndex: j + 1 });
                    }

                    if (missingPages.length === 0) {
                        chapterOk = true;
                        console.log(`✅ Chương hoàn chỉnh: ${chap.title}`);
                        break;
                    }

                    console.warn(`⚠️ Chương còn ${missingPages.length} ảnh thiếu (lần ${attempt}/${maxChapterAttempts}), đang tải lại chương...`);
                    for (const page of missingPages) {
                        const saved = await retrySaveFile(page.url, page.fullPath, chap.url, currentCookies, mangaTitle, chap.title, page.pageIndex);
                        if (!saved) {
                            console.warn(`⚠️ Vẫn thiếu ảnh: ${page.fullPath}`);
                        }
                    }

                    if (attempt < maxChapterAttempts) {
                        await sleep(1500);
                    }
                }

                if (!chapterOk) {
                    console.error(`❌ Chương vẫn thiếu file sau ${maxChapterAttempts} lần thử: ${chap.title}`);
                }
            } else {
                console.warn(`-> Chương trống: ${chap.title}`);
            }
            
        } catch (e) {
            console.error(`Lỗi tải chương ${chap.title}:`, e);
            if (e.message.includes("Extension context invalidated")) {
                await setupParser();
            }
        }

        await sleep(1000);
    }
    
    // Đóng Offscreen
    const finalCheck = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (finalCheck.length > 0) {
        chrome.offscreen.closeDocument();
    }

    console.log("[Background] Hoàn tất!");

    // [FIX LỖI DÒNG 141] Kiểm tra quyền trước khi gọi thông báo
    if (chrome.notifications) {
        chrome.notifications.create({
            type: 'basic', 
            iconUrl: 'icon.png', // Đảm bảo bạn có file icon.png hoặc xóa dòng này
            title: 'Truyen Downloader', 
            message: `Đã tải xong!`
        });
    } else {
        console.log("⚠️ Không thể hiện thông báo (Thiếu quyền 'notifications' trong manifest)");
    }
}


async function loadFromMoetruyenChapter(chapterId) {
    try {
        const r = await fetch(`https://api.moetruyen.net/v1/chapters/${chapterId}/images`);
        if (!r.ok) throw new Error(`Lỗi API moe ${r.status}`);
        const j = await r.json();
        // cấu trúc dãy image phụ thuộc API thực tế; điều chỉnh nếu cần
        return (j.images || j.data || []).map(i => i.url || i);
    } catch (e) {
        console.warn('⚠️ Lỗi loadFromMoetruyenChapter:', e.message);
        return [];
    }
}

async function loadFromCuutruyenChapter(chapterUrl) {
    try {
        console.log('[Cuutruyen] Loading chapter:', chapterUrl);
        const response = await fetch(chapterUrl);
        if (!response.ok) throw new Error(`Lỗi fetch chapter ${response.status}`);
        const html = await response.text();
        
        // Extract page IDs from HTML
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const pageElements = doc.querySelectorAll('[data-id]');
        const pageIds = [];
        
        for (const elem of pageElements) {
            const id = elem.getAttribute('data-id');
            const index = elem.getAttribute('data-index');
            if (id && index !== null) {
                pageIds.push({
                    id,
                    index: parseInt(index) || 0
                });
            }
        }
        
        if (pageIds.length === 0) {
            console.warn('[Cuutruyen] No pages found');
            return [];
        }
        
        // Sort by index and extract URLs
        pageIds.sort((a, b) => a.index - b.index);
        const imageUrls = [];
        
        for (const page of pageIds) {
            // Try to get image URL from storage CDN
            const imageUrl = `https://storage-ct.lrclib.net/file/cuutruyen/images/${page.id}.jpg`;
            imageUrls.push(imageUrl);
        }
        
        console.log(`[Cuutruyen] Found ${imageUrls.length} images`);
        return imageUrls;
    } catch (e) {
        console.warn('⚠️ Lỗi loadFromCuutruyenChapter:', e.message);
        return [];
    }
}

async function sendToLocalApp(imageUrl, savePath, referer, cookies, mangaTitle, chapterTitle, pageIndex) {
    try {
        const res = await fetch('http://127.0.0.1:3000/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageUrl, savePath, referer, cookies, mangaTitle, chapterTitle, pageIndex })
        });
        if (!res.ok) throw new Error(`Server lỗi ${res.status}`);
        return true;
    } catch (e) {
        console.warn(`⚠️ Lỗi gửi Server: ${e.message}`);
        return false;
    }
}

function sanitize(name) {
    if (!name) return "Unknown";
    let clean = name
        .replace(/[\\/:*?"<>|]+/g, '-')   // invalid Windows chars
        .replace(/[\u0000-\u001F\u007F]+/g, '-')
        .replace(/\s+/g, ' ')               // normalize spaces
        .replace(/\.+$/g, '')               // remove trailing dots
        .trim();

    if (!clean) return "Unknown";
    if (clean.length > 128) clean = clean.slice(0, 128).trim();
    return clean;
}
