# Hỗ trợ cuutruyen.net

## Tổng quan

Adapter này cho phép tải truyện từ **cuutruyen.net** với hỗ trợ đặc biệt cho ảnh được render trên canvas (ảnh bị scramble/mã hóa).

## Cách hoạt động

### 1. Phát hiện và quét chương
- Khi bạn truy cập trang truyện trên cuutruyen.net, extension sẽ tự động phát hiện trang web
- Nhấn "QUÉT CHƯƠNG" để lấy danh sách các chương
- Adapter sẽ phân tích HTML để tìm tất cả các link chương

### 2. Trích xuất ảnh
- Khi tải một chương, adapter sẽ:
  1. Fetch HTML trang chương
  2. Tìm tất cả `data-id` attributes từ các page elements
  3. Xây dựng URL ảnh từ storage CDN: `https://storage-ct.lrclib.net/file/cuutruyen/images/{pageId}.jpg`
  4. Gửi ảnh tới server để lưu và kiểm tra chất lượng

### 3. Xử lý ảnh bị scramble
- Các ảnh trên cuutruyen.net được render qua canvas, nhưng dữ liệu gốc vẫn có thể trích xuất qua page ID
- Adapter sử dụng storage CDN endpoint để lấy ảnh gốc chưa bị scramble
- Server sẽ tự động xóa ảnh trùng lặp và giữ bản chất lượng cao nhất

## Cấu trúc URL

```
Trang manga:     https://cuutruyen.net/mangas/{mangaId}
Trang chương:    https://cuutruyen.net/mangas/{mangaId}/chapters/{chapterId}
```

## Cách sử dụng

### Bước 1: Mở trang truyện
```
https://cuutruyen.net/mangas/481  (ví dụ: Kanojo, Okarishimasu)
```

### Bước 2: Nhấn "QUÉT CHƯƠNG"
Extension sẽ quét tất cả chương và hiển thị danh sách

### Bước 3: Chọn chương cần tải
- Chọn checkbox cho các chương muốn tải
- Hoặc nhấn "All" để chọn tất cả

### Bước 4: Tùy chọn đường dẫn lưu
- Nhập đường dẫn thư mục (ví dụ: `D:\Truyen_Download`)
- Mặc định: `D:\TruyenQQ_Download`

### Bước 5: Nhấn "TẢI CÁC CHƯƠNG ĐÃ CHỌN"
- Extension sẽ bắt đầu tải ngầm
- Tiến trình hiển thị trong popup
- Tài khoản sẽ được lưu để tải lại nếu thiếu file

## Cấu trúc thư mục

```
D:\Truyen_Download\
├── Kanojo, Okarishimasu\
│   ├── Chương 424 - Lối vào\
│   │   ├── 001.jpg
│   │   ├── 002.jpg
│   │   └── ...
│   ├── Chương 425\
│   └── ...
└── [Truyện khác]\
```

## Tính năng nâng cao

### Kiểm tra file tự động
- Server sẽ kiểm tra xem ảnh đã được lưu chưa
- Nếu thiếu file, sẽ tải lại tự động
- Nếu file trùng lặp với các format khác nhau, sẽ giữ bản chất lượng cao nhất

### Tự động xóa trùng lặp
- Khi tải cùng một chương lần thứ 2, server sẽ:
  1. So sánh file kích thước (proxy cho chất lượng)
  2. Xóa file kém hơn
  3. Giữ file tốt nhất

### Rate limiting
- Extension tự động chậm lại giữa các request (500ms)
- Để tránh kích hoạt anti-bot của cuutruyen

## Lỗi thường gặp và cách khắc phục

### Không tìm thấy chương
**Nguyên nhân**: Trang không phải là trang truyện hoặc HTML khác so với mong đợi

**Cách khắc phục**:
1. Kiểm tra URL: phải là `cuutruyen.net/mangas/{id}`
2. Refresh trang rồi thử lại
3. Kiểm tra console (F12) xem có lỗi gì không

### Tải ảnh thất bại
**Nguyên nhân**: 
- Server local không chạy
- Kết nối timeout
- CDN storage tạm thời lỗi

**Cách khắc phục**:
1. Đảm bảo server chạy: `node server.js`
2. Kiểm tra lại URL đường dẫn lưu
3. Chạy `node test-cuutruyen.js` để test

### Ảnh bị scramble/hỏng
**Nguyên nhân**: Page ID hoặc storage URL thay đổi

**Cách khắc phục**:
1. Chạy test: `node test-cuutruyen.js`
2. Kiểm tra lại URL pattern trong console

## Testing

Chạy test script để kiểm tra extraction hoạt động:

```bash
node test-cuutruyen.js
```

Output mong đợi:
```
🔍 Testing cuutruyen.net chapter extraction...

📡 Fetching: https://cuutruyen.net/mangas/481/chapters/87569

✅ Fetched 450.23KB of HTML

📖 Found 28 pages

  Page 1: ID=2159517 → https://storage-ct.lrclib.net/file/cuutruyen/images/2159517.jpg
  Page 2: ID=2159518 → https://storage-ct.lrclib.net/file/cuutruyen/images/2159518.jpg
  ...
```

## Thông tin kỹ thuật

### API Endpoints
- Chương HTML: `GET https://cuutruyen.net/mangas/{mangaId}/chapters/{chapterId}`
- Storage CDN: `GET https://storage-ct.lrclib.net/file/cuutruyen/images/{pageId}.jpg`

### HTML Selectors
- Page container: `[data-id]` (contains page ID and index)
- Chapter title: `h1` or `.chapter-title`
- Manga title: Extracted from URL or page meta

### Attributes
```html
<div id="page-2159517" data-id="2159517" data-index="0">
  <canvas width="2048" height="1277">...</canvas>
</div>
```

## Hạn chế

1. **Canvas rendering**: Nếu cuutruyen.net thay đổi cơ chế render, adapter có thể không hoạt động
2. **Storage CDN URL**: Phụ thuộc vào endpoint CDN hiện tại
3. **Rate limiting**: Có thể bị block nếu tải quá nhanh
4. **Authentication**: Một số chương có thể yêu cầu đăng nhập

## Cập nhật trong tương lai

- [ ] Hỗ trợ canvas pixel extraction (fallback nếu CDN URL thay đổi)
- [ ] Hỗ trợ authentication/login
- [ ] Cải thiện rate limiting
- [ ] Thêm bookmark tự động

## Liên hệ

Nếu gặp vấn đề:
1. Kiểm tra console browser (F12 → Console)
2. Chạy test script: `node test-cuutruyen.js`
3. Báo cáo vấn đề với:
   - URL chương gặp sự cố
   - Output của test script
   - Error message từ console

## License

Adapter này được tạo ra cho mục đích sử dụng cá nhân.
