import { useLayoutStore } from "../stores/layoutStore";
import ConnectionsPanel from "../views/ConnectionsPanel";
import FilesPanel from "../views/FilesPanel";
import LocalSidebar from "../local-dev/LocalSidebar";

export default function LeftSidebar() {
  const view = useLayoutStore((s) => s.activeSidebarView);
  return (
    <>
      {view === "servers" && <ConnectionsPanel />}
      {view === "files" && <FilesPanel />}
      {view === "local" && <LocalSidebar />}
    </>
  );
}
