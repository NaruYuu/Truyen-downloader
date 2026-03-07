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

            const response = await fetch(chap.url);
            const htmlText = await response.text();

            // Gửi sang Offscreen (Timeout 10s cho chắc)
            const imageUrls = await Promise.race([
                chrome.runtime.sendMessage({
                    action: 'PARSE_HTML', 
                    html: htmlText, 
                    config: config
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
            ]);

            if (imageUrls && Array.isArray(imageUrls) && imageUrls.length > 0) {
                console.log(`-> Tìm thấy ${imageUrls.length} ảnh.`);
                for (let j = 0; j < imageUrls.length; j++) {
                    const url = imageUrls[j];
                    let ext = 'jpg';
                    try { ext = url.split('.').pop().split('?')[0] || 'jpg'; } catch(e){}
                    if (ext.length > 4) ext = 'jpg';

                    const fullPath = `${baseFolder}\\${sanitize(mangaTitle)}\\${sanitize(chap.title)}\\${j + 1}.${ext}`;
                    await sendToLocalApp(url, fullPath, chap.url, currentCookies);

                    // So sánh với server
                    if (await checkIfFileExists(baseLink, chap, j + 1)) {
                        console.log(`-> File đã tồn tại: ${fullPath}`);
                        continue;
                    }
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

async function checkIfFileExists(baseLink, chap, chapterNumber) {
    // Gọi API server để kiểm tra
    try {
        const response = await fetch(`${baseLink}/api/sync/check_file`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath: `${sanitize(chap.title)}/${chapterNumber}.jpg` })
        });
        if (!response.ok) throw new Error(`Server lỗi ${response.status}`);
        return response.json().exists;
    } catch (e) {
        console.warn(`⚠️ Lỗi kiểm tra file: ${e.message}`);
        return false;
    }
}

async function sendToLocalApp(imageUrl, savePath, referer, cookies) {
    try {
        const res = await fetch('http://127.0.0.1:3000/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageUrl, savePath, referer, cookies })
        });
        if (!res.ok) throw new Error(`Server lỗi ${res.status}`);
    } catch (e) {
        console.warn(`⚠️ Lỗi gửi Server: ${e.message}`);
    }
}

function sanitize(name) {
    if (!name) return "Unknown";
    return name.replace(/[\\/:*?"<>|]/g, '-').trim();
}
