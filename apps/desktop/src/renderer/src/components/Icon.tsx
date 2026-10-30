const paths = {
  copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V3H3v13h5" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  check: <path d="m5 12 4 4L19 6" />,
  edit: <path d="m15 4 5 5M4 20l5-1L21 7l-4-4L5 15Z" />,
  key: <><circle cx="8" cy="9" r="5" /><path d="m12 12 8 8m-4-4 3-3" /></>,
  alert: <><path d="m12 3 10 18H2ZM12 9v5" /><circle cx="12" cy="17.5" r=".5" /></>,
  home: <path d="m3 10 9-7 9 7v10H15v-7H9v7H3Z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  message: <path d="M21 11a9 9 0 0 1-13 8L3 21l2-6a9 9 0 1 1 16-4Z" />,
  folder: <path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10H3Z" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  settings: <><circle cx="12" cy="12" r="4" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2" /></>,
  panel: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  document: <><path d="M6 2h8l5 5v15H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM14 2v5h5M8 12h7m-7 4h7" /></>,
  shield: <path d="m12 2 8 4v6c0 5-3 8-8 10-5-2-8-5-8-10V6Zm-3 10 2 2 4-4" />,
  send: <path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13" />,
  paperclip: <path d="m20 11-8 8a5 5 0 0 1-7-7L14 3a4 4 0 0 1 6 6l-9 9a2 2 0 0 1-3-3l8-8" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  heart: <path d="M20 6c-2-3-6-3-8 0-2-3-6-3-8 0-3 5 4 11 8 15 4-4 11-10 8-15Z" />,
};

export type IconName = keyof typeof paths;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {paths[name]}
    </svg>
  );
}
