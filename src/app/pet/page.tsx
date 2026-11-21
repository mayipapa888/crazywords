"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  EXP_SOURCES,
  MAX_DAILY_EXP,
  MAX_TICKETS,
  NAME_MAX_LENGTH,
  STAGES,
  sanitizePetName,
  stageName,
  type PetBreakdown,
} from "@/lib/pet/rules";

type PetPayload = {
  name: string;
  stage: number;
  stageName: string;
  exp: number;
  nextStageExp: number | null;
  progress: number;
  tickets: number;
  todayExp: number;
  todayBreakdown: PetBreakdown;
  maxStage: number;
};

/** 五个阶段的一句话描述（展示在宠物形象下方） */
const STAGE_LINES = [
  "还在蛋壳里酝酿，多听多写就能破壳。",
  "刚睁眼的小家伙，最喜欢听你读单词。",
  "已经能跟着你一起念，继续攒经验吧。",
  "羽翼渐丰，陪你把每天的学习变成习惯。",
  "传说中的学习搭子，满级后也继续发光。",
];

function isPetPayload(value: unknown): value is PetPayload {
  if (!value || typeof value !== "object") return false;
  const pet = value as Record<string, unknown>;
  const breakdown = pet.todayBreakdown;
  if (!breakdown || typeof breakdown !== "object") return false;
  const b = breakdown as Record<string, unknown>;
  return (
    typeof pet.name === "string" &&
    typeof pet.stage === "number" &&
    typeof pet.stageName === "string" &&
    typeof pet.exp === "number" &&
    (typeof pet.nextStageExp === "number" || pet.nextStageExp === null) &&
    typeof pet.progress === "number" &&
    typeof pet.tickets === "number" &&
    typeof pet.todayExp === "number" &&
    typeof pet.maxStage === "number" &&
    ["dictation", "listening", "checkin", "notes"].every((key) => typeof b[key] === "number")
  );
}

function extractPet(payload: unknown): PetPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const pet = (payload as { pet?: unknown }).pet;
  return isPetPayload(pet) ? pet : null;
}

function errorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const message = (payload as { error?: unknown }).error;
    if (typeof message === "string" && message.trim()) return message;
  }
  return `请求失败（HTTP ${status}）`;
}

/* -------------------------------------------------------------------------- */
/* 宠物形象：内联 SVG，五个阶段各一种形态                                       */
/* -------------------------------------------------------------------------- */

type ArtIds = { bodyId: string; goldId: string; glowId: string };

function EggStage({ bodyId, goldId, glowId }: ArtIds) {
  return (
    <g>
      <circle cx="100" cy="104" r="82" fill={`url(#${glowId})`} />
      <ellipse cx="100" cy="177" rx="42" ry="8" fill="#0f2f3d" opacity="0.08" />
      <path
        d="M100 30c27 0 48 32 48 63 0 29-21 47-48 47s-48-18-48-47c0-31 21-63 48-63Z"
        fill={`url(#${bodyId})`}
      />
      <path
        d="M100 30c-17 0-32 13-40 34 9-6 21-9 35-8 16 1 29 8 38 19-5-26-18-45-33-45Z"
        fill="#ffffff"
        fillOpacity="0.2"
      />
      <g fill="#ffffff" fillOpacity="0.38">
        <ellipse cx="78" cy="72" rx="8" ry="11" />
        <ellipse cx="124" cy="94" rx="6" ry="8" />
        <ellipse cx="90" cy="124" rx="10" ry="6" />
        <ellipse cx="116" cy="126" rx="4" ry="3" />
      </g>
      <path
        d="M68 88l9-6 8 9 9-8 6 8"
        stroke="#ffffff"
        strokeOpacity="0.8"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M104 120l8-5 7 8 7-5"
        stroke="#ffffff"
        strokeOpacity="0.55"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M150 52c.9 4.4 2.5 6 6.9 6.9-4.4.9-6 2.5-6.9 6.9-.9-4.4-2.5-6-6.9-6.9 4.4-.9 6-2.5 6.9-6.9Z"
        fill={`url(#${goldId})`}
        fillOpacity="0.9"
      />
      <circle cx="42" cy="66" r="2.4" fill="#a78bfa" fillOpacity="0.7" />
      <circle cx="162" cy="128" r="2" fill="#22d3ee" fillOpacity="0.8" />
    </g>
  );
}

