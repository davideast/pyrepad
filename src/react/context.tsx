/**
 * @pyric/pad/react - Declarative React Context & Provider Binder.
 * Manages collaborative SyncSeam connections across component hierarchies without render lag or update depth loops.
 */
import React, { createContext, useContext, useState, useMemo } from "react";
import { SyncSeam } from "../adapters/types.ts";

export interface PyrepadContextValue {
  adapter: SyncSeam | null;
  editorAdapter: unknown | null;
  setEditorAdapter: (ea: unknown | null) => void;
}

const defaultContext: PyrepadContextValue = {
  adapter: null,
  editorAdapter: null,
  setEditorAdapter: () => {},
};

export const PyrepadContext = createContext<PyrepadContextValue>(defaultContext);

export interface PyrepadProviderProps {
  adapter: SyncSeam | null;
  children?: React.ReactNode;
}

export function PyrepadProvider(props: PyrepadProviderProps): React.ReactElement {
  const { adapter, children } = props;
  const [editorAdapter, setEditorAdapterState] = useState<unknown | null>(null);

  const contextValue = useMemo(() => {
    const resolvedAdapter = adapter || null;
    return {
      adapter: resolvedAdapter,
      editorAdapter: editorAdapter,
      setEditorAdapter: setEditorAdapterState,
    };
  }, [adapter, editorAdapter]);

  return (
    <PyrepadContext.Provider value={contextValue}>
      {children}
    </PyrepadContext.Provider>
  );
}

export function usePyrepadContext(): PyrepadContextValue {
  const ctx = useContext(PyrepadContext);
  const isUndefined = ctx === undefined || ctx === null;
  if (isUndefined) {
    throw new Error("usePyrepadContext must be used within a <PyrepadProvider />");
  }
  return ctx;
}

export function useResolvedAdapter(custom?: SyncSeam | null): SyncSeam | null {
  const ctx = useContext(PyrepadContext);
  const isCustomDefined = custom !== undefined && custom !== null;
  if (isCustomDefined) {
    return custom!;
  }
  const hasContextAdapter = Boolean(ctx && ctx.adapter);
  if (hasContextAdapter) {
    return ctx!.adapter;
  }
  return null;
}
