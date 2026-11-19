/**
 * 知识点富文本 HTML 白名单过滤。
 *
 * 仅可在浏览器环境使用（依赖 DOMParser）；服务端路由不要 import 本文件。
 * 白名单标签：b, strong, i, em, u, s, br, p, div, span, ul, ol, li
 * 白名单属性：仅 span[style]，style 只保留 color / font-size /
 * font-weight / font-style / text-decoration，其余标签与属性全部去掉。
 */

const ALLOWED_TAGS = new Set([
  "B",
  "STRONG",
  "I",
  "EM",
  "U",
  "S",
  "BR",
  "P",
  "DIV",
  "SPAN",
  "UL",
  "OL",
  "LI",
]);

/** 这些标签连同内部文本一起丢弃，避免把脚本/样式内容当正文保留。 */
const DROP_WITH_CONTENT = new Set([
  "SCRIPT",
  "STYLE",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "TEMPLATE",
  "NOSCRIPT",
  "TITLE",
  "META",
  "LINK",
]);

const ALLOWED_STYLE_PROPERTIES = [
  "color",
  "font-size",
  "font-weight",
  "font-style",
  "text-decoration",
  "margin-left",
] as const;

/** 允许携带 style 的标签；其余标签不带任何属性。 */
const STYLE_HOST_TAGS = new Set(["SPAN", "P", "DIV", "LI"]);

type AllowedStyleProperty = (typeof ALLOWED_STYLE_PROPERTIES)[number];

/** 只接受安全的 CSS 值，拒绝 url()/var()/expression 等写法。 */
const STYLE_VALUE_PATTERNS: Record<AllowedStyleProperty, RegExp> = {
  color: /^(?:#[0-9a-f]{3,8}|rgba?\([^()]*\)|hsla?\([^()]*\)|[a-z]{3,20})$/i,
  "font-size": /^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/i,
  "font-weight": /^(?:normal|bold|bolder|lighter|[1-9]00)$/i,
  "font-style": /^(?:normal|italic|oblique)$/i,
  "text-decoration": /^[a-z-]+(?:\s+[a-z-]+)*$/i,
  "margin-left": /^\d+(?:\.\d+)?(?:px|em|rem)$/i,
};

function sanitizeStyle(raw: string | null, doc: Document): string {
  if (!raw) return "";

  // 交给浏览器解析样式声明，再按白名单逐项取回，避免手写解析遗漏。
  const probe = doc.createElement("span");
  probe.setAttribute("style", raw);

  const parts: string[] = [];
  for (const property of ALLOWED_STYLE_PROPERTIES) {
    let value = probe.style.getPropertyValue(property).trim();
    // 部分浏览器把下划线写成 text-decoration-line，归一化为允许的简写。
    if (property === "text-decoration" && !value) {
      value = probe.style.getPropertyValue("text-decoration-line").trim();
    }
    if (!value) continue;
    if (!STYLE_VALUE_PATTERNS[property].test(value)) continue;
    parts.push(`${property}: ${value}`);
  }
  return parts.join("; ");
}

function cleanChildren(source: Node, target: Node, doc: Document): void {
  for (const child of Array.from(source.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      target.appendChild(doc.createTextNode(child.nodeValue ?? ""));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const element = child as HTMLElement;
    const tag = element.tagName.toUpperCase();

    if (!ALLOWED_TAGS.has(tag)) {
      // 未授权标签：脚本类整体丢弃，其余标签拆掉但保留子内容（文字）。
      if (!DROP_WITH_CONTENT.has(tag)) cleanChildren(element, target, doc);
      continue;
    }

    if (STYLE_HOST_TAGS.has(tag)) {
      const style = sanitizeStyle(element.getAttribute("style"), doc);
      // 没有任何允许样式的 span 直接拆掉，减少无意义嵌套。
      if (tag === "SPAN" && !style) {
        cleanChildren(element, target, doc);
        continue;
      }
      const clone = doc.createElement(tag.toLowerCase());
      if (style) clone.setAttribute("style", style);
      target.appendChild(clone);
      cleanChildren(element, clone, doc);
      continue;
    }

    const clone = doc.createElement(tag.toLowerCase());
    target.appendChild(clone);
    cleanChildren(element, clone, doc);
  }
}

/**
 * 过滤富文本 HTML，返回只含白名单标签/样式的安全 HTML。
 * 输入为空或非浏览器环境时返回空字符串。
 */
export function sanitizeHtml(input: string | null | undefined): string {
  if (!input) return "";
  if (typeof DOMParser === "undefined") return "";

  const doc = new DOMParser().parseFromString(input, "text/html");
  const source = doc.body ?? doc.documentElement;
  if (!source) return "";

  const container = doc.createElement("div");
  cleanChildren(source, container, doc);
  return container.innerHTML;
}
