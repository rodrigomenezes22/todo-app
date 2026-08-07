"use client";

import { useEffect, useRef } from "react";
import { sanitizeRichText } from "@/lib/rich-text";

/**
 * Small contentEditable editor. It serializes the DOM the browser produces into
 * the whitelisted subset in `@/lib/rich-text`, so whatever leaves this component
 * is already safe to store and render.
 */

const INLINE_TAGS: Record<string, string> = {
  B: "b",
  STRONG: "b",
  I: "i",
  EM: "i",
  U: "u",
  S: "s",
  STRIKE: "s",
  DEL: "s",
  CODE: "code",
};

const BLOCK_TAGS: Record<string, string> = {
  P: "p",
  DIV: "p",
  UL: "ul",
  OL: "ol",
  LI: "li",
};

const TOOLBAR_BUTTONS = [
  { command: "bold", label: "B", title: "Bold", className: "bold" },
  { command: "italic", label: "I", title: "Italic", className: "italic" },
  {
    command: "underline",
    label: "U",
    title: "Underline",
    className: "underline",
  },
  {
    command: "strikeThrough",
    label: "S",
    title: "Strikethrough",
    className: "strike",
  },
  {
    command: "insertUnorderedList",
    label: "• List",
    title: "Bulleted list",
    className: "",
  },
  {
    command: "insertOrderedList",
    label: "1. List",
    title: "Numbered list",
    className: "",
  },
  {
    command: "removeFormat",
    label: "Clear",
    title: "Clear formatting",
    className: "",
  },
] as const;

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineTagFromStyle(element: HTMLElement): string | null {
  const { fontWeight, fontStyle, textDecorationLine } = element.style;

  if (fontWeight === "bold" || fontWeight === "700") return "b";
  if (fontStyle === "italic") return "i";
  if (textDecorationLine.includes("underline")) return "u";
  if (textDecorationLine.includes("line-through")) return "s";

  return null;
}

function serializeChildren(node: Node): string {
  let html = "";
  node.childNodes.forEach((child) => {
    html += serializeNode(child);
  });
  return html;
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeText(node.textContent ?? "");
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const element = node as HTMLElement;
  if (element.tagName === "BR") {
    return "<br>";
  }

  const children = serializeChildren(element);
  const inlineTag = INLINE_TAGS[element.tagName] ?? inlineTagFromStyle(element);
  if (inlineTag) {
    return children ? `<${inlineTag}>${children}</${inlineTag}>` : "";
  }

  const blockTag = BLOCK_TAGS[element.tagName];
  if (blockTag) {
    return `<${blockTag}>${children}</${blockTag}>`;
  }

  // Spans, fonts, images and anything else are unwrapped down to their content.
  return children;
}

type RichTextEditorProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
};

export default function RichTextEditor({
  id,
  value,
  onChange,
  placeholder = "Write the task details...",
  ariaLabel,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastValueRef = useRef<string | null>(null);

  // Only rewrite the DOM for changes that did not come from typing here,
  // otherwise the caret jumps back to the start on every keystroke.
  useEffect(() => {
    if (value === lastValueRef.current) return;

    lastValueRef.current = value;
    const editor = editorRef.current;
    if (editor && editor.innerHTML !== value) {
      editor.innerHTML = value;
    }
  }, [value]);

  function emitChange() {
    const editor = editorRef.current;
    if (!editor) return;

    const html = sanitizeRichText(serializeChildren(editor));
    lastValueRef.current = html;
    onChange(html);
  }

  function runCommand(command: string) {
    editorRef.current?.focus();
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand(command);
    emitChange();
  }

  return (
    <div className="rich-text-field">
      <div className="rich-text-toolbar" role="toolbar" aria-label="Formatting">
        {TOOLBAR_BUTTONS.map((button) => (
          <button
            key={button.command}
            type="button"
            className={`rich-text-tool ${button.className}`}
            title={button.title}
            aria-label={button.title}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => runCommand(button.command)}>
            {button.label}
          </button>
        ))}
      </div>

      <div
        id={id}
        ref={editorRef}
        className={`rich-text-editor ${value ? "" : "is-empty"}`}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel ?? placeholder}
        data-placeholder={placeholder}
        onInput={emitChange}
        onBlur={emitChange}
      />
    </div>
  );
}
