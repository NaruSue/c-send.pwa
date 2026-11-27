#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, path::PathBuf, sync::{Arc, Mutex}, time::Duration};
use tauri::{Emitter, Manager, State, Webview, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_updater::UpdaterExt;

const PWA_URL: &str = "https://narusue.github.io/c-send.pwa/";
const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Item { id: String, title: String, value: String, mode: String, #[serde(default)] tags: Vec<String>, #[serde(default)] source: String }
#[derive(Clone, Deserialize, Serialize, Default)]
struct Snapshot { #[serde(default)] api_version: u32, #[serde(default)] items: Vec<Item> }
#[derive(Default)]
struct AppState { snapshot: Mutex<Snapshot>, pending: Mutex<HashMap<String, tokio::sync::oneshot::Sender<Result<String,String>>>> }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WrapperInfo { wrapper_version: &'static str, api_version: u32, os: &'static str, capabilities: Vec<&'static str> }

fn require_main(webview: &Webview) -> Result<(),String> {
    let url=webview.url().map_err(|e|e.to_string())?;
    if webview.label()=="main" && url.scheme()=="https" && url.host_str()==Some("narusue.github.io") && url.path().starts_with("/c-send.pwa") { Ok(()) } else { Err("command unavailable in this webview".into()) }
}
fn require_quick(webview: &Webview) -> Result<(),String> { if webview.label()=="quick" { Ok(()) } else { Err("command unavailable in this webview".into()) } }

#[tauri::command]
fn desktop_get_info(webview: Webview) -> Result<WrapperInfo,String> {
    require_main(&webview)?;
    Ok(WrapperInfo { wrapper_version: VERSION, api_version: 1,
        os: if cfg!(target_os="windows") { "windows" } else if cfg!(target_os="macos") { "macos" } else { "linux" },
        capabilities: vec!["quick-select", "clipboard-text", "template-resolve", "always-on-top", "diagnostic-log", "tray"] })
}
#[tauri::command]
fn desktop_publish_quick_list(snapshot: Snapshot, state: State<'_, Arc<AppState>>, app: tauri::AppHandle, webview: Webview) -> Result<(),String> {
    require_main(&webview)?;
    if snapshot.api_version != 1 { return Err("unsupported API version".into()); }
    let clean = Snapshot { api_version: 1, items: snapshot.items.into_iter().take(20).collect() };
    *state.snapshot.lock().map_err(|e|e.to_string())? = clean.clone();
    if let Some(window) = app.get_webview_window("quick") { let _ = window.emit("quick-list-updated", &clean); }
    Ok(())
}
#[tauri::command]
fn desktop_respond_template(request_id: String, item_id: String, payload: Option<serde_json::Value>, error: Option<String>, state: State<'_, Arc<AppState>>, webview: Webview) -> Result<(),String> {
    require_main(&webview)?;
    let tx = state.pending.lock().map_err(|e|e.to_string())?.remove(&request_id).ok_or("unknown template request")?;
    let result = if let Some(error) = error { Err(error) } else if let Some(text) = payload.and_then(|v|v.get("text").and_then(|x|x.as_str()).map(str::to_owned)) { Ok(text) } else { Err("invalid template response".into()) };
    let _ = item_id;
    let _ = tx.send(result); Ok(())
}
#[tauri::command]
async fn desktop_select_item(item_id: String, app: tauri::AppHandle, state: State<'_, Arc<AppState>>, webview: Webview) -> Result<(),String> {
    require_quick(&webview)?;
    let item = state.snapshot.lock().map_err(|e|e.to_string())?.items.iter().find(|x|x.id == item_id).cloned().ok_or("item is no longer available")?;
    let text = if item.mode == "template" {
        let request_id = uuid::Uuid::new_v4().to_string();
        let (tx,rx) = tokio::sync::oneshot::channel();
        state.pending.lock().map_err(|e|e.to_string())?.insert(request_id.clone(), tx);
        let needs_clipboard = ["{{clipboard}}", "{{sort}}", "{{unique}}", "{{calc}}", "{{json}}", "{{uri_encode}}", "{{uri_decode}}"].iter().any(|needle|item.value.contains(needle));
        let context = if needs_clipboard { serde_json::json!({"clipboardText":app.clipboard().read_text().unwrap_or_default()}) } else { serde_json::json!({}) };
        app.emit("c-send-template-resolve", serde_json::json!({"requestId":request_id,"itemId":item.id,"context":context})).map_err(|e|e.to_string())?;
        match tokio::time::timeout(Duration::from_secs(30), rx).await { Ok(Ok(Ok(s)))=>s, _=>{state.pending.lock().ok().map(|mut p|p.remove(&request_id));return Err("template expansion failed".into())} }
    } else { item.value.clone() };
    app.clipboard().write_text(text).map_err(|e|e.to_string())?;
    let used_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let _ = app.emit("c-send-item-used", serde_json::json!({"itemId":item.id,"usedAt":used_at}));
    let _ = app.emit("c-send-log", serde_json::json!({"level":"info","event":"quick_select_copy_succeeded","at":used_at}));
    if let Some(window) = app.get_webview_window("quick") { let _ = window.hide(); }
    Ok(())
}
#[tauri::command]
fn desktop_get_quick_list(state: State<'_, Arc<AppState>>, webview: Webview) -> Result<Snapshot,String> { require_quick(&webview)?; Ok(state.snapshot.lock().map(|s|s.clone()).unwrap_or_default()) }
#[tauri::command]
fn desktop_set_always_on_top(enabled: bool, app: tauri::AppHandle, webview: Webview) -> Result<(),String> {
    require_main(&webview)?;
    apply_always_on_top(enabled, &app)
}
fn apply_always_on_top(enabled: bool, app: &tauri::AppHandle) -> Result<(),String> {
    app.get_webview_window("main").ok_or("main window missing")?.set_always_on_top(enabled).map_err(|e|e.to_string())?;
    let path = settings_path(app)?;
    fs::create_dir_all(path.parent().ok_or("settings path missing parent")?).map_err(|e|e.to_string())?;
    fs::write(path, serde_json::json!({"alwaysOnTop":enabled}).to_string()).map_err(|e|e.to_string())
}
fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf,String> { Ok(app.path().app_config_dir().map_err(|e|e.to_string())?.join("settings.json")) }
fn saved_always_on_top(app: &tauri::AppHandle) -> bool { settings_path(app).ok().and_then(|p|fs::read_to_string(p).ok()).and_then(|s|serde_json::from_str::<serde_json::Value>(&s).ok()).and_then(|v|v.get("alwaysOnTop").and_then(|b|b.as_bool())).unwrap_or(false) }
#[tauri::command]
fn desktop_show_main(app: tauri::AppHandle, webview: Webview) -> Result<(),String> { require_quick(&webview)?; show_main(&app) }
fn show_main(app: &tauri::AppHandle) -> Result<(),String> { let w=app.get_webview_window("main").ok_or("main window missing")?; w.show().map_err(|e|e.to_string())?;w.set_focus().map_err(|e|e.to_string()) }
fn desktop_toggle_main(app: tauri::AppHandle) { if let Some(w)=app.get_webview_window("main") { if w.is_visible().unwrap_or(false) {let _=w.hide();} else {let _=w.show();let _=w.set_focus();} } }

fn show_quick(app: &tauri::AppHandle) {
    if let Some(w)=app.get_webview_window("quick") { let _=w.emit("quick-list-updated", app.state::<Arc<AppState>>().snapshot.lock().map(|s|s.clone()).unwrap_or_default()); let _=w.emit("quick-list-opened", ()); let _=w.show();let _=w.set_focus();return; }
    if let Ok(w)=WebviewWindowBuilder::new(app,"quick",WebviewUrl::App("quick.html".into())).title("c-send クイック選択").inner_size(420.0,520.0).resizable(false).always_on_top(true).center().build() {
        let state=app.state::<Arc<AppState>>().snapshot.lock().map(|s|s.clone()).unwrap_or_default();let _=w.emit("quick-list-updated",state);let _=w.emit("quick-list-opened",());
    }
}
fn main() {
    let state=Arc::new(AppState::default());
    let visibility_shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
    tauri::Builder::default().manage(state)
        .plugin(tauri_plugin_clipboard_manager::init()).plugin(tauri_plugin_dialog::init()).plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, shortcut, event| {
            let toggle = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
            if shortcut == &toggle && event.state() == ShortcutState::Pressed { desktop_toggle_main(app.clone()); }
        }).build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![desktop_get_info,desktop_publish_quick_list,desktop_respond_template,desktop_select_item,desktop_get_quick_list,desktop_set_always_on_top,desktop_show_main])
        .setup(|app| {
            app.global_shortcut().register(visibility_shortcut)?;
            let main=WebviewWindowBuilder::new(app,"main",WebviewUrl::External(PWA_URL.parse().unwrap())).title("c-send").inner_size(1000.0,760.0).min_inner_size(640.0,480.0).build()?;
            let _=main.set_always_on_top(saved_always_on_top(app.handle()));
            {
                let icon=tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
                let menu=tauri::menu::Menu::with_items(app,&[
                    &tauri::menu::MenuItem::with_id(app,"show","通常画面を表示",true,None::<&str>)?,
                    &tauri::menu::MenuItem::with_id(app,"quick","クイック選択",true,None::<&str>)?,
                    &tauri::menu::MenuItem::with_id(app,"top","常に手前に表示を切替",true,None::<&str>)?,
                    &tauri::menu::MenuItem::with_id(app,"update","更新を確認",true,None::<&str>)?,
                    &tauri::menu::MenuItem::with_id(app,"quit","終了",true,None::<&str>)?])?;
                tauri::tray::TrayIconBuilder::new().icon(icon).menu(&menu).show_menu_on_left_click(false)
                    .on_menu_event(move |app,event| match event.id().as_ref(){
                        "show"=>{let _=show_main(app);},
                        "quick"=>show_quick(app),
                        "top"=>if let Some(w)=app.get_webview_window("main"){let current=w.is_always_on_top().unwrap_or(false);let _=apply_always_on_top(!current,app);},
                        "update"=>{let handle=app.clone();tauri::async_runtime::spawn(async move {
                            if let Ok(updater)=handle.updater(){match updater.check().await {
                                Ok(Some(update))=>{let version=update.version.clone();let yes=handle.dialog().message(format!("c-send {version} をダウンロードして更新しますか？")).title("更新があります").kind(MessageDialogKind::Info).buttons(MessageDialogButtons::YesNo).blocking_show();
                                    if yes {if update.download_and_install(|_,_|{},||{}).await.is_ok(){handle.restart();}else{handle.dialog().message("更新に失敗しました。後でもう一度お試しください。").title("更新できませんでした").kind(MessageDialogKind::Error).blocking_show();}}},
                                Ok(None)=>{handle.dialog().message("最新バージョンを使用しています。").title("更新確認").kind(MessageDialogKind::Info).blocking_show();},
                                Err(_)=>{handle.dialog().message("更新を確認できませんでした。ネットワーク接続を確認してください。").title("更新確認").kind(MessageDialogKind::Error).blocking_show();}
                            }}
                        });},
                        "quit"=>{let yes=app.dialog().message("c-sendを終了しますか？").title("終了の確認").kind(MessageDialogKind::Warning).buttons(MessageDialogButtons::YesNo).blocking_show();if yes{app.exit(0);}},_=>{}})
                    .on_tray_icon_event(|tray,event| match event {
                        tauri::tray::TrayIconEvent::Click{button:tauri::tray::MouseButton::Left,button_state:tauri::tray::MouseButtonState::Up,..}=>show_quick(tray.app_handle()),
                        tauri::tray::TrayIconEvent::DoubleClick{button:tauri::tray::MouseButton::Left,..}=>{let _=show_main(tray.app_handle());},
                        _=>{}
                    })
                    .build(app)?;
          }
            Ok(())
        })
        .on_window_event(|window,event| if window.label()=="main" { if let tauri::WindowEvent::CloseRequested{api,..}=event {api.prevent_close();let _=window.hide();} })
        .run(tauri::generate_context!()).expect("failed to run c-send");
}
