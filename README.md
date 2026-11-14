# CrazyWords

面向自学用户的英语背单词 Web MVP：导入自有词表 → 设定每日目标 → **强制麦克风**的一对一听写（双模式）→ SRS / 错词本复习。辅线：语音查词。

> 产品方案 SSOT：Agent Store `docs/crazywords-product-plan.md`。

## 本地启动

```bash
npm install
cp .env.example .env
npx prisma migrate deploy
npm run gen:import-template   # 可选：重新生成 Excel 模板
npm run db:seed               # 可选
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)（听写需 **HTTPS 或 localhost** + 麦克风）。

## 导入列顺序（固定）

| 列序 | 字段 | 规则 |
|------|------|------|
| 1 | 序号 | **不导入** |
| 2 | 单词 | 必填 |
| 3 | 音标 | 可选 |
| 4 | 词性 | 可选 |
| 5 | 中文释义 | 可选 |
| 6 | 例句 | 可选 |
| 7 | 相关词组 | `\|` 分隔 → phrases |
| 8 | 近义词 | → related，前缀 `近:` |
| 9 | 反义词 | → related，前缀 `反:` |

- **首行表头不导入**
- 同词**覆盖**
- 模板：导入页「下载 Excel 模板」或 `samples/words.sample.xlsx` / `public/templates/words-import.xlsx`
- 样例 CSV：`samples/words.sample.csv`

## 听写双模式

| 模式 | 流程 | 判定 |
|------|------|------|
| **A** 报中文 → 写/念单词（`gloss`） | TTS 播中文释义 → **播报结束后**再计时开录 → 实时 ASR 显示在上半区 | 下半区：提取拼写 vs 目标词；读音 vs 识别文本 |
| **B** 报单词 → 说中文（`meaning`） | TTS/展示英文词 → 播报后直接开录 → 实时 ASR | 提取中文关键字 vs `gloss_zh` |

- 设置项 `clozeEnabled`：**启用模式 B**（关闭则仅模式 A）；队列中与 A 交替
- 点「说完了」立即停表并判定；否则按 `autoSubmitSeconds` 自动提交
- 上半实时文本、下半判定分区
- 无麦克风仍阻断；需 localhost/HTTPS

## 实时听写配置

| 配置项（设置页） | 字段名 | 默认 |
|------------------|--------|------|
| 自动开始录音（模式 A：TTS 结束后） | `autoStartRecordSeconds` | **10** |
| 自动提交（开录后） | `autoSubmitSeconds` | **15** |
| 自动下一词（反馈后） | `autoNextWordSeconds` | **30** |

### 阿里云 ASR + TTS（生产）

`SPEECH_PROVIDER=aliyun` 时：

| 能力 | 实现 | 必填 |
|------|------|------|
| 听写实时识别 | 浏览器 WebSocket → NLS **SpeechTranscriber**（`POST /api/speech/nls-token` 签发 Token） | `ASR_ACCESS_KEY_ID` / `ASR_ACCESS_KEY_SECRET` / `ASR_APP_KEY`，`NLS_REGION` |
| 题目播报 | 服务端阿里云 **语音合成** REST → 返回 `audioBase64` 播放（**不用**浏览器 SpeechSynthesis） | `TTS_ACCESS_KEY_ID` / `TTS_ACCESS_KEY_SECRET` / `TTS_APP_KEY`（可与 ASR_* 填相同；TTS_* 空时回退读 ASR_*） |

- 缺密钥或调用失败 → **明确报错**，不会静默改走 mock  
- mock **仅**当 `SPEECH_PROVIDER=mock`（本地开发）  
- 项目须开通：**实时语音识别** + **语音合成**；模式 A 建议英文识别模型，模式 B 需中文识别  

状态自检：`GET /api/speech/status`（不返回密钥）。

### 本地验证

```bash
# A) mock（无需密钥）
SPEECH_PROVIDER=mock npm run dev
# /dictation：TTS 用浏览器顶替；ASR 模拟边说边出字

# B) 阿里云（自备密钥，勿提交仓库）
# .env:
#   SPEECH_PROVIDER=aliyun
#   NLS_REGION=cn-shanghai
#   ASR_ACCESS_KEY_ID=...  ASR_ACCESS_KEY_SECRET=...  ASR_APP_KEY=...
#   TTS_ACCESS_KEY_ID=...  TTS_ACCESS_KEY_SECRET=...  TTS_APP_KEY=...  # 可与 ASR 相同
npm run dev
# 故意留空密钥应看到 502 / 页面错误提示，而不是 mock
# /dictation：播报为阿里云音频；开录后浏览器连 wss://nls-gateway-*.aliyuncs.com/ws/v1
```

## 环境变量（语音相关）

| 变量 | 必填（aliyun） | 说明 |
|------|----------------|------|
| `SPEECH_PROVIDER` | 是（`aliyun`） | `mock` 仅本地 |
| `NLS_REGION` | 建议 | 默认 `cn-shanghai` |
| `NLS_WS_URL` | 否 | 默认 `wss://nls-gateway-{region}.aliyuncs.com/ws/v1` |
| `ASR_ACCESS_KEY_ID` / `ASR_ACCESS_KEY_SECRET` / `ASR_APP_KEY` | 是 | 实时识别 Token + 一句话 ASR |
| `TTS_ACCESS_KEY_ID` / `TTS_ACCESS_KEY_SECRET` / `TTS_APP_KEY` | 是* | 语音合成；*可与 ASR_* 相同，空则回退 ASR_* |
| `TTS_VOICE` / `TTS_VOICE_EN` | 否 | 中/英发音人 |

完整列表见 `.env.example`。**勿提交真实密钥。**

## 开通阿里云

1. [智能语音交互](https://www.aliyun.com/product/nls) → 创建项目拿 AppKey  
2. 开通 **实时语音识别** 与 **语音合成**；英文听写选英文模型  
3. 将 AccessKey / AppKey 写入本地 `.env`（`SPEECH_PROVIDER=aliyun`），勿提交仓库  

## 上海初中考纲 2026

见 `samples/shanghai-zhongkao-2026.csv` 与 `samples/SOURCES.md`。`npm run db:seed` 或导入页一键预设。

## 脚本

| 命令 | 作用 |
|------|------|
| `npm run dev` | 开发 |
| `npm run db:seed` | 种子 |
| `npm run gen:import-template` | 生成 Excel 模板 |
