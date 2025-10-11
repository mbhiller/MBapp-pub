import * as React from "react";

type Ctx = {
  workspaceId: string | null;
  setWorkspaceId: (id: string | null) => void;
};

const WorkspaceContext = React.createContext<Ctx>({ workspaceId: null, setWorkspaceId: () => {} });

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspaceId, setWorkspaceId] = React.useState<string | null>(null);
  return (
    <WorkspaceContext.Provider value={{ workspaceId, setWorkspaceId }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return React.useContext(WorkspaceContext);
}
