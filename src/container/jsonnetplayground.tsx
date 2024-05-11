import {
  type FC,
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from 'react';
import jsonnetEnginePath from '@wasm/jsonnet.engine.wasm';

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
import {compileStreaming, runMod} from '@/wasi.js';

const Header = ({share}: {share: () => void}) => (
  <Box padded={BoxPadded.TB} paddedSmall>
    <Flex alignItems={FlexAlignItems.Center} gap="16px">
      <hgroup>
        <h1 className={TextClasses.TitleSmall}>Jsonnet Playground</h1>
      </hgroup>
      <ButtonGroup>
        <Button type="reset">Reset</Button>
        <Button onClick={share}>Share</Button>
      </ButtonGroup>
      <Field>
        <Flex alignItems={FlexAlignItems.Center}>
          <Input type="checkbox" name="strout" toggleSwitch />
          <Label>String Output</Label>
        </Flex>
      </Field>
    </Flex>
  </Box>
);

const MAIN_FILE_ID = 'MAIN';
const MAIN_FILE_NAME = 'main.jsonnet';

const CloseIcon = () => (
  <svg
    className={styles['close-icon']}
    aria-hidden={true}
    width="16"
    height="16"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="square"
    strokeLinejoin="miter"
    fill="none"
  >
    <polyline points="6 6 18 18" />
    <polyline points="18 6 6 18" />
  </svg>
);

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
  strout: boolean;
  [key: string]: FormValue;
};

const getStr = (s: unknown): string => (typeof s === 'string' ? s : '');

const filesStateToBuf = (s: FilesState): ArrayBuffer => {
  const arr = [s.strout ? 't' : 'f', getStr(s[`${MAIN_FILE_ID}:data`])].concat(
    s.files.flatMap((id) => [getStr(s[`${id}:name`]), getStr(s[`${id}:data`])]),
  );
  return strArrToBuf(arr);
};

const bufToFilesState = (buf: ArrayBuffer): Result<FilesState, Error> => {
  const arr = bufToStrArray(buf);
  if (isResErr(arr)) {
    return arr;
  }
  if (arr.value.length < 2) {
    return {err: new Error('File state is malformed')};
  }
  const files: string[] = [];
  const state: FilesState = {
    files,
    strout: arr.value[0] === 't',
    [`${MAIN_FILE_ID}:data`]: arr.value[1],
  };
  const rest = arr.value.slice(2);
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

type JsonnetConfig = {
  files: {[key: string]: string};
  strout: boolean;
};

const filesStateToWasmFiles = (s: FilesState): JsonnetConfig => {
  const files: [string, string][] = [
    [MAIN_FILE_NAME, getStr(s[`${MAIN_FILE_ID}:data`])],
  ];
  s.files.forEach((id) =>
    files.push([getStr(s[`${id}:name`]), getStr(s[`${id}:data`])]),
  );
  return {
    files: Object.fromEntries<string>(files),
    strout: s.strout,
  };
};

const initFilesState = (): FilesState => {
  const id = crypto.randomUUID() as string;
  return {
    files: [id],
    strout: false,
    [`${MAIN_FILE_ID}:data`]: `local nstd = import 'native:std';

local world = import 'dir/world.libsonnet';

assert nstd.log(
  'These functions are available in the additional native std lib',
  std.map((function(i) i.key), std.objectKeysValuesAll(nstd)),
);

assert nstd.log('This is a secret', world.secret);

local Person(name='World') = {
  name: name,
  welcome: 'Hello ' + name + '!',
};

local person = Person('Kevin');

{
  people: [Person(), person],
  secret: world.secrethash,
  obj: nstd.jsonMergePatch(
    {
      foo: {
        bar: "baz",
      },
      hello: "world",
    },
    {
      foo: {
        bar: person.name,
      },
    },
  ),
}
`,
    [`${id}:name`]: 'dir/world.libsonnet',
    [`${id}:data`]: `local nstd = import 'native:std';

{
  secret: 'top secret',
  secrethash: nstd.sha256hex(self.secret),
}
`,
  };
};

const emptyOutput = () => ({stdout: '', stderr: ''});

const JsonnetPlayground: FC = () => {
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

  const [jsonnetMod, setJsonnetMod] = useState<WebAssembly.Module | undefined>(
    undefined,
  );
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const mod = await compileStreaming(fetch(jsonnetEnginePath));
      if (isSignalAborted(controller.signal)) {
        return;
      }
      if (isResErr(mod)) {
        console.error('Failed compiling wasm module', mod.err);
        return;
      }
      setJsonnetMod(mod.value);
    })();
    return () => {
      controller.abort();
    };
  }, [setJsonnetMod]);

  const deferredFormState = useDeferredValue(formState);
  const [output, setOutput] = useState(emptyOutput);

  useEffect(() => {
    if (isNil(jsonnetMod)) {
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
      const res = await runMod(jsonnetMod, {
        stdin: JSON.stringify(filesStateToWasmFiles(deferredFormState)),
      });
      if (isSignalAborted(controller.signal)) {
        return;
      }
      if (isResErr(res)) {
        setOutput({
          stdout: '',
          stderr: `Failed running wasm module: ${res.err.toString()}`,
        });
        return;
      }
      setOutput(res.value);
    })();
    return () => {
      controller.abort();
    };
  }, [setOutput, jsonnetMod, deferredFormState]);

  return (
    <Box padded={BoxPadded.LR} center>
      <Form form={form} onReset={handleReset}>
        <Header share={share} />
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
            <pre>{output.stdout}</pre>
            <h3 className={TextClasses.TitleSmall}>Logs</h3>
            <pre>{output.stderr}</pre>
          </Flex>
        </Flex>
      </Form>
    </Box>
  );
};

export default JsonnetPlayground;
