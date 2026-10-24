# SensorGuard

## 1. Giới thiệu

SensorGuard là hệ thống giám sát cảm biến IoT và phát hiện sự cố theo thời gian thực. Hệ thống thu thập các chỉ số đo lường từ thiết bị cảm biến (nhiệt độ, độ ẩm, độ rung), chuyển qua hàng đợi xử lý nền, lưu trữ vào cơ sở dữ liệu chuỗi thời gian (Time Series), tự động phát hiện các chỉ số vượt ngưỡng hoặc mất kết nối, đồng thời hiển thị thông tin trực quan trên giao diện web.

Dự án giúp giải quyết bài toán giám sát thiết bị tập trung, cảnh báo kịp thời khi phần cứng gặp trục trặc và hỗ trợ đội ngũ vận hành theo dõi trạng thái hệ thống ổn định.

## 2. Chức năng chính

### Chức năng đã hoàn thiện:
- **Quản lý cảm biến:** Đăng ký mới cảm biến, tra cứu danh sách có phân trang trên máy chủ, tìm kiếm theo mã hoặc tên, lọc theo loại, cơ sở (facility) và khu vực (zone), chỉnh sửa thông tin cấu hình và ngưỡng cảnh báo.
- **Thu thập dữ liệu cảm biến:** Tiếp nhận dữ liệu đo lường đơn lẻ hoặc theo lô (batch) qua REST API, sử dụng hàng đợi BullMQ để đệm dữ liệu tránh quá tải.
- **Theo dõi nhiệt độ, độ ẩm và độ rung:** Hỗ trợ ba loại cảm biến phổ biến với đơn vị đo tương ứng (°C, %, mm/s).
- **Phát hiện dữ liệu bất thường:** So sánh dữ liệu thực tế với ngưỡng cảnh báo (warningLow, warningHigh, criticalLow, criticalHigh); áp dụng cơ chế chống rung (hysteresis) và yêu cầu nhiều bản ghi đạt chuẩn liên tiếp trước khi phục hồi trạng thái.
- **Tạo và xử lý cảnh báo:** Tự động tạo sự cố (incident) khi phát hiện bất thường hoặc mất kết nối; hỗ trợ quy trình chuyển trạng thái từ đang mở (open), đã ghi nhận (acknowledged) sang đã giải quyết (resolved).
- **Giả lập cảm biến IoT:** Công cụ dòng lệnh (CLI) giả lập lưu lượng dữ liệu với nhiều kịch bản: bình thường, quá nhiệt, độ ẩm cao, rung lắc mạnh, ngắt kết nối và gửi dữ liệu đột biến.
- **Xem biểu đồ và dữ liệu trên website:** Giao diện React hiển thị biểu đồ đường đo lường thời gian thực, bảng phân phối thiết bị và danh sách sự cố.
- **Theo dõi hoạt động hệ thống:** Kiểm tra trạng thái hoạt động (liveness probe qua `/health`), tính sẵn sàng của cơ sở dữ liệu (readiness probe qua `/ready`), và trạng thái cụm worker qua `/api/v1/workers`.
- **Xác thực và phân quyền người dùng (RBAC):** Đăng nhập/đăng xuất bảo mật với MongoDB-backed sessions; băm mật khẩu bằng thuật toán scrypt với salt ngẫu nhiên; phân chia 3 vai trò (ADMIN, OPERATOR, VIEWER) thực thi nghiêm ngặt tại backend; tự động hết hạn phiên và thu hồi phiên ngay lập tức khi khóa tài khoản hoặc thay đổi vai trò; bảo vệ chống tấn công CSRF và session fixation.
- **Giám sát nhịp tim Worker (Heartbeat Probe):** Định kỳ ghi nhận nhịp tim worker (10 giây) vào Redis registry (`sg:workers:<db>`), tự động chuyển sang `degraded` khi worker dừng hoặc mất kết nối MongoDB, tự hết hạn (stale sau 30 giây) nếu tiến trình worker bị tắt đột ngột.
- **Môi trường Staging và Cổng Caddy HTTPS:** Cấu hình Docker Compose (`deploy/compose.yml`) triển khai stack staging hoàn chỉnh với Caddy Reverse Proxy hỗ trợ HTTPS nội bộ (`https://localhost:8443`), mạng nội bộ `private` cô lập hoàn toàn API, Worker, MongoDB và Redis.
- **Quy trình sao lưu và phục hồi BSON:** Kịch bản kiểm chứng quy trình sao lưu và phục hồi toàn diện (`mongodump`/`mongorestore`), bảo toàn đầy đủ các Time Series collections (`sensor_readings`) và chỉ mục mà không ảnh hưởng đến dữ liệu phát triển.

