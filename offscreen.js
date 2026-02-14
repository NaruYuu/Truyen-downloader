// Ghi log để biết file này đã chạy
console.log("Offscreen Worker đã khởi động!");

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Chỉ xử lý tin nhắn PARSE_HTML
    if (msg.action === 'PARSE_HTML') {
        try {
            const images = parseImagesFromHtml(msg.html, msg.config);
            sendResponse(images);
        } catch (e) {
            console.error("Lỗi phân tích:", e);
            sendResponse([]); // Trả về rỗng để không bị treo
        }
    }
    return true; // Giữ kết nối
});

function parseImagesFromHtml(htmlString, config) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');
    
    // 1. Tìm ảnh theo Selector
    let imgs = [...doc.querySelectorAll(config.common.images)];

    // 2. Fallback: Tìm div chứa nhiều ảnh nhất
    if (imgs.length === 0) {
        let allDivs = doc.querySelectorAll('div');
        let maxImgs = 0;
        let targetDiv = null;
        allDivs.forEach(div => {
            if (div.id.includes('comment') || div.className.includes('comment') || div.tagName === 'FOOTER') return;
            let count = div.querySelectorAll('img').length;
            if (count > maxImgs) { maxImgs = count; targetDiv = div; }
        });
        if (targetDiv) imgs = [...targetDiv.querySelectorAll('img')];
    }

    // 3. Lấy link
    let imageUrls = imgs.map(img => img.dataset.src || img.dataset.original || img.src);
    
    // 4. Lọc rác
    let uniqueUrls = [...new Set(imageUrls)];
    return filterJunkImages(uniqueUrls);
}

function filterJunkImages(imageUrls) {
    return imageUrls.filter(link => {
        if (!link) return false;
        let lowerLink = link.toLowerCase();
        
        if (lowerLink.includes('.gif')) return false;
        if (lowerLink.startsWith('data:')) return false;
        if (lowerLink.includes('logo') || lowerLink.includes('icon') || lowerLink.includes('avatar')) return false;
        if (lowerLink.includes('facebook') || lowerLink.includes('messenger')) return false;

        return true;
    });
}