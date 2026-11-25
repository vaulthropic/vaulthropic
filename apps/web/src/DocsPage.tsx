import { MDXProvider } from "@mdx-js/react";
import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import { mdxComponents } from "./docs/components.js";
import { DocsActionProvider } from "./docs/context.js";
import { followPlainClick } from "./docs/follow.js";
import Guide from "./docs/pages/guide.mdx";
import UsdcApis from "./docs/pages/usdc-apis.mdx";
import WhatIsVaulthropic from "./docs/pages/what-is-vaulthropic.mdx";
import { currentSectionId, docNavItems, normalizeDocPath, pageForPath } from "./docs/registry.js";

const articles: Record<string, ComponentType> = {
  "what-is-vaulthropic": WhatIsVaulthropic,
  guide: Guide,
  "usdc-apis": UsdcApis,
};

type Place = { path: string; hash: string };

function readPlace(): Place {
  return {
    path: normalizeDocPath(window.location.pathname),
    hash: window.location.hash.replace(/^#/, ""),
  };
}

function placeFromUrl(url: string): Place {
  const parsed = new URL(url, window.location.origin);
  return { path: normalizeDocPath(parsed.pathname), hash: parsed.hash.replace(/^#/, "") };
}

export function DocsPage({
  locationKey,
  onNavigate,
  onOpenLab,
}: {
  locationKey: number;
  onNavigate: (url: string) => void;
  onOpenLab: () => void;
}) {
  const [place, setPlace] = useState<Place>(readPlace);

  useEffect(() => {
    const sync = () => setPlace(readPlace());
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, [locationKey]);

  const page = pageForPath(place.path);
  const Article = page ? articles[page.id] : undefined;
  const active = page ? currentSectionId(page, place.hash) : "";

  function go(url: string) {
    onNavigate(url);
    setPlace(placeFromUrl(url));
  }

  return (
    <DocsActionProvider actions={{ navigate: go, openLab: onOpenLab }}>
      <MDXProvider components={mdxComponents}>
        <div className="docs-reading">
          <div className="docs-shell">
            <nav className="docs-nav" aria-label="Guide">
              <p className="docs-kicker">User guide</p>
              <p className="docs-host">Reading room for documents.vaulthropic.com. This copy is served at /docs.</p>
              <p className="docs-nav-label">On this page</p>
              <ul className="docs-toc">
                {docNavItems().map((item) => item.kind === "label" ? (
                  <li key={item.key} className="docs-toc-label">{item.label}</li>
                ) : (
                  <li key={item.key}>
                    <a
                      href={item.href}
                      aria-current={page?.id === item.page.id && item.section?.id === active ? "true" : undefined}
                      onClick={(event) => {
                        if (!item.href || !followPlainClick(event)) return;
                        go(item.href);
                      }}
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="docs-main">
              {page && Article ? (
                <>
                  <header className="page-intro">
                    <p className="eyebrow">{page.eyebrow}</p>
                    <h1>{page.title}</h1>
                    <p className="lede">{page.lede}</p>
                  </header>
                  <Article />
                </>
              ) : (
                <header className="page-intro">
                  <p className="eyebrow">Documentation</p>
                  <h1>This page is not in the guide.</h1>
                  <p className="lede">That address has no article. The menu still lists the pages that do.</p>
                  <p className="prose">
                    <a href="/docs" onClick={(event) => { if (followPlainClick(event)) go("/docs"); }}>Open the guide</a>
                  </p>
                </header>
              )}
            </div>
          </div>
        </div>
      </MDXProvider>
    </DocsActionProvider>
  );
}