### Chức năng chưa có hoặc dự kiến phát triển tiếp:
- Chưa có API tổng hợp dữ liệu lịch sử theo từng khung giờ hoặc ngày (analytics hiện hiển thị phân phối tức thời).
- Chưa kích hoạt gửi cảnh báo qua Email/SMS/Webhook ra bên ngoài.

## 3. Công nghệ sử dụng

- **Backend:** Node.js (>=20), Express 4.
- **Frontend:** React 19, TypeScript, Vite, TanStack Query, Recharts, Lucide React.
- **Cơ sở dữ liệu:** MongoDB (hỗ trợ Time Series collection, Mongoose).
- **Hàng đợi & Bộ nhớ đệm:** Redis, BullMQ, ioredis.
- **Giám sát:** Datadog tracer (`dd-trace`), DogStatsD (cấu hình sẵn sàng cho APM và log định dạng JSON).
- **Môi trường & Container:** Docker, Docker Compose.
- **Kiểm thử giao diện:** Node Test Runner, Vitest, Testing Library.

## 4. Cấu trúc thư mục

```text
SensorGuard/
├── src/                  # Mã nguồn chính của backend
│   ├── config/           # Cấu hình môi trường, kết nối MongoDB và Redis
│   ├── controllers/      # Bộ điều hướng xử lý logic request cho sensor, reading, alert
│   ├── middleware/       # Middleware xác thực API key, validate dữ liệu, xử lý lỗi
│   ├── models/           # Mô hình dữ liệu Mongoose (Sensor, Reading, Incident)
│   ├── queues/           # Cấu hình hàng đợi BullMQ tiếp nhận dữ liệu
│   ├── routes/           # Định nghĩa các tuyến đường REST API
│   ├── services/         # Logic nghiệp vụ xử lý dữ liệu và phát hiện bất thường
│   ├── observability/    # Thiết lập logger JSON và metric tích hợp Datadog
│   ├── app.js            # Khởi tạo ứng dụng Express
│   ├── index.js          # Điểm khởi chạy tiến trình Backend API
│   └── worker.js         # Điểm khởi chạy tiến trình Telemetry Worker
├── frontend/             # Ứng dụng giao diện người dùng (React + Vite)
│   ├── src/              # Mã nguồn giao diện: components, pages, charts
│   ├── server/           # Cổng nội bộ (BFF gateway) bảo vệ API key
│   └── package.json      # Cấu hình thư viện và script của frontend
├── simulator/            # Công cụ CLI giả lập dữ liệu cảm biến gửi về hệ thống
├── monitoring/           # Cấu hình mẫu Datadog dashboard, monitor và collector
├── scripts/              # Các kịch bản khởi tạo database, chỉ mục, dữ liệu mẫu
├── config/               # Cấu hình môi trường phát triển phụ trợ
├── Dockerfile            # Cấu hình build container cho ứng dụng
├── docker-compose.yml    # Cấu hình chạy ứng dụng và dịch vụ qua Docker
└── README.md             # Tài liệu hướng dẫn dự án
```

## 5. Yêu cầu trước khi chạy

