import {Result, isNil} from '@xorkevin/nuke/computil';
import {WASI, File, OpenFile, ConsoleStdout} from '@bjorn3/browser_wasi_shim';

interface WasmModEnv {
  stdin?: string;
}

export const compileStreaming = async (
  source: Response | PromiseLike<Response>,
): Promise<Result<WebAssembly.Module, Error>> => {
  try {
    return {value: await WebAssembly.compileStreaming(source)};
  } catch (err) {
    return {err: new Error('Failed compiling wasm module', {cause: err})};
  }
};

export const runMod = async (
  mod: WebAssembly.Module,
  env: WasmModEnv,
): Promise<Result<undefined, Error>> => {
  const textEncoder = new TextEncoder();
  const stdin = isNil(env.stdin) ? [] : textEncoder.encode(env.stdin);
  let fds = [
    new OpenFile(new File(stdin)),
    ConsoleStdout.lineBuffered((msg: string) =>
      console.log(`[WASI stdout] ${msg}`),
    ),
    ConsoleStdout.lineBuffered((msg: string) =>
      console.warn(`[WASI stderr] ${msg}`),
    ),
  ];
  let wasi = new WASI([], [], fds);
  try {
    let instance = await WebAssembly.instantiate(mod, {
      wasi_snapshot_preview1: wasi.wasiImport,
    });
    if (!(instance.exports['memory'] instanceof WebAssembly.Memory)) {
      return {err: new Error('Wasm module missing memory export')};
    }
    if (typeof instance.exports['_start'] !== 'function') {
      return {err: new Error('Wasm module missing memory export')};
    }
    wasi.start(
      instance as {
        exports: {memory: WebAssembly.Memory; _start: () => unknown};
      },
    );
    return {value: undefined};
  } catch (err) {
    return {err: new Error('Failed running wasm module', {cause: err})};
  }
};
