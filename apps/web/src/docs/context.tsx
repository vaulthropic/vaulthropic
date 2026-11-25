import { createContext, useContext } from "react";
import type { ReactNode } from "react";

export type DocsActions = {
  navigate: (url: string) => void;
  openLab: () => void;
};

const DocsActionContext = createContext<DocsActions>({
  navigate: () => undefined,
  openLab: () => undefined,
});

export function DocsActionProvider({ actions, children }: { actions: DocsActions; children: ReactNode }) {
  return <DocsActionContext.Provider value={actions}>{children}</DocsActionContext.Provider>;
}

export function useDocsActions(): DocsActions {
  return useContext(DocsActionContext);
}
