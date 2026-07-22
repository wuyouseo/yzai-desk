use std::collections::BTreeSet;
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
use winreg::RegKey;

fn normalize_font_name(value_name: &str) -> Option<String> {
    let mut name = value_name.split(" (").next().unwrap_or(value_name).trim().to_string();
    let style_suffixes = [
        " Bold Italic", " SemiBold Italic", " Semibold Italic", " Light Italic",
        " ExtraLight", " ExtraBold", " SemiBold", " Semibold", " Bold", " Italic",
        " Regular", " Medium", " Light", " Black",
    ];
    for suffix in style_suffixes {
        if name.ends_with(suffix) {
            name.truncate(name.len() - suffix.len());
            break;
        }
    }
    let name = name.trim();
    (!name.is_empty()).then(|| name.to_string())
}

fn collect_registry_fonts(root: winreg::HKEY, fonts: &mut BTreeSet<String>) {
    let registry = RegKey::predef(root);
    if let Ok(key) = registry.open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts") {
        for entry in key.enum_values().flatten() {
            if let Some(name) = normalize_font_name(&entry.0) {
                fonts.insert(name);
            }
        }
    }
}

#[tauri::command]
pub fn get_system_fonts() -> Vec<String> {
    let mut fonts = BTreeSet::new();
    collect_registry_fonts(HKEY_LOCAL_MACHINE, &mut fonts);
    collect_registry_fonts(HKEY_CURRENT_USER, &mut fonts);
    fonts.into_iter().collect()
}
