import { useLayoutStore } from "../stores/layoutStore";
import ServersPanel from "../views/ServersPanel";
import FilesPanel from "../views/FilesPanel";
import SftpPanel from "../views/SftpPanel";

export default function LeftSidebar() {
  const view = useLayoutStore((s) => s.activeSidebarView);
  return (
    <>
      {view === "servers" && <ServersPanel />}
      {view === "files" && <FilesPanel />}
      {view === "sftp" && <SftpPanel />}
    </>
  );
}
