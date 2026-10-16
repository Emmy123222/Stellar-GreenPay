/**
 * components/ProjectImage.tsx
 *
 * A project cover `<img>` that degrades gracefully (#1069). Uploaded
 * cover URLs are third-party (IPFS gateways, admin-pasted links) and can
 * 404 or be unreachable, which used to leave a broken-image icon in the
 * card. On any load error we swap in the branded leaf placeholder.
 *
 * Two details worth keeping in mind:
 *  - once the placeholder is showing we drop the `onError` handler, so a
 *    placeholder that itself fails can't trigger another state update
 *    and loop;
 *  - a NEW `src` clears the error flag during render (the
 *    "adjusting state when a prop changes" pattern), so an admin
 *    re-uploading a cover is picked up without a remount.
 */
import { useState } from "react";

export const PROJECT_PLACEHOLDER_SRC = "/project-placeholder.svg";

interface ProjectImageProps {
  src: string;
  alt: string;
  className?: string;
}

export default function ProjectImage({ src, alt, className }: ProjectImageProps) {
  const [prevSrc, setPrevSrc] = useState(src);
  const [errored, setErrored] = useState(false);

  if (prevSrc !== src) {
    setPrevSrc(src);
    setErrored(false);
  }

  return (
    <img
      src={errored ? PROJECT_PLACEHOLDER_SRC : src}
      alt={alt}
      className={className}
      onError={errored ? undefined : () => setErrored(true)}
    />
  );
}
