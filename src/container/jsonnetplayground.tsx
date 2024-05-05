import {type FC, useEffect, useCallback} from 'react';

import {
  Box,
  BoxPadded,
  Flex,
  FlexAlignItems,
  FlexDir,
} from '@xorkevin/nuke/component/box';
import {Button, ButtonGroup} from '@xorkevin/nuke/component/button';
import {
  Form,
  type FormValue,
  Textarea,
  TextareaResize,
  useForm,
  Field,
  Label,
  Input,
} from '@xorkevin/nuke/component/form';
import {TextClasses} from '@xorkevin/nuke/component/text';

import styles from './jsonnetplayground.module.css';

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

type FilesState = {
  files: string[];
  [key: string]: FormValue;
};

const Footer = ({add}: {add: () => void}) => (
  <Box padded={BoxPadded.TB} paddedSmall>
    <ButtonGroup>
      <Button onClick={add}>Add</Button>
    </ButtonGroup>
  </Box>
);

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
          next.files = next.files.slice();
          next.files.splice(idx, 1);
        }
        delete next[`${id}:name`];
        delete next[`${id}:data`];
        return next;
      });
    },
    [formSetState],
  );

  const share = useCallback(() => {}, [formState]);

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
