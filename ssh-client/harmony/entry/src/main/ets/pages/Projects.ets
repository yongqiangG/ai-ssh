import { router } from '@kit.ArkUI';
import { Context } from '@kit.AbilityKit';
import { http } from '@kit.NetworkKit';
import { ConnectionStore, Connection } from '../common/ConnectionStore';

/** spike 期项目占位页：拉 GET /api/projects 验 REST+token 链路，点项目进 ArkWeb 壳 */
@Entry
@Component
struct Projects {
  @State projects: ProjectItem[] = [];
  @State loading: boolean = true;
  @State errorMsg: string = '';
  private context = getContext(this);

  aboutToAppear(): void {
    this.loadProjects();
  }

  private async loadProjects(): Promise<void> {
    const conn = await ConnectionStore.load(this.context);
    return new Promise<void>((resolve) => {
      const req = http.createHttp();
      req.request(conn.baseUrl + '/api/projects', {
        method: http.RequestMethod.GET,
        header: { 'X-Companion-Token': conn.token }
      }, async (err, resp) => {
        req.destroy();
        if (err) {
          this.errorMsg = '网络错误：' + JSON.stringify(err);
          this.loading = false;
          resolve();
          return;
        }
        const body = resp.result as string;
        const parsed = JSON.parse(body) as ApiResponse<ProjectItem[]>;
        if (parsed.code !== '0000') {
          this.errorMsg = `服务端错误 ${parsed.code}：${parsed.info}`;
          this.loading = false;
          resolve();
          return;
        }
        this.projects = parsed.data ?? [];
        this.loading = false;
        resolve();
      });
    });
  }

  build() {
    Column() {
      // 顶栏
      Row({ space: 12 }) {
        Text('项目').fontSize(20).fontWeight(FontWeight.Bold).layoutWeight(1)
        Text('配置').fontSize(14).fontColor('#8a93a6')
          .onClick(() => {
            router.pushUrl({ url: 'pages/Setup' });
          })
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 12, bottom: 12 })

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
              this.loadProjects();
            })
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else if (this.projects.length === 0) {
        Column() {
          Text('暂无项目（在 PC 端添加）').fontSize(14).fontColor('#8a93a6')
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else {
        List({ space: 8 }) {
          ForEach(this.projects, (p: ProjectItem) => {
            ListItem() {
              Column({ space: 4 }) {
                Text(p.name).fontSize(16).fontWeight(FontWeight.Medium)
                Text(p.path).fontSize(12).fontColor('#8a93a6').maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
              }
              .width('100%')
              .padding(14)
              .borderRadius(10)
              .backgroundColor('#151a23')
              .onClick(() => {
                const params: Record<string, string> = { 'projectId': p.id, 'projectName': p.name };
                router.pushUrl({ url: 'pages/Tasks', params: params });
              })
            }
          }, (p: ProjectItem) => p.id)
        }
        .layoutWeight(1)
        .width('100%')
        .padding({ left: 16, right: 16 })
        .scrollBar(BarState.Off)
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#0b0e14')
  }
}

interface ProjectItem {
  id: string;
  name: string;
  path: string;
}

interface ApiResponse<T> {
  code: string;
  info: string;
  data: T | null;
}