function BabyStage({ bodyId, goldId, glowId }: ArtIds) {
  return (
    <g>
      <circle cx="100" cy="104" r="82" fill={`url(#${glowId})`} />
      <ellipse cx="100" cy="177" rx="40" ry="8" fill="#0f2f3d" opacity="0.08" />
      <path
        d="M138 142c16 0 24-10 21-21"
        stroke={`url(#${bodyId})`}
        strokeWidth="9"
        strokeLinecap="round"
      />
      <ellipse cx="82" cy="165" rx="15" ry="9" fill={`url(#${bodyId})`} />
      <ellipse cx="118" cy="165" rx="15" ry="9" fill={`url(#${bodyId})`} />
      <ellipse cx="100" cy="132" rx="39" ry="35" fill={`url(#${bodyId})`} />
      <ellipse cx="100" cy="138" rx="24" ry="22" fill="#ffffff" fillOpacity="0.2" />
      <path d="M72 60c-9-13-7-25 2-28 9-3 17 6 21 18Z" fill={`url(#${bodyId})`} />
      <path d="M128 60c9-13 7-25-2-28-9-3-17 6-21 18Z" fill={`url(#${bodyId})`} />
      <path d="M78 56c-4-8-3-15 2-17 5-1 9 4 11 11Z" fill="#ffffff" fillOpacity="0.32" />
      <path d="M122 56c4-8 3-15-2-17-5-1-9 4-11 11Z" fill="#ffffff" fillOpacity="0.32" />
      <circle cx="100" cy="80" r="34" fill={`url(#${bodyId})`} />
      <circle cx="87" cy="79" r="5.5" fill="#123243" />
      <circle cx="113" cy="79" r="5.5" fill="#123243" />
      <circle cx="88.6" cy="77" r="1.8" fill="#ffffff" />
      <circle cx="114.6" cy="77" r="1.8" fill="#ffffff" />
      <ellipse cx="78" cy="91" rx="5" ry="3" fill="#ff9e8a" fillOpacity="0.55" />
      <ellipse cx="122" cy="91" rx="5" ry="3" fill="#ff9e8a" fillOpacity="0.55" />
      <path d="M94 90c3 4 9 4 12 0" stroke="#123243" strokeWidth="2.2" strokeLinecap="round" />
      <path
        d="M100 46c-2-8 1-13 7-15"
        stroke={`url(#${bodyId})`}
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M158 58c.8 4 2.3 5.4 6.2 6.2-3.9.8-5.4 2.3-6.2 6.2-.8-3.9-2.3-5.4-6.2-6.2 3.9-.8 5.4-2.3 6.2-6.2Z"
        fill={`url(#${goldId})`}
        fillOpacity="0.9"
      />
      <circle cx="40" cy="96" r="2.2" fill="#22d3ee" fillOpacity="0.75" />
      <circle cx="166" cy="140" r="2.4" fill="#a78bfa" fillOpacity="0.7" />
    </g>
  );
}

