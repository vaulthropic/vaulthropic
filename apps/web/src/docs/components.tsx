import type { AnchorHTMLAttributes, HTMLAttributes, ReactNode, TableHTMLAttributes } from "react";
import { useDocsActions } from "./context.js";
import { followPlainClick } from "./follow.js";
import { normalizeDocPath } from "./registry.js";

export const PAYTO_VERIFY =
  "Verify the live endpoint URL and the receiving payTo address from this provider’s official docs or from the HTTP 402 challenge on the request you are about to send. A copied address can go stale. The challenge’s payTo, asset, chain, and amount are the values to allowlist for that call.";

export function Callout({ tone = "note", title, children }: { tone?: "note" | "warning"; title: string; children: ReactNode }) {
  return (
    <aside className={tone === "warning" ? "doc-callout is-warning" : "doc-callout is-note"}>
      <p className="doc-callout-title">{title}</p>
      <div className="doc-callout-body">{children}</div>
    </aside>
  );
}

export function EndpointSetup({
  docsHref,
  docsLabel = "Official documentation",
  host,
  children,
}: {
  docsHref: string;
  docsLabel?: string;
  host?: string;
  children?: ReactNode;
}) {
  return (
    <div className="doc-endpoint">
      <p className="prose">
        <a href={docsHref} target="_blank" rel="noopener noreferrer">{docsLabel}</a>
      </p>
      {host ? <p className="prose">Documented host <span className="mono">{host}</span>.</p> : null}
      {children}
      <p className="doc-verify">{PAYTO_VERIFY}</p>
    </div>
  );
}

export function PolicyNote({ children }: { children: ReactNode }) {
  return (
    <aside className="doc-policy">
      <p className="doc-policy-label">Policy ceilings</p>
      <div>{children}</div>
    </aside>
  );
}

export function LabLink({ children }: { children: ReactNode }) {
  const { openLab } = useDocsActions();
  return (
    <a href="/lab" onClick={(event) => { if (followPlainClick(event)) openLab(); }}>
      {children}
    </a>
  );
}

export function DocAnchor({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { navigate } = useDocsActions();
  const external = typeof href === "string" && /^https?:\/\//.test(href);
  const inGuide = typeof href === "string" && (href.startsWith("/docs") || href.startsWith("#"));
  return (
    <a
      href={href}
      {...rest}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      onClick={(event) => {
        if (!inGuide || typeof href !== "string" || !followPlainClick(event)) return;
        const url = href.startsWith("#") ? `${normalizeDocPath(window.location.pathname)}${href}` : href;
        navigate(url);
      }}
    >
      {children}
    </a>
  );
}

function Prose({ className, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return <p {...rest} className={["prose", className].filter(Boolean).join(" ")} />;
}

function DocTable({ children, className, ...rest }: TableHTMLAttributes<HTMLTableElement>) {
  const table = <table {...rest} className={className ?? "docs-table"}>{children}</table>;
  if (className?.split(/\s+/).includes("docs-table")) return table;
  return <div className="docs-table-wrap">{table}</div>;
}

export const mdxComponents = {
  a: DocAnchor,
  p: Prose,
  ul: (props: HTMLAttributes<HTMLUListElement>) => <ul {...props} className="docs-list" />,
  ol: (props: HTMLAttributes<HTMLOListElement>) => <ol {...props} className="docs-list" />,
  table: DocTable,
  Callout,
  DocAnchor,
  EndpointSetup,
  PolicyNote,
  LabLink,
};
