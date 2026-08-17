//! 通知排障探针（临时，验证后删除）：直接调 notify 的发送函数发一条
//! 真实形态的 toast（模板 XML + launch + tag/group）。
//! 用法：cargo run --example toast_probe --release

fn main() {
    // notify::send_attention_toast 是私有的，这里按同配方重发一条完整形态
    use windows::{
        core::{HSTRING, Interface},
        Data::Xml::Dom::IXmlNode,
        UI::Notifications::{ToastNotification, ToastNotificationManager, ToastTemplateType},
    };
    let doc = ToastNotificationManager::GetTemplateContent(ToastTemplateType::ToastText02).unwrap();
    let texts = doc.GetElementsByTagName(&HSTRING::from("text")).unwrap();
    let node = texts.Item(0).unwrap();
    let tn = doc.CreateTextNode(&HSTRING::from("探针：完整形态（模板+launch+tag）")).unwrap();
    node.AppendChild(&tn.cast::<IXmlNode>().unwrap()).unwrap();
    let node2 = texts.Item(1).unwrap();
    let tn2 = doc.CreateTextNode(&HSTRING::from("与 notify.rs 发送路径一致")).unwrap();
    node2.AppendChild(&tn2.cast::<IXmlNode>().unwrap()).unwrap();
    let root = doc.DocumentElement().unwrap();
    root.SetAttribute(&HSTRING::from("launch"), &HSTRING::from("--aish-task=probe"))
        .unwrap();
    let n = ToastNotification::CreateToastNotification(&doc).unwrap();
    n.SetTag(&HSTRING::from("probe-tag-1")).unwrap();
    n.SetGroup(&HSTRING::from("aish-attention")).unwrap();
    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from("com.johnny.ai-ssh"))
        .unwrap();
    println!("full-shape show: {:?}", notifier.Show(&n));
}