function TeenStage({ bodyId, goldId, glowId }: ArtIds) {
  return (
    <g>
      <circle cx="100" cy="104" r="82" fill={`url(#${glowId})`} />
      <ellipse cx="100" cy="177" rx="42" ry="8" fill="#0f2f3d" opacity="0.08" />
      <path
        d="M136 150c18 2 26-8 24-20"
        stroke={`url(#${bodyId})`}
        strokeWidth="8"
        strokeLinecap="round"
      />
      <ellipse cx="64" cy="132" rx="10" ry="17" transform="rotate(18 64 132)" fill={`url(#${bodyId})`} />
      <ellipse cx="136" cy="132" rx="10" ry="17" transform="rotate(-18 136 132)" fill={`url(#${bodyId})`} />
      <path
        d="M100 100c22 0 36 20 36 46 0 17-14 26-36 26s-36-9-36-26c0-26 14-46 36-46Z"
        fill={`url(#${bodyId})`}
      />
      <ellipse cx="100" cy="140" rx="20" ry="24" fill="#ffffff" fillOpacity="0.16" />
      <path d="M78 58c-10-16-10-34-1-38 9-4 18 8 20 26Z" fill={`url(#${bodyId})`} />
      <path d="M122 58c10-16 10-34 1-38-9-4-18 8-20 26Z" fill={`url(#${bodyId})`} />
      <path d="M82 54c-5-10-5-20-1-22 4-2 8 4 9 13Z" fill="#ffffff" fillOpacity="0.32" />
      <path d="M118 54c5-10 5-20 1-22-4-2-8 4-9 13Z" fill="#ffffff" fillOpacity="0.32" />
      <circle cx="100" cy="80" r="30" fill={`url(#${bodyId})`} />
      <ellipse cx="88" cy="79" rx="4" ry="5" fill="#123243" />
      <ellipse cx="112" cy="79" rx="4" ry="5" fill="#123243" />
      <circle cx="89" cy="77" r="1.4" fill="#ffffff" />
      <circle cx="113" cy="77" r="1.4" fill="#ffffff" />
      <ellipse cx="79" cy="89" rx="4" ry="2.4" fill="#ff9e8a" fillOpacity="0.5" />
      <ellipse cx="121" cy="89" rx="4" ry="2.4" fill="#ff9e8a" fillOpacity="0.5" />
      <path d="M95 89c3 3 7 3 10 0" stroke="#123243" strokeWidth="2" strokeLinecap="round" />
      <path d="M70 100c10 8 50 8 60 0l-3 12c-14 7-40 7-54 0Z" fill={`url(#${goldId})`} />
      <path d="M124 111l10 19-12 3-5-17Z" fill={`url(#${goldId})`} />
      <path
        d="M100 118c.8 4 2.3 5.5 6.3 6.3-4 .8-5.5 2.3-6.3 6.3-.8-4-2.3-5.5-6.3-6.3 4-.8 5.5-2.3 6.3-6.3Z"
        fill="#ffffff"
        fillOpacity="0.85"
      />
      <circle cx="42" cy="64" r="2.2" fill="#22d3ee" fillOpacity="0.75" />
      <circle cx="162" cy="94" r="2.4" fill="#a78bfa" fillOpacity="0.7" />
      <circle cx="152" cy="40" r="1.8" fill="#fbbf24" fillOpacity="0.8" />
    </g>
  );
}

