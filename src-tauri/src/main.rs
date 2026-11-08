// Кот Депресняк — хост на Tauri.
// Оригинальный cat.swf проигрывает Ruffle в прозрачном окне поверх всех окон (как MDM Zinc):
// левая кнопка мыши таскает кота, правая открывает его меню, в трее — настройки.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs,
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::{
    http,
    menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow, WindowEvent, Wry,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as _};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

const STAGE_W: f64 = 920.0;
const STAGE_H: f64 = 750.0;
const SCALES: [u32; 6] = [30, 40, 50, 64, 80, 100];
const TITLE: &str = "Кот Депресняк";
const DEFAULT_ABOUT: &str = "Помесь адского кота и райской кошечки из хулиганского фэнтази «Мефодий Буслаев». \
Биовампир, забияка, обладает кошмарным характером и чудовищным аппетитом.";

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
struct Settings {
    scale: u32,
    on_top: bool,
    muted: bool,
    x: Option<i32>,
    y: Option<i32>,
}

impl Default for Settings {
    fn default() -> Self {
        Self { scale: 64, on_top: true, muted: false, x: None, y: None }
    }
}

struct AppState {
    settings: Mutex<Settings>,
    last_save: Mutex<Instant>,
}

fn settings_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("settings.json"))
}

fn load_settings(app: &AppHandle) -> Settings {
    settings_path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_settings(app: &AppHandle) {
    let state = app.state::<AppState>();
    let s = state.settings.lock().unwrap().clone();
    if let Some(p) = settings_path(app) {
        if let Some(dir) = p.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let _ = fs::write(p, serde_json::to_string_pretty(&s).unwrap_or_default());
    }
    *state.last_save.lock().unwrap() = Instant::now();
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

// ---------- размер и положение ----------

/// Размер окна в физических пикселях: высота = scale% рабочей области, пропорции сцены 920x750.
fn window_size(win: &WebviewWindow, scale: u32) -> (PhysicalSize<u32>, PhysicalPosition<i32>, PhysicalSize<u32>) {
    let mon = win.current_monitor().ok().flatten().or_else(|| win.primary_monitor().ok().flatten());
    let (wa_pos, wa_size) = match &mon {
        Some(m) => (m.work_area().position, m.work_area().size),
        None => (PhysicalPosition::new(0, 0), PhysicalSize::new(1920, 1040)),
    };
    let h = (wa_size.height as f64 * scale as f64 / 100.0).round();
    let w = (h * STAGE_W / STAGE_H).round();
    (PhysicalSize::new(w as u32, h as u32), wa_pos, wa_size)
}

/// Не даём коту потеряться за краем экрана целиком.
fn clamp(x: i32, y: i32, size: PhysicalSize<u32>, wa_pos: PhysicalPosition<i32>, wa_size: PhysicalSize<u32>) -> (i32, i32) {
    let vis = 80;
    let (w, h) = (size.width as i32, size.height as i32);
    let x = x.clamp(wa_pos.x - w + vis, wa_pos.x + wa_size.width as i32 - vis);
    let y = y.clamp(wa_pos.y - h + vis, wa_pos.y + wa_size.height as i32 - vis);
    (x, y)
}

/// Выставляет размер окна по настройке масштаба. `keep_center` — масштабировать относительно
/// центра текущего окна, иначе взять сохранённую позицию (или центр экрана, если её нет).
fn apply_geometry(app: &AppHandle, mode: Geometry) {
    let Some(win) = main_window(app) else { return };
    let state = app.state::<AppState>();
    let mut s = state.settings.lock().unwrap();
    let (size, wa_pos, wa_size) = window_size(&win, s.scale);
    let centered = (
        wa_pos.x + (wa_size.width as i32 - size.width as i32) / 2,
        wa_pos.y + (wa_size.height as i32 - size.height as i32) / 2,
    );
    let (x, y) = match mode {
        Geometry::Center => centered,
        Geometry::Saved => match (s.x, s.y) {
            (Some(x), Some(y)) => (x, y),
            _ => centered,
        },
        Geometry::KeepCenter => {
            let old_pos = win.outer_position().unwrap_or(PhysicalPosition::new(centered.0, centered.1));
            let old = win.outer_size().unwrap_or(size);
            let cx = old_pos.x + old.width as i32 / 2;
            let cy = old_pos.y + old.height as i32 / 2;
            (cx - size.width as i32 / 2, cy - size.height as i32 / 2)
        }
    };
    let (x, y) = clamp(x, y, size, wa_pos, wa_size);
    let _ = win.set_size(size);
    let _ = win.set_position(PhysicalPosition::new(x, y));
    s.x = Some(x);
    s.y = Some(y);
    drop(s);
    save_settings(app);
}

#[derive(Clone, Copy)]
enum Geometry {
    Saved,
    Center,
    KeepCenter,
}

fn show_cat(app: &AppHandle) {
    if let Some(win) = main_window(app) {
        let on_top = app.state::<AppState>().settings.lock().unwrap().on_top;
        let _ = win.show();
        let _ = win.set_always_on_top(on_top);
    }
    rebuild_tray_menu(app);
}

fn hide_cat(app: &AppHandle) {
    if let Some(win) = main_window(app) {
        let _ = win.hide();
    }
    rebuild_tray_menu(app);
}

fn show_about(app: &AppHandle, text: Option<String>) {
    let body = format!(
        "{}\n\nПорт оригинальной программы (MDM Zinc + Flash, 2007) на Tauri и Ruffle. \
         Анимация и звук — из оригинального cat.swf.",
        text.filter(|t| !t.is_empty()).unwrap_or_else(|| DEFAULT_ABOUT.to_string())
    );
    let mut dlg = app
        .dialog()
        .message(body)
        .title(format!("О программе — {TITLE}"))
        .kind(MessageDialogKind::Info);
    // окно-владелец — кот: иначе диалог оказывается под котом, который поверх всех окон
    if let Some(win) = main_window(app).filter(|w| w.is_visible().unwrap_or(false)) {
        dlg = dlg.parent(&win);
    }
    dlg.show(|_| {});
}

// ---------- команды из страницы ----------

/// Вызовы mdm.* из ролика (через fscommand, см. tools/patch_swf.py).
#[tauri::command]
fn fscommand(app: AppHandle, cmd: String, arg: String) {
    match cmd.to_lowercase().as_str() {
        "exit" => app.exit(0),
        "minimize" => hide_cat(&app), // как minimizeToTray(true): прячемся в трей
        "prompt" => show_about(&app, Some(arg)),
        _ => {}
    }
}

#[tauri::command]
fn exit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn open_url(app: AppHandle, url: String) {
    if url.starts_with("http://") || url.starts_with("https://") {
        let _ = app.opener().open_url(url, None::<&str>);
    }
}

#[tauri::command]
fn get_settings(app: AppHandle) -> Settings {
    app.state::<AppState>().settings.lock().unwrap().clone()
}

/// Положение курсора относительно окна в CSS-пикселях, если он над окном.
#[tauri::command]
fn cursor_in_window(window: WebviewWindow) -> Option<(f64, f64)> {
    let c = window.cursor_position().ok()?;
    let p = window.inner_position().ok()?;
    let s = window.inner_size().ok()?;
    let k = window.scale_factor().unwrap_or(1.0);
    let (x, y) = (c.x - p.x as f64, c.y - p.y as f64);
    if x < 0.0 || y < 0.0 || x >= s.width as f64 || y >= s.height as f64 {
        return None;
    }
    Some((x / k, y / k))
}

/// Самотест (только если задана переменная CAT_SELFTEST=<пункт меню>), см. ui/selftest.js.
#[tauri::command]
fn selftest_config() -> Option<String> {
    std::env::var("CAT_SELFTEST").ok()
}

#[tauri::command]
fn selftest_log(msg: String) {
    if let Ok(path) = std::env::var("CAT_SELFTEST_LOG") {
        use std::io::Write;
        if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(f, "{msg}");
        }
    }
}

// ---------- трей ----------

fn rebuild_tray_menu(app: &AppHandle) {
    let Some(tray) = app.tray_by_id("main") else { return };
    if let Ok(menu) = build_tray_menu(app) {
        let _ = tray.set_menu(Some(menu));
    }
}

fn build_tray_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let s = app.state::<AppState>().settings.lock().unwrap().clone();
    let visible = main_window(app).and_then(|w| w.is_visible().ok()).unwrap_or(false);
    let autostart = app.autolaunch().is_enabled().unwrap_or(false);

    let toggle = MenuItem::with_id(app, "toggle", if visible { "Спрятать кота" } else { "Показать кота" }, true, None::<&str>)?;
    let scale_items = SCALES
        .iter()
        .map(|&v| {
            let label = if v == 64 { format!("{v}% высоты экрана (как в оригинале)") } else { format!("{v}% высоты экрана") };
            CheckMenuItem::with_id(app, format!("scale_{v}"), label, true, s.scale == v, None::<&str>)
        })
        .collect::<tauri::Result<Vec<_>>>()?;
    let scale_refs: Vec<&dyn IsMenuItem<Wry>> = scale_items.iter().map(|i| i as &dyn IsMenuItem<Wry>).collect();
    let size = Submenu::with_items(app, "Размер", true, &scale_refs)?;
    let on_top = CheckMenuItem::with_id(app, "on_top", "Поверх всех окон", true, s.on_top, None::<&str>)?;
    let muted = CheckMenuItem::with_id(app, "muted", "Без звука", true, s.muted, None::<&str>)?;
    let center = MenuItem::with_id(app, "center", "Вернуть в центр экрана", true, None::<&str>)?;
    let auto = CheckMenuItem::with_id(app, "autostart", "Запускать вместе с Windows", true, autostart, None::<&str>)?;
    let about = MenuItem::with_id(app, "about", "О программе", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    Menu::with_items(app, &[&toggle, &sep1, &size, &on_top, &muted, &center, &auto, &sep2, &about, &quit])
}

fn on_tray_menu(app: &AppHandle, id: &str) {
    let state = app.state::<AppState>();
    match id {
        "toggle" => {
            let visible = main_window(app).and_then(|w| w.is_visible().ok()).unwrap_or(false);
            if visible {
                hide_cat(app)
            } else {
                show_cat(app)
            }
            return;
        }
        "on_top" => {
            let v = {
                let mut s = state.settings.lock().unwrap();
                s.on_top = !s.on_top;
                s.on_top
            };
            if let Some(w) = main_window(app) {
                let _ = w.set_always_on_top(v);
            }
            save_settings(app);
        }
        "muted" => {
            let v = {
                let mut s = state.settings.lock().unwrap();
                s.muted = !s.muted;
                s.muted
            };
            let _ = app.emit("muted", v);
            save_settings(app);
        }
        "center" => apply_geometry(app, Geometry::Center),
        "autostart" => {
            let al = app.autolaunch();
            let _ = if al.is_enabled().unwrap_or(false) { al.disable() } else { al.enable() };
        }
        "about" => show_about(app, None),
        "quit" => app.exit(0),
        other => {
            if let Some(v) = other.strip_prefix("scale_").and_then(|v| v.parse::<u32>().ok()) {
                state.settings.lock().unwrap().scale = v;
                apply_geometry(app, Geometry::KeepCenter);
            }
        }
    }
    rebuild_tray_menu(app);
}

// ---------- шрифт ----------

/// Фразы набраны системным шрифтом «Arial CYR». Отдаём Ruffle системный Arial из C:\Windows\Fonts
/// по адресу catfont://arial.ttf (в WebView2 — http://catfont.localhost/arial.ttf).
fn serve_font(req: http::Request<Vec<u8>>) -> http::Response<Vec<u8>> {
    let name = req.uri().path().trim_start_matches('/').to_ascii_lowercase();
    let allowed = ["arial.ttf", "arialbd.ttf", "ariali.ttf", "arialbi.ttf"];
    let body = if allowed.contains(&name.as_str()) {
        let dir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into());
        fs::read(PathBuf::from(dir).join("Fonts").join(&name)).ok()
    } else {
        None
    };
    let builder = http::Response::builder().header("Access-Control-Allow-Origin", "*");
    match body {
        Some(b) => builder.status(200).header("Content-Type", "font/ttf").body(b).unwrap(),
        None => builder.status(404).body(Vec::new()).unwrap(),
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_cat(app)))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .register_uri_scheme_protocol("catfont", |_ctx, req| serve_font(req))
        .invoke_handler(tauri::generate_handler![
            fscommand,
            exit_app,
            open_url,
            get_settings,
            cursor_in_window,
            selftest_config,
            selftest_log
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            app.manage(AppState {
                settings: Mutex::new(load_settings(&handle)),
                last_save: Mutex::new(Instant::now()),
            });

            apply_geometry(&handle, Geometry::Saved);
            if let Some(win) = main_window(&handle) {
                let on_top = handle.state::<AppState>().settings.lock().unwrap().on_top;
                let _ = win.set_always_on_top(on_top);
                let _ = win.show();

                // запоминаем позицию после перетаскивания (не чаще раза в полсекунды)
                let h = handle.clone();
                win.on_window_event(move |e| match e {
                    WindowEvent::Moved(p) => {
                        let st = h.state::<AppState>();
                        {
                            let mut s = st.settings.lock().unwrap();
                            s.x = Some(p.x);
                            s.y = Some(p.y);
                        }
                        let due = st.last_save.lock().unwrap().elapsed() > Duration::from_millis(500);
                        if due {
                            save_settings(&h);
                        }
                    }
                    WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        hide_cat(&h);
                    }
                    _ => {}
                });
            }

            let menu = build_tray_menu(&handle)?;
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().expect("нет иконки приложения"))
                .tooltip(TITLE)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| on_tray_menu(app, e.id().as_ref()))
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        on_tray_menu(tray.app_handle(), "toggle");
                    }
                })
                .build(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("не удалось запустить")
        .run(|app, e| {
            if let tauri::RunEvent::Exit = e {
                save_settings(app);
            }
        });
}