- **Hệ điều hành:** Windows 10/11, macOS hoặc Linux.
- **Node.js:** Phiên bản 20 trở lên (khuyến nghị Node.js 22 LTS) cùng trình quản lý gói `npm`.
- **MongoDB:** Phiên bản 6.0 trở lên hỗ trợ Time Series collection (mặc định cổng `27017`).
- **Redis:** Phiên bản 7.x (mặc định cổng `6379`).
- **Git:** Dùng để clone mã nguồn.

Lưu ý: Đảm bảo dịch vụ MongoDB và Redis đã được khởi động trên máy tính trước khi chạy backend.

## 6. Cài đặt

Mở PowerShell tại thư mục dự án và thực hiện các bước sau:

### Bước 1: Cài đặt thư viện dependencies

```powershell
# Cài đặt thư viện cho backend
npm install

# Cài đặt thư viện cho frontend
npm --prefix frontend install
```

### Bước 2: Thiết lập biến môi trường

Sao chép tệp mẫu `.env.example` thành `.env`:

```powershell
Copy-Item .env.example .env
```

Mở tệp `.env` vừa tạo và chỉnh sửa cấu hình nếu cần (ví dụ chuỗi kết nối MongoDB, thông tin Redis hoặc giá trị `API_KEY`). Không dùng khóa bí mật mặc định trên môi trường triển khai thực tế.

### Bước 3: Khởi tạo cơ sở dữ liệu

Chạy lệnh để tạo Time Series collection, đánh chỉ mục (indexes) và thêm dữ liệu cảm biến mẫu:

```powershell
npm run db:setup
```

## 7. Chạy dự án

Hệ thống bao gồm các tiến trình độc lập, nên mở các cửa sổ terminal riêng biệt để quan sát nhật ký hoạt động:

### Cửa sổ 1: Chạy Backend API
```powershell
npm start
```
API lắng nghe tại địa chỉ: `http://127.0.0.1:3000`

### Cửa sổ 2: Chạy Telemetry Worker
```powershell
npm run worker
```
Worker sẽ kết nối Redis, lắng nghe hàng đợi BullMQ, ghi nhận dữ liệu đo vào MongoDB và kiểm tra ngưỡng cảnh báo.

### Cửa sổ 3: Chạy giao diện React Dashboard
```powershell
npm run frontend:dev
```
Truy cập giao diện tại trình duyệt: `http://127.0.0.1:5173`

### Cửa sổ 4: Chạy IoT Simulator (tùy chọn)
Để giả lập cảm biến gửi dữ liệu liên tục về hệ thống:
```powershell
# Xem hướng dẫn các tùy chọn kịch bản
npm run simulate -- --help

# Gửi dữ liệu bình thường (120 cảm biến, 20 gói tin/giây trong 30 giây)
npm run simulate -- --sensors 120 --rate 20 --duration 30 --scenario NORMAL

# Thử nghiệm kịch bản nhiệt độ cao
npm run simulate -- --sensors 10 --rate 5 --duration 20 --scenario HIGH_TEMPERATURE
```

### Kiểm tra tự động frontend (Typecheck, Test, Build)
```powershell
npm run frontend:typecheck
npm run frontend:test
npm run frontend:build
```

## 8. Các chức năng trên giao diện

Giao diện web (`http://127.0.0.1:5173`) bao gồm các phân hệ chính:

