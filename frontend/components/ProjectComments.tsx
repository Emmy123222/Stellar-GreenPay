/**
 * components/ProjectComments.tsx
 * Donor discussion thread on a project page (#1662).
 *
 * Everyone can read approved comments. Connected donors can post; the backend
 * checks the donation, moderates the text and rate limits per wallet, so the
 * form just surfaces whichever of those answers comes back.
 */
import { useEffect, useState } from "react";
import { deleteProjectComment, fetchProjectComments, postProjectComment } from "@/lib/api";
import { shortenAddress, timeAgo } from "@/utils/format";
import type { ProjectComment } from "@/utils/types";

const MAX_LENGTH = 1000;

interface ProjectCommentsProps {
  projectId: string;
  publicKey: string | null;
}

function errorMessage(err: unknown): string {
  const e = err as { response?: { status?: number; data?: { error?: string; message?: string } } };
  const status = e?.response?.status;
  if (status === 401) return "Connect and verify your wallet to comment.";
  if (status === 429) return "You're commenting too quickly. Please wait a few minutes and try again.";
  return e?.response?.data?.error || e?.response?.data?.message || "Something went wrong. Please try again.";
}

export default function ProjectComments({ projectId, publicKey }: ProjectCommentsProps) {
  const [comments, setComments] = useState<ProjectComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchProjectComments(projectId)
      .then((res) => {
        if (cancelled) return;
        setComments(res.data);
        setCursor(res.next_cursor);
        setHasMore(res.has_more);
        setLoadError(null);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Comments couldn't be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const handleLoadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetchProjectComments(projectId, { cursor });
      setComments((prev) => [...prev, ...res.data]);
      setCursor(res.next_cursor);
      setHasMore(res.has_more);
    } catch {
      // Keep what is already shown; the button stays available to retry.
    } finally {
      setLoadingMore(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || submitting) return;
    setSubmitting(true);
    setFormError(null);
    setNotice(null);
    try {
      const created = await postProjectComment(projectId, body);
      setDraft("");
      if (created.moderationStatus === "approved") {
        setComments((prev) => [created, ...prev]);
      } else {
        setNotice("Thanks! Your comment will appear once a moderator has reviewed it.");
      }
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    try {
      await deleteProjectComment(commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };

  return (
    <div className="card" aria-labelledby="project-comments-heading">
      <h2 id="project-comments-heading" className="font-display text-lg font-semibold text-forest-900 mb-4">
        Discussion
      </h2>

      {publicKey ? (
        <form onSubmit={handleSubmit} className="mb-5">
          <label htmlFor="project-comment-body" className="label">
            Add a comment
          </label>
          <textarea
            id="project-comment-body"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={MAX_LENGTH}
            rows={3}
            disabled={submitting}
            placeholder="Share why you support this project…"
            className="input-field resize-y"
          />
          <div className="flex items-center justify-between gap-3 mt-2">
            <span className="text-xs text-[var(--text-secondary)] font-body">
              {draft.length} / {MAX_LENGTH} · Only donors to this project can comment.
            </span>
            <button
              type="submit"
              disabled={submitting || !draft.trim()}
              className="btn-primary text-sm py-2 px-4 disabled:opacity-60"
            >
              {submitting ? "Posting…" : "Post comment"}
            </button>
          </div>
          {formError && (
            <p role="alert" className="mt-2 text-sm text-red-600 font-body">
              {formError}
            </p>
          )}
          {notice && (
            <p role="status" className="mt-2 text-sm text-forest-700 font-body">
              {notice}
            </p>
          )}
        </form>
      ) : (
        <p className="mb-5 text-sm text-[var(--text-secondary)] font-body">
          Connect your wallet to join the discussion. Only donors to this project can comment.
        </p>
      )}

      {loading ? (
        <div className="space-y-3" aria-busy="true">
          {[1, 2].map((i) => (
            <div key={i} className="animate-pulse h-12 bg-forest-100 rounded-xl" />
          ))}
        </div>
      ) : loadError ? (
        <p className="text-sm text-red-600 font-body">{loadError}</p>
      ) : comments.length === 0 ? (
        <p className="text-sm text-[#4f6f4f] dark:text-[#8aaa8a] font-body">
          No comments yet. Donors can start the conversation.
        </p>
      ) : (
        <>
          <ul className="space-y-4">
            {comments.map((c) => (
              <li key={c.id} className="pb-4 border-b border-forest-100 last:border-0 last:pb-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-semibold text-forest-700 font-body" title={c.authorAddress}>
                    {c.authorDisplayName || shortenAddress(c.authorAddress)}
                  </span>
                  <div className="flex items-center gap-3">
                    <time dateTime={c.createdAt} className="text-xs text-[#8aaa8a] dark:text-forest-300 font-body">
                      {timeAgo(c.createdAt)}
                    </time>
                    {publicKey && publicKey === c.authorAddress && (
                      <button
                        type="button"
                        onClick={() => handleDelete(c.id)}
                        className="text-xs text-red-600 hover:underline font-body"
                        aria-label="Delete your comment"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-sm text-forest-900/90 leading-relaxed font-body whitespace-pre-line break-words">
                  {c.body}
                </p>
              </li>
            ))}
          </ul>
          {hasMore && (
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="btn-secondary text-sm py-2 px-4 mt-4 disabled:opacity-60"
            >
              {loadingMore ? "Loading…" : "Load more comments"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
