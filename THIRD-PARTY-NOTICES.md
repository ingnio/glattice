# Third-party notices

Glattice is released under the MIT License (see `LICENSE`). It includes or links the
third-party components listed below, each under its own license. This file is generated
by `scripts/third-party-notices.py`; regenerate it when dependencies change.

## Font

- **Roboto Mono** (`src-tauri/assets/RobotoMono-Regular.ttf`). Copyright 2015 The Roboto Mono Project Authors (https://github.com/googlefonts/robotomono). Licensed under the SIL Open Font License, Version 1.1. The full license text is in `src-tauri/assets/OFL.txt`.

## Optional component

- **gifski** is linked only when Glattice is built with `--features gifski`. It is licensed under AGPL-3.0, and a binary built that way is subject to the AGPL. Default builds and the official installers do not include it.

## Rust crates compiled into the application (310)

| Package | Version | License | Source |
| --- | --- | --- | --- |
| ab_glyph | 0.2.32 | Apache-2.0 | https://github.com/alexheretic/ab-glyph |
| ab_glyph_rasterizer | 0.1.10 | Apache-2.0 | https://github.com/alexheretic/ab-glyph |
| adler2 | 2.0.1 | 0BSD OR MIT OR Apache-2.0 | https://github.com/oyvindln/adler2 |
| aho-corasick | 1.1.4 | Unlicense OR MIT | https://github.com/BurntSushi/aho-corasick |
| alloc-no-stdlib | 2.0.4 | BSD-3-Clause | https://github.com/dropbox/rust-alloc-no-stdlib |
| alloc-stdlib | 0.2.2 | BSD-3-Clause | https://github.com/dropbox/rust-alloc-no-stdlib |
| anyhow | 1.0.102 | MIT OR Apache-2.0 | https://github.com/dtolnay/anyhow |
| arboard | 3.6.1 | MIT OR Apache-2.0 | https://github.com/1Password/arboard |
| base64 | 0.22.1 | MIT OR Apache-2.0 | https://github.com/marshallpierce/rust-base64 |
| bitflags | 2.11.1 | MIT OR Apache-2.0 | https://github.com/bitflags/bitflags |
| bitflags | 1.3.2 | MIT/Apache-2.0 | https://github.com/bitflags/bitflags |
| block-buffer | 0.10.4 | MIT OR Apache-2.0 | https://github.com/RustCrypto/utils |
| brotli | 8.0.2 | BSD-3-Clause AND MIT | https://github.com/dropbox/rust-brotli |
| brotli-decompressor | 5.0.0 | BSD-3-Clause/MIT | https://github.com/dropbox/rust-brotli-decompressor |
| bytemuck | 1.25.0 | Zlib OR Apache-2.0 OR MIT | https://github.com/Lokathor/bytemuck |
| bytemuck_derive | 1.10.2 | Zlib OR Apache-2.0 OR MIT | https://github.com/Lokathor/bytemuck |
| byteorder | 1.5.0 | Unlicense OR MIT | https://github.com/BurntSushi/byteorder |
| byteorder-lite | 0.1.0 | Unlicense OR MIT | https://github.com/image-rs/byteorder-lite |
| bytes | 1.11.1 | MIT | https://github.com/tokio-rs/bytes |
| camino | 1.2.2 | MIT OR Apache-2.0 | https://github.com/camino-rs/camino |
| cargo-platform | 0.1.9 | MIT OR Apache-2.0 | https://github.com/rust-lang/cargo |
| cargo_metadata | 0.19.2 | MIT | https://github.com/oli-obk/cargo_metadata |
| cfb | 0.7.3 | MIT | https://github.com/mdsteele/rust-cfb |
| cfg-if | 1.0.4 | MIT OR Apache-2.0 | https://github.com/rust-lang/cfg-if |
| chrono | 0.4.44 | MIT OR Apache-2.0 | https://github.com/chronotope/chrono |
| clipboard-win | 5.4.1 | BSL-1.0 | https://github.com/DoumanAsh/clipboard-win |
| color_quant | 1.1.0 | MIT | https://github.com/image-rs/color_quant.git |
| convert_case | 0.4.0 | MIT | https://github.com/rutrum/convert-case |
| cookie | 0.18.1 | MIT OR Apache-2.0 | https://github.com/SergioBenitez/cookie-rs |
| cpal | 0.15.3 | Apache-2.0 | https://github.com/rustaudio/cpal |
| cpufeatures | 0.2.17 | MIT OR Apache-2.0 | https://github.com/RustCrypto/utils |
| crc32fast | 1.5.0 | MIT OR Apache-2.0 | https://github.com/srijs/rust-crc32fast |
| crossbeam-channel | 0.5.15 | MIT OR Apache-2.0 | https://github.com/crossbeam-rs/crossbeam |
| crossbeam-deque | 0.8.6 | MIT OR Apache-2.0 | https://github.com/crossbeam-rs/crossbeam |
| crossbeam-epoch | 0.9.18 | MIT OR Apache-2.0 | https://github.com/crossbeam-rs/crossbeam |
| crossbeam-utils | 0.8.21 | MIT OR Apache-2.0 | https://github.com/crossbeam-rs/crossbeam |
| crypto-common | 0.1.7 | MIT OR Apache-2.0 | https://github.com/RustCrypto/traits |
| cssparser | 0.29.6 | MPL-2.0 | https://github.com/servo/rust-cssparser |
| cssparser-macros | 0.6.1 | MPL-2.0 | https://github.com/servo/rust-cssparser |
| ctor | 0.2.9 | Apache-2.0 OR MIT | https://github.com/mmastrac/rust-ctor |
| darling | 0.23.0 | MIT | https://github.com/TedDriggs/darling |
| darling_core | 0.23.0 | MIT | https://github.com/TedDriggs/darling |
| darling_macro | 0.23.0 | MIT | https://github.com/TedDriggs/darling |
| dasp_sample | 0.11.0 | MIT OR Apache-2.0 | https://github.com/rustaudio/sample.git |
| deranged | 0.5.8 | MIT OR Apache-2.0 | https://github.com/jhpratt/deranged |
| derive_more | 0.99.20 | MIT | https://github.com/JelteF/derive_more |
| digest | 0.10.7 | MIT OR Apache-2.0 | https://github.com/RustCrypto/traits |
| dirs | 6.0.0 | MIT OR Apache-2.0 | https://github.com/soc/dirs-rs |
| dirs-sys | 0.5.0 | MIT OR Apache-2.0 | https://github.com/dirs-dev/dirs-sys-rs |
| displaydoc | 0.2.5 | MIT OR Apache-2.0 | https://github.com/yaahc/displaydoc |
| dpi | 0.1.2 | Apache-2.0 AND MIT | https://github.com/rust-windowing/winit |
| drag | 2.1.0 | Apache-2.0 OR MIT |  |
| dtoa | 1.0.11 | MIT OR Apache-2.0 | https://github.com/dtolnay/dtoa |
| dtoa-short | 0.3.5 | MPL-2.0 | https://github.com/upsuper/dtoa-short |
| dunce | 1.0.5 | CC0-1.0 OR MIT-0 OR Apache-2.0 | https://gitlab.com/kornelski/dunce |
| dyn-clone | 1.0.20 | MIT OR Apache-2.0 | https://github.com/dtolnay/dyn-clone |
| either | 1.15.0 | MIT OR Apache-2.0 | https://github.com/rayon-rs/either |
| equivalent | 1.0.2 | Apache-2.0 OR MIT | https://github.com/indexmap-rs/equivalent |
| erased-serde | 0.4.10 | MIT OR Apache-2.0 | https://github.com/dtolnay/erased-serde |
| error-code | 3.3.2 | BSL-1.0 | https://github.com/DoumanAsh/error-code |
| fax | 0.2.6 | MIT | https://github.com/pdf-rs/fax |
| fax_derive | 0.2.0 | MIT | https://github.com/pdf-rs/fax |
| fdeflate | 0.3.7 | MIT OR Apache-2.0 | https://github.com/image-rs/fdeflate |
| flate2 | 1.1.9 | MIT OR Apache-2.0 | https://github.com/rust-lang/flate2-rs |
| fnv | 1.0.7 | Apache-2.0 / MIT | https://github.com/servo/rust-fnv |
| form_urlencoded | 1.2.2 | MIT OR Apache-2.0 | https://github.com/servo/rust-url |
| futf | 0.1.5 | MIT / Apache-2.0 | https://github.com/servo/futf |
| fxhash | 0.2.1 | Apache-2.0/MIT | https://github.com/cbreeden/fxhash |
| generic-array | 0.14.7 | MIT | https://github.com/fizyk20/generic-array.git |
| getrandom | 0.2.17 | MIT OR Apache-2.0 | https://github.com/rust-random/getrandom |
| getrandom | 0.3.4 | MIT OR Apache-2.0 | https://github.com/rust-random/getrandom |
| getrandom | 0.4.2 | MIT OR Apache-2.0 | https://github.com/rust-random/getrandom |
| gif | 0.13.3 | MIT OR Apache-2.0 | https://github.com/image-rs/image-gif |
| glob | 0.3.3 | MIT OR Apache-2.0 | https://github.com/rust-lang/glob |
| global-hotkey | 0.7.0 | Apache-2.0 OR MIT | https://github.com/amrbashir/global-hotkey |
| half | 2.7.1 | MIT OR Apache-2.0 | https://github.com/VoidStarKat/half-rs |
| hashbrown | 0.17.0 | MIT OR Apache-2.0 | https://github.com/rust-lang/hashbrown |
| hashbrown | 0.12.3 | MIT OR Apache-2.0 | https://github.com/rust-lang/hashbrown |
| heck | 0.5.0 | MIT OR Apache-2.0 | https://github.com/withoutboats/heck |
| hex | 0.4.3 | MIT OR Apache-2.0 | https://github.com/KokaKiwi/rust-hex |
| hound | 3.5.1 | Apache-2.0 | https://github.com/ruuda/hound |
| html5ever | 0.29.1 | MIT OR Apache-2.0 | https://github.com/servo/html5ever |
| http | 1.4.0 | MIT OR Apache-2.0 | https://github.com/hyperium/http |
| http-range | 0.1.5 | MIT | https://github.com/bancek/rust-http-range.git |
| ico | 0.5.0 | MIT | https://github.com/mdsteele/rust-ico |
| icu_collections | 2.2.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| icu_locale_core | 2.2.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| icu_normalizer | 2.2.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| icu_normalizer_data | 2.2.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| icu_properties | 2.2.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| icu_properties_data | 2.2.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| icu_provider | 2.2.0 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| ident_case | 1.0.1 | MIT/Apache-2.0 | https://github.com/TedDriggs/ident_case |
| idna | 1.1.0 | MIT OR Apache-2.0 | https://github.com/servo/rust-url/ |
| idna_adapter | 1.2.1 | Apache-2.0 OR MIT | https://github.com/hsivonen/idna_adapter |
| image | 0.25.10 | MIT OR Apache-2.0 | https://github.com/image-rs/image |
| image-webp | 0.2.4 | MIT OR Apache-2.0 | https://github.com/image-rs/image-webp |
| indexmap | 2.14.0 | Apache-2.0 OR MIT | https://github.com/indexmap-rs/indexmap |
| indexmap | 1.9.3 | Apache-2.0 OR MIT | https://github.com/bluss/indexmap |
| infer | 0.19.0 | MIT | https://github.com/bojand/infer |
| itoa | 1.0.18 | MIT OR Apache-2.0 | https://github.com/dtolnay/itoa |
| json-patch | 3.0.1 | MIT/Apache-2.0 | https://github.com/idubrov/json-patch |
| jsonptr | 0.6.3 | MIT OR Apache-2.0 | https://github.com/chanced/jsonptr |
| keyboard-types | 0.7.0 | MIT OR Apache-2.0 | https://github.com/pyfisch/keyboard-types |
| kuchikiki | 0.8.8-speedreader | MIT | https://github.com/brave/kuchikiki |
| libc | 0.2.185 | MIT OR Apache-2.0 | https://github.com/rust-lang/libc |
| litemap | 0.8.2 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| lock_api | 0.4.14 | MIT OR Apache-2.0 | https://github.com/Amanieu/parking_lot |
| log | 0.4.29 | MIT OR Apache-2.0 | https://github.com/rust-lang/log |
| mac | 0.1.1 | MIT/Apache-2.0 | https://github.com/reem/rust-mac.git |
| markup5ever | 0.14.1 | MIT OR Apache-2.0 | https://github.com/servo/html5ever |
| match_token | 0.1.0 | MIT OR Apache-2.0 | https://github.com/servo/html5ever |
| matches | 0.1.10 | MIT | https://github.com/SimonSapin/rust-std-candidates |
| memchr | 2.8.0 | Unlicense OR MIT | https://github.com/BurntSushi/memchr |
| mime | 0.3.17 | MIT OR Apache-2.0 | https://github.com/hyperium/mime |
| miniz_oxide | 0.8.9 | MIT OR Zlib OR Apache-2.0 | https://github.com/Frommi/miniz_oxide/tree/master/miniz_oxide |
| mio | 1.2.0 | MIT | https://github.com/tokio-rs/mio |
| moxcms | 0.8.1 | BSD-3-Clause OR Apache-2.0 | https://github.com/awxkee/moxcms.git |
| muda | 0.17.2 | Apache-2.0 OR MIT | https://github.com/tauri-apps/muda |
| new_debug_unreachable | 1.0.6 | MIT | https://github.com/mbrubeck/rust-debug-unreachable |
| nodrop | 0.1.14 | MIT/Apache-2.0 | https://github.com/bluss/arrayvec |
| num-conv | 0.2.1 | MIT OR Apache-2.0 | https://github.com/jhpratt/num-conv |
| num-traits | 0.2.19 | MIT OR Apache-2.0 | https://github.com/rust-num/num-traits |
| once_cell | 1.21.4 | MIT OR Apache-2.0 | https://github.com/matklad/once_cell |
| option-ext | 0.2.0 | MPL-2.0 | https://github.com/soc/option-ext.git |
| owned_ttf_parser | 0.25.1 | Apache-2.0 | https://github.com/alexheretic/owned-ttf-parser |
| parking_lot | 0.12.5 | MIT OR Apache-2.0 | https://github.com/Amanieu/parking_lot |
| parking_lot_core | 0.9.12 | MIT OR Apache-2.0 | https://github.com/Amanieu/parking_lot |
| percent-encoding | 2.3.2 | MIT OR Apache-2.0 | https://github.com/servo/rust-url/ |
| phf | 0.8.0 | MIT | https://github.com/sfackler/rust-phf |
| phf | 0.10.1 | MIT | https://github.com/sfackler/rust-phf |
| phf | 0.11.3 | MIT | https://github.com/rust-phf/rust-phf |
| phf_generator | 0.11.3 | MIT | https://github.com/rust-phf/rust-phf |
| phf_generator | 0.10.0 | MIT | https://github.com/sfackler/rust-phf |
| phf_macros | 0.11.3 | MIT | https://github.com/rust-phf/rust-phf |
| phf_macros | 0.10.0 | MIT | https://github.com/sfackler/rust-phf |
| phf_shared | 0.10.0 | MIT | https://github.com/sfackler/rust-phf |
| phf_shared | 0.11.3 | MIT | https://github.com/rust-phf/rust-phf |
| phf_shared | 0.8.0 | MIT | https://github.com/sfackler/rust-phf |
| pin-project-lite | 0.2.17 | Apache-2.0 OR MIT | https://github.com/taiki-e/pin-project-lite |
| png | 0.18.1 | MIT OR Apache-2.0 | https://github.com/image-rs/image-png |
| png | 0.17.16 | MIT OR Apache-2.0 | https://github.com/image-rs/image-png |
| potential_utf | 0.1.5 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| powerfmt | 0.2.0 | MIT OR Apache-2.0 | https://github.com/jhpratt/powerfmt |
| ppv-lite86 | 0.2.21 | MIT OR Apache-2.0 | https://github.com/cryptocorrosion/cryptocorrosion |
| precomputed-hash | 0.1.1 | MIT | https://github.com/emilio/precomputed-hash |
| proc-macro-hack | 0.5.20+deprecated | MIT OR Apache-2.0 | https://github.com/dtolnay/proc-macro-hack |
| proc-macro2 | 1.0.106 | MIT OR Apache-2.0 | https://github.com/dtolnay/proc-macro2 |
| pxfm | 0.1.29 | BSD-3-Clause OR Apache-2.0 | https://github.com/awxkee/pxfm |
| quick-error | 2.0.1 | MIT/Apache-2.0 | http://github.com/tailhook/quick-error |
| quote | 1.0.45 | MIT OR Apache-2.0 | https://github.com/dtolnay/quote |
| rand | 0.8.6 | MIT OR Apache-2.0 | https://github.com/rust-random/rand |
| rand_chacha | 0.3.1 | MIT OR Apache-2.0 | https://github.com/rust-random/rand |
| rand_core | 0.6.4 | MIT OR Apache-2.0 | https://github.com/rust-random/rand |
| raw-window-handle | 0.6.2 | MIT OR Apache-2.0 OR Zlib | https://github.com/rust-windowing/raw-window-handle |
| rayon | 1.12.0 | MIT OR Apache-2.0 | https://github.com/rayon-rs/rayon |
| rayon-core | 1.13.0 | MIT OR Apache-2.0 | https://github.com/rayon-rs/rayon |
| ref-cast | 1.0.25 | MIT OR Apache-2.0 | https://github.com/dtolnay/ref-cast |
| ref-cast-impl | 1.0.25 | MIT OR Apache-2.0 | https://github.com/dtolnay/ref-cast |
| regex | 1.12.3 | MIT OR Apache-2.0 | https://github.com/rust-lang/regex |
| regex-automata | 0.4.14 | MIT OR Apache-2.0 | https://github.com/rust-lang/regex |
| regex-syntax | 0.8.10 | MIT OR Apache-2.0 | https://github.com/rust-lang/regex |
| rfd | 0.16.0 | MIT | https://github.com/PolyMeilex/rfd |
| same-file | 1.0.6 | Unlicense/MIT | https://github.com/BurntSushi/same-file |
| schemars | 0.8.22 | MIT | https://github.com/GREsau/schemars |
| schemars | 1.2.1 | MIT | https://github.com/GREsau/schemars |
| schemars | 0.9.0 | MIT | https://github.com/GREsau/schemars |
| schemars_derive | 0.8.22 | MIT | https://github.com/GREsau/schemars |
| scopeguard | 1.2.0 | MIT OR Apache-2.0 | https://github.com/bluss/scopeguard |
| selectors | 0.24.0 | MPL-2.0 | https://github.com/servo/servo |
| semver | 1.0.28 | MIT OR Apache-2.0 | https://github.com/dtolnay/semver |
| serde | 1.0.228 | MIT OR Apache-2.0 | https://github.com/serde-rs/serde |
| serde-untagged | 0.1.9 | MIT OR Apache-2.0 | https://github.com/dtolnay/serde-untagged |
| serde_core | 1.0.228 | MIT OR Apache-2.0 | https://github.com/serde-rs/serde |
| serde_derive | 1.0.228 | MIT OR Apache-2.0 | https://github.com/serde-rs/serde |
| serde_derive_internals | 0.29.1 | MIT OR Apache-2.0 | https://github.com/serde-rs/serde |
| serde_json | 1.0.149 | MIT OR Apache-2.0 | https://github.com/serde-rs/json |
| serde_repr | 0.1.20 | MIT OR Apache-2.0 | https://github.com/dtolnay/serde-repr |
| serde_spanned | 1.1.1 | MIT OR Apache-2.0 | https://github.com/toml-rs/toml |
| serde_with | 3.18.0 | MIT OR Apache-2.0 | https://github.com/jonasbb/serde_with/ |
| serde_with_macros | 3.18.0 | MIT OR Apache-2.0 | https://github.com/jonasbb/serde_with/ |
| serialize-to-javascript | 0.1.2 | MIT OR Apache-2.0 | https://github.com/chippers/serialize-to-javascript |
| serialize-to-javascript-impl | 0.1.2 | MIT OR Apache-2.0 | https://github.com/chippers/serialize-to-javascript |
| servo_arc | 0.2.0 | MIT OR Apache-2.0 | https://github.com/servo/servo |
| sha2 | 0.10.9 | MIT OR Apache-2.0 | https://github.com/RustCrypto/hashes |
| simd-adler32 | 0.3.9 | MIT | https://github.com/mcountryman/simd-adler32 |
| siphasher | 1.0.2 | MIT/Apache-2.0 | https://github.com/jedisct1/rust-siphash |
| siphasher | 0.3.11 | MIT/Apache-2.0 | https://github.com/jedisct1/rust-siphash |
| smallvec | 1.15.1 | MIT OR Apache-2.0 | https://github.com/servo/rust-smallvec |
| socket2 | 0.6.3 | MIT OR Apache-2.0 | https://github.com/rust-lang/socket2 |
| softbuffer | 0.4.8 | MIT OR Apache-2.0 | https://github.com/rust-windowing/softbuffer |
| stable_deref_trait | 1.2.1 | MIT OR Apache-2.0 | https://github.com/storyyeller/stable_deref_trait |
| string_cache | 0.8.9 | MIT OR Apache-2.0 | https://github.com/servo/string-cache |
| strsim | 0.11.1 | MIT | https://github.com/rapidfuzz/strsim-rs |
| syn | 2.0.117 | MIT OR Apache-2.0 | https://github.com/dtolnay/syn |
| syn | 1.0.109 | MIT OR Apache-2.0 | https://github.com/dtolnay/syn |
| synstructure | 0.13.2 | MIT | https://github.com/mystor/synstructure |
| tao | 0.34.8 | Apache-2.0 | https://github.com/tauri-apps/tao |
| tauri | 2.10.3 | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri |
| tauri-codegen | 2.5.5 | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri |
| tauri-macros | 2.5.5 | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri |
| tauri-plugin-clipboard-manager | 2.3.2 | Apache-2.0 OR MIT | https://github.com/tauri-apps/plugins-workspace |
| tauri-plugin-dialog | 2.7.0 | Apache-2.0 OR MIT | https://github.com/tauri-apps/plugins-workspace |
| tauri-plugin-fs | 2.5.0 | Apache-2.0 OR MIT | https://github.com/tauri-apps/plugins-workspace |
| tauri-plugin-global-shortcut | 2.3.1 | Apache-2.0 OR MIT | https://github.com/tauri-apps/plugins-workspace |
| tauri-plugin-single-instance | 2.4.1 | Apache-2.0 OR MIT | https://github.com/tauri-apps/plugins-workspace |
| tauri-plugin-store | 2.4.2 | Apache-2.0 OR MIT | https://github.com/tauri-apps/plugins-workspace |
| tauri-runtime | 2.10.1 | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri |
| tauri-runtime-wry | 2.10.1 | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri |
| tauri-utils | 2.8.3 | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri |
| tendril | 0.4.3 | MIT/Apache-2.0 | https://github.com/servo/tendril |
| thiserror | 2.0.18 | MIT OR Apache-2.0 | https://github.com/dtolnay/thiserror |
| thiserror | 1.0.69 | MIT OR Apache-2.0 | https://github.com/dtolnay/thiserror |
| thiserror-impl | 2.0.18 | MIT OR Apache-2.0 | https://github.com/dtolnay/thiserror |
| thiserror-impl | 1.0.69 | MIT OR Apache-2.0 | https://github.com/dtolnay/thiserror |
| tiff | 0.11.3 | MIT | https://github.com/image-rs/image-tiff |
| time | 0.3.47 | MIT OR Apache-2.0 | https://github.com/time-rs/time |
| time-core | 0.1.8 | MIT OR Apache-2.0 | https://github.com/time-rs/time |
| time-macros | 0.2.27 | MIT OR Apache-2.0 | https://github.com/time-rs/time |
| tinystr | 0.8.3 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| tokio | 1.52.1 | MIT | https://github.com/tokio-rs/tokio |
| tokio-macros | 2.7.0 | MIT | https://github.com/tokio-rs/tokio |
| toml | 0.9.12+spec-1.1.0 | MIT OR Apache-2.0 | https://github.com/toml-rs/toml |
| toml_datetime | 0.7.5+spec-1.1.0 | MIT OR Apache-2.0 | https://github.com/toml-rs/toml |
| toml_parser | 1.1.2+spec-1.1.0 | MIT OR Apache-2.0 | https://github.com/toml-rs/toml |
| toml_writer | 1.1.1+spec-1.1.0 | MIT OR Apache-2.0 | https://github.com/toml-rs/toml |
| tracing | 0.1.44 | MIT | https://github.com/tokio-rs/tracing |
| tracing-attributes | 0.1.31 | MIT | https://github.com/tokio-rs/tracing |
| tracing-core | 0.1.36 | MIT | https://github.com/tokio-rs/tracing |
| tray-icon | 0.21.3 | MIT OR Apache-2.0 | https://github.com/tauri-apps/tray-icon |
| ttf-parser | 0.25.1 | MIT OR Apache-2.0 | https://github.com/harfbuzz/ttf-parser |
| typeid | 1.0.3 | MIT OR Apache-2.0 | https://github.com/dtolnay/typeid |
| typenum | 1.20.0 | MIT OR Apache-2.0 | https://github.com/paholg/typenum |
| unic-char-property | 0.9.0 | MIT/Apache-2.0 | https://github.com/open-i18n/rust-unic/ |
| unic-char-range | 0.9.0 | MIT/Apache-2.0 | https://github.com/open-i18n/rust-unic/ |
| unic-common | 0.9.0 | MIT/Apache-2.0 | https://github.com/open-i18n/rust-unic/ |
| unic-ucd-ident | 0.9.0 | MIT/Apache-2.0 | https://github.com/open-i18n/rust-unic/ |
| unic-ucd-version | 0.9.0 | MIT/Apache-2.0 | https://github.com/open-i18n/rust-unic/ |
| unicode-ident | 1.0.24 | (MIT OR Apache-2.0) AND Unicode-3.0 | https://github.com/dtolnay/unicode-ident |
| unicode-segmentation | 1.13.2 | MIT OR Apache-2.0 | https://github.com/unicode-rs/unicode-segmentation |
| url | 2.5.8 | MIT OR Apache-2.0 | https://github.com/servo/rust-url |
| urlpattern | 0.3.0 | MIT | https://github.com/denoland/rust-urlpattern |
| utf-8 | 0.7.6 | MIT OR Apache-2.0 | https://github.com/SimonSapin/rust-utf8 |
| utf8_iter | 1.0.4 | Apache-2.0 OR MIT | https://github.com/hsivonen/utf8_iter |
| uuid | 1.23.1 | Apache-2.0 OR MIT | https://github.com/uuid-rs/uuid |
| walkdir | 2.5.0 | Unlicense/MIT | https://github.com/BurntSushi/walkdir |
| webview2-com | 0.38.2 | MIT | https://github.com/wravery/webview2-rs |
| webview2-com-macros | 0.8.1 | MIT | https://github.com/wravery/webview2-rs |
| webview2-com-sys | 0.38.2 | MIT | https://github.com/wravery/webview2-rs |
| weezl | 0.1.12 | MIT OR Apache-2.0 | https://github.com/image-rs/weezl |
| widestring | 1.2.1 | MIT OR Apache-2.0 | https://github.com/VoidStarKat/widestring-rs |
| winapi-util | 0.1.11 | Unlicense OR MIT | https://github.com/BurntSushi/winapi-util |
| window-vibrancy | 0.6.0 | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri-plugin-vibrancy |
| windows | 0.61.3 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows | 0.62.2 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows | 0.52.0 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows | 0.54.0 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-collections | 0.2.0 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-collections | 0.3.2 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-core | 0.58.0 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-core | 0.62.2 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-core | 0.52.0 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-core | 0.61.2 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-core | 0.54.0 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-future | 0.2.1 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-future | 0.3.2 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-implement | 0.52.0 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-implement | 0.58.0 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-implement | 0.60.2 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-interface | 0.59.3 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-interface | 0.58.0 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-interface | 0.52.0 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-link | 0.1.3 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-link | 0.2.1 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-numerics | 0.2.0 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-numerics | 0.3.1 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-result | 0.1.2 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-result | 0.2.0 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-result | 0.3.4 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-result | 0.4.1 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-strings | 0.4.2 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-strings | 0.5.1 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-strings | 0.1.0 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-sys | 0.60.2 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-sys | 0.61.2 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-sys | 0.59.0 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-targets | 0.53.5 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-targets | 0.52.6 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-threading | 0.1.0 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-threading | 0.2.1 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows-version | 0.1.7 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows_x86_64_msvc | 0.53.1 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| windows_x86_64_msvc | 0.52.6 | MIT OR Apache-2.0 | https://github.com/microsoft/windows-rs |
| winnow | 1.0.2 | MIT | https://github.com/winnow-rs/winnow |
| winnow | 0.7.15 | MIT | https://github.com/winnow-rs/winnow |
| writeable | 0.6.3 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| wry | 0.54.4 | Apache-2.0 OR MIT | https://github.com/tauri-apps/wry |
| xcap | 0.9.4 | Apache-2.0 | https://github.com/nashaofu/xcap.git |
| yoke | 0.8.2 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| yoke-derive | 0.8.2 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| zerocopy | 0.8.48 | BSD-2-Clause OR Apache-2.0 OR MIT | https://github.com/google/zerocopy |
| zerocopy-derive | 0.8.48 | BSD-2-Clause OR Apache-2.0 OR MIT | https://github.com/google/zerocopy |
| zerofrom | 0.1.7 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| zerofrom-derive | 0.1.7 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| zerotrie | 0.2.4 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| zerovec | 0.11.6 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| zerovec-derive | 0.11.3 | Unicode-3.0 | https://github.com/unicode-org/icu4x |
| zmij | 1.0.21 | MIT | https://github.com/dtolnay/zmij |
| zune-core | 0.5.1 | MIT OR Apache-2.0 OR Zlib | https://github.com/etemesi254/zune-image |
| zune-jpeg | 0.5.15 | MIT OR Apache-2.0 OR Zlib | https://github.com/etemesi254/zune-image/tree/dev/crates/zune-jpeg |

## JavaScript packages bundled into the interface (12)

| Package | Version | License | Source |
| --- | --- | --- | --- |
| @tauri-apps/api | 2.10.1 | Apache-2.0 OR MIT | https://github.com/tauri-apps/tauri#readme |
| @tauri-apps/plugin-clipboard-manager | 2.3.2 | MIT OR Apache-2.0 | https://github.com/tauri-apps/plugins-workspace#readme |
| @tauri-apps/plugin-dialog | 2.7.0 | MIT OR Apache-2.0 | https://github.com/tauri-apps/plugins-workspace#readme |
| @tauri-apps/plugin-fs | 2.5.0 | MIT OR Apache-2.0 | https://github.com/tauri-apps/plugins-workspace#readme |
| @tauri-apps/plugin-global-shortcut | 2.3.1 | MIT OR Apache-2.0 | https://github.com/tauri-apps/plugins-workspace#readme |
| @tauri-apps/plugin-store | 2.4.2 | MIT OR Apache-2.0 | https://github.com/tauri-apps/plugins-workspace#readme |
| @types/dom-mediacapture-transform | 0.1.11 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/dom-mediacapture-transform |
| @types/dom-webcodecs | 0.1.13 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/dom-webcodecs |
| mediabunny | 1.41.0 | MPL-2.0 | https://mediabunny.dev/ |
| react | 19.2.5 | MIT | https://react.dev/ |
| react-dom | 19.2.5 | MIT | https://react.dev/ |
| scheduler | 0.27.0 | MIT | https://react.dev/ |

## License summary

- MIT OR Apache-2.0: 165
- MIT: 56
- Apache-2.0 OR MIT: 26
- Unicode-3.0: 18
- MIT/Apache-2.0: 14
- Apache-2.0: 7
- MPL-2.0: 6
- Unlicense OR MIT: 5
- MIT OR Apache-2.0 OR Zlib: 3
- BSD-2-Clause OR Apache-2.0 OR MIT: 2
- BSD-3-Clause: 2
- BSD-3-Clause OR Apache-2.0: 2
- BSL-1.0: 2
- Unlicense/MIT: 2
- Zlib OR Apache-2.0 OR MIT: 2
- (MIT OR Apache-2.0) AND Unicode-3.0: 1
- 0BSD OR MIT OR Apache-2.0: 1
- Apache-2.0 / MIT: 1
- Apache-2.0 AND MIT: 1
- Apache-2.0/MIT: 1
- BSD-3-Clause AND MIT: 1
- BSD-3-Clause/MIT: 1
- CC0-1.0 OR MIT-0 OR Apache-2.0: 1
- MIT / Apache-2.0: 1
- MIT OR Zlib OR Apache-2.0: 1