function AdultStage({ bodyId, goldId, glowId }: ArtIds) {
  return (
    <g>
      <circle cx="100" cy="104" r="82" fill={`url(#${glowId})`} />
      <ellipse cx="100" cy="180" rx="46" ry="8" fill="#0f2f3d" opacity="0.08" />
      <g opacity="0.85">
        <path d="M66 116C42 108 34 84 40 62c4 16 16 22 27 28 9 5 14 15 12 26Z" fill={`url(#${bodyId})`} />
        <path d="M134 116c24-8 32-32 26-54-4 16-16 22-27 28-9 5-14 15-12 26Z" fill={`url(#${bodyId})`} />
      </g>
      <path
        d="M132 152c20 0 30-12 28-26"
        stroke={`url(#${bodyId})`}
        strokeWidth="9"
        strokeLinecap="round"
      />
      <path d="M158 122c3 6 2 12-3 16" stroke={`url(#${goldId})`} strokeWidth="5" strokeLinecap="round" />
      <ellipse cx="82" cy="170" rx="15" ry="8" fill={`url(#${bodyId})`} />
      <ellipse cx="118" cy="170" rx="15" ry="8" fill={`url(#${bodyId})`} />
      <path
        d="M100 96c24 0 38 22 38 48 0 18-16 28-38 28s-38-10-38-28c0-26 14-48 38-48Z"
        fill={`url(#${bodyId})`}
      />
      <ellipse cx="100" cy="142" rx="22" ry="26" fill="#ffffff" fillOpacity="0.14" />
      <path d="M76 56c-6-10-6-18 0-20 6-2 12 5 14 14Z" fill={`url(#${bodyId})`} />
      <path d="M124 56c6-10 6-18 0-20-6-2-12 5-14 14Z" fill={`url(#${bodyId})`} />
      <circle cx="100" cy="76" r="30" fill={`url(#${bodyId})`} />
      <path d="M100 48l-6-18 12 6 6-14 4 18-8 8Z" fill={`url(#${goldId})`} />
      <ellipse cx="88" cy="76" rx="4" ry="5" fill="#123243" />
      <ellipse cx="112" cy="76" rx="4" ry="5" fill="#123243" />
      <circle cx="89" cy="74.5" r="1.4" fill="#ffffff" />
      <circle cx="113" cy="74.5" r="1.4" fill="#ffffff" />
      <path d="M82 67l10-2M118 67l-10-2" stroke="#123243" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M94 88c4 4 8 4 12 0" stroke="#123243" strokeWidth="2.2" strokeLinecap="round" />
      <path
        d="M100 124c.8 4 2.4 5.6 6.4 6.4-4 .8-5.6 2.4-6.4 6.4-.8-4-2.4-5.6-6.4-6.4 4-.8 5.6-2.4 6.4-6.4Z"
        fill={`url(#${goldId})`}
      />
      <path
        d="M158 58c.8 4 2.3 5.4 6.2 6.2-3.9.8-5.4 2.3-6.2 6.2-.8-3.9-2.3-5.4-6.2-6.2 3.9-.8 5.4-2.3 6.2-6.2Z"
        fill={`url(#${goldId})`}
        fillOpacity="0.9"
      />
      <circle cx="38" cy="98" r="2.2" fill="#22d3ee" fillOpacity="0.75" />
      <circle cx="166" cy="146" r="2.4" fill="#a78bfa" fillOpacity="0.7" />
    </g>
  );
}

