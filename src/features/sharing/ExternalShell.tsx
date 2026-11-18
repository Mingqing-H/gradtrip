import type { ReactNode } from 'react';
import { Brand } from '../../components/ui';
import styles from './external.module.css';

export function ExternalShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <div className={styles.shell}><header className={styles.topbar}><a href="#/" className="brand"><Brand/></a></header><main className={`${styles.content} ${wide ? styles.wide : ''}`}>{children}</main></div>;
}
