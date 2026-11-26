fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("gnu")
    {
        use std::{env, fs, path::PathBuf, process::Command};

        // MinGW links default-manifest.o. Keep Tauri's manifest so Windows
        // can activate Common Controls v6 without duplicate PE resources.
        let target = env::var("TARGET").expect("missing Rust target");
        let arch = env::var("CARGO_CFG_TARGET_ARCH").expect("missing architecture");
        let gcc_arch = if arch == "x86" { "i686" } else { &arch };
        let linker_key = format!(
            "CARGO_TARGET_{}_LINKER",
            target.to_uppercase().replace('-', "_")
        );
        let linker = env::var_os(&linker_key)
            .unwrap_or_else(|| format!("{gcc_arch}-w64-mingw32-gcc").into());
        let out = PathBuf::from(env::var_os("OUT_DIR").expect("missing OUT_DIR"));
        let source = out.join("postdove-empty-manifest.c");
        fs::write(&source, "/* The manifest is supplied by Tauri. */\n")
            .expect("failed to write empty manifest object source");
        let status = Command::new(linker)
            .arg("-c")
            .arg(&source)
            .arg("-o")
            .arg(out.join("default-manifest.o"))
            .status()
            .expect("failed to run the MinGW compiler");
        assert!(
            status.success(),
            "failed to build the empty manifest object"
        );
        println!("cargo:rustc-link-arg=-B{}/", out.display());
    }
    tauri_build::build();
}
