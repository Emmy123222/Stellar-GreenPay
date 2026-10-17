/**
 * components/ProjectImage.tsx
 *
 * Alt-text rules (documented here):
 * 1. If `decorative` is true → alt="" + role="presentation" (skipped by screen readers)
 * 2. Else if `alt` prop is provided → use it verbatim
 * 3. Else if `description` is provided → use description as alt text
 * 4. Else → fall back to project `name` as alt text (alt={name})
 * 5. Placeholder image (when src is missing) always gets alt="" + role="presentation"
 *    so it is never announced as "project-placeholder".
 */
import { useEffect, useState } from "react";

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
  const [currentSrc, setCurrentSrc] = useState(src);
  useEffect(() => setCurrentSrc(src), [src]);

  const hasImage = Boolean(src && currentSrc && currentSrc !== PROJECT_PLACEHOLDER_SRC);
  const resolvedAlt = decorative || !hasImage ? "" : alt ?? description ?? name;

  return (
    <img
      src={hasImage ? currentSrc : PROJECT_PLACEHOLDER_SRC}
      alt={resolvedAlt}
      role={decorative || !hasImage ? "presentation" : undefined}
      className={className}
      width={width}
      height={height}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      onError={
        hasImage
          ? () => setCurrentSrc(PROJECT_PLACEHOLDER_SRC)
          : undefined
      }
    />
  );
}

export default ProjectImage;
