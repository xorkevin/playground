import {type FC, useCallback, useEffect, useRef} from 'react';

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
} from '@xorkevin/nuke/computil';
import {useRoute, useRouter} from '@xorkevin/nuke/router';

import styles from './jsonnetplayground.module.css';

import {
  bufToStrArray,
  compress,
  decompress,
  hexDigestStr,
  strArrToBuf,
} from '@/compress.js';

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
    </Flex>
  </Box>
);

const MAIN_FILE_ID = 'MAIN';

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
            value={isMain ? 'main.jsonnet' : undefined}
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
            rows={8}
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
  if (arr.value.length % 2 !== 1) {
    return {err: new Error('File state is malformed')};
  }
  const files: string[] = [];
  const state: FilesState = {
    files,
    [`${MAIN_FILE_ID}:data`]: arr.value[0],
  };
  for (let i = 2; i < arr.value.length; i += 2) {
    const name = arr.value[i - 1];
    const data = arr.value[i];
    const id = crypto.randomUUID() as string;
    files.push(id);
    state[`${id}:name`] = name;
    state[`${id}:data`] = data;
  }
  return {value: state};
};

const initFilesState = (): FilesState => {
  return {
    files: [],
    [`${MAIN_FILE_ID}:data`]: '',
  };
};

const JsonnetPlayground: FC = () => {
  const form = useForm(initFilesState);
  const formState = form.state;
  const formSetState = form.setState;

  useEffect(() => {
    formSetState((v) => {
      let copy = undefined;
      const s = new Set<string>(formState.files);
      for (const k of Object.keys(v)) {
        if (k === 'files') {
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

  return (
    <Box padded={BoxPadded.LR} center>
      <Form form={form}>
        <Header share={share} />
        <Flex gap="16px">
          <Flex dir={FlexDir.Col} gap="16px" className={styles['files']}>
            <PlaygroundFile id={MAIN_FILE_ID} rm={rm} />
            {formState.files.map((id) => (
              <PlaygroundFile key={id} id={id} rm={rm} />
            ))}
            <Footer add={add} />
          </Flex>
          <div className={styles['output']}>
            <pre>{JSON.stringify(formState, undefined, '  ')}</pre>
          </div>
        </Flex>
      </Form>
    </Box>
  );
};

export default JsonnetPlayground;
