import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "react-router-dom";

type Props = {
  markdown: string;
  className?: string;
};

const linkClass = "text-accent no-underline hover:underline";

const helpMarkdownComponents: Components = {
  a({ href, children }) {
    if (href?.startsWith("/help")) {
      return (
        <Link to={href} className={linkClass}>
          {children}
        </Link>
      );
    }
    return (
      <a
        href={href}
        className={linkClass}
        target={href?.startsWith("http") ? "_blank" : undefined}
        rel={href?.startsWith("http") ? "noreferrer noopener" : undefined}
      >
        {children}
      </a>
    );
  },
};

/**
 * Renders markdown for the Help page (GFM: tables, strikethrough, task lists).
 */
export function HelpMarkdown({ markdown, className }: Props) {
  return (
    <div
      className={
        className ??
        [
          "prose prose-invert max-w-none",
          "prose-headings:scroll-mt-24 prose-headings:font-semibold prose-headings:tracking-tight",
          "prose-h1:text-2xl prose-h1:mb-4 prose-h1:mt-0",
          "prose-h2:text-xl prose-h2:mt-10 prose-h2:mb-3 prose-h2:border-b prose-h2:border-border/60 prose-h2:pb-2",
          "prose-h3:text-base prose-h3:font-medium prose-h3:text-slate-200",
          "prose-p:text-slate-300 prose-p:leading-relaxed",
          "prose-a:text-accent prose-a:no-underline hover:prose-a:underline",
          "prose-strong:text-slate-100",
          "prose-code:rounded prose-code:bg-white/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:font-mono prose-code:text-sm prose-code:text-slate-200 prose-code:before:content-none prose-code:after:content-none",
          "prose-pre:bg-[#121820] prose-pre:border prose-pre:border-border/60 prose-pre:text-slate-300",
          "prose-blockquote:border-accent/40 prose-blockquote:text-slate-400",
          "prose-li:marker:text-slate-500",
          "prose-hr:border-border/60",
          "prose-table:text-sm",
          "prose-th:border prose-th:border-border/60 prose-th:bg-white/[0.06] prose-th:px-3 prose-th:py-2",
          "prose-td:border prose-td:border-border/40 prose-td:px-3 prose-td:py-2",
        ].join(" ")
      }
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={helpMarkdownComponents}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
