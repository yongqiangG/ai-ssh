import { router } from '@kit.ArkUI';
import { promptAction } from '@kit.ArkUI';
import { Context } from '@kit.AbilityKit';
import { http } from '@kit.NetworkKit';
import { ConnectionStore, Connection } from '../common/ConnectionStore';

/** 连接配置页：spike 期语义对齐 web 伴侣 SetupView（地址 + token，保存即 ping 验证） */
@Entry
@Component
struct Setup {
  @State baseUrl: string = '';
  @State token: string = '';
  @State testing: boolean = false;
  private context = getContext(this);

  aboutToAppear(): void {
    ConnectionStore.load(this.context).then((conn: Connection) => {
      // 地址缺省预填反向转发标准地址（hdc rport tcp:18081 tcp:18081 后 127.0.0.1 直达 PC 门面）；
      // 正式连 VPS 时用户改填 https 域名。历史保存过则用保存值。
      // 缺省空串：地址因环境而异（USB rport 走 127.0.0.1、局域网走内网 IP、外网走 VPS），
      // 不预设默认值避免误导
      this.baseUrl = conn.baseUrl;
      this.token = conn.token;
    });
  }

  /** GET /api/health 免鉴权，作为可达性探针（对齐 web 伴侣 checkHealth） */
  private async testConnection(): Promise<boolean> {
    const base = this.baseUrl.replace(/\/+$/, '');
    return new Promise<boolean>((resolve) => {
      const req = http.createHttp();
      req.request(base + '/api/health', { method: http.RequestMethod.GET, connectTimeout: 5000 },
        (err, resp) => {
          req.destroy();
          resolve(!err && resp.responseCode === 200);
        });
    });
  }

  private async onSave(): Promise<void> {
    if (!this.baseUrl || !this.token) {
      promptAction.showToast({ message: '地址与 token 都要填' });
      return;
    }
    this.testing = true;
    const ok = await this.testConnection();
    this.testing = false;
    if (!ok) {
      promptAction.showToast({ message: '连不上：检查 PC 门面是否在跑、手机是否同网、防火墙 18081' });
      return;
    }
    await ConnectionStore.save(this.context,
      { baseUrl: this.baseUrl.replace(/\/+$/, ''), token: this.token });
    router.replaceUrl({ url: 'pages/Projects' });
  }

  build() {
    Column({ space: 16 }) {
      Text('AI-SSH 伴侣')
        .fontSize(24)
        .fontWeight(FontWeight.Bold)
        .margin({ top: 64 })
      Text('连接到 PC 端 AI Coding 门面')
        .fontSize(14)
        .fontColor('#8a93a6')
        .margin({ bottom: 32 })

      TextInput({ placeholder: '门面地址（如 http://192.168.1.100:18080）', text: this.baseUrl })
        .onChange((v: string) => {
          this.baseUrl = v;
        })
        .height(48)
        .width('100%')
        .backgroundColor('#151a23')
        .fontColor('#e6e9f0')
        .placeholderColor('#5a6375')
        .borderRadius(10)
        .padding({ left: 14, right: 14 })

      TextInput({ placeholder: 'token（PC 端 ~/.ai-ssh-dev/coding/web.json）', text: this.token })
        .onChange((v: string) => {
          this.token = v;
        })
        .height(48)
        .width('100%')
        .backgroundColor('#151a23')
        .fontColor('#e6e9f0')
        .placeholderColor('#5a6375')
        .borderRadius(10)
        .padding({ left: 14, right: 14 })

      Button(this.testing ? '验证中…' : '保存并连接')
        .width('100%')
        .height(48)
        .enabled(!this.testing)
        .onClick(() => {
          this.onSave();
        })
    }
    .width('100%')
    .height('100%')
    .padding({ left: 24, right: 24 })
    .backgroundColor('#0b0e14')
    .alignItems(HorizontalAlign.Start)
  }
}
