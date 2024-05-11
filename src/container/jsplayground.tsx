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
  type QuickJSSyncVariant,
  Scope,
  isFail,
  newQuickJSWASMModuleFromVariant,
  newVariant,
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
  Label,
  Textarea,
  TextareaResize,
  useForm,
} from '@xorkevin/nuke/component/form';
import {TextClasses} from '@xorkevin/nuke/component/text';
import {
  type Result,
  isNil,
  isResErr,
  isSignalAborted,
  sleep,
} from '@xorkevin/nuke/computil';
import {useRoute, useRouter} from '@xorkevin/nuke/router';

import styles from './playground.module.css';

import {
  bufToStrArray,
  compress,
  decompress,
  hexDigestStr,
  strArrToBuf,
} from '@/compress.js';
import {compileStreaming} from '@/wasi.js';

const Header = ({share}: {share: () => void}) => (
  <Box padded={BoxPadded.TB} paddedSmall>
    <Flex alignItems={FlexAlignItems.Center} gap="16px">
      <hgroup>
        <h1 className={TextClasses.TitleSmall}>JS Playground</h1>
      </hgroup>
      <ButtonGroup>
        <Button type="reset">Reset</Button>
        <Button onClick={share}>Share</Button>
      </ButtonGroup>
    </Flex>
  </Box>
);

const PlaygroundFile = () => {
  return (
    <div>
      <Field>
        <Flex dir={FlexDir.Col}>
          <Label>Data</Label>
          <Textarea
            name="content"
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

type FilesState = {
  content: string;
};

const filesStateToBuf = (s: FilesState): ArrayBuffer => {
  return strArrToBuf([s.content]);
};

const bufToFilesState = (buf: ArrayBuffer): Result<FilesState, Error> => {
  const arr = bufToStrArray(buf);
  if (isResErr(arr)) {
    return arr;
  }
  if (arr.value.length !== 1) {
    return {err: new Error('File state is malformed')};
  }
  const state: FilesState = {
    content: arr.value[0] ?? '',
  };
  return {value: state};
};

const initFilesState = (): FilesState => {
  return {
    content: '',
  };
};

const emptyOutput = () => ({stdout: '', stderr: ''});

const JSPlayground: FC = () => {
  const form = useForm(initFilesState);
  const formState = form.state;
  const formSetState = form.setState;

  const unmounted = useRef<AbortSignal | undefined>();
  useEffect(() => {
    const controller = new AbortController();
    unmounted.current = controller.signal;
    return () => {
      controller.abort();
    };
  }, [unmounted]);
  const prevCode = useRef('');

  const route = useRoute();
  const routeNav = route.navigate;
  const share = useCallback(() => {
    void (async () => {
      const code = await compress(filesStateToBuf(formState));
      if (isResErr(code)) {
        console.error('Failed compressing url code', code.err);
        return;
      }
      if (isNil(unmounted.current) || isSignalAborted(unmounted.current)) {
        return;
      }
      const digest = await hexDigestStr(code.value);
      if (isNil(unmounted.current) || isSignalAborted(unmounted.current)) {
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
  }, [formState, unmounted, routeNav]);

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
      const digest = await hexDigestStr(code);
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

  const deferredFormState = useDeferredValue(formState);
  const [output, setOutput] = useState(emptyOutput);

  useEffect(() => {
    if (isNil(quickjsMod)) {
      setOutput(emptyOutput);
      return;
    }

    const controller = new AbortController();
    void (async () => {
      setOutput((v) => ({stdout: v.stdout, stderr: 'Loading...'}));
      await sleep(250, {signal: controller.signal});
      if (isSignalAborted(controller.signal)) {
        return;
      }
      const logs: string[] = [];
      const qjs = await newQuickJSWASMModuleFromVariant(quickjsMod);
      if (isSignalAborted(controller.signal)) {
        return;
      }

      Scope.withScope((scope: Scope) => {
        const runtime = scope.manage(qjs.newRuntime());
        runtime.setMemoryLimit(2 * 1024 * 1024);
        runtime.setMaxStackSize(1024 * 1024);
        let interruptCycles = 0;
        runtime.setInterruptHandler(() => {
          interruptCycles++;
          if (interruptCycles > 1024) {
            return true;
          }
          return false;
        });
        const context = scope.manage(runtime.newContext());
        const result = context.evalCode(deferredFormState.content, 'main.js', {
          type: 'module',
          strict: true,
        });
        if (isFail(result)) {
          const resErr = scope.manage(result.error);
          setOutput({
            stdout: '',
            stderr: `${logs.join('\n')}\nJS error: ${JSON.stringify(context.dump(resErr), undefined, '  ')}`,
          });
          return;
        }
        const modExports = scope.manage(result.value);
        if (context.typeof(modExports) !== 'object') {
          setOutput({
            stdout: ``,
            stderr: `${logs.join('\n')}\nModule exports: ${JSON.stringify(context.dump(modExports), undefined, '  ')}`,
          });
          return;
        }
        const mainfn = scope.manage(context.getProp(modExports, 'default'));
        if (context.typeof(mainfn) !== 'function') {
          setOutput({
            stdout: ``,
            stderr: `${logs.join('\n')}\nModule exports: ${JSON.stringify(context.dump(modExports), undefined, '  ')}`,
          });
          return;
        }
        const fnresult = context.callFunction(mainfn, context.global);
        if (isFail(fnresult)) {
          const resErr = scope.manage(fnresult.error);
          setOutput({
            stdout: '',
            stderr: `${logs.join('\n')}\nJS error: ${JSON.stringify(context.dump(resErr), undefined, '  ')}`,
          });
          return;
        }
        const fnret = scope.manage(fnresult.value);
        setOutput({
          stdout: JSON.stringify(context.dump(fnret), undefined, '  '),
          stderr: logs.join('\n'),
        });
      });
    })();
    return () => {
      controller.abort();
    };
  }, [setOutput, quickjsMod, deferredFormState]);

  return (
    <Box padded={BoxPadded.LR} center>
      <Form form={form} onReset={handleReset}>
        <Header share={share} />
        <Flex gap="16px">
          <Flex dir={FlexDir.Col} gap="16px" className={styles['files']}>
            <PlaygroundFile />
          </Flex>
          <Flex dir={FlexDir.Col} className={styles['output']} gap="8px">
            <h2 className={TextClasses.TitleMedium}>Output</h2>
            <pre>{output.stdout}</pre>
            <h3 className={TextClasses.TitleSmall}>Logs</h3>
            <pre>{output.stderr}</pre>
          </Flex>
        </Flex>
      </Form>
    </Box>
  );
};

export default JSPlayground;
