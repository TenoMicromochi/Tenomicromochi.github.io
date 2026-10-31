# vendor

Files copied without any change from `Software/spoiler-png/node_modules/@noble/` (2026-10-30).

| Folder | Package | Version | License |
|---|---|---|---|
| `noble-ciphers/` | `@noble/ciphers` | 2.4.0 | MIT (`LICENSE`) |
| `noble-hashes/` | `@noble/hashes` | 2.4.0 | MIT (`LICENSE`) |

Copied: `chacha.js`, `_arx.js`, `_poly1305.js`, `utils.js` (ciphers) and `sha2.js`, `hkdf.js`, `hmac.js`, `scrypt.js`, `pbkdf2.js`, `utils.js`, `_md.js`, `_u64.js` (hashes) - the files `chacha.js` and the four hash modules import, and what those import in turn.
`scrypt.js` is not called in stage 1; it is here for the passphrase stage.

## jpeg-js

`jpeg-js/decoder.js` is `lib/decoder.js` of `jpeg-js` 0.4.4 (Apache-2.0 / BSD, see `jpeg-js/LICENSE`) from `Software/spoiler-png/node_modules/jpeg-js/`.
One line is changed so that the file can be loaded as an ES module: the line
`if (typeof module !== 'undefined') {` became `export default decode; if (typeof module !== 'undefined') {`.
(Replacing `module.exports = decode;` itself is not possible: `export` is not allowed inside an `if` block.)
Everything else is byte for byte the same. `decode` is always called with `useTArray: true` and `formatAsRGBA: true`, so the `Buffer` path is never taken.

## jsquash-webp / wasm-feature-detect (WebP, file format v2)

Taken with `npm pack` on 2026-10-30 and copied without any change:

| Folder | Package | Version | License |
|---|---|---|---|
| `jsquash-webp/` | `@jsquash/webp` | 1.5.0 | Apache-2.0 (`LICENSE`; libwebp: `codec/LICENSE.codec.md`) |
| `wasm-feature-detect/` | `wasm-feature-detect` | 1.9.0 (the newest 1.x, as `^1.2.11` asks) | Apache-2.0 (`LICENSE`) |

`jsquash-webp/`: `decode.js` `encode.js` `meta.js` `utils.js` `package.json` `LICENSE` and `codec/` (`dec/webp_dec.js` + `.wasm`, `enc/webp_enc.js` + `.wasm`, `enc/webp_enc_simd.js` + `.wasm`).
`wasm-feature-detect/`: `dist/esm/index.js`, `package.json`, `LICENSE`.

`js/core/webpcodec.js` uses `codec/*`, `utils.js` and `meta.js` directly and does not import jSquash's `decode.js` / `encode.js`:
`encode.js` has the import `from 'wasm-feature-detect'` (a bare name), which a module Worker cannot resolve without a bundler or an import map, and the build must stay unchanged. `webpcodec.js` does the same few steps (SIMD check, module start, `decode` / `encode` call).
The `.wasm` files are fetched by the codec modules from their own folder (`new URL('...wasm', import.meta.url)`), so the server must send `.wasm` as `application/wasm`.
