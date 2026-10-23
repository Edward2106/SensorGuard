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
- **Theo dõi hoạt động hệ thống:** Kiểm tra trạng thái hoạt động (liveness probe qua `/health`) và tính sẵn sàng của cơ sở dữ liệu (readiness probe qua `/ready`).

### Chức năng chưa có hoặc chưa hoàn thiện:
- Chưa có hệ thống đăng nhập tài khoản người dùng nhiều cấp độ (RBAC).
- Chưa có endpoint kiểm tra nhịp tim riêng biệt (heartbeat probe) cho tiến trình worker.
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

Các API yêu cầu xác thực cần gửi kèm tiêu đề HTTP `X-API-Key: <giá_trị_API_KEY>`.

| Phương thức | Đường dẫn | Xác thực | Mô tả |
|---|---|---|---|
| GET | `/health` | Không | Kiểm tra tiến trình backend còn hoạt động hay không |
| GET | `/ready` | Không | Kiểm tra kết nối tới MongoDB và Redis |
| GET | `/api/v1/sensors` | X-API-Key | Lấy danh sách cảm biến (hỗ trợ phân trang, lọc) |
| POST | `/api/v1/sensors` | X-API-Key | Đăng ký cảm biến mới kèm cấu hình ngưỡng |
| GET | `/api/v1/sensors/:sensorId` | X-API-Key | Xem thông tin chi tiết một cảm biến |
| PUT | `/api/v1/sensors/:sensorId` | X-API-Key | Cập nhật thông tin và ngưỡng của cảm biến |
| DELETE | `/api/v1/sensors/:sensorId` | X-API-Key | Xóa cảm biến khỏi hệ thống |
| GET | `/api/v1/sensors/stats` | X-API-Key | Thống kê số lượng cảm biến theo trạng thái |
| GET | `/api/v1/sensors/:sensorId/readings` | X-API-Key | Lấy danh sách dữ liệu đo của cảm biến |
| GET | `/api/v1/sensors/:sensorId/readings/latest` | X-API-Key | Lấy dữ liệu đo mới nhất của cảm biến |
| POST | `/api/v1/readings` | X-API-Key | Đưa bản ghi đo lường vào hàng đợi xử lý |
| POST | `/api/v1/readings/batch` | X-API-Key | Đưa tập hợp nhiều bản ghi vào hàng đợi |
| GET | `/api/v1/incidents` | X-API-Key | Lấy danh sách sự cố cảnh báo |
| GET | `/api/v1/incidents/stats` | X-API-Key | Thống kê số lượng sự cố theo mức độ |
| PATCH | `/api/v1/incidents/:alertId/acknowledge` | X-API-Key | Chuyển trạng thái sự cố sang đã ghi nhận |
| PATCH | `/api/v1/incidents/:alertId/resolve` | X-API-Key | Đóng và đánh dấu giải quyết sự cố |

## 10. Giám sát bằng Datadog

Mã nguồn dự án đã tích hợp sẵn thư viện `dd-trace` và xuất nhật ký theo định dạng có cấu trúc JSON kèm mã định danh vết (Trace ID và Span ID):

- Chạy ứng dụng kèm APM:
  ```powershell
  npm run start:observed
  npm run worker:observed
  ```
- Tệp nhật ký tự động ghi tại thư mục `logs/` (mỗi tiến trình lưu tệp riêng với cơ chế xoay vòng dung lượng 5 MiB).
- Các chỉ số DogStatsD gửi qua cổng UDP `8125` trên máy cục bộ với tiền tố `sensorguard.*`.
- Các tệp cấu hình mẫu cho bảng điều khiển và cảnh báo có sẵn tại thư mục `monitoring/` (`dashboard.json`, `monitors.json`).

*Lưu ý rõ ràng:* Việc đẩy dữ liệu lên dịch vụ đám mây Datadog Cloud (Cloud Logs Explorer, Custom Metrics) chưa được kiểm thử toàn diện do hạn chế quyền hạn truy cập của Datadog Agent trên máy trạm cục bộ. Dự án không tự động tạo tài nguyên trên Datadog và dịch vụ Datadog Cloud là dịch vụ thương mại có phí.

## 11. Những giới hạn hiện tại

- **Xác thực người dùng:** Hiện tại sử dụng một khóa `API_KEY` chia sẻ chung trong `.env`. Chưa có cơ chế quản lý tài khoản người dùng, phiên đăng nhập (session) hoặc mã xác thực JWT.
- **Giám sát Worker:** Chưa có HTTP endpoint độc lập để kiểm tra tình trạng nhịp tim (heartbeat) của tiến trình worker.
- **Thống kê lịch sử:** Backend chưa có các API tính toán gộp (aggregation theo ngày/tuần/tháng) cho dữ liệu chuỗi thời gian lớn; biểu đồ hiện giới hạn hiển thị tối đa 200 điểm dữ liệu gần nhất.
- **Xác thực Datadog Cloud:** Tích hợp Datadog mới dừng lại ở mức đo lường tại tiến trình cục bộ, chưa xác nhận luồng đẩy dữ liệu thành công lên tài khoản Datadog Cloud.
- **Môi trường tách biệt (Isolated Docker):** Bộ cấu hình `compose.isolated.yml` đã được chuẩn bị nhưng chưa chuyển đổi làm môi trường mặc định.

## 12. Hướng phát triển

Các kế hoạch cải tiến trong giai đoạn tiếp theo (Phase 8):
- Bổ sung hệ thống xác thực người dùng dựa trên JWT và phân quyền quản trị viên / kỹ thuật viên vận hành.
- Bổ sung cơ chế thông báo sự cố tức thời qua Email, Webhook (Discord, Slack, Telegram).
- Xây dựng API tổng hợp dữ liệu lịch sử phục vụ phân tích xu hướng dài hạn.
- Thiết lập endpoint kiểm tra sức khỏe chuyên biệt cho cụm worker.
- Tự động hóa quy trình triển khai CI/CD với GitHub Actions và triển khai thử nghiệm trên hạ tầng đám mây.

## 13. Lưu ý bảo mật

- **Không đưa tệp bí mật lên Git:** Tệp `.env` chứa thông tin cấu hình nhạy cảm và mật khẩu cơ sở dữ liệu. Tệp này đã được khai báo trong `.gitignore` và không bao giờ được commit lên GitHub.
- **Cấu hình môi trường riêng:** Người dùng khi tải mã nguồn về cần tạo tệp `.env` riêng từ `.env.example` và thiết lập khóa `API_KEY` an toàn.
- **Bảo vệ cổng nội bộ:** Cổng giao tiếp frontend (`server/boundary.mjs`) được cấu hình chỉ phục vụ cho việc phát triển cục bộ (`localhost`). Khi đưa vào môi trường thực tế, bắt buộc phải có tường lửa và lớp bảo mật xác thực chuyên dụng.
