# Cuutruyen.net Setup Verification Checklist

## Pre-Setup Requirements
- [ ] Node.js v14+ installed
- [ ] npm packages installed: `npm install` (should have express, axios, fs-extra, cors)
- [ ] Local server running: `node server.js` on http://127.0.0.1:3000
- [ ] Chrome extension loaded in chrome://extensions/
- [ ] Manifest v3 support enabled

## Extension Files - Verify Presence

### New Files (Should exist)
- [ ] `truyenqq-downloader/cuutruyen-adapter.js` (460 lines)
- [ ] `truyenqq-downloader/test-cuutruyen.js` (50 lines)
- [ ] `truyenqq-downloader/CUUTRUYEN_SUPPORT.md` (documentation)
- [ ] `truyenqq-downloader/IMPLEMENTATION_SUMMARY.md` (this implementation)

### Modified Files (Verify Changes)
- [ ] `truyenqq-downloader/popup.html` - includes `<script src="cuutruyen-adapter.js"></script>`
- [ ] `truyenqq-downloader/popup.js` - includes `SITE_API_CONFIG['cuutruyen.net']` config
- [ ] `truyenqq-downloader/background.js` - includes `loadFromCuutruyenChapter()` function and cuutruyen check

## Server Files - Verify Status

### Must Have
- [ ] `truyenqq-server/server.js` (includes deduplication from Phase 1)
  - [ ] `groupFilesByBase()` function
  - [ ] `dedupeFolder()` function
  - [ ] `resolveDuplicateQuality()` function
  - [ ] POST `/download` endpoint

### Optional Test Files
- [ ] `truyenqq-downloader/test-cuutruyen.js` - for validation

## Step-by-Step Verification

### Step 1: Start Server
```bash
cd truyenqq-server
npm install  # if not done yet
node server.js
```

**Expected Output:**
```
🚀 Server đang chạy tại http://127.0.0.1:3000
```

**Verify:**
```bash
curl http://127.0.0.1:3000
# Should return: ✅ Server đang chạy ngon lành! Hãy gửi POST request vào /download
```

### Step 2: Load Extension
1. Go to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select `truyenqq-downloader` folder
5. Extension should appear with icon

**Verify:**
- [ ] Extension icon appears in Chrome toolbar
- [ ] No errors in chrome://extensions/ page
- [ ] Manifest shows version 4.0

### Step 3: Test Cuutruyen Detection
1. Navigate to: `https://cuutruyen.net/mangas/481`
2. Click extension popup
3. Check if "QUÉT CHƯƠNG" button is visible

**Expected Result:**
- Popup should show chapter scanning interface
- No errors in browser console

### Step 4: Run Detection Test
```bash
node truyenqq-downloader/test-cuutruyen.js
```

**Expected Output:**
```
🔍 Testing cuutruyen.net chapter extraction...
📡 Fetching: https://cuutruyen.net/mangas/481/chapters/87569
✅ Fetched XXX.XXkB of HTML
📖 Found 28 pages
  Page 1: ID=2159517 → https://storage-ct.lrclib.net/file/cuutruyen/images/2159517.jpg
  ...
✅ Test completed successfully!
```

### Step 5: Test Chapter Extraction
1. On cuutruyen.net manga page
2. Click "QUÉT CHƯƠNG"
3. Wait for results

**Expected Result:**
- [ ] Chapter list appears
- [ ] Manga cover displays
- [ ] Status shows: "✅ Tải API thành công: X chương"

### Step 6: Test Download
1. Select 1-2 chapters
2. Set download folder (or use default)
3. Click "TẢI CÁC CHƯƠNG ĐÃ CHỌN"

**Expected Result:**
- Status shows: "🚀 Đang tải ngầm..."
- Files appear in download folder: `{folder}/{MangaTitle}/{ChapterTitle}/001.jpg`, etc.
- Server console shows: `⬇️ [DOWNLOAD]` messages

