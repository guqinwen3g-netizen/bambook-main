/** 测试用的手写签字：与 components/mist/SignaturePad.tsx `signatureSvg` 输出同一结构（两段笔画、一个落点）。 */
export const TEST_SIGNATURE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="52.0 40.0 120.5 64.0" width="120.5" height="64.0" fill="none" stroke="#0E1A21" stroke-linecap="round" stroke-linejoin="round"><path d="M60.0 90.0Q72.4 60.2 88.1 75.3" stroke-width="2.70"/><path d="M88.1 75.3Q104.0 90.5 120.6 66.0" stroke-width="1.94"/><circle cx="160.5" cy="56.0" r="1.35" fill="#0E1A21"/></svg>';
export const TEST_SIGNATURE = { svg: TEST_SIGNATURE_SVG } as const;
