import { useState } from 'react';
import { Icon } from './Icon';
import styles from './MascotArtwork.module.css';

export interface MascotAsset {
  readonly src: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
}

interface MascotArtworkProps {
  size: 'hero' | 'compact';
  // Only reviewed assets imported from the renderer belong here.
  asset?: MascotAsset;
}

export function MascotArtwork({ size, asset }: MascotArtworkProps) {
  const [failedSource, setFailedSource] = useState<string>();

  return (
    <div className={styles.artwork} data-size={size}>
      {asset && failedSource !== asset.src ? (
        <img key={asset.src} className={styles.image} src={asset.src} width={asset.width}
          height={asset.height} alt={asset.alt} onError={() => setFailedSource(asset.src)} />
      ) : (
        <div className={styles.placeholder} role="img" aria-label="一二布布插画占位，原版素材待接入">
          {size === 'compact' ? (
            <span className={styles.compactLabel}>素材待接入</span>
          ) : (
            <>
              <span className={styles.mark}><Icon name="folder" /><Icon name="document" /></span>
              <span>角色插画预留位</span>
              <span className={styles.caption}>原版素材待接入</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
