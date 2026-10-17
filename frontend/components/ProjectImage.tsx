/**
 * components/ProjectImage.tsx
 *
 * A project cover `<img>` that degrades gracefully (#1069) while applying
 * the documented alt-text rules:
 * 1. If `decorative` is true → alt="" + role="presentation" (skipped by screen readers)
 * 2. Else if `alt` prop is provided → use it verbatim
 * 3. Else if `description` is provided → use description as alt text
 * 4. Else → fall back to project `name` as alt text (alt={name})
 * 5. Placeholder image (when src is missing or fails to load) always gets
 *    alt="" + role="presentation" so it is never announced as "project-placeholder".
 *
 * Uploaded cover URLs are third-party (IPFS gateways, admin-pasted links) and can
 * 404 or be unreachable, which used to leave a broken-image icon in the card. On
 * any load error we swap in the branded leaf placeholder.
 */
import { useState } from "react";

export const PROJECT_PLACEHOLDER_SRC = "/project-placeholder.svg";

interface ProjectImageProps {
  src?: string;
  name: string;
  description?: string;
  alt?: string;
  decorative?: boolean;
  className?: string;
  width?: number | string;
  height?: number | string;
  priority?: boolean;
}

export function ProjectImage({
  src,
  name,
  description,
  alt,
  decorative = false,
  className = "",
  width,
  height,
  priority = false,
}: ProjectImageProps) {
  const [prevSrc, setPrevSrc] = useState(src);
  const [errored, setErrored] = useState(false);

  // A NEW src clears the error flag during render (the "adjusting state when a
  // prop changes" pattern), so an admin re-uploading a cover is picked up
  // without a remount.
  if (prevSrc !== src) {
    setPrevSrc(src);
    setErrored(false);
  }

  const showPlaceholder = decorative || !src || errored;

  // Resolve alt text per the documented fallback chain.
  const resolvedAlt: string = showPlaceholder
    ? ""
    : alt ?? description ?? name;

  if (showPlaceholder) {
    return (
      <img
        src={src && !errored ? src : PROJECT_PLACEHOLDER_SRC}
        alt=""
        role="presentation"
        className={className}
        width={width}
        height={height}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
      />
    );
  }

  return (
    <img
      src={src}
      alt={resolvedAlt}
      className={className}
      width={width}
      height={height}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      onError={errored ? undefined : () => setErrored(true)}
    />
  );
}

export default ProjectImage;
