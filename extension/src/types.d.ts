/**
 * CSS module declarations for side-effect imports
 * Allows TypeScript to recognize CSS imports without type errors
 */
declare module '*.css' {
  const content: string;
  export default content;
}
