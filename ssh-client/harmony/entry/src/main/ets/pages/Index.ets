import { router } from '@kit.ArkUI';
import { Context } from '@kit.AbilityKit';
import { ConnectionStore, Connection } from '../common/ConnectionStore';

/** 启动分流：有连接配置进项目列表，无则进配置页 */
@Entry
@Component
struct Index {
  private context = getContext(this);

  aboutToAppear(): void {
    ConnectionStore.load(this.context).then((conn: Connection) => {
      if (conn.baseUrl !== '' && conn.token !== '') {
        router.replaceUrl({ url: 'pages/Projects' });
      } else {
        router.replaceUrl({ url: 'pages/Setup' });
      }
    });
  }

  build() {
    Column() {
      LoadingProgress().width(40).height(40)
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .backgroundColor('#0b0e14')
  }
}
