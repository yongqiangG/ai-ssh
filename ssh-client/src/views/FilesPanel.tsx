import EmptyState from "../components/EmptyState";

export default function FilesPanel() {
  return (
    <section className="panel">
      <div className="panel-header">
        <span className="panel-title">文件目录</span>
      </div>
      <div className="panel-body">
        <EmptyState
          icon="files"
          title="文件浏览即将上线"
          hint="后续将支持远程目录浏览、文件预览与在线编辑"
        />
      </div>
    </section>
  );
}
