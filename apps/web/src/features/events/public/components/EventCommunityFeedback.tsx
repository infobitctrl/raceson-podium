import { useState } from "react";
import { useI18n } from "@/shared/i18n/I18nContext";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Loader2, MessageCircle, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import {
  addEventReviewComment,
  getEventCommunity,
  removeOwnEventReviewComment,
  submitEventReview,
  type PortalEventReview,
} from "@/lib/portal-data";
import { cn } from "@/lib/utils";

type EventCommunityFeedbackProps = {
  eventEditionId: string;
  eventSlug: string;
  viewerAthleteProfileId: string | null;
};

function formatCommentDate(value: string, localeTag: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat(localeTag, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function EventReviewCard({
  review,
  viewerAthleteProfileId,
  onChanged,
}: {
  review: PortalEventReview;
  viewerAthleteProfileId: string | null;
  onChanged: () => Promise<unknown>;
}) {
  const { t, localeTag } = useI18n();
  const [commentBody, setCommentBody] = useState("");
  const [isSavingComment, setIsSavingComment] = useState(false);
  const [removingCommentId, setRemovingCommentId] = useState<string | null>(null);

  async function handleAddComment() {
    if (!viewerAthleteProfileId) {
      toast.error("Sign in with an athlete account to comment on this race.");
      return;
    }
    const body = commentBody.trim();
    if (body.length < 2) return;
    setIsSavingComment(true);
    try {
      await addEventReviewComment(review.id, body);
      setCommentBody("");
      await onChanged();
      toast.success("Race comment posted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to post your comment.");
    } finally {
      setIsSavingComment(false);
    }
  }

  async function handleRemoveComment(commentId: string) {
    setRemovingCommentId(commentId);
    try {
      await removeOwnEventReviewComment(commentId);
      await onChanged();
      toast.success("Comment removed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to remove the comment.");
    } finally {
      setRemovingCommentId(null);
    }
  }

  return (
    <article className="rounded-2xl border border-border/70 bg-background/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-foreground">{review.name}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{review.date}</div>
        </div>
        <div className="flex items-center gap-1" aria-label={`${review.rating} out of 5 stars`}>
          {Array.from({ length: 5 }, (_, index) => (
            <Star
              key={`${review.id}-star-${index}`}
              className={cn(
                "h-4 w-4",
                index < review.rating ? "fill-current text-trail-amber" : "text-border",
              )}
            />
          ))}
        </div>
      </div>
      {review.title ? <h4 className="mt-3 font-display text-base font-bold">{review.title}</h4> : null}
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{review.text}</p>

      <div className="mt-4 rounded-xl border border-border/60 bg-card/70 p-3">
        <div className="flex items-center justify-between gap-3 text-xs font-semibold text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><MessageCircle className="h-3.5 w-3.5" /> Race discussion</span>
          <span>{t("event.detail.community.comments", { count: review.comments.length })}</span>
        </div>
        {review.comments.length ? (
          <div className="mt-3 space-y-2">
            {review.comments.map((comment) => (
              <div key={comment.id} className="rounded-xl bg-background px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold">{comment.authorName}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{formatCommentDate(comment.createdAt, localeTag)}</div>
                  </div>
                  {viewerAthleteProfileId === comment.authorAthleteProfileId ? (
                    <button
                      type="button"
                      onClick={() => void handleRemoveComment(comment.id)}
                      disabled={removingCommentId === comment.id}
                      aria-label="Remove your race comment"
                      className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      {removingCommentId === comment.id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  ) : null}
                </div>
                <p className="mt-1.5 text-sm leading-5 text-muted-foreground">{comment.body}</p>
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Textarea
            value={commentBody}
            onChange={(event) => setCommentBody(event.target.value)}
            maxLength={2000}
            rows={2}
            placeholder={t(viewerAthleteProfileId ? "event.detail.community.commentPlaceholder" : "event.detail.community.commentSignIn")}
            disabled={!viewerAthleteProfileId || isSavingComment}
            aria-label={t("event.detail.community.commentLabel", { name: review.name })}
            className="min-h-16 flex-1"
          />
          <button
            type="button"
            onClick={() => void handleAddComment()}
            disabled={!viewerAthleteProfileId || isSavingComment || commentBody.trim().length < 2}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 self-end rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            {isSavingComment ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCircle className="h-3.5 w-3.5" />}
            Post
          </button>
        </div>
      </div>
    </article>
  );
}

export default function EventCommunityFeedback({
  eventEditionId,
  eventSlug,
  viewerAthleteProfileId,
}: EventCommunityFeedbackProps) {
  const { t, formatNumber } = useI18n();
  const [rating, setRating] = useState(0);
  const [reviewBody, setReviewBody] = useState("");
  const [isSavingReview, setIsSavingReview] = useState(false);
  const communityQuery = useQuery({
    queryKey: ["event-community", eventEditionId],
    queryFn: () => getEventCommunity(eventEditionId),
    enabled: Boolean(eventEditionId),
  });
  const community = communityQuery.data ?? {
    reviews: [],
    reviewCount: 0,
    commentCount: 0,
    averageRating: null,
  };

  async function handleSaveReview() {
    if (!viewerAthleteProfileId) {
      toast.error("Sign in with an athlete profile to review this race.");
      return;
    }
    setIsSavingReview(true);
    try {
      await submitEventReview({ eventSlug, rating, text: reviewBody });
      setRating(0);
      setReviewBody("");
      await communityQuery.refetch();
      toast.success("Race review published.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to publish your race review.");
    } finally {
      setIsSavingReview(false);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-soft" aria-labelledby="event-feedback-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Race feedback</div>
          <h3 id="event-feedback-title" className="mt-1.5 font-display text-xl font-bold">Reviews and comments</h3>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-semibold">
            {community.averageRating == null ? t("event.detail.community.noRating") : t("event.detail.community.rating", { rating: formatNumber(community.averageRating, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}
          </span>
          <span className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-semibold">
            {t("event.detail.community.reviews", { count: community.reviewCount })}
          </span>
          <span className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-semibold">
            {t("event.detail.community.comments", { count: community.commentCount })}
          </span>
        </div>
      </div>

      {viewerAthleteProfileId ? (
        <div className="mt-4 rounded-2xl border border-primary/20 bg-primary/[0.035] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">Your race rating</span>
            <div className="flex gap-1" role="radiogroup" aria-label="Race rating">
              {Array.from({ length: 5 }, (_, index) => {
                const value = index + 1;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={rating === value}
                    aria-label={`${value} star${value === 1 ? "" : "s"}`}
                    onClick={() => setRating(value)}
                    className="rounded-md p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <Star className={cn("h-5 w-5", value <= rating ? "fill-current text-trail-amber" : "text-border")} />
                  </button>
                );
              })}
            </div>
          </div>
          <Textarea
            value={reviewBody}
            onChange={(event) => setReviewBody(event.target.value)}
            maxLength={3000}
            rows={3}
            placeholder={t("event.detail.community.reviewPlaceholder")}
            aria-label={t("event.detail.community.reviewLabel")}
            className="mt-3"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground">One review per athlete; submitting again updates it.</span>
            <button
              type="button"
              onClick={() => void handleSaveReview()}
              disabled={isSavingReview || rating === 0 || reviewBody.trim().length < 2}
              className="inline-flex h-9 items-center gap-2 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              {isSavingReview ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Star className="h-3.5 w-3.5" />}
              Publish review
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/60 p-4">
          <p className="text-sm text-muted-foreground">{t("event.detail.community.signIn")}</p>
          <Link
            to={`/auth?${new URLSearchParams({ next: `/events/${eventSlug}?tab=community` }).toString()}`}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Sign in
          </Link>
        </div>
      )}

      {communityQuery.isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : communityQuery.error ? (
        <div className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
          Race feedback could not be loaded.
        </div>
      ) : community.reviews.length ? (
        <div className="mt-4 space-y-3">
          {community.reviews.map((review) => (
            <EventReviewCard
              key={review.id}
              review={review}
              viewerAthleteProfileId={viewerAthleteProfileId}
              onChanged={communityQuery.refetch}
            />
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-border bg-background/60 p-6 text-center text-sm text-muted-foreground">
          No race reviews yet. Be the first athlete to share race-day feedback here.
        </div>
      )}
    </section>
  );
}
