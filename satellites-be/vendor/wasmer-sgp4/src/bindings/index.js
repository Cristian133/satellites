const fs = require("fs/promises");
const { WASI } = require("node:wasi");
const { Sgp4: _Sgp4 } = require("./sgp4/sgp4.js");

class Bindings {
    constructor() {
        this._cache = {}
    }

    async _getModule(filename) {
        if (filename in this._cache) {
            return this._cache[filename];
        }

        const wasm = await fs.readFile(`${__dirname}/${filename}`);
        this._cache[filename] = await WebAssembly.compile(wasm);
        return this._cache[filename];
    }

    async sgp4(options) {
        const wrapper = new _Sgp4();
        const module = await this._getModule("sgp4/sgp4.wasm");
        const imports = options?.imports || {};

        const wasi = new WASI({ version: "preview1", args: [], env: {} });
        imports.wasi_snapshot_preview1 = wasi.wasiImport;

        await wrapper.instantiate(module, imports);

        return wrapper;
    }
}

module.exports = { Bindings };
