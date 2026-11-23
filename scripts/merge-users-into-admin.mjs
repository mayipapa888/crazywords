/**
 * 把历史匿名用户（localhost:3000 时代产生的数据）全部合并到指定管理员账号名下。
 *
 * 用法：
 *   node --env-file=.env scripts/merge-users-into-admin.mjs rockyboy-ethan [--dry-run]
 *
 * 合并规则：
 * - WordList：改 userId（同名词表保留多个，不合并名称）
 * - Session：改 userId
 * - Attempt：随 Session 走
 * - KnowledgeNote / ListeningLog / PointSpend / BattleRecord：改 userId
 * - CardState：unique(userId, entryId)，冲突时保留目标用户已有记录，删掉重复的
 * - WrongBookItem：unique(userId, entryId)，冲突时累加 wrongCount、取最近 lastWrongAt
 * - Pet：unique(userId)，合并 EXP 与已发券，保留目标宠物
 * - 其余空壳匿名用户直接删除
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const targetUsername = process.argv[2];
const dryRun = process.argv.includes("--dry-run");

if (!targetUsername) {
  console.error("用法: node --env-file=.env scripts/merge-users-into-admin.mjs <用户名> [--dry-run]");
  process.exit(1);
}

const target = await p.user.findUnique({ where: { username: targetUsername } });
if (!target) {
  console.error(`找不到用户 ${targetUsername}`);
  process.exit(1);
}

const others = await p.user.findMany({ where: { id: { not: target.id } } });
console.log(`目标用户: ${target.username} (${target.id})`);
console.log(`待合并用户: ${others.length} 个${dryRun ? "（dry-run，不写入）" : ""}`);

let moved = {
  lists: 0,
  sessions: 0,
  notes: 0,
  listening: 0,
  spends: 0,
  battles: 0,
  cardsMoved: 0,
  cardsDropped: 0,
  wrongsMoved: 0,
  wrongsMerged: 0,
  petsMerged: 0,
};

for (const u of others) {
  const uid = u.id;
  const lists = await p.wordList.count({ where: { userId: uid } });
  const sessions = await p.session.count({ where: { userId: uid } });
  const notes = await p.knowledgeNote.count({ where: { userId: uid } });
  const listening = await p.listeningLog.count({ where: { userId: uid } });
  const spends = await p.pointSpend.count({ where: { userId: uid } });
  const battles = await p.battleRecord.count({ where: { userId: uid } });
  const cards = await p.cardState.findMany({ where: { userId: uid } });
  const wrongs = await p.wrongBookItem.findMany({ where: { userId: uid } });
  const pet = await p.pet.findUnique({ where: { userId: uid } });

  if (dryRun) {
    console.log(
      `- ${u.username ?? "(匿名)"} ${uid.slice(-6)}: 词表 ${lists}, 会话 ${sessions}, 笔记 ${notes}, 听力 ${listening}, 听力卡 ${cards.length}, 错词 ${wrongs.length}, 宠物 ${pet ? "有" : "无"}`,
    );
    continue;
  }

  await p.$transaction(async (tx) => {
    // 1) 直接改归属的表
    await tx.wordList.updateMany({ where: { userId: uid }, data: { userId: target.id } });
    await tx.session.updateMany({ where: { userId: uid }, data: { userId: target.id } });
    await tx.knowledgeNote.updateMany({ where: { userId: uid }, data: { userId: target.id } });
    await tx.pointSpend.updateMany({ where: { userId: uid }, data: { userId: target.id } });
    await tx.battleRecord.updateMany({ where: { userId: uid }, data: { userId: target.id } });

    // 2) ListeningLog unique(userId, date)：逐条累加
    for (const log of await tx.listeningLog.findMany({ where: { userId: uid } })) {
      const existing = await tx.listeningLog.findUnique({
        where: { userId_date: { userId: target.id, date: log.date } },
      });
      if (existing) {
        await tx.listeningLog.update({
          where: { id: existing.id },
          data: { seconds: existing.seconds + log.seconds },
        });
        await tx.listeningLog.delete({ where: { id: log.id } });
      } else {
        await tx.listeningLog.update({ where: { id: log.id }, data: { userId: target.id } });
      }
    }

    // 3) CardState unique(userId, entryId)
    for (const card of await tx.cardState.findMany({ where: { userId: uid } })) {
      const existing = await tx.cardState.findUnique({
        where: { userId_entryId: { userId: target.id, entryId: card.entryId } },
      });
      if (existing) {
        await tx.cardState.delete({ where: { id: card.id } });
      } else {
        await tx.cardState.update({ where: { id: card.id }, data: { userId: target.id } });
      }
    }

    // 4) WrongBookItem unique(userId, entryId)：合并计数
    for (const w of await tx.wrongBookItem.findMany({ where: { userId: uid } })) {
      const existing = await tx.wrongBookItem.findUnique({
        where: { userId_entryId: { userId: target.id, entryId: w.entryId } },
      });
      if (existing) {
        await tx.wrongBookItem.update({
          where: { id: existing.id },
          data: {
            wrongCount: existing.wrongCount + w.wrongCount,
            active: existing.active || w.active,
            lastWrongAt: w.lastWrongAt > existing.lastWrongAt ? w.lastWrongAt : existing.lastWrongAt,
          },
        });
        await tx.wrongBookItem.delete({ where: { id: w.id } });
      } else {
        await tx.wrongBookItem.update({ where: { id: w.id }, data: { userId: target.id } });
      }
    }

    // 5) Pet unique(userId)：合并经验与券
    if (pet) {
      const mine = await tx.pet.findUnique({ where: { userId: target.id } });
      if (!mine) {
        await tx.pet.update({ where: { id: pet.id }, data: { userId: target.id } });
      } else {
        await tx.pet.update({
          where: { id: mine.id },
          data: {
            exp: Math.max(mine.exp, pet.exp),
            tickets: Math.min(20, mine.tickets + pet.tickets),
            milestoneIssued: Math.max(mine.milestoneIssued, pet.milestoneIssued),
          },
        });
        await tx.pet.delete({ where: { id: pet.id } });
      }
    }

    // 6) 删掉这个空壳用户（数据已迁走）
    await tx.user.delete({ where: { id: uid } });
  });

  moved.lists += lists;
  moved.sessions += sessions;
  moved.notes += notes;
  moved.listening += listening;
  moved.spends += spends;
  moved.battles += battles;
  moved.cardsMoved += cards.length;
  moved.wrongsMoved += wrongs.length;
  if (pet) moved.petsMerged += 1;
}

if (!dryRun) {
  console.log("合并完成：", JSON.stringify(moved));
  const left = await p.user.count();
  console.log("剩余用户数:", left);
}

await p.$disconnect();
