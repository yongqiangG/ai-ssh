import { Children, isValidElement, useState } from "react";
import type { MouseEvent, ReactElement, ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import Markdown from "react-markdown";
import type { Components, UrlTransform } from "react-markdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import Icon from "./Icon";
import styles from "./MessageBubble.module.css";

const ALLOWED_ELEMENTS = [
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "input",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
];

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ["className", /^language-[\w-]+$/],
    ],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
  },
};

const hasExplicitProtocol = (url: string) => /^[a-z][a-z\d+.-]*:/i.test(url);

const urlTransform: UrlTransform = (url, key) => {
  if (key !== "href" || !hasExplicitProtocol(url)) return "";
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:" || protocol === "mailto:"
      ? url
      : "";
  } catch {
    return "";
  }
};

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const firstChild = Children.toArray(children).find(isValidElement) as
    | ReactElement<{ className?: string; children?: ReactNode }>
    | undefined;
  const className = firstChild?.props.className ?? "";
  const language = /language-([\w-]+)/.exec(className)?.[1] ?? "text";
  const code = String(firstChild?.props.children ?? "").replace(/\n$/, "");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时保持静默，避免打断阅读。
    }
  };

  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeHeader}>
        <span className={styles.codeLang}>{language}</span>
        <button
          className={styles.codeCopy}
          type="button"
          onClick={copy}
          title={copied ? "已复制" : "复制代码"}
        >
          <Icon name={copied ? "check" : "copy"} size={13} />
        </button>
      </div>
      <pre className={styles.codePre}>
        <code className={className}>{code}</code>
      </pre>
    </div>
  );
}

const components: Components = {
  a({ href, children, node: _node, ...props }) {
    const safeHref = typeof href === "string" ? urlTransform(href, "href", _node!) : "";

    const open = async (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      if (!safeHref) return;
      try {
        await openUrl(safeHref);
      } catch {
        window.open(safeHref, "_blank", "noopener,noreferrer");
      }
    };

    return (
      <a
        {...props}
        href={safeHref || undefined}
        rel="noreferrer"
        onClick={open}
        title={safeHref || "不支持的链接协议"}
      >
        {children}
      </a>
    );
  },
  code({ className, children, ...props }) {
    return (
      <code
        {...props}
        className={className ? `${styles.inlineCode} ${className}` : styles.inlineCode}
      >
        {children}
      </code>
    );
  },
  pre({ children }) {
    return <CodeBlock>{children}</CodeBlock>;
  },
};

export default function MarkdownContent({ content }: { content: string }) {
  return (
    <Markdown
      allowedElements={ALLOWED_ELEMENTS}
      components={components}
      rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
      remarkPlugins={[remarkGfm]}
      skipHtml
      urlTransform={urlTransform}
    >
      {content}
    </Markdown>
  );
}
