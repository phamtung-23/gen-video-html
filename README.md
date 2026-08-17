# generate-video-ai

Tạo video dọc từ HTML/CSS/JS bằng [**HyperFrames**](https://hyperframes.heygen.com) — framework của HeyGen render từng frame bằng headless Chrome rồi ghép thành MP4 qua ffmpeg.

Đưa vào một video tham chiếu → nhận lại một video cùng phong cách. Phần **đo đạc, design system, và lớp component/timeline là dùng chung**; mỗi video vẫn là một project riêng vì trong HyperFrames *một project chính là một composition*.

---

## Yêu cầu

```bash
brew install node ffmpeg
npx hyperframes doctor          # kiểm tra môi trường 1 lần
export PRODUCER_BROWSER_GPU_MODE=hardware   # macOS: bật GPU khi render
```

---

## Cấu trúc

```
generate-video-ai/
├── kit/                        # ★ nguồn chân lý dùng chung
│   ├── frame.md                #   design spec: màu, chữ, spacing, luật
│   ├── kit.css                 #   component layer
│   └── kit.js                  #   builders + timeline helpers
├── tools/
│   ├── measure.mjs             # ★ video tham chiếu → số đo thật
│   └── new-video.mjs           # ★ scaffold project + copy kit / --sync
├── .claude/skills/video-from-reference/
│   └── SKILL.md                # ★ quy trình tôi bám theo mỗi lần
└── videos/
    ├── sync-vs-async/          # 9.33s  (viết tay, trước khi có kit)
    ├── atomic-transactions/    # 14.12s (viết tay, trước khi có kit)
    └── kit-smoketest/          # ví dụ chạy được: dùng đủ mọi builder
```

Mọi lệnh `hyperframes` phải chạy **từ trong thư mục project** (chỗ có `hyperframes.json`).

---

## Cách dùng nhanh

Trong Claude Code:

```
/video-from-reference refs/clip.mp4                          file local
/video-from-reference https://www.tiktok.com/@x/video/123    link (tự tải bằng yt-dlp)
/video-from-reference idempotency keys                       chỉ có chủ đề, không có clip
```

Video tải về nằm ở `refs/` và chỉ dùng làm đầu vào đo đạc — đo cấu trúc và nhịp, không bao giờ mang footage, nhạc nền hay handle của người ta vào sản phẩm.

Dưới đây là các bước skill đó chạy, nếu bạn muốn làm tay.

---

## Quy trình một video mới

### 1. Đo video tham chiếu — không bao giờ ước lượng bằng mắt

```bash
node tools/measure.mjs <reference.mp4> --out .measure
```

Đọc pixel thật qua ffmpeg và in ra: probe, cột nội dung, hộp từng element (top + pitch + thời điểm hiện), hàng chữ kèm cap-height, palette, và **các beat thay đổi** — tất cả quy về canvas 1080. Kèm key frame tại mỗi beat + contact sheet.

- Hộp bị dính vào nhau? Frame tham chiếu mặc định ở gần cuối, nơi hiệu ứng glow bắc cầu qua khoảng hở. Chạy lại với `--ref 0.2`.
- Tin **top và pitch**; **chiều cao** thì đối chiếu lại với key frame (viền mềm làm phình số đo).

### 2. Đọc key frame

Tool không đọc được chữ và không hiểu ý nghĩa. Mở `.measure/frames/*.png` để biết: có mấy lane, tên từng trạng thái, caption viết gì.

### 3. Quét lại có phạm vi

```bash
node tools/measure.mjs <reference.mp4> --band 1190:1215    # dải y, toạ độ 1080
```

Một lần đổi caption làm thay đổi quá ít pixel để vượt ngưỡng toàn khung. Thu hẹp vào đúng dải thì nó nổi bật rõ ràng.

### 4. Scaffold

```bash
node tools/new-video.mjs <name> --duration 14.12 --title "…" --sub "…"
```

### 5–7. Viết `shot-plan.json` → author → verify → render

```bash
cd videos/<name>
npm run check                                  # phải 0 error
npx hyperframes snapshot . --at <beat>,<beat>  # rồi NHÌN ảnh
npx hyperframes render . -q high -o ./renders/video.mp4
```

Gate tự động chỉ bắt được *sai luật*, không bắt được *xấu*. Luôn nhìn snapshot.

Quality **high**, không dùng mặc định `standard`: nền tối nhiều gradient + glow mà bitrate thấp sẽ bị banding sau khi TikTok/Reels nén lại lần nữa.

---

## Độ chính xác của `measure.mjs`

Đã kiểm chứng ngược lại số đo tay của cả hai video:

| Hạng mục | Kết quả |
|---|---|
| Beat đổi caption | **10/10 khớp tuyệt đối** — `0.8 3.0 4.6 6.1` và `7.8 9.25 10.1 10.6 11.2 11.8` |
| Hộp card | `492..608 h=117` vs đo tay `492..609 h=118` |
| Pitch | 158 và 123 — khớp chính xác |
| Thời điểm chip hiện | 6.4 / 11.4 vs đo tay 6.3 / 11.3 |

---

## Kit

`kit/` ở gốc là nguồn chân lý; **mỗi project giữ một bản sao đông cứng**.

Đây không phải trùng lặp vô ích: `hyperframes lint` **chặn thẳng** mọi đường dẫn đi ngược lên trên project root (`invalid_parent_traversal_in_asset_path`) và Studio trả 404, nên `../../kit/` không dùng được. Bản sao cũng khoá kit theo từng video — sửa kit không bao giờ âm thầm làm đổi video đã render xong.

```bash
node tools/new-video.mjs --sync   # kéo kit hiện tại vào các project có dùng kit
```

Chỉ đụng vào project thật sự tham chiếu `kit/kit.js`; project viết tay được bỏ qua.

API: `bg badge chip then vs card arc` (builders) · `reveal hide swap captions pulse march travel pin entrance` (timeline) · `T` (token màu) · `ICONS`.

Ví dụ chạy được, dùng đủ mọi builder: **`videos/kit-smoketest/index.html`**.

---

## 5 cái bẫy (kit sinh ra để chặn 4 cái đầu)

1. **`fromTo()` bị delay rò giá trị `from` về frame 0.** `immediateRender` mặc định `true`, nên tween đặt ở giây thứ 7 lại apply trạng thái đầu ngay lúc build. Tween *ẩn* bị delay còn tệ hơn — nó ép element **hiện** từ frame đầu. Dùng `Kit.reveal()` (đặt `immediateRender:false` **và** gắn `.hf-pre` để CSS giữ trạng thái ẩn) và `Kit.hide()` (`.to()` thuần). **Phải có cả hai**: chỉ `immediateRender:false` thì không có gì ẩn element; chỉ `.hf-pre` thì bị tween ghi đè.

2. **Crossfade đồng thời vẽ chồng hai chuỗi chữ.** Nhãn xếp chồng phải mờ đi *rồi mới* hiện. `Kit.swap()` / `Kit.captions()` làm tuần tự. Chữ cố ý chồng nhau phải gắn `data-layout-allow-overlap="true"`.

3. **CSS transform ban đầu + GSAP tween cùng property = fail lint** (`gsap_css_transform_conflict`). Thanh segment tween `backgroundColor`; element chạy theo đường cong đặt vị trí trên wrapper.

4. **Gate contrast chặt hơn video gốc.** Video tham chiếu hay dùng xám 3.8–4.3:1 mà `hyperframes check` từ chối (cần 4.5:1). Đừng chống lại — nâng chữ lên và thể hiện "đã bị undo" bằng cách **làm tối nền card**.

5. **Không bao giờ viết chuỗi đóng thẻ script trong file được inline vào script tag** — kể cả trong comment. Compiler nhúng `kit/kit.js` vào một `<script>`, và HTML parser đóng thẻ ngay tại chuỗi đó, đổ toàn bộ phần còn lại của kit ra trang dưới dạng chữ. Triệu chứng: `Kit is not defined` + template literal hiện nguyên văn `${w}`.

Ngoài ra: nền full-screen đặt trên **element con** (`.hf-bg`), không đặt trên composition root — producer có thể bỏ background của chính root và render ra **đen** trong khi preview vẫn đúng.

---

## Hai video đã làm

| Project | Dài | Nội dung |
|---|---|---|
| `videos/sync-vs-async` | 9.33s / 280 frames | 2 lane, thanh 25 segment, tuần tự vs song song, chip 6.2s vs 2.8s |
| `videos/atomic-transactions` | 14.12s / 424 frames | 2 lane, arc diagram có dot chạy, COMMIT vs ROLLBACK, có rewind |

Cả hai viết tay trước khi có kit, nên vẫn inline CSS/JS riêng — chúng là tham chiếu thiết kế, không phải template.

---

## Mở lại Studio

```bash
cd videos/<name> && npm run dev      # http://localhost:3002 (tự nhảy port nếu bận)
```

Là server chạy dài, block terminal tới khi `Ctrl+C`. Trong Claude Code gõ `! npm run dev` để output vào thẳng conversation.

---

## Muốn đổi thứ hay đổi

| Muốn đổi | Sửa ở đâu |
|---|---|
| Màu / chữ / spacing của **mọi** video sau này | `kit/frame.md` + `kit/kit.css`, rồi `--sync` |
| Nội dung một video | khối `DATA` ở đầu `<script>` trong `index.html` của project |
| Độ dài video | `data-duration` trên `#root` — **đọc lúc compile**, script hay `--variables` sửa sau đều vô tác dụng |
