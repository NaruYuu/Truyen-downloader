let scannedChapters = [];

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
            'table a'        // Selector bảng
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
    status.innerText = "Đang quét HTML...";
    
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Luôn dùng scanChaptersSmartly (Quét HTML)
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

    status.innerText = "🚀 Đang tải ngầm...";
    status.style.color = "green";
    btn.disabled = true;

    // Gửi lệnh xuống Background
    chrome.runtime.sendMessage({
        action: 'START_DOWNLOAD_QUEUE',
        chapters: selectedChapters,
        baseFolder: baseFolder,
        mangaTitle: mangaTitle,
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
        div.innerHTML = `<input type="checkbox" value="${index}" id="c${index}"><label for="c${index}"><span>${chap.title}</span></label>`;
        container.appendChild(div);
    });
}