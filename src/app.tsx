import {
  type ChangeEventHandler,
  type FC,
  Suspense,
  lazy,
  useCallback,
} from 'react';

import {
  Box,
  BoxPadded,
  BoxSize,
  Flex,
  FlexAlignItems,
  FlexJustifyContent,
} from '@xorkevin/nuke/component/box';
import {Field, Select} from '@xorkevin/nuke/component/form';
import {NavBar, NavClasses} from '@xorkevin/nuke/component/nav';
import {
  ColorScheme,
  TextClasses,
  useColorScheme,
} from '@xorkevin/nuke/component/text';
import {classNames, strToEnum} from '@xorkevin/nuke/computil';
import {type Route, Routes} from '@xorkevin/nuke/router';

import styles from './app.module.css';

const fallbackView = <div>Loading</div>;

const routes: Route[] = [
  {
    path: '/play/jsonnet',
    exact: true,
    component: lazy(
      async () => await import('./container/jsonnetplayground.js'),
    ),
  },
  {
    path: '/play/js',
    exact: true,
    component: lazy(async () => await import('./container/jsplayground.js')),
  },
];

const App: FC = () => {
  const {colorScheme, setColorScheme} = useColorScheme();
  const onColorSchemeChange = useCallback<
    ChangeEventHandler<HTMLSelectElement>
  >(
    (e) => {
      setColorScheme(
        strToEnum(ColorScheme, e.target.value) ?? ColorScheme.System,
      );
    },
    [setColorScheme],
  );
  return (
    <div className={styles['mainapp']}>
      <header className={NavClasses.Banner}>
        <Box
          size={BoxSize.S6}
          padded={BoxPadded.LR}
          center
          className={NavClasses.BannerItem}
        >
          <Flex
            justifyContent={FlexJustifyContent.SpaceBetween}
            alignItems={FlexAlignItems.Stretch}
            className={classNames(NavClasses.BannerItem)}
          >
            <Flex
              alignItems={FlexAlignItems.Stretch}
              className={classNames(NavClasses.BannerItem)}
              gap="16px"
            >
              <Flex
                alignItems={FlexAlignItems.Center}
                className={TextClasses.TitleSmall}
              >
                Code Playground
              </Flex>
              <NavBar matchesAriaCurrent="page" aria-label="Site navigation">
                <NavBar.Link href="play/jsonnet" exact>
                  Jsonnet
                </NavBar.Link>
                <NavBar.Link href="play/js" exact>
                  JS
                </NavBar.Link>
              </NavBar>
            </Flex>
            <Field>
              <Flex alignItems={FlexAlignItems.Center}>
                <Select
                  name="scheme"
                  value={colorScheme}
                  onChange={onColorSchemeChange}
                >
                  <option value={ColorScheme.System}>System</option>
                  <option value={ColorScheme.Light}>Light</option>
                  <option value={ColorScheme.Dark}>Dark</option>
                </Select>
              </Flex>
            </Field>
          </Flex>
        </Box>
      </header>
      <main>
        <Suspense fallback={fallbackView}>
          <Routes routes={routes} fallbackRedir="/play/jsonnet" />
        </Suspense>
      </main>
    </div>
  );
};

export default App;
