import {
  type FC,
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from 'react';
import QuickJSMod from '@jitl/quickjs-wasmfile-release-sync';
import QuickJSWasmMod from '@jitl/quickjs-wasmfile-release-sync/wasm';
import {
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSSyncVariant,
  Scope,
  isFail,
  newQuickJSWASMModuleFromVariant,
  newVariant,
  VmCallResult,
} from 'quickjs-emscripten-core';

import {
  Box,
  BoxPadded,
  Flex,
  FlexAlignItems,
  FlexDir,
} from '@xorkevin/nuke/component/box';
import {Button, ButtonGroup} from '@xorkevin/nuke/component/button';
import {
  Field,
  Form,
  type FormValue,
  Input,
  Label,
  Textarea,
  TextareaResize,
  useForm,
} from '@xorkevin/nuke/component/form';
import {TextClasses} from '@xorkevin/nuke/component/text';
import {
  type Result,
  isNil,
  isNonNil,
  isResErr,
  isSignalAborted,
  sleep,
} from '@xorkevin/nuke/computil';
import {useRoute, useRouter} from '@xorkevin/nuke/router';

import styles from './playground.module.css';
import {CloseIcon} from './playgroundui.js';

import {
  bufToStrArray,
  compress,
  decompress,
  sha256hex,
  strArrToBuf,
} from '@/compress.js';
import {compileStreaming} from '@/wasi.js';

const Header = ({share, run}: {share: () => void; run: () => void}) => (
  <Box padded={BoxPadded.TB} paddedSmall>
    <Flex alignItems={FlexAlignItems.Center} gap="16px">
      <hgroup>
        <h1 className={TextClasses.TitleSmall}>JS Playground</h1>
      </hgroup>
      <ButtonGroup>
        <Button type="reset">Reset</Button>
        <Button onClick={share}>Share</Button>
        <Button onClick={run}>Run</Button>
      </ButtonGroup>
    </Flex>
  </Box>
);

const MAIN_FILE_ID = 'MAIN';
const MAIN_FILE_NAME = 'main.js';

const PlaygroundFile = ({id, rm}: {id: string; rm: (id: string) => void}) => {
  const isMain = id === MAIN_FILE_ID;
  const del = useCallback(() => {
    rm(id);
  }, [id, rm]);
  return (
    <div>
      <Field>
        <Flex alignItems={FlexAlignItems.Center} gap="8px">
          <Label>Filename</Label>
          <Input
            name={`${id}:name`}
            value={isMain ? MAIN_FILE_NAME : undefined}
            readOnly={isMain}
          />
          {!isMain && (
            <Button onClick={del} paddedSmall aria-label="Remove">
              <CloseIcon />
            </Button>
          )}
        </Flex>
      </Field>
      <Field>
        <Flex dir={FlexDir.Col}>
          <Label>Data</Label>
          <Textarea
            name={`${id}:data`}
            resize={TextareaResize.Vertical}
            rows={16}
            monospace
            fullWidth
          />
        </Flex>
      </Field>
    </div>
  );
};

const Footer = ({add}: {add: () => void}) => (
  <Box padded={BoxPadded.TB} paddedSmall>
    <ButtonGroup>
      <Button onClick={add}>Add</Button>
    </ButtonGroup>
  </Box>
);

type FilesState = {
  files: string[];
  [key: string]: FormValue;
};

const getStr = (s: unknown): string => (typeof s === 'string' ? s : '');

const filesStateToBuf = (s: FilesState): ArrayBuffer => {
  const arr = [getStr(s[`${MAIN_FILE_ID}:data`])].concat(
    s.files.flatMap((id) => [getStr(s[`${id}:name`]), getStr(s[`${id}:data`])]),
  );
  return strArrToBuf(arr);
};

const bufToFilesState = (buf: ArrayBuffer): Result<FilesState, Error> => {
  const arr = bufToStrArray(buf);
  if (isResErr(arr)) {
    return arr;
  }
  if (arr.value.length < 1) {
    return {err: new Error('File state is malformed')};
  }
  const files: string[] = [];
  const state: FilesState = {
    files,
    [`${MAIN_FILE_ID}:data`]: arr.value[0],
  };
  const rest = arr.value.slice(1);
  if (rest.length % 2 !== 0) {
    return {err: new Error('File state is malformed')};
  }
  for (let i = 1; i < rest.length; i += 2) {
    const name = rest[i - 1];
    const data = rest[i];
    const id = crypto.randomUUID() as string;
    files.push(id);
    state[`${id}:name`] = name ?? '';
    state[`${id}:data`] = data ?? '';
  }
  return {value: state};
};

type QuickJSDir = {
  files: Map<string, string>;
  main: string;
};

const filesStateToQuickJSDir = (s: FilesState): QuickJSDir => {
  const files = new Map<string, string>();
  s.files.forEach((id) => {
    files.set(getStr(s[`${id}:name`]), getStr(s[`${id}:data`]));
  });
  return {
    files,
    main: getStr(s[`${MAIN_FILE_ID}:data`]),
  };
};

const initFilesState = (): FilesState => {
  const id = crypto.randomUUID() as string;
  return {
    files: [id],
    [`${MAIN_FILE_ID}:data`]: `import * as secret from './secret.js';

export default secret.keyhash;
`,
    [`${id}:name`]: 'secret.js',
    [`${id}:data`]: `import u from 'universe:std';

const key = 'top secret';
u.log(key);
export const keyhash = await u.sha256hex(key);
`,
  };
};

const emptyOutput = () => ({stdout: '', stderr: ''});

const JSPlayground: FC = () => {
  const form = useForm(initFilesState);
  const formState = form.state;
  const formSetState = form.setState;

  useEffect(() => {
    formSetState((v) => {
      let copy = undefined;
      const s = new Set<string>(formState.files);
      for (const k of Object.keys(v)) {
        if (k === 'files' || k === 'strout') {
          continue;
        }
        const [name] = k.split(':', 1) as [string];
        if (name !== MAIN_FILE_ID && !s.has(name)) {
          if (copy === undefined) {
            copy = Object.assign({}, v);
          }
          delete copy[k];
        }
      }
      return copy ?? v;
    });
  }, [formState, formSetState]);

  const add = useCallback(() => {
    formSetState((v) => {
      const next = Object.assign({}, v);
      next.files = next.files.slice();
      const id = crypto.randomUUID() as string;
      next.files.push(id);
      Object.assign(next, {
        [`${id}:name`]: '',
        [`${id}:data`]: '',
      });
      return next;
    });
  }, [formSetState]);

  const rm = useCallback(
    (id: string) => {
      formSetState((v) => {
        if (id === MAIN_FILE_ID) {
          return v;
        }
        const next = Object.assign({}, v);
        const idx = next.files.indexOf(id);
        if (idx > -1) {
          next.files = next.files.toSpliced(idx, 1);
        }
        delete next[`${id}:name`];
        delete next[`${id}:data`];
        return next;
      });
    },
    [formSetState],
  );

  const unmounted = useRef<AbortSignal | undefined>();
  useEffect(() => {
    const controller = new AbortController();
    unmounted.current = controller.signal;
    return () => {
      controller.abort();
    };
  }, [unmounted]);
  const prevCode = useRef('');

  const lastShare = useRef<AbortController | undefined>();
  const route = useRoute();
  const routeNav = route.navigate;
  const share = useCallback(() => {
    if (isNonNil(lastShare.current)) {
      lastShare.current.abort();
      lastShare.current = undefined;
    }
    const unmountSignal = unmounted.current;
    if (isNil(unmountSignal)) {
      return;
    }
    const controller = new AbortController();
    lastShare.current = controller;
    unmountSignal.addEventListener(
      'abort',
      () => {
        controller.abort();
      },
      {signal: controller.signal},
    );
    void (async () => {
      const code = await compress(filesStateToBuf(formState));
      if (isResErr(code)) {
        console.error('Failed compressing url code', code.err);
        return;
      }
      if (isSignalAborted(controller.signal)) {
        return;
      }
      const digest = await sha256hex(code.value);
      if (isSignalAborted(controller.signal)) {
        return;
      }
      if (digest === prevCode.current) {
        return;
      }
      const params = new URLSearchParams({
        codev0: code.value,
      });
      // set code to avoid redecoding
      prevCode.current = digest;
      routeNav(`#${params.toString()}`, true);
    })();
  }, [lastShare, formState, unmounted, routeNav]);

  const handleReset = useCallback(() => {
    routeNav('', true);
  }, [routeNav]);

  const router = useRouter();
  const routerURL = router.url;
  useEffect(() => {
    let hash = routerURL.hash;
    if (isNil(hash)) {
      prevCode.current = '';
      return;
    }
    if (hash.startsWith('#')) {
      hash = hash.slice(1);
    }
    const u = new URLSearchParams(hash);
    const code = u.get('codev0');
    if (isNil(code) || code === '') {
      prevCode.current = '';
      return;
    }
    const controller = new AbortController();
    void (async () => {
      const digest = await sha256hex(code);
      if (isSignalAborted(controller.signal)) {
        return;
      }
      if (digest === prevCode.current) {
        return;
      }
      const buf = await decompress(code);
      if (isSignalAborted(controller.signal)) {
        return;
      }
      if (digest === prevCode.current) {
        return;
      }
      prevCode.current = digest;
      if (isResErr(buf)) {
        console.error('Failed decompressing url code', buf.err);
        return;
      }
      const s = bufToFilesState(buf.value);
      if (isResErr(s)) {
        console.error('Failed parsing url code', s.err);
        return;
      }
      console.log('setting files state');
      formSetState(s.value);
    })();
    return () => {
      controller.abort();
    };
  }, [prevCode, routerURL, formSetState]);

  const [quickjsMod, setQuickjsMod] = useState<QuickJSSyncVariant | undefined>(
    undefined,
  );
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const mod = await compileStreaming(fetch(QuickJSWasmMod));
      if (isSignalAborted(controller.signal)) {
        return;
      }
      if (isResErr(mod)) {
        console.error('Failed compiling wasm module', mod.err);
        return;
      }
      const qjsMod = newVariant(QuickJSMod as unknown as QuickJSSyncVariant, {
        wasmModule: mod.value,
      });
      setQuickjsMod(qjsMod);
    })();
    return () => {
      controller.abort();
    };
  }, [setQuickjsMod]);

  const lastRun = useRef<AbortController | undefined>();
  const [output, setOutput] = useState(emptyOutput);
  const run = useCallback(() => {
    if (isNil(quickjsMod)) {
      setOutput(emptyOutput);
      return;
    }

    if (isNonNil(lastRun.current)) {
      lastRun.current.abort();
      lastRun.current = undefined;
    }
    const unmountSignal = unmounted.current;
    if (isNil(unmountSignal)) {
      return;
    }
    const controller = new AbortController();
    lastRun.current = controller;
    unmountSignal.addEventListener(
      'abort',
      () => {
        controller.abort();
      },
      {signal: controller.signal},
    );

    setOutput((v) => ({stdout: v.stdout, stderr: 'Loading...'}));
    void (async () => {
      const logs: string[] = [];
      const qjs = await newQuickJSWASMModuleFromVariant(quickjsMod);
      if (isSignalAborted(controller.signal)) {
        return;
      }

      try {
        await Scope.withScopeAsync(async (scope: Scope) => {
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
            if (isSignalAborted(controller.signal)) {
              console.error('Run cancelled', {interruptCycles});
              return true;
            }
            return false;
          });
          const dir = filesStateToQuickJSDir(formState);
          runtime.setModuleLoader((modName: string, ctx: QuickJSContext) => {
            if (modName === 'universe:std') {
              ctx.newObject().consume((universe) => {
                ctx
                  .newFunction('log', (...args) => {
                    if (isSignalAborted(controller.signal)) {
                      return;
                    }
                    const a = args.map((v) => ctx.dump(v) as unknown);
                    if (logs.length > 1024) {
                      logs.splice(0, logs.length - 512, '...omitted...');
                    }
                    logs.push(JSON.stringify(a, undefined, '  '));
                    setOutput({
                      stdout: '',
                      stderr: logs.join('\n'),
                    });
                  })
                  .consume((v) => {
                    ctx.setProp(universe, 'log', v);
                  });
                ctx
                  .newFunction('sleep', (ms: QuickJSHandle) => {
                    if (ctx.typeof(ms) !== 'number') {
                      return {
                        error: ctx.newError(
                          new Error(
                            'Must provide sleep with a number of milliseconds',
                          ),
                        ),
                      };
                    }
                    const msV = ctx.getNumber(ms);
                    const promise = scope.manage(ctx.newPromise());
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
                    sleep(msV, {signal: controller.signal})
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
                        promise.dispose();
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
                        error: ctx.newError(
                          new Error('Cannot hash a non-string'),
                        ),
                      };
                    }
                    const str = ctx.getString(s);
                    const promise = scope.manage(ctx.newPromise());
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
              return {value: `export default universe`};
            }
            const f = dir.files.get(modName);
            if (isNil(f)) {
              return {error: new Error(`No module ${modName}`)};
            }
            return {value: f};
          });

          const vm = scope.manage(runtime.newContext());
          const unpackQuickJSResult = (
            res: VmCallResult<QuickJSHandle>,
          ): QuickJSHandle | undefined => {
            if (isFail(res)) {
              const resErr = scope.manage(res.error);
              if (isSignalAborted(controller.signal)) {
                return;
              }
              const err = vm.dump(resErr) as unknown;
              logs.push(`JS error: ${JSON.stringify(err, undefined, '  ')}`);
              setOutput({
                stdout: '',
                stderr: logs.join('\n'),
              });
              return undefined;
            }
            const value = scope.manage(res.value);
            if (isSignalAborted(controller.signal)) {
              return undefined;
            }
            return value;
          };
          const waitForPromise = async (
            v: QuickJSHandle,
          ): Promise<QuickJSHandle | undefined> => {
            scope.manage(v);
            const promise = vm.resolvePromise(v);
            vm.runtime.executePendingJobs();
            const res = await promise;
            // must unpack result to manage handles
            return unpackQuickJSResult(res);
          };
          const unpackQuickJSCall = async (
            res: VmCallResult<QuickJSHandle>,
          ): Promise<QuickJSHandle | undefined> => {
            const value = unpackQuickJSResult(res);
            if (isNil(value)) {
              return;
            }
            return await waitForPromise(value);
          };

          const modExports = await unpackQuickJSCall(
            vm.evalCode(dir.main, MAIN_FILE_NAME, {
              type: 'module',
              strict: true,
            }),
          );
          if (isNil(modExports)) {
            return;
          }
          logs.push(
            `Main module exports: ${JSON.stringify(vm.dump(modExports), undefined, '  ')}`,
          );
          setOutput({
            stdout: '',
            stderr: logs.join('\n'),
          });
          if (vm.typeof(modExports) !== 'object') {
            return;
          }
          const mainfn = scope.manage(vm.getProp(modExports, 'default'));
          if (vm.typeof(mainfn) !== 'function') {
            return;
          }
          const fnRet = await unpackQuickJSCall(
            vm.callFunction(mainfn, vm.global),
          );
          if (isNil(fnRet)) {
            return;
          }
          setOutput({
            stdout: JSON.stringify(vm.dump(fnRet), undefined, '  '),
            stderr: logs.join('\n'),
          });
        });
      } catch (err) {
        console.error('Failed executing QuickJS', err);
      }
    })();
  }, [lastRun, setOutput, quickjsMod, unmounted, formState]);

  const deferredOutput = useDeferredValue(output);

  return (
    <Box padded={BoxPadded.LR} center>
      <Form form={form} onReset={handleReset}>
        <Header share={share} run={run} />
        <Flex gap="16px">
          <Flex dir={FlexDir.Col} gap="16px" className={styles['files']}>
            <PlaygroundFile id={MAIN_FILE_ID} rm={rm} />
            {formState.files.map((id) => (
              <PlaygroundFile key={id} id={id} rm={rm} />
            ))}
            <Footer add={add} />
          </Flex>
          <Flex dir={FlexDir.Col} className={styles['output']} gap="8px">
            <h2 className={TextClasses.TitleMedium}>Output</h2>
            <pre>{deferredOutput.stdout}</pre>
            <h3 className={TextClasses.TitleSmall}>Logs</h3>
            <pre>{deferredOutput.stderr}</pre>
          </Flex>
        </Flex>
      </Form>
    </Box>
  );
};

export default JSPlayground;
