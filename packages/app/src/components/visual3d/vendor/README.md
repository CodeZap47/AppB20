# Local 3D decoders

Normal builds use these pinned artifacts and never download decoder code at runtime.

- Three.js **0.186.1** supplies the glTF Draco decoder, loader algorithms and Meshoptimizer **1.1** decoder. The main-thread loaders and extracted Worker handlers are adapted to static module Workers; Meshopt's generated-Worker implementation is removed.
- Basis Universal source commit **b15211474da1cf7c3a408a40dd22f18b15514b22** is compiled with **Emscripten 6.0.9**, `NO_DYNAMIC_EXECUTION=ON`, `EMBIND_AOT=ON`, KTX2 and Zstandard enabled. The default upstream prebuilt file is deliberately not used. The ESM factory explicitly accepts `wasmBinary` and does not generate JavaScript functions dynamically.
- `manifest.json` records source/toolchain/options and SHA-256 for each artifact. The individual licenses accompany the artifacts; worker/loader adaptations retain Three's MIT attribution.
- The extension policy permits local WebAssembly (`wasm-unsafe-eval`) and **self-only static Workers**. It does not permit JavaScript `unsafe-eval`, Blob Workers or remote scripts. Blob URLs used for embedded model images are data, not executable code.

To reproduce, install Emscripten 6.0.9 and CMake, check out the exact Basis commit, then run from the repo root:

```sh
B20_BASIS_SOURCE=/absolute/basis_universal \
B20_EMSDK=/absolute/emsdk \
B20_CMAKE=/absolute/cmake \
B20_PYTHON=/absolute/python3 \
node scripts/build-visual-decoders.mjs
```

Use a Python version accepted by that SDK (3.10 or newer), with the SDK activated in the developer environment. Run `decoders.test.ts` and `sceneRuntime.test.ts`, and load the development-only `apps/web/visual3d-probe.html` from a built static server with `script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'`. The probe checks actual geometry, original node indices and nonempty KTX2 texture output. A normal production build only includes `index.html`, not this test entry point.
