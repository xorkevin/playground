import {ConsoleStdout, File, OpenFile, WASI} from '@bjorn3/browser_wasi_shim';

import {type Result, isNil} from '@xorkevin/nuke/computil';

interface WasmModEnv {
  stdin?: string;
}

export const compileStreaming = async (
  source: PromiseLike<Response> | Response,
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
): Promise<Result<{stdout: string; stderr: string}, Error>> => {
  const textEncoder = new TextEncoder();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const stdin = isNil(env.stdin) ? [] : textEncoder.encode(env.stdin);
  const fds = [
    new OpenFile(new File(stdin)),
    ConsoleStdout.lineBuffered((msg: string) => {
      stdout.push(msg);
    }),
    ConsoleStdout.lineBuffered((msg: string) => {
      stderr.push(msg);
    }),
  ];
  const wasi = new WASI([], [], fds);
  try {
    const instance = await WebAssembly.instantiate(mod, {
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
    return {value: {stdout: stdout.join('\n'), stderr: stderr.join('\n')}};
  } catch (err) {
    return {err: new Error('Failed running wasm module', {cause: err})};
  }
};
