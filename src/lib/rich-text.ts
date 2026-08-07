/**
 * Rich text is stored as a very small HTML subset: whitelisted, attribute-free
 * tags only. Anything else is escaped into plain text, so task details written
 * by one customer stay inert when another customer opens a shared dashboard.
 */

const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "b",
  "i",
  "u",
  "s",
  "ul",
  "ol",
  "li",
  "code",
]);

const TAG_ALIASES: Record<string, string> = {
  strong: "b",
  em: "i",
  strike: "s",
  del: "s",
  div: "p",
};

const VOID_TAGS = new Set(["br"]);

export const MAX_RICH_TEXT_LENGTH = 20000;
export const MAX_TASK_TITLE_LENGTH = 200;

/** Matches an attribute-free tag such as `<b>`, `</ul>` or `<br />`. */
const TAG_TOKEN = /<\/?([a-zA-Z][a-zA-Z0-9]*)\s*\/?>/y;
const ENTITY_TOKEN =
  /&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,30});/y;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

export function sanitizeRichText(input: unknown): string {
  if (typeof input !== "string" || input.length === 0) {
    return "";
  }

  const source = input.slice(0, MAX_RICH_TEXT_LENGTH);
  let output = "";
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (char === "<") {
      TAG_TOKEN.lastIndex = index;
      const match = TAG_TOKEN.exec(source);

      if (match) {
        const rawTag = match[1].toLowerCase();
        const tag = TAG_ALIASES[rawTag] ?? rawTag;

        if (ALLOWED_TAGS.has(tag)) {
          const isClosing = match[0].startsWith("</");
          if (VOID_TAGS.has(tag)) {
            output += isClosing ? "" : `<${tag}>`;
          } else {
            output += isClosing ? `</${tag}>` : `<${tag}>`;
          }
          index += match[0].length;
          continue;
        }
      }

      output += "&lt;";
      index += 1;
      continue;
    }

    if (char === "&") {
      ENTITY_TOKEN.lastIndex = index;
      const match = ENTITY_TOKEN.exec(source);

      if (match) {
        output += match[0];
        index += match[0].length;
        continue;
      }

      output += "&amp;";
      index += 1;
      continue;
    }

    if (char === ">") {
      output += "&gt;";
      index += 1;
      continue;
    }

    output += char;
    index += 1;
  }

  return richTextToPlainText(output) ? output : "";
}

export function richTextToPlainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeTaskTitle(input: unknown): string {
  if (typeof input !== "string") {
    return "";
  }

  return input
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TASK_TITLE_LENGTH);
}
