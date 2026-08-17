//! 通知排障探针 v4（临时，验证后删除）：验证进程内 Activated 事件回调
//! ——模板 toast + launch 属性 + Activated handler，保持通知对象存活，
//! 控制台等待事件。点弹出的 toast，若控制台打出 ACTIVATED 即该机制可用。
//! 用法：cargo run --example toast_probe --release

use std::sync::mpsc;

use windows::{
    core::{HSTRING, Interface},
    Data::Xml::Dom::IXmlNode,
    Foundation::TypedEventHandler,
    UI::Notifications::{
        ToastActivatedEventArgs, ToastNotification, ToastNotificationManager, ToastTemplateType,
    },
};

fn main() {
    let (tx, rx) = mpsc::channel::<String>();

    // 模板 toast + launch 属性（与 notify.rs 发送形态一致）
    let doc = ToastNotificationManager::GetTemplateContent(ToastTemplateType::ToastText02).unwrap();
    let texts = doc.GetElementsByTagName(&HSTRING::from("text")).unwrap();
    let n0 = texts.Item(0).unwrap();
    let t0 = doc.CreateTextNode(&HSTRING::from("探针v4：Activated 回调测试")).unwrap();
    n0.AppendChild(&t0.cast::<IXmlNode>().unwrap()).unwrap();
    let n1 = texts.Item(1).unwrap();
    let t1 = doc.CreateTextNode(&HSTRING::from("点我——控制台打印即成功")).unwrap();
    n1.AppendChild(&t1.cast::<IXmlNode>().unwrap()).unwrap();
    let root = doc.DocumentElement().unwrap();
    root.SetAttribute(&HSTRING::from("launch"), &HSTRING::from("--aish-task=probe-v4"))
        .unwrap();

    let notification = ToastNotification::CreateToastNotification(&doc).unwrap();

    // Activated 回调：toast 被点击时进程内触发
    let tx_activated = tx.clone();
    let handler = TypedEventHandler::<ToastNotification, windows::core::IInspectable>::new(
        move |_sender, args| {
            let arg = args
                .as_ref()
                .and_then(|a| a.cast::<ToastActivatedEventArgs>().ok())
                .and_then(|e| e.Arguments().ok())
                .map(|s| s.to_string())
                .unwrap_or_default();
            tx_activated.send(format!("ACTIVATED arg={arg}")).ok();
            Ok(())
        },
    );
    notification.Activated(&handler).unwrap();

    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from("com.johnny.ai-ssh"))
        .unwrap();
    // 通知对象必须存活，否则事件接线随对象销毁——先克隆保活再 Show
    let keep = notification.clone();
    println!("show: {:?}", notifier.Show(&notification));
    std::mem::forget(keep);
    std::mem::forget(notifier);

    println!("waiting 90s for click...");
    if let Ok(msg) = rx.recv_timeout(std::time::Duration::from_secs(90)) {
        println!("event: {msg}");
    } else {
        println!("timeout, no event");
    }
}