- **Tổng quan (Overview):** Hiển thị thẻ tóm tắt tổng số cảm biến, số lượng trực tuyến (dựa trên dữ liệu thực tế), ngoại tuyến, bảo trì, tổng sự cố đang mở và số sự cố nghiêm trọng (Critical). Đồng thời hiển thị danh sách sự cố gần nhất và bản ghi dữ liệu mới nhận.
- **Quản lý cảm biến (Sensors):** Liệt kê toàn bộ cảm biến có hỗ trợ phân trang từ máy chủ, tìm kiếm theo tên/mã, bộ lọc trạng thái và loại cảm biến, form đăng ký mới cảm biến và hộp thoại xem chi tiết thông số.
- **Giám sát thời gian thực (Monitoring):** Lựa chọn từng cảm biến để theo dõi biểu đồ đường đo lường nhiệt độ, độ ẩm hoặc độ rung, kèm theo các đường ranh giới ngưỡng cảnh báo (Warning/Critical) và bảng lịch sử đo lường (giới hạn tối đa 200 bản ghi mới nhất).
- **Trung tâm sự cố (Incidents):** Theo dõi toàn bộ cảnh báo phát sinh từ hệ thống, lọc theo mức độ nghiêm trọng (low, medium, high, critical) và trạng thái (open, acknowledged, resolved). Hỗ trợ nút thao tác tiếp nhận (Acknowledge) và đóng sự cố (Resolve).
- **Phân tích mạng lưới (Analytics):** Thống kê biểu đồ cột về cơ cấu loại cảm biến, tình trạng kết nối, trạng thái vận hành và phân bổ sự cố.
- **Sức khỏe hệ thống (System Health):** Theo dõi trạng thái kiểm tra `/health` và `/ready` của API, trạng thái kết nối tới MongoDB và Redis, cùng đường dẫn tiện ích tới các bảng giám sát Datadog.
- **Cài đặt (Settings):** Tùy chỉnh chế độ hiển thị sáng/tối (Dark/Light mode), thời gian tự động làm mới dữ liệu (5s - 60s), múi giờ hiển thị và khoảng thời gian biểu đồ mặc định.

## 9. API chính

Hệ thống hỗ trợ 2 cơ chế xác thực:
1. **Người dùng (Web UI):** Sử dụng Cookie phiên làm việc an toàn (`__Secure-sg_session` ở production hoặc `sg_session` ở development) kèm tiêu đề CSRF `X-SensorGuard-UI: 1` và `Content-Type: application/json`.
2. **Thiết bị IoT & Dịch vụ nền:** Gửi tiêu đề HTTP `X-API-Key: <DEVICE_API_KEY>` (chỉ được phép gửi bản ghi đo lường telemetry vào `/api/v1/readings`) hoặc khóa dịch vụ `API_KEY` (khi bật `LEGACY_API_KEY_ENABLED`).

