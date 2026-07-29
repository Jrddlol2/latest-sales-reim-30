import { useState, useEffect } from 'react';
import { Portal } from '../../components/shared/Portal';
import { Card, CardHeader, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Select, Label } from '../../components/ui/Input';
import { useAppContext } from '../../components/AppContext';
import { useToast } from '../../components/shared/ToastContext';
import {
  fetchSupportRequest, createSupportRequest, addSupportMessage, updateSupportStatus,
} from '../../lib/api';
import { fromServerSupport } from '../../lib/api';
import { SupportRequest, SupportRequestStatus, UserRole } from '../../types';
import { formatMoney } from '../../lib/money';
import { formatDate, formatDateTime } from '../../lib/date';
import { Pagination } from '../../components/ui/Pagination';

const ITEMS_PER_PAGE = 10;

export function Support() {
  const { currentUser, supportRequests, refresh, claims } = useAppContext();
  const { addToast } = useToast();

  const [activeTicket, setActiveTicket] = useState<SupportRequest | null>(null);
  const [showNewTicketModal, setShowNewTicketModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // The list omits messages; load the full thread when a ticket is opened.
  const openTicket = async (ticket: SupportRequest) => {
    setActiveTicket(ticket);
    try {
      const full = await fetchSupportRequest(ticket.id);
      setActiveTicket(fromServerSupport(full));
    } catch {
      // Keep the list-level ticket if the detail fetch fails.
    }
  };
  
  // New ticket form
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'Low' | 'Medium' | 'High'>('Medium');
  const [relatedEntityId, setRelatedEntityId] = useState('');

  // Reply message form
  const [replyText, setReplyText] = useState('');

  const isAdmin = currentUser.role === UserRole.ADMIN;
  
  // Filter user tickets or show all if admin
  const userTickets = isAdmin
    ? supportRequests
    : supportRequests.filter(req => req.requestorId === currentUser.id);

  const totalPages = Math.ceil(userTickets.length / ITEMS_PER_PAGE);
  const paginatedTickets = userTickets.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(Math.max(1, totalPages));
  }, [totalPages, currentPage]);

  const handleCreateTicket = async () => {
    if (!subject.trim() || !description.trim()) {
      addToast('Please enter a subject and description', 'error');
      return;
    }
    setBusy(true);
    try {
      const created = await createSupportRequest({
        subject,
        description,
        priority,
        related_entity_type: relatedEntityId ? 'Claim' : undefined,
        related_entity_id: relatedEntityId || undefined,
      });
      await refresh();
      addToast('Support ticket submitted.', 'success');
      setShowNewTicketModal(false);
      setSubject(''); setDescription(''); setRelatedEntityId('');
      // Open the freshly created ticket with its thread.
      openTicket(fromServerSupport(created));
    } catch (err: any) {
      addToast(err?.message || 'Could not create the ticket.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSendReply = async () => {
    if (!activeTicket || !replyText.trim()) return;
    setBusy(true);
    try {
      await addSupportMessage(activeTicket.id, replyText);
      const full = await fetchSupportRequest(activeTicket.id);
      setActiveTicket(fromServerSupport(full));
      setReplyText('');
      refresh();
    } catch (err: any) {
      addToast(err?.message || 'Could not send the reply.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleStatusChange = async (ticketId: string, newStatus: SupportRequestStatus) => {
    try {
      await updateSupportStatus(ticketId, newStatus);
      const full = await fetchSupportRequest(ticketId);
      setActiveTicket(fromServerSupport(full));
      refresh();
      addToast(`Ticket status updated to ${newStatus}.`, 'success');
    } catch (err: any) {
      addToast(err?.message || 'Could not update status.', 'error');
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-6xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="font-display text-display text-on-surface">Support Helpdesk</h1>
          <p className="text-body-md text-outline mt-1">Submit inquiries, track tickets, or resolve system issues with finance & IT.</p>
        </div>
        <Button className="gap-2" onClick={() => setShowNewTicketModal(true)}>
          <span className="material-symbols-outlined">add_task</span> Open New Ticket
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Ticket List */}
        <div className="lg:col-span-5 space-y-4">
          <Card>
            <CardHeader className="bg-surface-container-low border-b border-outline-variant flex justify-between items-center py-3">
              <h3 className="font-headline-sm text-on-surface">
                {isAdmin ? 'All User Support Tickets' : 'My Support Tickets'}
              </h3>
              <span className="text-xs bg-primary-container text-on-primary-container font-mono-data px-2 py-0.5 rounded-full font-bold">
                {userTickets.length}
              </span>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-outline-variant/60 max-h-[600px] overflow-y-auto">
              {userTickets.length === 0 ? (
                <div className="p-8 text-center text-outline">
                  <span className="material-symbols-outlined text-[48px] mb-2">confirmation_number</span>
                  <p className="font-semibold text-on-surface">No tickets found</p>
                  <p className="text-xs mt-1">Create a ticket if you need assistance.</p>
                </div>
              ) : (
                paginatedTickets.map(ticket => {
                  const isSelected = activeTicket?.id === ticket.id;
                  const statusColors = 
                    ticket.status === SupportRequestStatus.RESOLVED ? 'bg-green-100 text-green-800' :
                    ticket.status === SupportRequestStatus.IN_PROGRESS ? 'bg-blue-100 text-blue-800' :
                    'bg-amber-100 text-amber-800';

                  return (
                    <div
                      key={ticket.id}
                      onClick={() => openTicket(ticket)}
                      className={`p-4 cursor-pointer hover:bg-brand-row-hover transition-colors ${isSelected ? 'bg-primary/10 border-l-4 border-primary' : ''}`}
                    >
                      <div className="flex justify-between items-start mb-1">
                        <span className={`text-[12px] font-bold uppercase px-2 py-0.5 rounded ${statusColors}`}>
                          {ticket.status}
                        </span>
                        <span className="text-[12px] text-outline font-mono-data">
                          {formatDate(ticket.createdAt)}
                        </span>
                      </div>
                      <p className="font-bold text-on-surface text-sm truncate">{ticket.subject}</p>
                      <p className="text-xs text-outline line-clamp-1 mt-1">{ticket.description}</p>
                      <div className="flex justify-between items-center mt-3 text-[12px] text-outline">
                        <span>Priority: <strong className={ticket.priority === 'High' ? 'text-error font-bold' : ''}>{ticket.priority}</strong></span>
                        {ticket.relatedEntityId && <span className="font-mono-data bg-surface-container px-1.5 py-0.5 rounded">{ticket.relatedEntityId}</span>}
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
            <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
          </Card>
        </div>

        {/* Ticket Detail Pane */}
        <div className="lg:col-span-7">
          {activeTicket ? (
            <Card className="h-full flex flex-col justify-between">
              <div>
                <CardHeader className="bg-surface-container-low border-b border-outline-variant flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono-data text-xs text-outline">{activeTicket.id}</span>
                      <span className="text-xs px-2 py-0.5 bg-surface-container font-semibold rounded">
                        Priority: {activeTicket.priority}
                      </span>
                    </div>
                    <h3 className="font-headline-md text-on-surface">{activeTicket.subject}</h3>
                  </div>

                  {/* Admin Status Controls */}
                  {isAdmin && (
                    <div className="flex items-center gap-2">
                      <Select 
                        value={activeTicket.status} 
                        onChange={e => handleStatusChange(activeTicket.id, e.target.value as SupportRequestStatus)}
                        className="py-1 text-xs"
                      >
                        <option value={SupportRequestStatus.OPEN}>Open</option>
                        <option value={SupportRequestStatus.IN_PROGRESS}>In Progress</option>
                        <option value={SupportRequestStatus.RESOLVED}>Resolved</option>
                      </Select>
                    </div>
                  )}
                </CardHeader>

                {/* Messages Thread. The server stores the opening complaint as
                    `description`, not as a thread message, so it's synthesized
                    here as the first bubble — otherwise a ticket with no replies
                    yet shows an empty conversation. */}
                <CardContent className="p-6 space-y-4 max-h-[420px] overflow-y-auto">
                  {[
                    { id: `${activeTicket.id}-opening`, senderId: activeTicket.requestorId, message: activeTicket.description, timestamp: activeTicket.createdAt },
                    ...activeTicket.messages,
                  ].map(msg => {
                    const isCurrentUser = msg.senderId === currentUser.id;
                    return (
                      <div 
                        key={msg.id} 
                        className={`flex flex-col ${isCurrentUser ? 'items-end' : 'items-start'}`}
                      >
                        <div className={`p-4 rounded-xl max-w-lg text-sm ${isCurrentUser ? 'bg-primary text-on-primary rounded-br-none' : 'bg-surface-container-high text-on-surface rounded-bl-none'}`}>
                          <p>{msg.message}</p>
                        </div>
                        <span className="text-[12px] text-outline mt-1 px-1 font-mono-data">
                          {formatDateTime(msg.timestamp)}
                        </span>
                      </div>
                    );
                  })}
                </CardContent>
              </div>

              {/* Reply Box */}
              <div className="p-4 border-t border-outline-variant bg-surface-container-lowest rounded-b-xl space-y-3">
                <textarea 
                  rows={3} 
                  value={replyText} 
                  onChange={e => setReplyText(e.target.value)}
                  placeholder="Write a message reply..." 
                  className="w-full text-sm p-3 border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <div className="flex justify-between items-center">
                  <div className="text-xs text-outline">
                    Status: <strong className="text-on-surface">{activeTicket.status}</strong>
                  </div>
                  <Button size="sm" className="gap-2" onClick={handleSendReply} disabled={busy}>
                    <span className="material-symbols-outlined text-[16px]">send</span> Send Message
                  </Button>
                </div>
              </div>
            </Card>
          ) : (
            <Card className="h-full flex flex-col items-center justify-center p-12 text-center text-outline">
              <span className="material-symbols-outlined text-[64px] mb-3 text-outline/50">chat_bubble</span>
              <h3 className="font-headline-sm text-on-surface">Select a Support Ticket</h3>
              <p className="text-sm max-w-sm mt-1">Click on a ticket from the left list to view conversation history and reply.</p>
            </Card>
          )}
        </div>
      </div>

      {/* New Ticket Modal */}
      {showNewTicketModal && (
        <Portal>
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-surface-container-lowest rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-outline-variant pb-3">
              <h3 className="font-headline-sm text-on-surface">Open Support Ticket</h3>
              <button onClick={() => setShowNewTicketModal(false)} className="text-outline hover:text-on-surface">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <Label required>Subject</Label>
                <Input type="text" value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. Disbursement Delay, Receipt Upload Issue" />
              </div>

              <div>
                <Label required>Priority</Label>
                <Select value={priority} onChange={e => setPriority(e.target.value as any)}>
                  <option value="Low">Low - General Question</option>
                  <option value="Medium">Medium - System / Approval Delay</option>
                  <option value="High">High - Urgent Financial Settlement</option>
                </Select>
              </div>

              <div>
                <Label>Link Related Claim (Optional)</Label>
                <Select value={relatedEntityId} onChange={e => setRelatedEntityId(e.target.value)}>
                  <option value="">None</option>
                  {claims.map(c => (
                    <option key={c.id} value={c.id}>{c.ref} - {formatMoney(c.total)} ({c.purpose})</option>
                  ))}
                </Select>
              </div>

              <div>
                <Label required>Description / Details</Label>
                <textarea 
                  rows={4} 
                  value={description} 
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Explain your inquiry or issue in detail..." 
                  className="w-full text-sm p-3 border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-outline-variant">
              <Button variant="outline" onClick={() => setShowNewTicketModal(false)} disabled={busy}>Cancel</Button>
              <Button onClick={handleCreateTicket} disabled={busy}>Submit Ticket</Button>
            </div>
          </div>
        </div>
        </Portal>
      )}
    </div>
  );
}
