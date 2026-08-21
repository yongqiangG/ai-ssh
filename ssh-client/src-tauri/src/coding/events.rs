//! coding 域事件总线（docs/actions/260821-mobile-companion.md 阶段 1）。
//!
//! 双写语义：[`publish`] 在原地保留 `app.emit`（桌面 webview 路径逐字节不变），
//! 同时扇出到进程内 broadcast 供 web 侧（axum/WS）订阅。桌面事件顺序与
//! 改造前完全一致——总线是纯旁路，不是桌面路径的一环。
//!
//! 滞后语义：broadcast 容量有限，慢订阅者会 [`broadcast::error::RecvError::Lagged`]
//! 丢历史事件。状态类事件（task-status 等）是幂等快照，丢中间态无害；
//! PTY 输出**不走本总线**（字节流丢帧不可接受，阶段 2 用带序号的环形缓冲
//! 另行设计）。

use once_cell::sync::Lazy;
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::sync::broadcast;

/// 总线事件 = Tauri 事件名 + payload 的原样快照。
/// （字段 allow：阶段 1 尚无消费者，阶段 2 WS 接入后移除）
#[derive(Clone, Debug)]
#[allow(dead_code)]
pub struct BusEvent {
    pub name: String,
    pub payload: Value,
}

const CHANNEL_CAPACITY: usize = 1024;

static BUS: Lazy<broadcast::Sender<BusEvent>> =
    Lazy::new(|| broadcast::channel(CHANNEL_CAPACITY).0);

/// 双写发布：桌面 emit 优先（失败也继续发总线，两路互不拖累）。
pub fn publish(app: &AppHandle, name: &str, payload: Value) {
    let _ = app.emit(name, &payload);
    let _ = BUS.send(BusEvent {
        name: name.to_string(),
        payload,
    });
}

/// 订阅总线（web 侧每个 WS/轮询连接一个接收端）。
/// （allow：阶段 1 尚无消费者，阶段 2 WS 接入后移除）
#[allow(dead_code)]
pub fn subscribe() -> broadcast::Receiver<BusEvent> {
    BUS.subscribe()
}

#[cfg(test)]
mod tests {
    use super::*;
    use once_cell::sync::Lazy;
    use parking_lot::Mutex;
    use serde_json::json;

    // BUS 是进程级单例，测试默认多线程并发跑会互相串事件——全部串行
    //（同 260820 评审的 analytics 测试串行纪律）。
    static TEST_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    // publish 走 AppHandle，纯总线行为（扇出/滞后）用 BUS.send 直测——
    // 两者进同一条 channel，语义等价。

    #[test]
    fn multiple_subscribers_each_receive_event() {
        let _guard = TEST_LOCK.lock();
        let mut r1 = subscribe();
        let mut r2 = subscribe();
        BUS.send(BusEvent {
            name: "coding:task-status".into(),
            payload: json!({"task_id": "t1", "status": "running"}),
        })
        .unwrap();
        for r in [&mut r1, &mut r2] {
            let ev = r.try_recv().expect("each subscriber gets a copy");
            assert_eq!(ev.name, "coding:task-status");
            assert_eq!(ev.payload["status"], "running");
        }
    }

    #[test]
    fn subscriber_joined_later_misses_earlier_events() {
        let _guard = TEST_LOCK.lock();
        // broadcast 零订阅者时 send 返 SendError，挂一个保活订阅端
        let _keepalive = subscribe();
        BUS.send(BusEvent {
            name: "coding:fs-changed".into(),
            payload: json!({"dir": "x"}),
        })
        .unwrap();
        let mut late = subscribe();
        assert!(late.try_recv().is_err());
    }

    #[tokio::test]
    async fn slow_subscriber_lags_and_recovers_to_latest() {
        let _guard = TEST_LOCK.lock();
        // 填满容量再溢发：慢接收端应观察到 Lagged（而非错误数据），
        // 排空保留窗口后能继续收到新事件
        let mut slow = subscribe();
        for i in 0..CHANNEL_CAPACITY + 5 {
            BUS.send(BusEvent {
                name: "coding:test".into(),
                payload: json!({"i": i}),
            })
            .unwrap();
        }
        let mut lagged_seen = false;
        loop {
            match slow.try_recv() {
                Ok(_) => continue,
                Err(broadcast::error::TryRecvError::Lagged(n)) => {
                    assert!(n > 0);
                    lagged_seen = true;
                }
                Err(broadcast::error::TryRecvError::Empty) => break,
                Err(other) => panic!("unexpected {other:?}"),
            }
        }
        assert!(lagged_seen);
        BUS.send(BusEvent {
            name: "coding:test".into(),
            payload: json!({"fresh": true}),
        })
        .unwrap();
        let recovered = slow.try_recv().expect("recovers after drain");
        assert!(recovered.payload["fresh"].as_bool().unwrap());
    }
}
