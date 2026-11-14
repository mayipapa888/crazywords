import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const header = ["序号", "单词", "音标", "词性", "中文释义", "例句", "相关词组", "近义词", "反义词"];
const samples = [
  header,
  [
    1,
    "abandon",
    "/əˈbændən/",
    "v.",
    "放弃；遗弃",
    "They had to abandon the project.",
    "abandon hope",
    "desert|forsake",
    "keep",
  ],
  [
    2,
    "benefit",
    "/ˈbenɪfɪt/",
    "n./v.",
    "益处；使受益",
    "Exercise can benefit your health.",
    "benefit from",
    "advantage",
    "harm",
  ],
];

const sheet = XLSX.utils.aoa_to_sheet(samples);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, sheet, "words");
const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

const targets = [
  path.join(root, "public", "templates", "words-import.xlsx"),
  path.join(root, "samples", "words.sample.xlsx"),
];

for (const t of targets) {
  fs.mkdirSync(path.dirname(t), { recursive: true });
  fs.writeFileSync(t, buf);
  console.log("wrote", t);
}
