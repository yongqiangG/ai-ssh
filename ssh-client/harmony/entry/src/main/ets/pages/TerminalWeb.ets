import { webview } from '@kit.ArkWeb';
import { Context } from '@kit.AbilityKit';
import { router } from '@kit.ArkUI';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { ConnectionStore, Connection } from '../common/ConnectionStore';

const TAG = 'TerminalWeb';
const DOMAIN = 0xA155;

/**
 * ArkWeb 终端页（Q6 WebView 自连形态）：加载 rawfile/terminal/terminal.html
 * 本地页（src/mobile 终端资产经 build:mobile 构建 + sync-harmony-rawfile 同步），
 * 经 URL query 注入 taskId/token/baseUrl——页面内 WS 直连门面，原生层不碰字节流。
 * rawfile 本地页加载用 resource://rawfile/ 协议；加载/错误全链 hilog 观测。
 */
@Entry
@Component
struct TerminalWeb {
  @State pageUrl: string = '';
  private controller: webview.WebviewController = new webview.WebviewController();
  private context = getContext(this);

  aboutToAppear(): void {
    const params = router.getParams() as Record<string, string>;
    const taskId = params !== undefined ? (params['taskId'] ?? '') : '';
    hilog.info(DOMAIN, TAG, 'aboutToAppear taskId=%{public}s', taskId);
    ConnectionStore.load(this.context).then((conn: Connection) => {
      if (taskId === '') {
        this.pageUrl = 'about:blank';
        return;
      }
      // query 注入三件套：taskId（任务定位）、token（鉴权，不落 localStorage）、
      // baseUrl（fetch/WS 绝对地址——rawfile 页 origin 是本地壳，无法同源推导）
      this.pageUrl =
        'resource://rawfile/terminal/terminal.html' +
        `?taskId=${encodeURIComponent(taskId)}` +
        `&token=${encodeURIComponent(conn.token)}` +
        `&baseUrl=${encodeURIComponent(conn.baseUrl)}`;
      hilog.info(DOMAIN, TAG, 'pageUrl=%{public}s', this.pageUrl);
    });
  }

  build() {
    Column() {
      if (this.pageUrl === '') {
        Column({ space: 12 }) {
          LoadingProgress().width(40).height(40)
          Text('连接配置加载中…').fontSize(14).fontColor('#8a93a6')
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
      } else {
        Web({ src: this.pageUrl, controller: this.controller })
          .width('100%')
          .height('100%')
          .javaScriptAccess(true)
          .domStorageAccess(true)
          .fileAccess(true)
          .onlineImageAccess(false)
          .backgroundColor('#0b0e14')
          .onControllerAttached(() => {
            hilog.info(DOMAIN, TAG, 'onControllerAttached');
            webview.WebviewController.setWebDebuggingAccess(true);
          })
          .onPageBegin((e) => {
            hilog.info(DOMAIN, TAG, 'onPageBegin url=%{public}s', e.url);
          })
          .onPageEnd((e) => {
            hilog.info(DOMAIN, TAG, 'onPageEnd url=%{public}s', e.url);
          })
          .onErrorReceive((e) => {
            hilog.error(DOMAIN, TAG, 'onErrorReceive err=%{public}s desc=%{public}s',
              `${e.error.getErrorCode()}`, e.error.getErrorInfo());
            return false;
          })
          .onConsole((e) => {
            hilog.info(DOMAIN, TAG, 'console: %{public}s', e.message.getMessage());
            return false;
          })
      }
    }
    .width('100%')
    .height('100%')
  }
}
