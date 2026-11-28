#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, path::PathBuf, sync::{Arc, Mutex, atomic::{AtomicU64, Ordering}}, time::{Duration, Instant}};
use tauri::{Emitter, Manager, State, Webview, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_updater::UpdaterExt;
use tauri_plugin_window_state::{AppHandleExt, StateFlags};
#[cfg(windows)]
mod system_menu;

const PWA_URL: &str = "https://narusue.github.io/c-send.pwa/";
const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Item { id: String, title: String, value: String, mode: String, #[serde(default)] tags: Vec<String>, #[serde(default)] source: String }
#[derive(Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct Snapshot { api_version: u32, #[serde(default)] items: Vec<Item> }
#[derive(Default)]
struct AppState { snapshot: Mutex<Snapshot>, generation: AtomicU64, clicks: AtomicU64, window_save_generation: AtomicU64, last_click: Mutex<Option<Instant>>, last_double_click: Mutex<Option<Instant>>, top_menu: Mutex<Option<tauri::menu::CheckMenuItem<tauri::Wry>>>, tray_menu: Mutex<Option<tauri::menu::Menu<tauri::Wry>>>, pending: Mutex<HashMap<String, tokio::sync::oneshot::Sender<Result<String,String>>>> }

fn window_state_flags() -> StateFlags { StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED }

fn schedule_window_state_save(app: tauri::AppHandle) {
    let generation = app.state::<Arc<AppState>>().window_save_generation.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(700)).await;
        if app.state::<Arc<AppState>>().window_save_generation.load(Ordering::SeqCst) == generation {
            if let Err(error) = app.save_window_state(window_state_flags()) { eprintln!("Failed to save window state: {error}"); }
        }
    });
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WrapperInfo { wrapper_version: &'static str, api_version: u32, os: &'static str, quick_list_count: usize, capabilities: Vec<&'static str> }

fn require_main(webview: &Webview) -> Result<(),String> {
    let url=webview.url().map_err(|e|e.to_string())?;
    if webview.label()=="main" && url.scheme()=="https" && url.host_str()==Some("narusue.github.io") && url.path().starts_with("/c-send.pwa") { Ok(()) } else { Err("command unavailable in this webview".into()) }
}

#[tauri::command]
fn desktop_get_info(webview: Webview, state: State<'_, Arc<AppState>>) -> Result<WrapperInfo,String> {
    require_main(&webview)?;
    Ok(WrapperInfo { wrapper_version: VERSION, api_version: 1,
        os: if cfg!(target_os="windows") { "windows" } else if cfg!(target_os="macos") { "macos" } else { "linux" },
        quick_list_count: state.snapshot.lock().map_err(|e|e.to_string())?.items.len(),
        capabilities: vec!["quick-select", "clipboard-text", "template-resolve", "always-on-top", "diagnostic-log", "tray"] })
}
#[tauri::command]
fn desktop_publish_quick_list(snapshot: Snapshot, state: State<'_, Arc<AppState>>, app: tauri::AppHandle, webview: Webview) -> Result<(),String> {
    require_main(&webview)?;
    if snapshot.api_version != 1 { return Err("unsupported API version".into()); }
    let clean = Snapshot { api_version: 1, items: snapshot.items.into_iter().take(20).collect() };
    { let mut current = state.snapshot.lock().map_err(|e|e.to_string())?; *current = clean; state.generation.fetch_add(1, Ordering::SeqCst); }
    #[cfg(target_os="linux")]
    refresh_linux_menu(&app).map_err(|e|e.to_string())?;
    #[cfg(not(target_os="linux"))]
    let _ = app;
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
async fn select_item(item: Item, generation: u64, app: tauri::AppHandle) -> Result<(),String> {
    let state = app.state::<Arc<AppState>>();
    let text = if item.mode == "template" {
        let request_id = uuid::Uuid::new_v4().to_string();
        let (tx,rx) = tokio::sync::oneshot::channel();
        state.pending.lock().map_err(|e|e.to_string())?.insert(request_id.clone(), tx);
        let needs_clipboard = ["{{clipboard}}", "{{sort}}", "{{unique}}", "{{calc}}", "{{json}}", "{{uri_encode}}", "{{uri_decode}}"].iter().any(|needle|item.value.contains(needle));
        let context = if needs_clipboard { serde_json::json!({"clipboardText":app.clipboard().read_text().unwrap_or_default()}) } else { serde_json::json!({}) };
        app.emit("c-send-template-resolve", serde_json::json!({"requestId":request_id,"itemId":item.id,"context":context})).map_err(|e|e.to_string())?;
        match tokio::time::timeout(Duration::from_secs(30), rx).await { Ok(Ok(Ok(s)))=>s, _=>{state.pending.lock().ok().map(|mut p|p.remove(&request_id));return Err("template expansion failed".into())} }
    } else { item.value.clone() };
    if state.generation.load(Ordering::SeqCst) != generation { return Err("item is no longer available".into()); }
    app.clipboard().write_text(text).map_err(|e|e.to_string())?;
    let used_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let _ = app.emit("c-send-item-used", serde_json::json!({"itemId":item.id,"usedAt":used_at}));
    let _ = app.emit("c-send-log", serde_json::json!({"level":"info","event":"quick_select_copy_succeeded","at":used_at}));
    Ok(())
}
#[tauri::command]
fn desktop_set_always_on_top(enabled: bool, app: tauri::AppHandle, webview: Webview) -> Result<(),String> {
    require_main(&webview)?;
    apply_always_on_top(enabled, &app)
}
fn apply_always_on_top(enabled: bool, app: &tauri::AppHandle) -> Result<(),String> {
    app.get_webview_window("main").ok_or("main window missing")?.set_always_on_top(enabled).map_err(|e|e.to_string())?;
    if let Some(item) = app.state::<Arc<AppState>>().top_menu.lock().map_err(|e|e.to_string())?.as_ref() { item.set_checked(enabled).map_err(|e|e.to_string())?; }
    let path = settings_path(app)?;
    fs::create_dir_all(path.parent().ok_or("settings path missing parent")?).map_err(|e|e.to_string())?;
    fs::write(path, serde_json::json!({"alwaysOnTop":enabled}).to_string()).map_err(|e|e.to_string())
}
fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf,String> { Ok(app.path().app_config_dir().map_err(|e|e.to_string())?.join("settings.json")) }
fn saved_always_on_top(app: &tauri::AppHandle) -> bool { settings_path(app).ok().and_then(|p|fs::read_to_string(p).ok()).and_then(|s|serde_json::from_str::<serde_json::Value>(&s).ok()).and_then(|v|v.get("alwaysOnTop").and_then(|b|b.as_bool())).unwrap_or(false) }
fn show_main(app: &tauri::AppHandle) -> Result<(),String> { let w=app.get_webview_window("main").ok_or("main window missing")?; w.show().map_err(|e|e.to_string())?;w.set_focus().map_err(|e|e.to_string()) }
fn desktop_toggle_main(app: tauri::AppHandle) { if let Some(w)=app.get_webview_window("main") { if w.is_visible().unwrap_or(false) {let _=w.hide();} else {let _=w.show();let _=w.set_focus();} } }

fn populate_tray_menu(app: &tauri::AppHandle, menu: &tauri::menu::Menu<tauri::Wry>, include_items: bool) -> tauri::Result<()> {
    use tauri::menu::{MenuItem, PredefinedMenuItem};
    if include_items {
        let state = app.state::<Arc<AppState>>();
        let snapshot = state.snapshot.lock().unwrap();
        let generation = state.generation.load(Ordering::SeqCst);
        if snapshot.items.is_empty() { menu.append(&MenuItem::with_id(app,"empty","項目がありません",false,None::<&str>)?)?; }
        for (index,item) in snapshot.items.iter().enumerate() {
            let title = item.title.replace('&', "&&").replace(['\r','\n'], " ");
            menu.append(&MenuItem::with_id(app,format!("item:{generation}:{index}"),if title.is_empty(){"(名称なし)"}else{&title},true,None::<&str>)?)?;
        }
        #[cfg(target_os="linux")]
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }
    if !include_items || cfg!(target_os="linux") {
        for (id,title) in [("show","通常画面を表示"),("top","常に手前に表示"),("update","更新を確認"),("quit","終了")] {
            if id == "top" { if let Some(item)=app.state::<Arc<AppState>>().top_menu.lock().unwrap().as_ref() { menu.append(item)?; } continue; }
            menu.append(&MenuItem::with_id(app,id,title,true,None::<&str>)?)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::Snapshot;

    #[test]
    fn pwa_quick_list_payload_uses_camel_case_api_version() {
        let snapshot: Snapshot = serde_json::from_str(r#"{"apiVersion":1,"items":[{"id":"item-1","title":"表示中","value":"本文","mode":"plain","tags":["note.com"],"source":"local"}]}"#).unwrap();
        assert_eq!(snapshot.api_version, 1);
        assert_eq!(snapshot.items.len(), 1);
        assert_eq!(snapshot.items[0].title, "表示中");
        assert_eq!(snapshot.items[0].value, "本文");
    }

    #[test]
    fn quick_list_payload_without_api_version_is_rejected() {
        assert!(serde_json::from_str::<Snapshot>(r#"{"items":[]}"#).is_err());
    }
}
fn make_tray_menu(app: &tauri::AppHandle, include_items: bool) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let menu = tauri::menu::Menu::new(app)?;
    populate_tray_menu(app, &menu, include_items)?;
    Ok(menu)
}
#[cfg(target_os="linux")]
fn refresh_linux_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
    let state=app.state::<Arc<AppState>>();
    let menu=state.tray_menu.lock().unwrap().clone();
    if let Some(menu)=menu { for item in menu.items()? { menu.remove(&item)?; } populate_tray_menu(app,&menu,true)?; }
    Ok(())
}
fn show_quick(app: &tauri::AppHandle) {
    if let (Ok(menu),Some(window))=(make_tray_menu(app,true),app.get_webview_window("main")) { let _ = window.popup_menu(&menu); }
}
fn check_for_updates(handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Ok(updater)=handle.updater(){match updater.check().await {
            Ok(Some(update))=>{let version=update.version.clone();let yes=handle.dialog().message(format!("c-send {version} をダウンロードして更新しますか？")).title("更新があります").kind(MessageDialogKind::Info).buttons(MessageDialogButtons::YesNo).blocking_show();
                if yes {if handle.save_window_state(window_state_flags()).is_err(){handle.dialog().message("ウィンドウの位置とサイズを保存できませんでした。更新を中止します。").title("更新できませんでした").kind(MessageDialogKind::Error).blocking_show();}else if update.download_and_install(|_,_|{},||{}).await.is_ok(){handle.restart();}else{handle.dialog().message("更新に失敗しました。後でもう一度お試しください。").title("更新できませんでした").kind(MessageDialogKind::Error).blocking_show();}}},
            Ok(None)=>{handle.dialog().message("最新バージョンを使用しています。").title("更新確認").kind(MessageDialogKind::Info).blocking_show();},
            Err(_)=>{handle.dialog().message("更新を確認できませんでした。ネットワーク接続を確認してください。").title("更新確認").kind(MessageDialogKind::Error).blocking_show();}
        }}
    });
}
fn main() {
    let state=Arc::new(AppState::default());
    let visibility_shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
    tauri::Builder::default().manage(state)
        .plugin(tauri_plugin_clipboard_manager::init()).plugin(tauri_plugin_dialog::init()).plugin(tauri_plugin_window_state::Builder::default().with_state_flags(window_state_flags()).build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, shortcut, event| {
            let toggle = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
            if shortcut == &toggle && event.state() == ShortcutState::Pressed { desktop_toggle_main(app.clone()); }
        }).build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![desktop_get_info,desktop_publish_quick_list,desktop_respond_template,desktop_set_always_on_top])
        .setup(move |app| {
            // The main window and tray must still work if another app owns this shortcut.
            let _ = app.global_shortcut().register(visibility_shortcut);
            let builder=WebviewWindowBuilder::new(app,"main",WebviewUrl::External(PWA_URL.parse().unwrap())).title("c-send").inner_size(1000.0,760.0).min_inner_size(320.0,320.0);
            #[cfg(debug_assertions)]
            let builder=builder.on_page_load(|window,payload| {
                if std::env::var_os("CSEND_CI_BRIDGE_CHECK").is_some() && matches!(payload.event(),tauri::webview::PageLoadEvent::Finished) {
                    let _=window.eval(r#"(async()=>{try{for(let i=0;i<60&&(!window.CsendDesktop?.available||document.querySelector('#appVersion')?.style.visibility!=='visible');i++)await new Promise(r=>setTimeout(r,1000));const api=window.CsendDesktop;if(!api?.available)throw Error('bridge unavailable');if(getComputedStyle(document.querySelector('#installTrigger')).display!=='none')throw Error('install button visible');const before=await api.getInfo();if(before.wrapperVersion!=='0.0.5')throw Error('version mismatch');document.querySelector('#newButton').click();await new Promise(r=>setTimeout(r,1000));document.querySelector('#name').value='実画面の連携確認';document.querySelector('#value').value='test text';document.querySelector('#itemTags').value='連携確認';document.querySelector('#saveButton').click();for(let i=0;i<20&&!document.querySelector('.item-title')?.textContent.includes('実画面の連携確認');i++)await new Promise(r=>setTimeout(r,500));if(!document.querySelector('.item-title')?.textContent.includes('実画面の連携確認'))throw Error('item not rendered');document.querySelector('[data-tag=連携確認]')?.click();let after;for(let i=0;i<20;i++){after=await api.getInfo();if(after.quickListCount===1)break;await new Promise(r=>setTimeout(r,500))}if(after.quickListCount!==1)throw Error('render list not received: '+after.quickListCount);await window.__TAURI__.window.getCurrentWindow().setTitle('CSEND_CI_BRIDGE_PASS')}catch(e){try{await window.__TAURI__.window.getCurrentWindow().setTitle('CSEND_CI_BRIDGE_FAIL: '+String(e))}catch{document.title='CSEND_CI_BRIDGE_FAIL'}}})()"#);
                }
            });
            let main=builder.build()?;
            let _=main.set_always_on_top(saved_always_on_top(app.handle()));
            #[cfg(windows)]
            system_menu::install(&main)?;
            {
                let check=tauri::menu::CheckMenuItem::with_id(app,"top","常に手前に表示",true,main.is_always_on_top().unwrap_or(false),None::<&str>)?;
                *app.state::<Arc<AppState>>().top_menu.lock().unwrap()=Some(check);
                let icon=tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
                let menu=make_tray_menu(app.handle(),cfg!(target_os="linux"))?;
                *app.state::<Arc<AppState>>().tray_menu.lock().unwrap()=Some(menu.clone());
                tauri::tray::TrayIconBuilder::with_id("main-tray").icon(icon).menu(&menu).show_menu_on_left_click(false)
                    .on_menu_event(move |app,event| match event.id().as_ref(){
                        "show"=>{let _=show_main(app);},
                        "top"=>if let Some(w)=app.get_webview_window("main"){let current=w.is_always_on_top().unwrap_or(false);let _=apply_always_on_top(!current,app);},
                        "update"=>check_for_updates(app.clone()),
                        "quit"=>{let yes=app.dialog().message("c-sendを終了しますか？").title("終了の確認").kind(MessageDialogKind::Warning).buttons(MessageDialogButtons::YesNo).blocking_show();if yes{app.exit(0);}},id=>{
                            let mut parts=id.split(':');
                            if parts.next()==Some("item") { if let (Some(Ok(generation)),Some(Ok(index)))=(parts.next().map(str::parse::<u64>),parts.next().map(str::parse::<usize>)) {
                                let state=app.state::<Arc<AppState>>();
                                let item=state.snapshot.lock().ok().and_then(|s| if state.generation.load(Ordering::SeqCst)==generation {s.items.get(index).cloned()} else {None});
                                if let Some(item)=item {let app=app.clone(); tauri::async_runtime::spawn(async move {if let Err(error)=select_item(item,generation,app.clone()).await {app.dialog().message(error).title("コピーできませんでした").kind(MessageDialogKind::Error).show(|_|{});}});}
                            }}
                        }})
                    .on_tray_icon_event(|tray,event| match event {
                        tauri::tray::TrayIconEvent::Click{button:tauri::tray::MouseButton::Left,button_state:tauri::tray::MouseButtonState::Up,..}=>{let app=tray.app_handle().clone();let state=app.state::<Arc<AppState>>();if state.last_double_click.lock().ok().and_then(|time|*time).map(|time|time.elapsed()<Duration::from_millis(500)).unwrap_or(false) {return;}
                            #[cfg(target_os="macos")]
                            {let mut last=state.last_click.lock().unwrap();if last.map(|time|time.elapsed()<Duration::from_millis(500)).unwrap_or(false) {*last=None;state.clicks.fetch_add(1,Ordering::SeqCst);let _=show_main(&app);return;}*last=Some(Instant::now());}
                            let token=state.clicks.fetch_add(1,Ordering::SeqCst)+1;drop(state);tauri::async_runtime::spawn(async move {tokio::time::sleep(Duration::from_millis(500)).await;if app.state::<Arc<AppState>>().clicks.load(Ordering::SeqCst)==token {show_quick(&app);}});},
                        tauri::tray::TrayIconEvent::DoubleClick{button:tauri::tray::MouseButton::Left,..}=>{let state=tray.app_handle().state::<Arc<AppState>>();state.clicks.fetch_add(1,Ordering::SeqCst);if let Ok(mut time)=state.last_double_click.lock(){*time=Some(Instant::now());}let _=show_main(tray.app_handle());},
                        _=>{}
                    })
                    .build(app)?;
          }
            Ok(())
        })
        .on_window_event(|window,event| if window.label()=="main" { match event {
            tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => schedule_window_state_save(window.app_handle().clone()),
            tauri::WindowEvent::CloseRequested{api,..} => {api.prevent_close();let _=window.hide();},
            _ => {}
        } })
        .run(tauri::generate_context!()).expect("failed to run c-send");
}
