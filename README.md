# InsightShield — Starter Repo (4-person team)

ระบบ AI จับคู่แผนประกันภัยสำหรับ WeBank Wealth+ · React + Node (TypeScript) · หน่วยเงิน **CNY (¥)**

โปรเจกต์นี้รันได้ตั้งแต่วันแรก: ทุก Engine มีเวอร์ชันพื้นฐานที่ทำงานจริงแล้ว แต่ละคนเข้าไปพัฒนาส่วนของตัวเองต่อได้เลย โดยไม่ต้องรอใคร

## เริ่มต้น

```bash
npm install          # ติดตั้งครั้งเดียวที่ root
npm run dev:server   # API ที่ http://localhost:4000
npm run dev:web      # หน้าเว็บที่ http://localhost:5173
npm test             # contract tests — ต้องผ่านก่อน merge ทุกครั้ง
npm run sandbox      # รันลูกค้าจำลอง 5 เคส -> logs/sandbox-run-*.json (หลักฐานข้อ 6)
npm run typecheck    # เช็ก type ทั้งโปรเจกต์
```

Frontend ทำงานแบบไม่มี backend ได้: `npm run dev:mock -w frontend`

## ใครทำอะไร

| คน | ส่วน | โฟลเดอร์ของตัวเอง (แก้ได้คนเดียว) |
| --- | --- | --- |
| **A** | Frontend ทั้งหมด | `frontend/` |
| **B** | Engine 1 — Concern Translation (+ LLM) | `server/src/engines/concern/` |
| **C** | Engine 2 Underwriting + Engine 3 Scoring/XAI | `server/src/engines/underwriting/`, `server/src/engines/scoring/` |
| **D** | API, pipeline, binding, audit, sandbox, รวมงาน | `server/src/index.ts`, `server/src/api/`, `server/src/pipeline.ts`, `server/src/binding/`, `server/src/audit/`, `server/scripts/` |
| ทุกคน (ต้องตกลงกัน) | สัญญากลาง | `shared/` |

## โครงสร้าง

```
shared/src/
  types.ts        <- รูปแบบข้อมูลที่ส่งหากัน (สัญญากลาง)
  contracts.ts    <- ลายเซ็นฟังก์ชันของแต่ละ Engine + endpoints
  catalog.ts      <- 4 ผลิตภัณฑ์ (CNY) = ขอบเขตวงเงิน
  mocks.ts        <- ข้อมูลปลอม + ลูกค้าจำลอง 5 เคส
server/src/
  engines/concern/       (B)
  engines/underwriting/  (C)
  engines/scoring/       (C)
  pipeline.ts, index.ts, api/, binding/, audit/   (D)
server/tests/contract.test.ts   <- ทุกคนเพิ่มเทสของตัวเอง
server/scripts/sandbox.ts       <- สร้าง log หลักฐาน
frontend/src/            (A)
```

## Data flow

`CustomerProfile` → **Engine 1** `translateConcern()` → `ConcernResult` → **Engine 2** `prescreen()` → `UnderwritingResult[]` → **Engine 3** `score()` → `ScoredProduct[]` → `RecommendationResponse` → app → `POST /bind` → `BindResult` · ทุกขั้นถูกบันทึกลง audit ledger (hash chain)

## TODO แต่ละคน (สัปดาห์แรก)

- **A:** ปรับ UI ให้เหมือนต้นแบบ, เพิ่มหน้า consent (PIPL 3 ขั้น), หน้า audit log, เปลี่ยนภาษาใน `i18n.ts` ถ้าจะทำจีน
- **B:** เพิ่ม `llm.ts` เรียก LLM แบบ JSON schema เมื่อมี `concernText`, ตัด PII ก่อนส่ง, ใช้ rules เดิมเป็น fallback
- **C:** ปรับเรตเบี้ยและน้ำหนักให้สมจริง (ตอนนี้คะแนนแต่ละแผนยังใกล้กันเกินไป), เพิ่มเทสกรณีขอบ
- **D:** เพิ่ม endpoint Q&A กรมธรรม์, เก็บ session ลง DB (ตอนนี้อยู่ใน memory), deploy, ดูแล CI
