// Link the NDI runtime that NDI Tools installed (no SDK headers needed — we
// declare the few functions/structs by hand in main.rs).
fn main() {
    println!("cargo:rustc-link-search=native=/usr/local/lib");
    println!("cargo:rustc-link-lib=dylib=ndi");
    // libndi.dylib's install name is @rpath/libndi.dylib → give the binary an
    // rpath so dyld resolves it at runtime.
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/local/lib");
}
