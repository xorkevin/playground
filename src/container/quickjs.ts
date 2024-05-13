import {
  type Disposable,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSSyncVariant,
  Scope,
  type VmCallResult,
  isFail,
  newQuickJSWASMModuleFromVariant,
} from 'quickjs-emscripten-core';

import {
  type Result,
  isNil,
  isSignalAborted,
  sleep,
} from '@xorkevin/nuke/computil';

import {sha256hex} from '@/compress.js';

export interface Logger {
  log: (from: string, entry: string) => void;
}

export class CachedLogger implements Logger {
  readonly #cap: number;
  #logs: string[];
  #head: number;
  #wrapped: boolean;
  readonly #cb: (l: this) => void;

  public constructor(cap: number, cb: (l: CachedLogger) => void) {
    this.#cap = cap;
    this.#logs = [];
    this.#head = 0;
    this.#wrapped = false;
    this.#cb = cb;
  }

  public log(this: this, from: string, entry: string): void {
    const line = `[${new Date().toISOString()} ${from}] ${entry}`;
    if (this.#logs.length < this.#cap) {
      this.#logs.push(line);
    } else {
      this.#logs[this.#head] = line;
      this.#head = (this.#head + 1) % this.#logs.length;
      this.#wrapped = true;
    }
    this.#cb(this);
  }

  public output(this: this): string[] {
    if (this.#logs.length === 0) {
      return [];
    }
    return this.#logs.slice(this.#head).concat(this.#logs.slice(0, this.#head));
  }

  public isWrapped(this: this): boolean {
    return this.#wrapped;
  }
}

class LifetimeManager implements Disposable {
  public alive: boolean;

  readonly #lifetimes: Set<Disposable>;

  public constructor() {
    this.alive = true;
    this.#lifetimes = new Set();
  }

  public add<T extends Disposable>(v: T): T {
    if (!this.alive) {
      throw new Error('Lifetime manager is freed');
    }
    this.#lifetimes.add(v);
    return v;
  }

  public remove(v: Disposable): void {
    if (this.#lifetimes.delete(v)) {
      v.dispose();
    }
  }

  public dispose(): void {
    if (!this.alive) {
      return;
    }
    for (const v of this.#lifetimes.values()) {
      v.dispose();
    }
    this.#lifetimes.clear();
    this.alive = false;
  }
}

const createUniverse = (
  ctx: QuickJSContext,
  lifetime: LifetimeManager,
  opts: {logger: Logger; signal: AbortSignal},
): string => {
  ctx.newObject().consume((universe) => {
    ctx
      .newFunction('log', (...args) => {
        const a = args.map((h) => {
          const v = ctx.dump(h) as unknown;
          if (isNil(v)) {
            return String(v);
          }
          switch (typeof v) {
            case 'string':
              return v;
            case 'number':
            case 'bigint':
            case 'boolean':
            case 'symbol':
              return String(v);
            default:
              return JSON.stringify(v, undefined, '  ');
          }
        });
        opts.logger.log('qjs', a.join(' '));
      })
      .consume((v) => {
        ctx.setProp(universe, 'log', v);
      });
    ctx
      .newFunction('sleep', (ms: QuickJSHandle) => {
        if (ctx.typeof(ms) !== 'number') {
          return {
            error: ctx.newError(
              new Error('Must provide sleep with a number of milliseconds'),
            ),
          };
        }
        const msV = ctx.getNumber(ms);
        const promise = lifetime.add(ctx.newPromise());
        promise.settled
          .then(() => {
            if (!ctx.runtime.alive) {
              return;
            }
            ctx.runtime.executePendingJobs();
          })
          .catch((err: unknown) => {
            console.error('Unexpected QuickJS promise error', err);
          });
        sleep(msV, {signal: opts.signal})
          .then(() => {
            if (!ctx.alive) {
              return;
            }
            promise.resolve();
          })
          .catch((err: unknown) => {
            if (!ctx.alive) {
              return;
            }
            if (err instanceof Error) {
              ctx.newError(err).consume((v) => {
                promise.reject(v);
              });
            } else {
              ctx.newError(JSON.stringify(err)).consume((v) => {
                promise.reject(v);
              });
            }
          })
          .finally(() => {
            lifetime.remove(promise);
          });
        return {value: promise.handle};
      })
      .consume((v) => {
        ctx.setProp(universe, 'sleep', v);
      });
    ctx
      .newFunction('sha256hex', (s: QuickJSHandle) => {
        if (ctx.typeof(s) !== 'string') {
          return {
            error: ctx.newError(new Error('Cannot hash a non-string')),
          };
        }
        const str = ctx.getString(s);
        const promise = lifetime.add(ctx.newPromise());
        promise.settled
          .then(() => {
            if (!ctx.runtime.alive) {
              return;
            }
            ctx.runtime.executePendingJobs();
          })
          .catch((err: unknown) => {
            console.error('Unexpected QuickJS promise error', err);
          });
        sha256hex(str)
          .then((v) => {
            if (!ctx.alive) {
              return;
            }
            ctx.newString(v).consume((v) => {
              promise.resolve(v);
            });
          })
          .catch((err: unknown) => {
            if (!ctx.alive) {
              return;
            }
            if (err instanceof Error) {
              ctx.newError(err).consume((v) => {
                promise.reject(v);
              });
            } else {
              ctx.newError(JSON.stringify(err)).consume((v) => {
                promise.reject(v);
              });
            }
          })
          .finally(() => {
            promise.dispose();
          });
        return {value: promise.handle};
      })
      .consume((v) => {
        ctx.setProp(universe, 'sha256hex', v);
      });
    ctx.setProp(ctx.global, 'universe', universe);
  });
  return 'export default universe;';
};

