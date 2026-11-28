fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "desktop_get_info", "desktop_publish_quick_list", "desktop_respond_template", "desktop_set_always_on_top"
        ]),
    )).expect("failed to build Tauri application");
}
