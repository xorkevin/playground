import {
  type FC,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from 'react';
import QuickJSMod from '@jitl/quickjs-wasmfile-release-sync';
import QuickJSWasmMod from '@jitl/quickjs-wasmfile-release-sync/wasm';
import {type QuickJSSyncVariant, newVariant} from 'quickjs-emscripten-core';

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
} from '@xorkevin/nuke/computil';
import {useRoute, useRouter} from '@xorkevin/nuke/router';

import styles from './playground.module.css';
import {CloseIcon} from './playgroundui.js';
import {CachedLogger, type QuickJSDir, runQuickJS} from './quickjs.js';

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

const filesStateToQuickJSDir = (s: FilesState): QuickJSDir => {
  const files = new Map<string, string>();
  s.files.forEach((id) => {
    files.set(getStr(s[`${id}:name`]), getStr(s[`${id}:data`]));
  });
  return {
    files,
    main: getStr(s[`${MAIN_FILE_ID}:data`]),
    mainFileName: MAIN_FILE_NAME,
  };
};

const initFilesState = (): FilesState => {
  const id = crypto.randomUUID() as string;
  return {
    files: [id],
    [`${MAIN_FILE_ID}:data`]: `import u from 'universe:std';
import * as secret from './secret.js';

u.log('Hello, world');

const main = () => {
  return secret.keyhash;
};
export default main;
`,
    [`${id}:name`]: 'secret.js',
    [`${id}:data`]: `import u from 'universe:std';

const key = 'top secret';
u.log(key);
export const keyhash = await u.sha256hex(key);
`,
  };
};

const emptyOutput = () => ({stdout: '', stderr: '', stats: ''});

const JSPlayground: FC = () => {
  const form = useForm(initFilesState);
  const formState = form.state;
  const formSetState = form.setState;

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

  const route = useRoute();
  const routeNav = route.navigate;

  const lastShare = useRef<AbortController | undefined>();
  const prevCode = useRef('');
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
      routeNav({hash: params.toString()}, {replace: true});
    })();
  }, [lastShare, unmounted, formState, prevCode, routeNav]);

  const handleReset = useCallback(() => {
    routeNav('', {replace: true});
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

  const [quickjsMod, setQuickjsMod] = useState<
    QuickJSSyncVariant | undefined
  >();
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
    if (isNonNil(lastRun.current)) {
      lastRun.current.abort();
      lastRun.current = undefined;
    }

    const unmountSignal = unmounted.current;
    if (isNil(unmountSignal)) {
      return;
    }

    if (isNil(quickjsMod)) {
      startTransition(() => {
        setOutput(emptyOutput);
      });
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

    startTransition(() => {
      setOutput((v) => ({
        stdout: v.stdout,
        stderr: 'Loading...',
        stats: v.stats,
      }));
    });
    void (async () => {
      const logger = new CachedLogger(1024, (l) => {
        if (isSignalAborted(controller.signal)) {
          return;
        }
        startTransition(() => {
          setOutput({
            stdout: '',
            stderr: (l.isWrapped() ? ['...omitted...'] : [])
              .concat(l.output())
              .join('\n'),
            stats: '',
          });
        });
      });
      const dir = filesStateToQuickJSDir(formState);
      const res = await runQuickJS(quickjsMod, dir, {
        logger,
        signal: controller.signal,
      });
      if (isSignalAborted(controller.signal)) {
        return;
      }
      if (isResErr(res)) {
        startTransition(() => {
          setOutput({
            stdout: '',
            stderr: (logger.isWrapped() ? ['...omitted...'] : [])
              .concat(logger.output())
              .concat(JSON.stringify(res.err, undefined, '  '))
              .join('\n'),
            stats: '',
          });
        });
        return;
      }
      startTransition(() => {
        setOutput({
          stdout: isNil(res.value.value)
            ? ''
            : JSON.stringify(res.value.value, undefined, '  '),
          stderr: (logger.isWrapped() ? ['...omitted...'] : [])
            .concat(logger.output())
            .join('\n'),
          stats: JSON.stringify({
            cycles: res.value.cycles,
            durationMS: res.value.duration,
          }),
        });
      });
    })();
  }, [lastRun, unmounted, quickjsMod, setOutput, formState]);

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
            <h3 className={TextClasses.TitleSmall}>Stats</h3>
            <pre>{deferredOutput.stats}</pre>
            <h3 className={TextClasses.TitleSmall}>Main function return</h3>
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