## Server Log Verification

When download is successful, server should show:

```
[HH:MM:SS] ⬇️ [DOWNLOAD] Kanojo, Okarishimasu/Chương 424 - Lối vào - 001.jpg
[HH:MM:SS] ⬇️ [DOWNLOAD] Kanojo, Okarishimasu/Chương 424 - Lối vào - 002.jpg
...
[HH:MM:SS] ✅ Giữ bản tốt nhất cho 'XXX': filename.jpg (87654 bytes)
[HH:MM:SS] 🗑️ Xóa file trùng trong folder: other_filename.jpg (76543 bytes)
```

## Troubleshooting Guide

### Problem: "Not found" when opening popup
**Solution:**
- Verify all required files are present
- Check manifest.json has correct script references
- Reload extension in chrome://extensions/

### Problem: "Không tìm thấy chương"
**Solution:**
- Verify you're on correct cuutruyen.net page
- Check URL format: `https://cuutruyen.net/mangas/{id}`
- Run test script to verify extraction works
- Check browser console for errors

### Problem: Server returns 500 error
**Solution:**
- Verify server is running: `node server.js`
- Check download folder path is valid
- Verify folder has write permissions
- Check server console for detailed error message

### Problem: Images appear scrambled/corrupted
**Solution:**
- This is expected! Cuutruyen renders via canvas
- Verify image URL in browser: `https://storage-ct.lrclib.net/file/cuutruyen/images/{pageId}.jpg`
- If URL returns 404, CDN structure may have changed
- Run test script to diagnose

### Problem: "Timeout" or "Extension context invalidated"
**Solution:**
- Increase timeout in background.js (currently 10s)
- Check internet connection
- Retry download
- Check if cuutruyen.net is accessible

## Performance Monitoring

### Expected Metrics
- **Extraction time**: 1-3 seconds per chapter
- **Download speed**: 100KB-500KB per image
- **Memory usage**: <50MB for extension, <100MB for server
- **CPU usage**: Minimal (<5%) except during parsing

### Monitor via
1. Server console - shows download progress
2. Browser DevTools (F12 → Network) - shows image requests
3. Browser DevTools (F12 → Console) - shows extension logs
4. Windows Task Manager - verify node.js process

## Verification Success Criteria

- [ ] Extension loads without errors
- [ ] Popup appears on cuutruyen.net pages
- [ ] Chapter extraction works (shows list)
- [ ] Download initiates (shows in server logs)
- [ ] Files save to disk
- [ ] Images are valid (can open in viewer)
- [ ] Deduplication works (no duplicate formats)

## Additional Commands

### Check if Server is Running
```bash
curl http://127.0.0.1:3000
```

### Check if Extension is Loaded
```javascript
// In browser console
chrome.extension.getBackgroundPage() // Should return background context
```

### Manual Download Test
```bash
curl -X POST http://127.0.0.1:3000/download \
  -H "Content-Type: application/json" \
  -d '{
    "imageUrl":"https://storage-ct.lrclib.net/file/cuutruyen/images/2159517.jpg",
    "savePath":"D:\\Test\\001.jpg",
    "referer":"https://cuutruyen.net/mangas/481/chapters/87569",
    "mangaTitle":"Test Manga",
    "chapterTitle":"Test Chapter"
  }'
```

## Next Steps After Verification

1. **Production Setup**: Deploy server to NAS or cloud service if desired
2. **Monitor**: Keep server running in background
3. **Update**: Check for cuutruyen.net HTML structure changes
4. **Extend**: Add more manga sources following cuutruyen adapter pattern
5. **Optimize**: Adjust rate limiting and timeout values based on usage

## Support Resources

- Test script: `node test-cuutruyen.js`
- Documentation: `CUUTRUYEN_SUPPORT.md`
- Implementation: `IMPLEMENTATION_SUMMARY.md`
- Browser Console: F12 → Console tab
- Server Console: Terminal/PowerShell output