function LegendStage({ bodyId, goldId, glowId }: ArtIds) {
  return (
    <g>
      <circle cx="100" cy="108" r="88" fill={`url(#${glowId})`} />
      <circle
        cx="100"
        cy="108"
        r="82"
        stroke={`url(#${goldId})`}
        strokeOpacity="0.4"
        strokeWidth="1.5"
        strokeDasharray="3 8"
      />
      <ellipse cx="100" cy="181" rx="48" ry="8" fill="#0f2f3d" opacity="0.08" />
      <path
        d="M64 120C36 112 26 84 34 58c6 18 18 24 30 30 12 6 18 18 16 30Z"
        fill={`url(#${goldId})`}
        fillOpacity="0.5"
      />
      <path
        d="M136 120c28-8 38-36 30-62-6 18-18 24-30 30-12 6-18 18-16 30Z"
        fill={`url(#${goldId})`}
        fillOpacity="0.5"
      />
      <ellipse cx="100" cy="34" rx="26" ry="7" stroke={`url(#${goldId})`} strokeWidth="3" />
      <path
        d="M134 155c22 2 32-12 28-28"
        stroke={`url(#${bodyId})`}
        strokeWidth="9"
        strokeLinecap="round"
      />
      <path d="M160 126l6-6M164 135l8-2" stroke={`url(#${goldId})`} strokeWidth="3" strokeLinecap="round" />
      <ellipse cx="82" cy="172" rx="15" ry="8" fill={`url(#${bodyId})`} />
      <ellipse cx="118" cy="172" rx="15" ry="8" fill={`url(#${bodyId})`} />
      <path
        d="M100 98c25 0 39 22 39 48 0 18-16 28-39 28s-39-10-39-28c0-26 14-48 39-48Z"
        fill={`url(#${goldId})`}
      />
      <circle cx="100" cy="78" r="30" fill={`url(#${goldId})`} />
      <path
        d="M76 60l4-22 10 12 10-18 10 18 10-12 4 22Z"
        fill="#fbbf24"
        stroke="#ffffff"
        strokeOpacity="0.65"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="100" cy="34" r="3.2" fill="#ffffff" />
      <path d="M82 78c3-4 8-4 11 0M107 78c3-4 8-4 11 0" stroke="#3b2a20" strokeWidth="2.6" strokeLinecap="round" />
      <ellipse cx="78" cy="88" rx="4.5" ry="2.6" fill="#ff9e8a" fillOpacity="0.5" />
      <ellipse cx="122" cy="88" rx="4.5" ry="2.6" fill="#ff9e8a" fillOpacity="0.5" />
      <path d="M94 88c4 4 8 4 12 0" stroke="#3b2a20" strokeWidth="2.2" strokeLinecap="round" />
      <path
        d="M100 126c1 5 3 7 8 8-5 1-7 3-8 8-1-5-3-7-8-8 5-1 7-3 8-8Z"
        fill="#ffffff"
        fillOpacity="0.9"
      />
      <path
        d="M44 52c.7 3.4 2 4.7 5.4 5.4-3.4.7-4.7 2-5.4 5.4-.7-3.4-2-4.7-5.4-5.4 3.4-.7 4.7-2 5.4-5.4Z"
        fill={`url(#${goldId})`}
      />
      <path
        d="M158 62c.7 3.4 2 4.7 5.4 5.4-3.4.7-4.7 2-5.4 5.4-.7-3.4-2-4.7-5.4-5.4 3.4-.7 4.7-2 5.4-5.4Z"
        fill={`url(#${goldId})`}
        fillOpacity="0.85"
      />
      <circle cx="160" cy="150" r="2.4" fill="#fbbf24" fillOpacity="0.9" />
      <circle cx="36" cy="116" r="2" fill="#22d3ee" fillOpacity="0.8" />
    </g>
  );
}

