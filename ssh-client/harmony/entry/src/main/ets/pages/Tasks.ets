import { router } from '@kit.ArkUI';
import { promptAction } from '@kit.ArkUI';
import { http } from '@kit.NetworkKit';
import { Context } from '@kit.AbilityKit';
import { ConnectionStore, Connection } from '../common/ConnectionStore';

/** 任务列表页（原生）：项目内任务列表，点任务进 rawfile 终端页；新建走最简表单（期 3 富输入） */
@Entry
@Component
struct Tasks {
  @State tasks: TaskItem[] = [];
  @State loading: boolean = true;
  @State errorMsg: string = '';
  @State newPrompt: string = '';
  @State creating: boolean = false;
  @State showNew: boolean = false;
  private projectId: string = '';
  private projectName: string = '';
  private context = getContext(this);

  aboutToAppear(): void {
    const params = router.getParams() as Record<string, string>;
    this.projectId = params !== undefined ? (params['projectId'] ?? '') : '';
    this.projectName = params !== undefined ? (params['projectName'] ?? '') : '';
    this.loadTasks();
  }

  private async request(conn: Connection, path: string, method: http.RequestMethod,
    body?: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const req = http.createHttp();
      const header: Record<string, string> = {};
      header['X-Companion-Token'] = conn.token;
      if (body !== undefined) {
        header['Content-Type'] = 'application/json';
      }
      req.request(conn.baseUrl + path, { method: method, header: header, extraData: body },
        (err, resp) => {
          req.destroy();
          if (err) {
            reject(new Error(JSON.stringify(err)));
            return;
          }
          resolve(resp.result as string);
        });
    });
  }

  private async loadTasks(): Promise<void> {
    const conn = await ConnectionStore.load(this.context);
    try {
      const raw = await this.request(conn, `/api/projects/${this.projectId}/tasks`,
        http.RequestMethod.GET);
      const parsed = JSON.parse(raw) as ApiResponse<TaskItem[]>;
      if (parsed.code !== '0000') {
        this.errorMsg = `服务端错误 ${parsed.code}：${parsed.info}`;
      } else {
        this.tasks = parsed.data ?? [];
        this.errorMsg = '';
      }
    } catch (e) {
      this.errorMsg = '网络错误：' + (e instanceof Error ? e.message : JSON.stringify(e));
    }
    this.loading = false;
  }

  private async createTask(): Promise<void> {
    if (this.newPrompt.trim() === '' || this.creating) {
      return;
    }
    this.creating = true;
    const conn = await ConnectionStore.load(this.context);
    const body = JSON.stringify({ prompt: this.newPrompt.trim(), agent: 'claude', permissionMode: 'ask' });
    try {
      const raw = await this.request(conn, `/api/projects/${this.projectId}/tasks`,
        http.RequestMethod.POST, body);
      const parsed = JSON.parse(raw) as ApiResponse<TaskItem>;
      if (parsed.code === '0000' && parsed.data) {
        this.showNew = false;
        this.newPrompt = '';
        const params: Record<string, string> = { 'taskId': parsed.data.id };
        router.pushUrl({ url: 'pages/TerminalWeb', params: params });
        return;
      }
      promptAction.showToast({ message: `创建失败 ${parsed.code}` });
    } catch (e) {
      promptAction.showToast({ message: '网络错误' });
    }
    this.creating = false;
  }

  /** 桌面同款状态徽章语义（TaskView STATUS_LABEL 对齐）；ArkTS 禁 untyped 字面量用 switch */
  private statusLabel(s: string): string {
    switch (s) {
      case 'pending':
        return '启动中';
      case 'running':
        return '运行中';
      case 'input_required':
        return '待确认';
      case 'awaiting_review':
        return '待验收';
      case 'done':
        return '完成';
      case 'failed':
        return '失败';
      case 'cancelled':
        return '已取消';
      case 'interrupted':
        return '已中断';
      default:
        return s;
    }
  }

  private statusColor(s: string): string {
    if (s === 'running' || s === 'pending') {
      return '#4fc3f7';
    }
    if (s === 'input_required' || s === 'awaiting_review') {
      return '#e5c07b';
    }
    if (s === 'done') {
      return '#98c379';
    }
    if (s === 'failed') {
      return '#e06c75';
    }
    return '#8a93a6';
  }

  private fmtTime(ms: number): string {
    const d = new Date(ms);
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const h = d.getHours().toString().padStart(2, '0');
    const min = d.getMinutes().toString().padStart(2, '0');
    return `${m}/${day} ${h}:${min}`;
  }

  build() {
    Column() {
      Row({ space: 12 }) {
        Text('←').fontSize(20).fontColor('#e6e9f0')
          .onClick(() => {
            router.back();
          })
        Text(this.projectName !== '' ? this.projectName : '任务')
          .fontSize(20).fontWeight(FontWeight.Bold).layoutWeight(1)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        Text('+ 新建').fontSize(14).fontColor('#4fc3f7')
          .onClick(() => {
            this.showNew = !this.showNew;
          })
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 12, bottom: 12 })

      if (this.showNew) {
        Column({ space: 10 }) {
          TextArea({ placeholder: '要做什么？（agent/权限模式暂默认 claude/ask，期 3 富输入）',
            text: this.newPrompt })
            .onChange((v: string) => {
              this.newPrompt = v;
            })
            .height(96)
            .width('100%')
            .backgroundColor('#151a23')
            .fontColor('#e6e9f0')
            .placeholderColor('#5a6375')
            .borderRadius(10)
          Button(this.creating ? '创建中…' : '创建并运行')
            .width('100%')
            .height(44)
            .enabled(!this.creating)
            .onClick(() => {
              this.createTask();
            })
        }
        .width('100%')
        .padding({ left: 16, right: 16, bottom: 8 })
      }

      if (this.loading) {
        Column({ space: 12 }) {
          LoadingProgress().width(36).height(36)
          Text('加载中…').fontSize(14).fontColor('#8a93a6')
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else if (this.errorMsg !== '') {
        Column({ space: 12 }) {
          Text(this.errorMsg).fontSize(14).fontColor('#e06c75')
          Button('重试')
            .onClick(() => {
              this.loading = true;
              this.errorMsg = '';
              this.loadTasks();
            })
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else if (this.tasks.length === 0) {
        Column() {
          Text('暂无任务').fontSize(14).fontColor('#8a93a6')
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else {
        List({ space: 8 }) {
          ForEach(this.tasks, (t: TaskItem) => {
            ListItem() {
              Column({ space: 6 }) {
                Row({ space: 8 }) {
                  Text(t.name ?? t.prompt).fontSize(15).fontWeight(FontWeight.Medium)
                    .layoutWeight(1).maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .fontColor('#e6e9f0')
                  Text(this.statusLabel(t.status)).fontSize(12)
                    .fontColor(this.statusColor(t.status))
                }
                .width('100%')
                Row() {
                  Text(t.agent).fontSize(11).fontColor('#5a6375')
                  Blank()
                  Text(this.fmtTime(t.createdAt)).fontSize(11).fontColor('#5a6375')
                }
                .width('100%')
              }
              .width('100%')
              .padding(14)
              .borderRadius(10)
              .backgroundColor('#151a23')
              .onClick(() => {
                const params: Record<string, string> = { 'taskId': t.id };
                router.pushUrl({ url: 'pages/TerminalWeb', params: params });
              })
            }
          }, (t: TaskItem) => t.id)
        }
        .layoutWeight(1)
        .width('100%')
        .padding({ left: 16, right: 16, bottom: 12 })
        .scrollBar(BarState.Off)
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#0b0e14')
  }
}

interface TaskItem {
  id: string;
  projectId: string;
  name: string | null;
  prompt: string;
  agent: string;
  permissionMode: string;
  status: string;
  createdAt: number;
}

interface ApiResponse<T> {
  code: string;
  info: string;
  data: T | null;
}