| Phương thức | Đường dẫn | Xác thực / Quyền hạn | Mô tả |
|---|---|---|---|
| GET | `/health` | Công khai | Kiểm tra tiến trình backend API còn hoạt động hay không (liveness) |
| GET | `/ready` | Công khai | Kiểm tra tính sẵn sàng kết nối tới MongoDB và Redis (readiness) |
| POST | `/api/v1/auth/login` | Công khai (Rate limit 10/15p) | Đăng nhập hệ thống, cấp cookie phiên làm việc |
| POST | `/api/v1/auth/logout` | Session + CSRF | Đăng xuất, hủy cookie và thu hồi phiên trên cơ sở dữ liệu |
| GET | `/api/v1/auth/me` | Session (Mọi vai trò) | Lấy thông tin tài khoản và vai trò đang đăng nhập |
| GET | `/api/v1/auth/users` | Session (Chỉ ADMIN) | Danh sách tài khoản người dùng có phân trang |
| POST | `/api/v1/auth/users` | Session (Chỉ ADMIN) | Tạo tài khoản người dùng mới (ADMIN, OPERATOR, VIEWER) |
| PATCH | `/api/v1/auth/users/:id` | Session (Chỉ ADMIN) | Khóa/mở tài khoản, cập nhật vai trò hoặc đổi mật khẩu |
| GET | `/api/v1/workers` | Session hoặc API Key | Kiểm tra tình trạng nhịp tim (heartbeat) của cụm worker nền |
| GET | `/api/v1/sensors` | Mọi vai trò / API Key | Lấy danh sách cảm biến (hỗ trợ phân trang, tìm kiếm, lọc) |
| POST | `/api/v1/sensors` | Chỉ ADMIN | Đăng ký cảm biến mới kèm cấu hình ngưỡng cảnh báo |
| GET | `/api/v1/sensors/:sensorId` | Mọi vai trò / API Key | Xem thông tin chi tiết cấu hình một cảm biến |
| PUT / PATCH | `/api/v1/sensors/:sensorId` | ADMIN, OPERATOR | Cập nhật thông số và ngưỡng cảnh báo của cảm biến |
| DELETE | `/api/v1/sensors/:sensorId` | Chỉ ADMIN | Xóa cảm biến khỏi hệ thống |
| GET | `/api/v1/sensors/stats` | Mọi vai trò / API Key | Thống kê số lượng cảm biến theo trạng thái |
| GET | `/api/v1/sensors/:sensorId/readings` | Mọi vai trò / API Key | Lấy danh sách lịch sử đo lường của cảm biến |
| GET | `/api/v1/sensors/:sensorId/readings/latest` | Mọi vai trò / API Key | Lấy bản ghi đo lường mới nhất của cảm biến |
| POST | `/api/v1/readings` | Thiết bị (`DEVICE_API_KEY`) | Đưa 1 bản ghi đo lường vào hàng đợi BullMQ (người dùng bị chặn) |
| POST | `/api/v1/readings/batch` | Thiết bị (`DEVICE_API_KEY`) | Đưa tập hợp nhiều bản ghi vào hàng đợi (tối đa 1000 bản ghi) |
| GET | `/api/v1/incidents` | Mọi vai trò / API Key | Lấy danh sách sự cố cảnh báo (lọc theo mức độ, trạng thái) |
| GET | `/api/v1/incidents/stats` | Mọi vai trò / API Key | Thống kê số lượng sự cố theo mức độ nghiêm trọng |
| PATCH | `/api/v1/incidents/:alertId/acknowledge` | ADMIN, OPERATOR | Ghi nhận sự cố (tự động gắn danh tính người thực hiện) |
| PATCH | `/api/v1/incidents/:alertId/resolve` | ADMIN, OPERATOR | Đóng và đánh dấu giải quyết sự cố kèm ghi chú giải pháp |

## 10. Giám sát bằng Datadog

Mã nguồn dự án đã tích hợp sẵn thư viện `dd-trace` và xuất nhật ký theo định dạng có cấu trúc JSON kèm mã định danh vết (Trace ID và Span ID):

- Chạy ứng dụng kèm APM:
  ```powershell
  npm run start:observed
  npm run worker:observed
  ```
- Tệp nhật ký tự động ghi tại thư mục `logs/` (mỗi tiến trình lưu tệp riêng với cơ chế xoay vòng dung lượng 5 MiB, lưu tối đa 3 bản sao lưu).
- Các chỉ số DogStatsD gửi qua cổng UDP `8125` trên máy cục bộ với tiền tố `sensorguard.*`.
- Các tệp cấu hình mẫu cho bảng điều khiển và cảnh báo có sẵn tại thư mục `monitoring/` (`dashboard.json`, `monitors.json`).

*Lưu ý rõ ràng:* Việc đẩy dữ liệu lên dịch vụ đám mây Datadog Cloud (Cloud Logs Explorer, Custom Metrics) chưa được kích hoạt vì Datadog Cloud là dịch vụ thương mại có phí. Toàn bộ thiết lập đo lường cục bộ an toàn, không tự động kích hoạt tính năng tính phí.

## 11. Kiểm định hiệu năng và Độ tin cậy (Phase 8 Benchmark)

Hệ thống đã thực hiện kiểm định tải (load test) trên hạ tầng cô lập với các kịch bản 20 req/s, 50 req/s và 100 req/s:

