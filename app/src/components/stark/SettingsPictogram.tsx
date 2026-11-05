import type { ReactNode } from "react";

export type SettingPictogramType =
  | "ACCOUNT"
  | "IMPORT"
  | "EXPORT"
  | "REMARK"
  | "SUBSCRIPTIONS"
  | "LANGUAGE"
  | "FONT"
  | "HELP"
  | "ABOUT"
  | "MODE"
  | "UPDATE"
  | "UPDATE_SOURCE";

const artwork: Record<SettingPictogramType, ReactNode> = {
  ACCOUNT: <>
    <path d="M16 2.5 27 7v8.4c0 7-4.3 11.4-11 14.1C9.3 26.8 5 22.4 5 15.4V7Z" fill="#477BDA" />
    <circle cx="16" cy="12" r="3.4" fill="#FFFFFF" />
    <path d="M9.3 21.4c.6-3.8 3-5.7 6.7-5.7s6.1 1.9 6.7 5.7a13.8 13.8 0 0 1-13.4 0Z" fill="#FFFFFF" />
    <circle cx="23.8" cy="23.1" r="5.3" fill="#42BFA0" />
    <path d="m21.7 23.1 1.5 1.5 2.8-3" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </>,
  IMPORT: <>
    <rect x="5.5" y="6" width="18" height="23" rx="3" fill="#8CC9ED" />
    <rect x="8.5" y="3" width="18" height="23" rx="3" fill="#FFFFFF" />
    <path d="M12.5 8h10M12.5 11h7" stroke="#B5CDE5" strokeWidth="2" strokeLinecap="round" />
    <path d="M14.2 13.5h3.6v6.1h3.1L16 25l-4.9-5.4h3.1Z" fill="#217EC5" />
    <path d="M10.5 27.5h11" stroke="#42C7AF" strokeWidth="2.3" strokeLinecap="round" />
  </>,
  EXPORT: <>
    <rect x="5.5" y="6" width="18" height="23" rx="3" fill="#85D9C6" />
    <rect x="8.5" y="3" width="18" height="23" rx="3" fill="#FFFFFF" />
    <path d="M12.5 20.5h10M12.5 23.5h7" stroke="#B4DAD0" strokeWidth="2" strokeLinecap="round" />
    <path d="M14.2 19.5h3.6v-6.1h3.1L16 8l-4.9 5.4h3.1Z" fill="#119A82" />
    <circle cx="24" cy="25" r="3" fill="#F6BE59" />
  </>,
  REMARK: <>
    <rect x="5" y="4" width="19" height="24" rx="3" fill="#F1A965" />
    <path d="M9 4h11a3 3 0 0 1 3 3v17H9Z" fill="#FFFFFF" />
    <path d="M12 9h8M12 13h6M12 17h5" stroke="#C2D4DF" strokeWidth="2" strokeLinecap="round" />
    <path d="M18 19.5 24.5 13l5.3 5.3-6.5 6.5-5.6.3Z" fill="#F07E45" />
    <circle cx="25.3" cy="17.5" r="1.1" fill="#FFFFFF" />
  </>,
  SUBSCRIPTIONS: <>
    <rect x="3" y="6" width="26" height="23" rx="5" fill="#7666D6" />
    <path d="M3 11h26v13a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5Z" fill="#FFFFFF" />
    <path d="M9 3v6M23 3v6" stroke="#5C4EB7" strokeWidth="3" strokeLinecap="round" />
    <circle cx="16" cy="19" r="6.1" fill="#F6C35F" />
    <path d="m12.8 19 2.2 2.2 4.2-4.3" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </>,
  LANGUAGE: <>
    <path d="M4 6a4 4 0 0 1 4-4h11a4 4 0 0 1 4 4v11a4 4 0 0 1-4 4h-7l-5 4v-4a4 4 0 0 1-3-4Z" fill="#43AFC1" />
    <path d="M19 11h5a4 4 0 0 1 4 4v7a4 4 0 0 1-4 4h-2v4l-5-4h-3a4 4 0 0 1-4-4v-2" fill="#F1B655" />
    <text x="7" y="16.5" fontSize="12" fontWeight="800" fill="#FFFFFF">A</text>
    <text x="16.5" y="22.5" fontSize="10" fontWeight="750" fill="#FFFFFF">文</text>
  </>,
  FONT: <>
    <rect x="3" y="5" width="26" height="23" rx="5" fill="#FFFFFF" />
    <path d="M8 23 14 8h3l6 15h-3.2l-1.2-3.2h-6.2L11.2 23Zm5.4-5.8h4.2L15.5 11Z" fill="#586CC2" />
    <circle cx="25" cy="23.5" r="5" fill="#F29883" />
    <text x="22.4" y="27" fontSize="10" fontWeight="800" fill="#FFFFFF">a</text>
  </>,
  HELP: <>
    <path d="M16 3C8.8 3 3 8 3 14.3c0 3.1 1.4 5.9 3.7 8l-1 5.3 5.3-2.1c1.6.6 3.3.9 5 .9 7.2 0 13-5 13-11.3C29 8 23.2 3 16 3Z" fill="#D87494" />
    <path d="M12.4 11.5a3.7 3.7 0 0 1 7.2 1c0 2.5-3.6 2.8-3.6 5" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" />
    <circle cx="16" cy="21.5" r="1.5" fill="#FFFFFF" />
    <path d="m25 2 .8 1.8 1.8.7-1.8.8L25 7l-.8-1.7-1.8-.8 1.8-.7Z" fill="#F6C765" />
  </>,
  ABOUT: <>
    <rect x="4" y="4" width="24" height="24" rx="7" fill="#536A9A" />
    <path d="m16 7.5 2 5.3 5.5 1.8-5.5 1.8-2 5.3-2-5.3-5.5-1.8 5.5-1.8Z" fill="#F9CD70" />
    <circle cx="22.7" cy="22.5" r="2.2" fill="#A8D7E9" />
    <circle cx="10" cy="22" r="1.3" fill="#FFFFFF" />
  </>,
  MODE: <>
    <rect x="3" y="5" width="16" height="17" rx="4" fill="#72B3D4" />
    <rect x="13" y="10" width="16" height="17" rx="4" fill="#48B99B" />
    <path d="M6.5 13h9m0 0-2.7-2.7M15.5 13l-2.7 2.7" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M25.5 20h-9m0 0 2.7-2.7M16.5 20l2.7 2.7" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </>,
  UPDATE: <>
    <path d="M7 4h15a4 4 0 0 1 4 4v13a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4Z" fill="#5BAFE0" />
    <path d="M7 4h15a4 4 0 0 1 4 4v3H3V8a4 4 0 0 1 4-4Z" fill="#2A8DCB" />
    <circle cx="7.5" cy="7.5" r="1" fill="#FFFFFF" />
    <path d="M14.5 12v7m0 0-3-3m3 3 3-3M9.5 22h10" fill="none" stroke="#FFFFFF" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="25.5" cy="24.5" r="4.7" fill="#55C68F" />
    <path d="m23.4 24.4 1.4 1.4 2.6-2.8" fill="none" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </>,
  UPDATE_SOURCE: <>
    <rect x="2.5" y="5" width="27" height="20" rx="4" fill="#4D94CC" />
    <rect x="5" y="8" width="22" height="14" rx="2" fill="#FFFFFF" />
    <path d="M11 28h10M16 25v3" fill="none" stroke="#4D94CC" strokeWidth="2.4" strokeLinecap="round" />
    <path d="M10 14.3a8.7 8.7 0 0 1 12 0M12.8 17a4.8 4.8 0 0 1 6.4 0" fill="none" stroke="#38B799" strokeWidth="2.1" strokeLinecap="round" />
    <circle cx="16" cy="19.2" r="1.5" fill="#38B799" />
  </>,
};

export function SettingsPictogram({ type }: { type: SettingPictogramType }) {
  return <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">{artwork[type]}</svg>;
}