function PetArt({ stage }: { stage: number }) {
  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  const bodyId = `pet-body-${uid}`;
  const goldId = `pet-gold-${uid}`;
  const glowId = `pet-glow-${uid}`;
  const ids = { bodyId, goldId, glowId };

  return (
    <svg
      viewBox="0 0 200 200"
      className="h-40 w-auto anim-float"
      role="img"
      aria-label={`宠物形态：${stageName(stage)}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={bodyId} x1="46" y1="182" x2="154" y2="26" gradientUnits="userSpaceOnUse">
          <stop stopColor="#22d3ee" />
          <stop offset="0.55" stopColor="#6366f1" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
        <linearGradient id={goldId} x1="58" y1="150" x2="150" y2="38" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fde68a" />
          <stop offset="0.5" stopColor="#fbbf24" />
          <stop offset="1" stopColor="#f2743a" />
        </linearGradient>
        <radialGradient id={glowId} cx="100" cy="104" r="86" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8b5cf6" stopOpacity="0.26" />
          <stop offset="0.6" stopColor="#22d3ee" stopOpacity="0.1" />
          <stop offset="1" stopColor="#22d3ee" stopOpacity="0" />
        </radialGradient>
      </defs>
      {stage <= 1 && <EggStage {...ids} />}
      {stage === 2 && <BabyStage {...ids} />}
      {stage === 3 && <TeenStage {...ids} />}
      {stage === 4 && <AdultStage {...ids} />}
      {stage >= 5 && <LegendStage {...ids} />}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* 页面                                                                        */
/* -------------------------------------------------------------------------- */

export default function PetPage() {
  const [pet, setPet] = useState<PetPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);

  const requestRef = useRef<AbortController | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/pet", { signal: controller.signal, cache: "no-store" });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) throw new Error(errorMessage(payload, res.status));

      const next = extractPet(payload);
      if (!next) throw new Error("返回数据格式异常");
      setPet(next);
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : "网络异常，请稍后重试");
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [load]);

  useEffect(() => {
    if (renaming) nameInputRef.current?.focus();
  }, [renaming]);

  const startRename = () => {
    if (!pet) return;
    setDraftName(pet.name);
    setRenameError(null);
    setRenaming(true);
  };

  const cancelRename = () => {
    setRenaming(false);
    setRenameError(null);
  };

  const submitRename = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = sanitizePetName(draftName);
    if (!parsed.ok) {
      setRenameError(parsed.error);
      return;
    }

    setSavingName(true);
    setRenameError(null);
    try {
      const res = await fetch("/api/pet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename", name: parsed.value }),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) throw new Error(errorMessage(payload, res.status));

      const next = extractPet(payload);
      if (!next) throw new Error("返回数据格式异常");
      setPet(next);
      setRenaming(false);
    } catch (e) {
      setRenameError(e instanceof Error ? e.message : "改名失败，请稍后重试");
    } finally {
      setSavingName(false);
    }
  };

  if (!pet) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        <section className="panel flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 py-6 text-sm text-[var(--muted)]">
          {error ? (
            <>
              <p className="text-[var(--danger)]">加载失败：{error}</p>
              <button type="button" className="btn-secondary" onClick={() => void load()}>
                重试
              </button>
            </>
          ) : (
            <p>{loading ? "正在唤醒小星…" : "暂无宠物数据"}</p>
          )}
        </section>
      </div>
    );
  }

  const expCap = pet.nextStageExp ?? STAGES[STAGES.length - 1].minExp;
  const percent = Math.round(Math.min(1, Math.max(0, pet.progress)) * 100);
  const nextStageName = pet.nextStageExp === null ? null : (STAGES[pet.stage]?.name ?? null);
  const line = STAGE_LINES[pet.stage - 1] ?? STAGE_LINES[0];

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* 顶部：名字 / 阶段 / EXP / 进度 / 吃鸡券 */}
      <section className="panel shrink-0 px-4 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="font-display text-xl text-[var(--ink)]">宠物</h1>

            {renaming ? (
              <form onSubmit={submitRename} className="flex min-w-0 flex-wrap items-center gap-1.5">
                <input
                  ref={nameInputRef}
                  value={draftName}
                  onChange={(event) => {
                    setDraftName(event.target.value);
                    setRenameError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") cancelRename();
                  }}
                  className="field w-36 px-2 py-1 text-sm"
                  aria-label="宠物名字"
                  placeholder="最多 12 个字"
                />
                <button
                  type="submit"
                  className="btn-primary px-2.5 py-1 text-xs"
                  disabled={savingName}
                >
                  {savingName ? "保存中…" : "保存"}
                </button>
                <button
                  type="button"
                  className="btn-secondary px-2.5 py-1 text-xs"
                  onClick={cancelRename}
                  disabled={savingName}
                >
                  取消
                </button>
                <span className="text-[10px] tabular-nums text-[var(--muted)]">
                  {Array.from(draftName).length}/{NAME_MAX_LENGTH}
                </span>
                {renameError && <span className="text-[11px] text-[var(--danger)]">{renameError}</span>}
              </form>
            ) : (
              <button
                type="button"
                onClick={startRename}
                className="group flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-[var(--chip)]"
                title="点击改名"
                aria-label={`修改宠物名字，当前为${pet.name}`}
              >
                <span className="truncate font-display text-xl text-[var(--ink)]">{pet.name}</span>
                <svg
                  viewBox="0 0 24 24"
                  className="h-3.5 w-3.5 shrink-0 text-[var(--muted)] group-hover:text-[var(--teal)]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
                  <path d="M13.5 6.5l3 3" />
                </svg>
                <span className="text-[10px] text-[var(--muted)] group-hover:text-[var(--teal)]">
                  改名
                </span>
              </button>
            )}

            <span
              className="badge"
              style={{ background: "var(--teal-soft)", color: "var(--teal)" }}
            >
              Lv.{pet.stage} · {pet.stageName}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <span className="badge badge-warn">今日 +{pet.todayExp} EXP</span>
            <span className="flex items-center gap-1.5 text-xs">
              <span className="badge badge-warn">🎫 吃鸡券</span>
              <span className="font-display text-sm tabular-nums text-[var(--accent)]">
                {pet.tickets}
              </span>
              <span className="text-[11px] text-[var(--muted)]">/ {MAX_TICKETS}</span>
            </span>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-3">
          <span className="shrink-0 font-display text-xs tabular-nums text-[var(--ink)]">
            EXP {pet.exp} / {expCap}
          </span>
          <div
            role="progressbar"
            aria-label="阶段经验进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--chip)]"
          >
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{
                width: `${percent}%`,
                background: "linear-gradient(90deg, var(--teal), var(--accent))",
              }}
            />
          </div>
          <span className="shrink-0 text-[11px] text-[var(--muted)]">
            {pet.nextStageExp === null
              ? "已满级"
              : `距${nextStageName ?? "下一阶段"}还差 ${Math.max(0, pet.nextStageExp - pet.exp)}`}
          </span>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px]">
          {STAGES.map((item) => {
            const active = pet.stage === item.stage;
            const reached = pet.stage >= item.stage;
            return (
              <span
                key={item.stage}
                className={`rounded px-1.5 py-0.5 ${
                  active
                    ? "bg-[var(--ink)] text-[var(--paper)]"
                    : reached
                      ? "bg-[var(--teal-soft)] text-[var(--teal)]"
                      : "bg-[var(--chip)] text-[var(--muted)]"
                }`}
              >
                {item.name} {item.minExp}
              </span>
            );
          })}
        </div>
      </section>

      {/* 中间：宠物形象 */}
      <section className="panel relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden px-4 py-2">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(340px 200px at 50% 44%, var(--glow-a), transparent 72%)",
          }}
        />
        <PetArt stage={pet.stage} />
        <p className="relative mt-0.5 max-w-md text-center text-[11px] leading-relaxed text-[var(--muted)]">
          {line}
        </p>
      </section>

      {/* 今日经验明细 + 规则 */}
      <section className="panel shrink-0 px-4 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <h2 className="text-sm font-medium text-[var(--ink)]">
            今日经验 <span className="text-[var(--accent)]">+{pet.todayExp}</span>
          </h2>
          <span className="text-[10px] text-[var(--muted)]">
            每日上限合计 {MAX_DAILY_EXP} EXP · 每天按 Asia/Shanghai 重置
          </span>
        </div>

        <div className="mt-1.5 grid grid-cols-4 gap-1.5">
          {EXP_SOURCES.map((source) => (
            <div
              key={source.key}
              className="min-w-0 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 py-1.5"
            >
              <div className="flex items-center justify-between gap-1 text-[11px] text-[var(--muted)]">
                <span className="truncate">
                  {source.icon} {source.label}
                </span>
                <span className="shrink-0 text-[10px]">/{source.dailyCap}</span>
              </div>
              <p className="mt-0.5 font-display text-base leading-none tabular-nums text-[var(--ink)]">
                +{pet.todayBreakdown[source.key]}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--muted)]">
          {EXP_SOURCES.map(
            (source) => `${source.detail} +${source.exp}（上限 ${source.dailyCap}）`,
          ).join(" · ")}
        </p>
      </section>

      {/* 底部：游戏入口 */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
          <span className="badge badge-warn">测试模式 · 不限次数</span>
          <span>吃鸡券照常累计：每次升阶 +1，最多 {MAX_TICKETS} 张</span>
        </div>
        <Link href="/battle" className="btn-accent px-5">
          去玩吃鸡
        </Link>
      </div>
    </div>
  );
}