- **Kịch bản 20 req/s (10 giây, 200 bản ghi):** Tỷ lệ thành công 100%, tỷ lệ lỗi 0%, độ trễ p50 = 27.9ms, p95 = 32.6ms, p99 = 70.9ms, tồn đọng hàng đợi cao nhất = 1 gói.
- **Kịch bản 50 req/s (10 giây, 500 bản ghi):** Tỷ lệ thành công 100%, tỷ lệ lỗi 0%, độ trễ p50 = 17.5ms, p95 = 26.1ms, p99 = 27.9ms, tồn đọng hàng đợi cao nhất = 1 gói.
- **Kịch bản 100 req/s (10 giây, 1000 bản ghi):** 
  - Khi hệ thống đạt trạng thái ấm (warm cache/JIT) và điều kiện I/O ổn định: Tiếp nhận thành công 1000/1000 bản ghi (tốc độ đo được 99.82 req/s), tỷ lệ lỗi 0%, độ trễ p50 = 14.2ms, p95 = 22.3ms, p99 = 25.3ms, tồn đọng hàng đợi cao nhất = 9 gói, worker xử lý p95 = 45ms.
  - *Điểm nghẽn xác nhận khi máy chủ chịu tải lạnh hoặc tài nguyên CPU/IO bị tranh chấp:* Trên môi trường máy trạm đơn máy chủ chạy chung cả API, Worker, MongoDB Time Series và Redis, điểm nghẽn chính nằm ở giới hạn in-flight request của client kiểm thử và chi phí xác thực rate limit/MongoDB write trước khi vào hàng đợi. Nếu độ trễ vượt quá ngưỡng timeout 5s của client, tỷ lệ lỗi có thể tăng lên ~1.1%. Do đó, trong môi trường sản xuất thực tế, khuyến nghị phân tách máy chủ cơ sở dữ liệu và cụm worker xử lý nền riêng biệt.

## 12. Những giới hạn hiện tại

- **Thống kê lịch sử dài hạn:** Backend chưa có các API tính toán tổng hợp (aggregation theo ngày/tuần/tháng) cho dữ liệu chuỗi thời gian lớn; biểu đồ giao diện hiện hiển thị tối đa 200 điểm dữ liệu gần nhất.
- **Kênh thông báo ra ngoài:** Chưa kích hoạt gửi cảnh báo trực tiếp qua Email, SMS hoặc Webhook (Discord/Slack/Telegram).
- **Hạ tầng 100 req/s:** Đã được kiểm chứng thực tế đạt chuẩn trong điều kiện cô lập, nhưng để duy trì liên tục ở quy mô lớn hơn cần hạ tầng cụm phân tán (distributed cluster) có nhiều worker nodes.

## 13. Hướng phát triển tiếp theo

- Xây dựng API tổng hợp dữ liệu lịch sử theo từng khung giờ và ngày phục vụ phân tích xu hướng dài hạn.
- Tích hợp module gửi thông báo tức thời qua Webhook và Email khi xuất hiện sự cố nghiêm trọng (Critical).
- Kích hoạt quy trình CI/CD tự động hóa trên GitHub Actions khi đưa mã nguồn lên môi trường đám mây.

## 14. Lưu ý bảo mật

- **Không đưa tệp bí mật lên Git:** Tệp `.env`, `.env.*`, khóa API, chứng chỉ và các bản sao lưu cơ sở dữ liệu đã được khai báo nghiêm ngặt trong `.gitignore` và được kiểm tra tự động bằng `scripts/secret-check.js`.
- **Cấu hình môi trường riêng:** Người dùng khi tải mã nguồn về cần tạo tệp `.env` riêng từ `.env.example` và thiết lập các khóa bí mật có độ dài tối thiểu 32 ký tự.
- **Bảo vệ cổng nội bộ và HTTPS:** Trong môi trường staging, toàn bộ truy cập đi qua Caddy Reverse Proxy trên cổng HTTPS `https://localhost:8443`. Không mở cổng backend API hoặc database trực tiếp ra ngoài Internet.
