import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const headers = ["word", "gloss_zh", "ipa", "pos", "example", "phrases", "related"];
const samples = [
  {
    word: "abandon",
    gloss_zh: "放弃；遗弃",
    ipa: "/əˈbændən/",
    pos: "v.",
    example: "They had to abandon the project.",
    phrases: "abandon hope",
    related: "desert|forsake",
  },
  {
    word: "benefit",
    gloss_zh: "益处；使受益",
    ipa: "/ˈbenɪfɪt/",
    pos: "n./v.",
    example: "Exercise can benefit your health.",
    phrases: "benefit from",
    related: "advantage",
  },
];

const sheet = XLSX.utils.json_to_sheet(samples, { header: headers });
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
