# CrazyWords

面向自学用户的英语背单词 Web MVP：导入自有词表 → 设定每日目标 → **强制麦克风**的一对一听写（释义拼写 + 可关闭的例句挖空）→ SRS / 错词本复习。辅线：语音查词。

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

## 实时听写

听写页使用**实时语音识别**（边说边显示）：

| 配置项（设置页） | 字段名 | 默认 |
|------------------|--------|------|
| 自动开始录音（进题后） | `autoStartRecordSeconds` | **10** |
| 自动提交（开录后） | `autoSubmitSeconds` | **15** |
| 自动下一词（反馈后） | `autoNextWordSeconds` | **30** |

- 识别文本自动提取拼写；发音判定用识别文本 vs 目标词
- 无麦克风仍阻断；需 localhost/HTTPS
- `SPEECH_PROVIDER=aliyun`：浏览器 WebSocket → 阿里云 **实时语音识别**（`SpeechTranscriber`）；`mock` 模拟流式出字
- 签发 Token：`POST /api/speech/nls-token`（需 `ASR_ACCESS_KEY_*` + `ASR_APP_KEY`，项目须开通实时识别）

### 本地验证实时听写

```bash
# 1) mock（无需密钥）
SPEECH_PROVIDER=mock npm run dev
# 打开 /dictation → 授权麦克风 → 开始听写 → 观察倒计时开录与实时文本

# 2) 阿里云
# .env 中 SPEECH_PROVIDER=aliyun，填 ASR_*，NLS 项目开通「实时语音识别」+ 英文模型
npm run dev
```

## 环境变量（语音相关）

| 变量 | 说明 |
|------|------|
| `SPEECH_PROVIDER` | `mock` / `aliyun` |
| `NLS_REGION` | 默认 `cn-shanghai` |
| `NLS_WS_URL` | 可选，默认 `wss://nls-gateway-{region}.aliyuncs.com/ws/v1` |
| `ASR_ACCESS_KEY_ID` / `ASR_ACCESS_KEY_SECRET` / `ASR_APP_KEY` | 实时识别 + 一句话 ASR |
| `TTS_*` | 语音合成 |

完整列表见 `.env.example`。**勿提交真实密钥。**

## 开通阿里云

1. [智能语音交互](https://www.aliyun.com/product/nls) → 创建项目拿 AppKey  
2. 开通 **实时语音识别**（听写）与语音合成；英文听写选英文模型  
3. AccessKey + `.env` 如上  

## 上海初中考纲 2026

见 `samples/shanghai-zhongkao-2026.csv` 与 `samples/SOURCES.md`。`npm run db:seed` 或导入页一键预设。

## 脚本

| 命令 | 作用 |
|------|------|
| `npm run dev` | 开发 |
| `npm run db:seed` | 种子 |
| `npm run gen:import-template` | 生成 Excel 模板 |
