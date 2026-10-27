// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MascotArtwork } from './MascotArtwork';

afterEach(cleanup);

const asset = { src: '/assets/reviewed-welcome.png', width: 640, height: 400, alt: '已审核的一二布布欢迎插画' };

describe('independent mascot artwork slot', () => {
  it.each(['hero', 'compact'] as const)('labels the neutral placeholder without loading a character image (%s)', (size) => {
    const { container } = render(<MascotArtwork size={size} />);
    const placeholder = screen.getByRole('img', { name: '一二布布插画占位，原版素材待接入' });
    expect(placeholder.textContent).toBe(size === 'compact' ? '素材待接入' : '角色插画预留位原版素材待接入');
    expect(container.querySelector('img')).toBeNull();
  });

  it('preserves the supplied asset path, natural dimensions and alternative text', () => {
    render(<MascotArtwork size="hero" asset={asset} />);
    const image = screen.getByRole('img', { name: asset.alt });
    expect(image.getAttribute('src')).toBe(asset.src);
    expect(image.getAttribute('width')).toBe('640');
    expect(image.getAttribute('height')).toBe('400');
  });

  it.each(['hero', 'compact'] as const)('falls back after an image error and can display a different reviewed source (%s)', (size) => {
    const { rerender } = render(<MascotArtwork size={size} asset={asset} />);
    fireEvent.error(screen.getByRole('img', { name: asset.alt }));
    const placeholder = screen.getByRole('img', { name: '一二布布插画占位，原版素材待接入' });
    expect(placeholder.textContent).toBe(size === 'compact' ? '素材待接入' : '角色插画预留位原版素材待接入');
    expect(screen.queryByRole('img', { name: asset.alt })).toBeNull();
    rerender(<MascotArtwork size={size} asset={{ ...asset, src: '/assets/replacement-welcome.png' }} />);
    expect(screen.getByRole('img', { name: asset.alt }).getAttribute('src')).toBe('/assets/replacement-welcome.png');
  });
});