export type QuickJSDir = {
  files: Map<string, string>;
  main: string;
  mainFileName: string;
};

export const runQuickJS = async (
  mod: QuickJSSyncVariant,
  dir: QuickJSDir,
  opts: {logger: Logger; signal: AbortSignal},
): Promise<
  Result<
    {
      value: unknown;
      duration: number;
      cycles: number;
    },
    Error
  >
> => {
  const qjs = await newQuickJSWASMModuleFromVariant(mod);
  if (isSignalAborted(opts.signal)) {
    return {err: new Error('Signal aborted')};
  }

  try {
    return await Scope.withScopeAsync(async (scope: Scope) => {
      const runtime = scope.manage(qjs.newRuntime());
      runtime.setMemoryLimit(10 * 1024 * 1024);
      runtime.setMaxStackSize(1024 * 1024);
      const start = performance.now();
      let interruptCycles = 0;
      runtime.setInterruptHandler(() => {
        interruptCycles++;
        // every interrupt cycle is around 4096 instructions
        if (interruptCycles > 1024) {
          console.error('Interrupt cycles exceeded', {interruptCycles});
          return true;
        }
        if (performance.now() - start > 2500) {
          console.error('Deadline exceeded', {interruptCycles});
          return true;
        }
        if (isSignalAborted(opts.signal)) {
          console.error('Run cancelled', {interruptCycles});
          return true;
        }
        return false;
      });
      const vm = scope.manage(runtime.newContext());
      // lifetime manager must be managed after, and hence cleaned up before,
      // the runtime context
      const lifetimeManager = scope.manage(new LifetimeManager());
      runtime.setModuleLoader((modName: string, ctx: QuickJSContext) => {
        if (modName === 'universe:std') {
          return {value: createUniverse(ctx, lifetimeManager, opts)};
        }
        const f = dir.files.get(modName);
        if (isNil(f)) {
          return {error: new Error(`No module ${modName}`)};
        }
        return {value: f};
      });

      const unpackQuickJSResult = (
        res: VmCallResult<QuickJSHandle>,
      ): QuickJSHandle | undefined => {
        if (isFail(res)) {
          res.error.consume((resErr) => {
            opts.logger.log(
              'sys',
              `JS error: ${JSON.stringify(vm.dump(resErr), undefined, '  ')}`,
            );
            return undefined;
          });
          return;
        }
        const value = res.value;
        if (isSignalAborted(opts.signal)) {
          value.dispose();
          return undefined;
        }
        return value;
      };
      const waitForPromise = async (
        v: QuickJSHandle,
      ): Promise<QuickJSHandle | undefined> => {
        const promise = vm.resolvePromise(v);
        vm.runtime.executePendingJobs();
        const res = await promise;
        return unpackQuickJSResult(res);
      };
      const unpackQuickJSCall = async (
        res: VmCallResult<QuickJSHandle>,
      ): Promise<QuickJSHandle | undefined> => {
        const value = unpackQuickJSResult(res);
        if (isNil(value)) {
          return undefined;
        }
        return await value.consume(async (v) => {
          return await waitForPromise(v);
        });
      };

      const modExports = await unpackQuickJSCall(
        vm.evalCode(dir.main, dir.mainFileName, {
          type: 'module',
          strict: true,
        }),
      );
      if (isNil(modExports)) {
        return {
          value: {
            value: undefined,
            duration: performance.now() - start,
            cycles: interruptCycles,
          },
        };
      }
      const mainfn = modExports.consume((modExports) => {
        opts.logger.log(
          'sys',
          `Main module exports: ${JSON.stringify(vm.dump(modExports), undefined, '  ')}`,
        );
        if (vm.typeof(modExports) !== 'object') {
          return undefined;
        }
        const mainfn = vm.getProp(modExports, 'default');
        return mainfn;
      });
      if (isNil(mainfn)) {
        return {
          value: {
            value: undefined,
            duration: performance.now() - start,
            cycles: interruptCycles,
          },
        };
      }
      const fnRet = await mainfn.consume(async (mainfn) => {
        if (vm.typeof(mainfn) !== 'function') {
          return undefined;
        }
        const fnRet = await unpackQuickJSCall(
          vm.callFunction(mainfn, vm.global),
        );
        if (isNil(fnRet)) {
          return undefined;
        }
        return fnRet;
      });
      if (isNil(fnRet)) {
        return {
          value: {
            value: undefined,
            duration: performance.now() - start,
            cycles: interruptCycles,
          },
        };
      }
      return {
        value: {
          value: fnRet.consume((fnRet) => vm.dump(fnRet) as unknown),
          duration: performance.now() - start,
          cycles: interruptCycles,
        },
      };
    });
  } catch (err) {
    return {err: new Error('Failed executing QuickJS', {cause: err})};
  }
};
