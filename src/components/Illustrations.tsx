"use client";

import { useId } from "react";

export type IllustrationProps = {
  /** 尺寸 / 透明度 / 动画由调用方通过 className 控制（如 h-20 w-auto opacity-80） */
  className?: string;
};

/** 每个实例生成唯一渐变 id，避免同页复用（如多个 SparkArt）时 <defs> 冲突 */
function useArtId(prefix: string): string {
  const reactId = useId();
  return `${prefix}${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

const FONT_STACK = "'Microsoft YaHei', 'PingFang SC', 'Segoe UI', sans-serif";

/** 首页横幅：声波 + 字母 + 星点，紫青渐变，纯装饰 */
export function HeroArt({ className }: IllustrationProps) {
  const uid = useArtId("heroArt");
  const wave = `${uid}Wave`;
  const letters = `${uid}Letters`;
  const bars = `${uid}Bars`;
  const halo = `${uid}Halo`;

  return (
    <svg
      viewBox="0 0 360 240"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={wave} x1="28" y1="208" x2="334" y2="36" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8B5CF6" />
          <stop offset="0.55" stopColor="#6366F1" />
          <stop offset="1" stopColor="#22D3EE" />
        </linearGradient>
        <linearGradient id={letters} x1="118" y1="180" x2="300" y2="70" gradientUnits="userSpaceOnUse">
          <stop stopColor="#A78BFA" />
          <stop offset="0.5" stopColor="#818CF8" />
          <stop offset="1" stopColor="#67E8F9" />
        </linearGradient>
        <linearGradient id={bars} x1="34" y1="204" x2="112" y2="118" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#22D3EE" />
        </linearGradient>
        <radialGradient id={halo} cx="196" cy="118" r="112" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8B5CF6" stopOpacity="0.42" />
          <stop offset="0.65" stopColor="#6366F1" stopOpacity="0.12" />
          <stop offset="1" stopColor="#22D3EE" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="196" cy="118" r="112" fill={`url(#${halo})`} />
      <ellipse
        cx="196"
        cy="118"
        rx="154"
        ry="92"
        stroke={`url(#${wave})`}
        strokeOpacity="0.22"
        strokeWidth="1.5"
        strokeDasharray="3 9"
      />

      <g fill={`url(#${bars})`}>
        <rect x="34" y="164" width="9" height="36" rx="4.5" opacity="0.55" />
        <rect x="50" y="144" width="9" height="56" rx="4.5" opacity="0.7" />
        <rect x="66" y="124" width="9" height="76" rx="4.5" opacity="0.85" />
        <rect x="82" y="150" width="9" height="50" rx="4.5" opacity="0.7" />
        <rect x="98" y="136" width="9" height="64" rx="4.5" opacity="0.8" />
      </g>

      <text
        x="118"
        y="172"
        fill={`url(#${letters})`}
        fontFamily={FONT_STACK}
        fontSize="112"
        fontWeight="800"
        letterSpacing="-8"
      >
        Aa
      </text>

      <g fill="none" stroke={`url(#${wave})`} strokeLinecap="round">
        <path d="M292 84a52 52 0 0 1 0 68" strokeWidth="3" strokeOpacity="0.9" />
        <path d="M292 62a78 78 0 0 1 0 112" strokeWidth="2.5" strokeOpacity="0.6" />
        <path d="M292 40a104 104 0 0 1 0 156" strokeWidth="2" strokeOpacity="0.35" />
      </g>

      <path
        d="M74 54c1.8 8.7 5 11.9 13.7 13.7C79 69.5 75.8 72.7 74 81.4 72.2 72.7 69 69.5 60.3 67.7 69 65.9 72.2 62.7 74 54Z"
        fill={`url(#${letters})`}
        fillOpacity="0.9"
      />
      <path
        d="M318 178c0.9 4.4 2.5 6 6.9 6.9-4.4 0.9-6 2.5-6.9 6.9-0.9-4.4-2.5-6-6.9-6.9 4.4-0.9 6-2.5 6.9-6.9Z"
        fill="#A5F3FC"
        fillOpacity="0.85"
      />
      <circle cx="248" cy="38" r="2.4" fill="#67E8F9" fillOpacity="0.7" />
      <circle cx="330" cy="126" r="2" fill="#A78BFA" fillOpacity="0.8" />
      <circle cx="126" cy="30" r="1.8" fill="#67E8F9" fillOpacity="0.5" />

      <path
        d="M24 224c26-16 48 10 74-2s48-24 74-8 48 18 74 2"
        stroke={`url(#${wave})`}
        strokeOpacity="0.45"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 磨耳朵 / 听写：耳机 + 音符 + 声波，纯装饰 */
export function HeadphonesArt({ className }: IllustrationProps) {
  const uid = useArtId("headphonesArt");
  const grad = `${uid}Grad`;
  const halo = `${uid}Halo`;

  return (
    <svg
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={grad} x1="30" y1="172" x2="172" y2="34" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8B5CF6" />
          <stop offset="0.55" stopColor="#6366F1" />
          <stop offset="1" stopColor="#22D3EE" />
        </linearGradient>
        <radialGradient id={halo} cx="100" cy="104" r="88" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8B5CF6" stopOpacity="0.22" />
          <stop offset="1" stopColor="#22D3EE" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="100" cy="104" r="88" fill={`url(#${halo})`} />

      <path
        d="M40 120v-8a60 60 0 0 1 120 0v8"
        stroke={`url(#${grad})`}
        strokeWidth="9"
        strokeLinecap="round"
      />
      <rect x="24" y="108" width="34" height="58" rx="17" fill={`url(#${grad})`} />
      <rect x="142" y="108" width="34" height="58" rx="17" fill={`url(#${grad})`} />
      <rect x="34" y="120" width="13" height="34" rx="6.5" fill="#FFFFFF" fillOpacity="0.28" />
      <rect x="152" y="120" width="13" height="34" rx="6.5" fill="#FFFFFF" fillOpacity="0.28" />

      <g stroke={`url(#${grad})`} strokeLinecap="round">
        <path d="M182 98a12 12 0 0 1 0 24" strokeWidth="3.5" strokeOpacity="0.85" />
        <path d="M190 86a24 24 0 0 1 0 48" strokeWidth="2.5" strokeOpacity="0.4" />
      </g>

      <g fill={`url(#${grad})`}>
        <ellipse cx="146" cy="52" rx="8" ry="6" transform="rotate(-20 146 52)" />
        <rect x="151" y="26" width="4" height="26" rx="2" />
      </g>
      <path
        d="M155 26c8 2 12 7 12 13"
        stroke={`url(#${grad})`}
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M62 40c0.9 4.4 2.5 6 6.9 6.9-4.4 0.9-6 2.5-6.9 6.9-0.9-4.4-2.5-6-6.9-6.9 4.4-0.9 6-2.5 6.9-6.9Z"
        fill="#67E8F9"
        fillOpacity="0.8"
      />
      <circle cx="36" cy="78" r="2.2" fill="#A78BFA" fillOpacity="0.75" />
      <circle cx="170" cy="166" r="2.4" fill="#67E8F9" fillOpacity="0.7" />
    </svg>
  );
}

/** 词库 / 单词本空状态：翻开的书 + 悬浮词卡，纯装饰 */
export function BookArt({ className }: IllustrationProps) {
  const uid = useArtId("bookArt");
  const grad = `${uid}Grad`;
  const halo = `${uid}Halo`;

  return (
    <svg
      viewBox="0 0 200 160"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={grad} x1="30" y1="132" x2="176" y2="20" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8B5CF6" />
          <stop offset="0.55" stopColor="#6366F1" />
          <stop offset="1" stopColor="#22D3EE" />
        </linearGradient>
        <radialGradient id={halo} cx="100" cy="88" r="76" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8B5CF6" stopOpacity="0.18" />
          <stop offset="1" stopColor="#22D3EE" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="100" cy="88" r="76" fill={`url(#${halo})`} />
      <ellipse cx="100" cy="130" rx="62" ry="8" fill={`url(#${grad})`} fillOpacity="0.12" />

      <path
        d="M100 54C82 42 58 40 32 48v68c26-8 50-6 68 6 18-12 42-14 68-6V48c-26-8-50-6-68 6Z"
        fill="#FFFFFF"
        fillOpacity="0.6"
        stroke={`url(#${grad})`}
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path d="M100 54v68" stroke={`url(#${grad})`} strokeWidth="3" strokeLinecap="round" />
      <g stroke={`url(#${grad})`} strokeOpacity="0.45" strokeWidth="2.5" strokeLinecap="round">
        <path d="M46 64c12-3 26-2 38 4M46 78c12-3 26-2 38 4M46 92c12-3 26-2 38 4" />
        <path d="M116 68c12-6 26-7 38-4M116 82c12-6 26-7 38-4" />
      </g>

      <g transform="rotate(7 150 30)">
        <rect
          x="118"
          y="8"
          width="66"
          height="44"
          rx="9"
          fill="#FFFFFF"
          stroke={`url(#${grad})`}
          strokeWidth="2.5"
        />
        <text
          x="128"
          y="39"
          fill={`url(#${grad})`}
          fontFamily={FONT_STACK}
          fontSize="24"
          fontWeight="700"
        >
          A
        </text>
        <rect x="149" y="22" width="25" height="4" rx="2" fill={`url(#${grad})`} fillOpacity="0.35" />
        <rect x="149" y="32" width="19" height="4" rx="2" fill={`url(#${grad})`} fillOpacity="0.25" />
      </g>

      <path
        d="M44 28c0.9 4.4 2.5 6 6.9 6.9-4.4 0.9-6 2.5-6.9 6.9-0.9-4.4-2.5-6-6.9-6.9 4.4-0.9 6-2.5 6.9-6.9Z"
        fill="#67E8F9"
        fillOpacity="0.8"
      />
      <circle cx="176" cy="126" r="2.4" fill="#A78BFA" fillOpacity="0.75" />
    </svg>
  );
}

/** 知识点空状态：便签 + 灯泡，纯装饰 */
export function NoteArt({ className }: IllustrationProps) {
  const uid = useArtId("noteArt");
  const grad = `${uid}Grad`;
  const halo = `${uid}Halo`;
  const glow = `${uid}Glow`;

  return (
    <svg
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={grad} x1="36" y1="182" x2="172" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8B5CF6" />
          <stop offset="0.55" stopColor="#6366F1" />
          <stop offset="1" stopColor="#22D3EE" />
        </linearGradient>
        <radialGradient id={halo} cx="100" cy="112" r="86" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8B5CF6" stopOpacity="0.18" />
          <stop offset="1" stopColor="#22D3EE" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={glow} cx="142" cy="58" r="46" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F59E0B" stopOpacity="0.3" />
          <stop offset="1" stopColor="#F59E0B" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="100" cy="112" r="86" fill={`url(#${halo})`} />

      <g transform="rotate(-7 96 126)">
        <rect
          x="42"
          y="80"
          width="108"
          height="100"
          rx="12"
          fill="#FFFFFF"
          fillOpacity="0.58"
          stroke={`url(#${grad})`}
          strokeWidth="3"
        />
        <g stroke={`url(#${grad})`} strokeOpacity="0.4" strokeWidth="3" strokeLinecap="round">
          <path d="M58 108h56M58 124h44M58 140h50M58 156h32" />
        </g>
        <path d="M126 80h24v24" stroke={`url(#${grad})`} strokeOpacity="0.35" strokeWidth="2.5" />
      </g>

      <circle cx="142" cy="58" r="46" fill={`url(#${glow})`} />
      <path
        d="M142 26a25 25 0 0 0-14 45c3 2 5 7 5 12v2h18v-2c0-5 2-10 5-12a25 25 0 0 0-14-45Z"
        fill="#FFFFFF"
        fillOpacity="0.6"
        stroke={`url(#${grad})`}
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <g stroke={`url(#${grad})`} strokeWidth="3.5" strokeLinecap="round">
        <path d="M133 92h18M135 99h14" />
      </g>

      <path
        d="M44 52c0.9 4.4 2.5 6 6.9 6.9-4.4 0.9-6 2.5-6.9 6.9-0.9-4.4-2.5-6-6.9-6.9 4.4-0.9 6-2.5 6.9-6.9Z"
        fill="#67E8F9"
        fillOpacity="0.8"
      />
      <circle cx="170" cy="146" r="2.4" fill="#A78BFA" fillOpacity="0.75" />
    </svg>
  );
}

/** 小装饰星芒：标题 / 统计卡角落 */
export function SparkArt({ className }: IllustrationProps) {
  const uid = useArtId("sparkArt");
  const grad = `${uid}Grad`;

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={grad} x1="3" y1="21" x2="21" y2="3" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8B5CF6" />
          <stop offset="0.55" stopColor="#6366F1" />
          <stop offset="1" stopColor="#22D3EE" />
        </linearGradient>
      </defs>
      <path
        d="M12 2c0.6 5.2 4.2 8.8 9.4 9.4-5.2 0.6-8.8 4.2-9.4 9.4-0.6-5.2-4.2-8.8-9.4-9.4C7.8 10.8 11.4 7.2 12 2Z"
        fill={`url(#${grad})`}
      />
      <circle cx="19.5" cy="4.5" r="1.3" fill={`url(#${grad})`} fillOpacity="0.7" />
    </svg>
  );
}
