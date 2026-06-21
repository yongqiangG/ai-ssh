import EmptyState from "../components/EmptyState";

export default function SftpPanel() {
  return (
    <section className="panel">
      <div className="panel-header">
        <span className="panel-title">SFTP 文件传输</span>
      </div>
      <div className="panel-body">
        <EmptyState
          icon="sftp"
          title="SFTP 传输即将上线"
          hint="后续将支持双向拖拽传输、目录同步与断点续传"
        />
      </div>
    </section>
  );
}
