use tauri::Manager;
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    AppendMenuW, CheckMenuItem, GetSystemMenu, GetWindowLongPtrW, GWL_EXSTYLE,
    MF_BYCOMMAND, MF_CHECKED, MF_GRAYED, MF_SEPARATOR, MF_STRING, MF_UNCHECKED,
    WM_INITMENUPOPUP, WM_NCDESTROY, WM_SYSCOMMAND, WS_EX_TOPMOST,
};

const TOP: usize = 0x1100;
const UPDATE: usize = 0x1110;
const VERSION: usize = 0x1120;
const SUBCLASS: usize = 0x4353;

fn wide(value: &str) -> Vec<u16> { value.encode_utf16().chain(Some(0)).collect() }

pub fn install(window: &tauri::WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    let hwnd = window.hwnd()?.0 as HWND;
    unsafe {
        let menu = GetSystemMenu(hwnd, 0);
        if menu.is_null() { return Err(std::io::Error::last_os_error().into()); }
        if AppendMenuW(menu, MF_SEPARATOR, 0, std::ptr::null()) == 0
            || AppendMenuW(menu, MF_STRING, TOP, wide("常に手前に表示").as_ptr()) == 0
            || AppendMenuW(menu, MF_STRING, UPDATE, wide("アプリの更新を確認").as_ptr()) == 0
            || AppendMenuW(menu, MF_STRING | MF_GRAYED, VERSION, wide(&format!("c-send wrap v{}", super::VERSION)).as_ptr()) == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        let data = Box::into_raw(Box::new(window.app_handle().clone()));
        if SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS, data as usize) == 0 {
            drop(Box::from_raw(data));
            return Err(std::io::Error::last_os_error().into());
        }
    }
    Ok(())
}

unsafe extern "system" fn subclass_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM, _id: usize, data: usize) -> LRESULT {
    let app = &*(data as *const tauri::AppHandle);
    match msg {
        WM_INITMENUPOPUP => {
            let checked = (GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST) != 0;
            CheckMenuItem(GetSystemMenu(hwnd, 0), TOP as u32, MF_BYCOMMAND | if checked { MF_CHECKED } else { MF_UNCHECKED });
        }
        WM_SYSCOMMAND => match wparam & 0xfff0 {
            TOP => {
                let checked = (GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST) != 0;
                let _ = super::apply_always_on_top(!checked, app);
                return 0;
            }
            UPDATE => { super::check_for_updates(app.clone()); return 0; }
            _ => {}
        },
        WM_NCDESTROY => {
            RemoveWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS);
            drop(Box::from_raw(data as *mut tauri::AppHandle));
        }
        _ => {}
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}
