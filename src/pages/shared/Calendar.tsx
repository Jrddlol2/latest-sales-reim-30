import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/shared/Modal';
import { useAppContext } from '../../components/AppContext';
import { useToast } from '../../components/shared/ToastContext';
import { confirmReviewMeeting, declineReviewMeeting, rescheduleReviewMeeting } from '../../lib/api';
import { ReviewMeetingStatus, ReviewMeeting, MOM } from '../../types';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const STATUS_STYLE: Record<string, string> = {
  [ReviewMeetingStatus.CONFIRMED]: 'bg-primary-container text-on-primary-container',
  [ReviewMeetingStatus.PENDING_CONFIRMATION]: 'bg-tertiary-container text-on-tertiary-container',
  [ReviewMeetingStatus.DECLINE_REQUESTED]: 'bg-error-container text-error',
  [ReviewMeetingStatus.COMPLETED]: 'bg-surface-container-high text-on-surface-variant',
};

export function Calendar() {
  const navigate = useNavigate();
  const { reviewMeetings, moms, currentUser, refresh } = useAppContext();
  const { addToast } = useToast();
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [selected, setSelected] = useState<ReviewMeeting | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');
  const [declineReason, setDeclineReason] = useState('');
  const [showDecline, setShowDecline] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { year, month } = cursor;
  const today = new Date();
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();

  type CalendarEvent =
    | { kind: 'review'; id: string; review: ReviewMeeting }
    | { kind: 'mom'; id: string; mom: MOM };

  // Group both client meetings and claim reviews by 'YYYY-M-D'.
  const byDay = useMemo<Record<string, CalendarEvent[]>>(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const rm of reviewMeetings) {
      if (!rm.meetingDate) continue;
      const d = new Date(rm.meetingDate);
      if (d.getFullYear() !== year || d.getMonth() !== month) continue;
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      (map[key] ||= []).push({ kind: 'review', id: rm.id, review: rm });
    }
    for (const mom of moms) {
      if (!mom.meetingDate) continue;
      const d = new Date(`${mom.meetingDate.split('T')[0]}T00:00:00`);
      if (d.getFullYear() !== year || d.getMonth() !== month) continue;
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      (map[key] ||= []).push({ kind: 'mom', id: mom.id, mom });
    }
    return map;
  }, [reviewMeetings, moms, year, month]);

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const agendaEvents = useMemo(
    () => Object.entries(byDay)
      .flatMap(([key, events]) => {
        const day = Number(key.split('-')[2]);
        return events.map(event => ({ day, event }));
      })
      .sort((a, b) => a.day - b.day),
    [byDay],
  );

  const step = (delta: number) => setCursor(c => {
    const m = c.month + delta;
    return { year: c.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
  });

  const totalThisMonth = Object.keys(byDay).reduce((n, key) => n + byDay[key].length, 0);

  // Selected always reflects the latest server data (after a refresh, the
  // object reference changes — look it up by id instead of trusting the stale one).
  const current = selected ? reviewMeetings.find(rm => rm.id === selected.id) || selected : null;
  const isApprover = current ? current.approverId === currentUser.id : false;
  const isRequestor = current ? current.requestorId === currentUser.id : false;
  const canRespond = isApprover && current?.status === ReviewMeetingStatus.PENDING_CONFIRMATION;
  const canReschedule = isRequestor && current?.status !== ReviewMeetingStatus.COMPLETED;

  const openMeeting = (rm: ReviewMeeting) => {
    setSelected(rm);
    setRescheduling(false);
    setShowDecline(false);
    setDeclineReason('');
    setNewDate(rm.meetingDate?.split('T')[0] || '');
    setNewTime(rm.meetingTime || '');
  };

  const handleConfirm = async () => {
    if (!current) return;
    setSubmitting(true);
    try {
      await confirmReviewMeeting(current.id);
      await refresh();
      addToast('Review meeting confirmed.', 'success');
      setSelected(null);
    } catch (err: any) {
      addToast(err?.message || 'Could not confirm this meeting.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecline = async () => {
    if (!current) return;
    setSubmitting(true);
    try {
      await declineReviewMeeting(current.id, declineReason.trim() || undefined);
      await refresh();
      addToast('Review meeting declined. The requestor can propose a new time.', 'success');
      setSelected(null);
    } catch (err: any) {
      addToast(err?.message || 'Could not decline this meeting.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReschedule = async () => {
    if (!current) return;
    if (!newDate || !newTime) {
      addToast('Pick a new date and time.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await rescheduleReviewMeeting(current.id, newDate, newTime);
      await refresh();
      addToast('New time proposed to your approver.', 'success');
      setSelected(null);
    } catch (err: any) {
      addToast(err?.message || 'Could not propose a new time.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="font-display text-display text-on-surface">Calendar</h1>
          <p className="text-body-md text-outline mt-1">View client meetings and approver-scheduled claim reviews.</p>
        </div>
      </div>

      <Card>
        <CardHeader className="bg-surface-container-low">
          <div className="flex items-center justify-between w-full">
            <h3 className="font-label-md uppercase tracking-wider text-on-surface">{MONTHS[month]} {year}</h3>
            <div className="flex items-center gap-2">
              <span className="font-label-sm text-outline mr-2">{totalThisMonth} event{totalThisMonth === 1 ? '' : 's'}</span>
              <button aria-label="Previous month" onClick={() => step(-1)} className="p-1.5 rounded-lg hover:bg-outline-variant transition-colors" title="Previous month">
                <span aria-hidden="true" className="material-symbols-outlined text-outline">chevron_left</span>
              </button>
              <button
                onClick={() => setCursor({ year: today.getFullYear(), month: today.getMonth() })}
                disabled={isCurrentMonth}
                title={isCurrentMonth ? "You're viewing the current month" : 'Jump to the current month'}
                className={`px-3 py-1 rounded-lg text-sm font-label-sm transition-colors ${isCurrentMonth ? 'text-outline/40 cursor-default' : 'hover:bg-outline-variant'}`}
              >
                Today
              </button>
              <button aria-label="Next month" onClick={() => step(1)} className="p-1.5 rounded-lg hover:bg-outline-variant transition-colors" title="Next month">
                <span aria-hidden="true" className="material-symbols-outlined text-outline">chevron_right</span>
              </button>
            </div>
          </div>
        </CardHeader>
        <div className="p-6">
          <div className="hidden md:grid grid-cols-7 gap-4">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="text-center font-label-sm text-outline uppercase pb-2 border-b border-outline-variant">{day}</div>
            ))}

            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={`blank-${i}`} className="min-h-[100px] bg-surface-container-lowest/50 border border-outline-variant/30 rounded-lg"></div>
            ))}

            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
              const events = byDay[`${year}-${month}-${day}`] || [];
              const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
              return (
                <div key={day} className={`min-h-[100px] p-2 border rounded-lg transition-colors group ${isToday ? 'border-primary ring-1 ring-primary/30' : 'border-outline-variant hover:border-primary'}`}>
                  <span className={`font-label-sm ${isToday ? 'text-primary font-bold' : 'text-on-surface-variant group-hover:text-primary'}`}>{day}</span>
                  <div className="mt-1 space-y-1">
                    {events.map(event => event.kind === 'review' ? (
                      <button
                        key={`review-${event.id}`}
                        onClick={() => openMeeting(event.review)}
                        title={`${event.review.claimNumber || 'Claim'} — ${event.review.status}${event.review.meetingTime ? ` at ${event.review.meetingTime}` : ''}`}
                        className={`w-full text-left text-[12px] px-2 py-1 rounded truncate ${STATUS_STYLE[event.review.status] || 'bg-surface-container-high text-on-surface'}`}
                      >
                        {event.review.meetingTime ? `${event.review.meetingTime} ` : ''}{event.review.claimNumber || 'Claim review'}
                      </button>
                    ) : (
                      <button
                        key={`mom-${event.id}`}
                        onClick={() => navigate(`/moms/${event.mom.id}`)}
                        title={`${event.mom.companyName || 'Client meeting'} — ${event.mom.purposeOfMeeting || 'Minutes of Meeting'}`}
                        className="w-full text-left text-[12px] px-2 py-1 rounded truncate bg-blue-100 text-blue-900"
                      >
                        {event.mom.companyName || 'Client meeting'}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="md:hidden space-y-3">
            {agendaEvents.length === 0 ? (
              <div className="rounded-lg border border-dashed border-outline-variant p-8 text-center text-body-sm text-outline">
                No events scheduled for this month.
              </div>
            ) : agendaEvents.map(({ day, event }) => (
              <button
                key={`${event.kind}-${event.id}`}
                type="button"
                onClick={() => event.kind === 'review' ? openMeeting(event.review) : navigate(`/moms/${event.mom.id}`)}
                className="flex w-full items-start gap-3 rounded-lg border border-outline-variant bg-surface-container-lowest p-4 text-left hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="flex h-11 w-11 flex-none flex-col items-center justify-center rounded-lg bg-surface-container-low text-primary">
                  <span className="text-[11px] font-semibold uppercase">{MONTHS[month].slice(0, 3)}</span>
                  <span className="font-headline-sm leading-none">{day}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-label-md text-on-surface">
                    {event.kind === 'review' ? event.review.claimNumber || 'Claim review' : event.mom.companyName || 'Client meeting'}
                  </span>
                  <span className="mt-1 block text-body-sm text-on-surface-variant">
                    {event.kind === 'review'
                      ? `${event.review.meetingTime || 'Time not set'} · ${event.review.status}`
                      : event.mom.purposeOfMeeting || 'Minutes of Meeting'}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-4 mt-6 pt-4 border-t border-outline-variant text-xs text-on-surface-variant">
            <span className="flex items-center gap-1.5"><span aria-hidden="true" className="w-3 h-3 rounded bg-blue-100"></span> Client meeting</span>
            <span className="flex items-center gap-1.5"><span aria-hidden="true" className="w-3 h-3 rounded bg-primary-container"></span> Confirmed</span>
            <span className="flex items-center gap-1.5"><span aria-hidden="true" className="w-3 h-3 rounded bg-tertiary-container"></span> Pending confirmation</span>
            <span className="flex items-center gap-1.5"><span aria-hidden="true" className="w-3 h-3 rounded bg-error-container"></span> Reschedule requested</span>
          </div>
        </div>
      </Card>

      <Modal
        isOpen={Boolean(current)}
        onClose={() => setSelected(null)}
        titleId="review-meeting-dialog-title"
        className="max-w-md"
      >
        {current && (
            <div className="bg-surface-container-lowest rounded-xl w-full p-6 shadow-2xl space-y-4">
              <div className="flex justify-between items-center border-b border-outline-variant pb-3">
                <h3 id="review-meeting-dialog-title" className="font-headline-sm text-on-surface">Review Meeting</h3>
                <button aria-label="Close review meeting details" onClick={() => setSelected(null)} className="text-outline hover:text-on-surface">
                  <span aria-hidden="true" className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-outline">Claim</span>
                  <span className="text-primary font-medium cursor-pointer hover:underline" onClick={() => { setSelected(null); navigate(`/claims/${current.claimId}`); }}>{current.claimNumber || 'View claim'}</span>
                </div>
                <div className="flex justify-between"><span className="text-outline">Requestor</span><span className="text-on-surface">{current.requestorName || '—'}</span></div>
                <div className="flex justify-between"><span className="text-outline">Approver</span><span className="text-on-surface">{current.approverName || '—'}</span></div>
                <div className="flex justify-between"><span className="text-outline">Proposed time</span><span className="text-on-surface font-mono-data">{current.meetingDate?.split('T')[0]} {current.meetingTime}</span></div>
                <div className="flex justify-between"><span className="text-outline">Status</span>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${STATUS_STYLE[current.status] || 'bg-surface-container-high text-on-surface'}`}>{current.status}</span>
                </div>
                {current.declineReason && (
                  <div className="p-3 bg-error-container/20 border border-error/20 rounded-lg">
                    <p className="text-xs font-medium text-error mb-1">Decline reason:</p>
                    <p className="text-xs text-on-surface-variant italic">"{current.declineReason}"</p>
                  </div>
                )}
              </div>

              {canRespond && !showDecline && (
                <div className="flex justify-end gap-2 pt-2 border-t border-outline-variant">
                  <Button variant="outline" className="gap-2" onClick={() => setShowDecline(true)} disabled={submitting}>
                    <span className="material-symbols-outlined text-[16px]">event_busy</span> Decline
                  </Button>
                  <Button className="gap-2" onClick={handleConfirm} disabled={submitting}>
                    {submitting ? <span className="material-symbols-outlined animate-spin text-[16px]">sync</span> : <span className="material-symbols-outlined text-[16px]">event_available</span>}
                    Confirm
                  </Button>
                </div>
              )}

              {canRespond && showDecline && (
                <div className="space-y-3 pt-2 border-t border-outline-variant">
                  <textarea
                    rows={2}
                    className="w-full bg-white border border-brand-field-border rounded-input px-3 py-2 text-body-sm focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none"
                    placeholder="Reason (optional)"
                    value={declineReason}
                    onChange={e => setDeclineReason(e.target.value)}
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => setShowDecline(false)} disabled={submitting}>Back</Button>
                    <Button className="gap-2" onClick={handleDecline} disabled={submitting}>
                      {submitting ? <span className="material-symbols-outlined animate-spin text-[16px]">sync</span> : null}
                      Confirm Decline
                    </Button>
                  </div>
                </div>
              )}

              {!canRespond && canReschedule && !rescheduling && (
                <div className="flex justify-end pt-2 border-t border-outline-variant">
                  <Button variant="outline" className="gap-2" onClick={() => setRescheduling(true)}>
                    <span className="material-symbols-outlined text-[16px]">edit_calendar</span> Propose New Time
                  </Button>
                </div>
              )}

              {canReschedule && rescheduling && (
                <div className="space-y-3 pt-2 border-t border-outline-variant">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="reschedule-date" className="text-xs text-outline uppercase tracking-wider font-medium">Review date</label>
                      <input id="reschedule-date" type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="w-full bg-white border border-brand-field-border rounded-input px-3 py-2 text-body-sm focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none" />
                    </div>
                    <div>
                      <label htmlFor="reschedule-time" className="text-xs text-outline uppercase tracking-wider font-medium">Review time</label>
                      <input id="reschedule-time" type="time" value={newTime} onChange={e => setNewTime(e.target.value)} className="w-full bg-white border border-brand-field-border rounded-input px-3 py-2 text-body-sm focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none" />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => setRescheduling(false)} disabled={submitting}>Cancel</Button>
                    <Button className="gap-2" onClick={handleReschedule} disabled={submitting}>
                      {submitting ? <span className="material-symbols-outlined animate-spin text-[16px]">sync</span> : null}
                      Send New Time
                    </Button>
                  </div>
                </div>
              )}
            </div>
        )}
      </Modal>
    </div>
  );
}
