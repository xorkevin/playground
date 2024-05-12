import type {FC} from 'react';

import styles from './playground.module.css';

export const CloseIcon: FC = () => (
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
