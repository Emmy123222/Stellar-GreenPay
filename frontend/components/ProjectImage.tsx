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
import Image from "next/image";

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
  // Resolve alt text per the documented fallback chain
  const resolvedAlt: string =
    decorative || !src
      ? ""
      : alt ?? description ?? name;

  const hasImage = Boolean(src);

  if (decorative) {
    return (
      <img
        src={src || "/project-placeholder.svg"}
        alt=""
        role="presentation"
        className={className}
        width={width}
        height={height}
        priority={priority}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
      />
    );
  }

  if (!hasImage) {
    return (
      <img
        src="/project-placeholder.svg"
        alt=""
        role="presentation"
        className={className}
        width={width}
        height={height}
        priority={priority}
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
      priority={priority}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
    />
  );
}

export default ProjectImage;
