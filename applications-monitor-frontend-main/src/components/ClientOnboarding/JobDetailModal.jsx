import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion as Motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Loader2,
  Pencil,
  User,
  Briefcase,
  ChevronRight,
  History,
  Paperclip,
  Plus,
  FileText,
  ChevronDown,
  CheckCircle,
  Mail,
  MessageSquare,
  PanelLeft,
  RefreshCw,
  AlertTriangle
} from 'lucide-react';
import { useChatStore } from '../../store/chatStore';
import {
  useOnboardingStore,
  useClientProfileStore,
  useSectionOpen,
  STATUS_LABELS,
  ONBOARDING_STATUSES
} from '../../store/onboardingStore';
import CollapsibleSection from './CollapsibleSection';
import PersonChip from './PersonChip';
import { OVERLAY_FADE, PANEL_RISE } from './animation';
import { API_BASE, AUTH_HEADERS, LOG, DASHBOARD_BASE } from './constants';
import { getStatusColor, clientDisplayName, convertToDMY } from './helpers';
import { toastUtils } from '../../utils/toastUtils';
import { handleAuthFailure } from '../../utils/authUtils';
import { apiFetch, getCached } from '../../utils/apiClient';
import { ClientProfileSection } from '../JobDetail/ClientProfileSection';
import CommentsSection from './CommentsSection';
import {
  buildDashboardManagerSelectOptions,
  selectValueMatchingOption
} from '../../utils/dashboardManagerSelect.js';

// Why a client has no milestone schedule, in operator language. The backend
// names the cause (milestoneBlockReason); this is only the wording.
const MILESTONE_BLOCK_COPY = {
  no_tracking_record: {
    summary: 'No tracking record',
    title: 'This client has no record in Client Job Analysis',
    detail: 'Milestone emails and this timeline are both computed from the tracking collection (dashboardtrackings). The plan shown in the ticket header lives on the ticket itself, so it can say "Ignite" while no tracking record exists at all. Until one does, the milestone job never sees this client and no email can fire.'
  },
  no_plan_set: {
    summary: 'No plan on record',
    title: 'The tracking record has no plan',
    detail: 'The client exists in Client Job Analysis but carries no plan, so there is nothing to compute thresholds from. Set the plan there and this timeline fills in.'
  },
  unknown_plan: {
    summary: 'Unrecognised plan',
    title: 'The plan on record is not one we sell',
    detail: 'The tracking record stores a plan value that has no milestone schedule. Correct it to Prime, Ignite, Professional or Executive in Client Job Analysis.'
  }
};

const MILESTONE_DELIVERY_BLOCKER_COPY = {
  client_not_active: 'The tracking record is not active, and the milestone job only scans active clients. These rows will stay Pending until it is.',
  no_payment_email: 'No Payment Email is set, so every milestone send is skipped. Add one in the INFO panel.'
};

const JobDetailModal = React.memo(({
  selectedJob,
  user,
  roles,
  loadingJobDetails,
  loadingComments = false,
  onClose,
  onUpdateJob,
  onMoveJob,
  canMoveAny,
  movingStatus,
  onFetchNonResolvedIssues,
  dashboardManagerNames
}) => {
  // Local modal state — completely isolated from the kanban board.
  // Section open/closed state lives in the persisted modal UI store
  // (useSectionOpen / useModalUiStore), not here.
  const profileOpen = useSectionOpen('profile');
  // Chat-first layout: the details column lives in a slide-in drawer
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [clientProfileData, setClientProfileData] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState(null);
  const [gmailUsername, setGmailUsername] = useState('');
  const [gmailPassword, setGmailPassword] = useState('');
  const [savingGmailCredentials, setSavingGmailCredentials] = useState(false);
  const [showGmailCredentialsHistory, setShowGmailCredentialsHistory] = useState(false);
  const [isEditingGmailCredentials, setIsEditingGmailCredentials] = useState(false);
  const [showAddAttachmentModal, setShowAddAttachmentModal] = useState(false);
  const [attachmentNameInput, setAttachmentNameInput] = useState('');
  const [attachmentFilePending, setAttachmentFilePending] = useState(null);
  const [expandedAttachmentIndices, setExpandedAttachmentIndices] = useState(new Set());
  const [editingAttachmentIndex, setEditingAttachmentIndex] = useState(null);
  const [editingAttachmentName, setEditingAttachmentName] = useState('');
  const [attachmentReplaceFilePending, setAttachmentReplaceFilePending] = useState(null);
  const [savingAttachmentEdit, setSavingAttachmentEdit] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [assigningCsm, setAssigningCsm] = useState(false);
  const [assigningResumeMaker, setAssigningResumeMaker] = useState(false);
  const [assigningLinkedInMember, setAssigningLinkedInMember] = useState(false);
  const [assigningOperator, setAssigningOperator] = useState(false);
  const [cardAnalysisDate, setCardAnalysisDate] = useState('');
  const [cardJobAnalysis, setCardJobAnalysis] = useState(null);
  const [appliedOnDateCount, setAppliedOnDateCount] = useState(null);
  const [fetchingAppliedOnDate, setFetchingAppliedOnDate] = useState(false);
  const [savingDashboardManager, setSavingDashboardManager] = useState(new Set());
  const [showEditClientNumberModal, setShowEditClientNumberModal] = useState(false);
  const [editingClientNameJobId, setEditingClientNameJobId] = useState(null);
  const [editingClientNameValue, setEditingClientNameValue] = useState('');
  const [emailLogs, setEmailLogs] = useState([]);
  const [emailLogsLoading, setEmailLogsLoading] = useState(false);
  const [emailLogsError, setEmailLogsError] = useState(null);
  const [paymentEmailValue, setPaymentEmailValue] = useState('');
  const [paymentEmailDraft, setPaymentEmailDraft] = useState('');
  const [editingPaymentEmail, setEditingPaymentEmail] = useState(false);
  const [savingPaymentEmail, setSavingPaymentEmail] = useState(false);
  const [milestoneSchedule, setMilestoneSchedule] = useState([]);
  const [milestonePlanCap, setMilestonePlanCap] = useState(0);
  const [milestonePlanType, setMilestonePlanType] = useState('');
  const [milestoneBaseCap, setMilestoneBaseCap] = useState(0);
  const [milestoneAddonApps, setMilestoneAddonApps] = useState(0);
  const [milestoneReferralApps, setMilestoneReferralApps] = useState(0);
  const [sendingPendingMilestone, setSendingPendingMilestone] = useState(false);
  // Why the schedule is empty, and why a non-empty one still won't send. Both
  // come from the email-logs endpoint so the panel can name the problem instead
  // of disappearing, which is what it used to do on an empty schedule.
  const [milestoneBlockReason, setMilestoneBlockReason] = useState(null);
  const [milestoneDeliveryBlockers, setMilestoneDeliveryBlockers] = useState([]);
  const [creatingTrackingRecord, setCreatingTrackingRecord] = useState(false);
  const [resendingLogId, setResendingLogId] = useState(null);
  // Onboarding email sequence (base résumé / cover letter / LinkedIn) — lives
  // in the dashboard backend's OnboardingMailState, not in this app's DB.
  const [onboardingMail, setOnboardingMail] = useState(null);
  const [onboardingMailLoading, setOnboardingMailLoading] = useState(false);
  const [onboardingMailError, setOnboardingMailError] = useState(null);
  const [sendingOnboardingStep, setSendingOnboardingStep] = useState(null);
  const [savingClientName, setSavingClientName] = useState(false);
  const [editingClientNumberEmail, setEditingClientNumberEmail] = useState(null);
  const [editingClientNumberValue, setEditingClientNumberValue] = useState('');
  const [savingClientNumber, setSavingClientNumber] = useState(false);
  const [operatorManagedUsers, setOperatorManagedUsers] = useState([]);
  const [loadingOperatorManagedUsers, setLoadingOperatorManagedUsers] = useState(false);
  const [operationsForClient, setOperationsForClient] = useState([]);
  const [clientIdForOperations, setClientIdForOperations] = useState(null);
  const [loadingOperationsForClient, setLoadingOperationsForClient] = useState(false);
  const [showAddOperatorModal, setShowAddOperatorModal] = useState(false);
  const [addingOperatorToClient, setAddingOperatorToClient] = useState(false);
  const [removingOperatorFromClient, setRemovingOperatorFromClient] = useState(null);
  const [showAddManagedUserModal, setShowAddManagedUserModal] = useState(false);
  const [availableClientsForOperator, setAvailableClientsForOperator] = useState([]);
  const [loadingAvailableClientsForOperator, setLoadingAvailableClientsForOperator] = useState(false);
  const [addingClientToOperator, setAddingClientToOperator] = useState(false);
  const [removingManagedUser, setRemovingManagedUser] = useState(null);
  const profileFetchRunIdRef = useRef(0);
  const attachmentNameInputRef = useRef(null);
  const previousJobIdRef = useRef(null);

  const isAdmin = user?.role === 'admin';
  const isCsm = user?.role === 'csm' || user?.roles?.includes?.('csm');
  const isTeamLead = user?.role === 'team_lead';
  const canViewOperations = isAdmin || isCsm || isTeamLead;
  const canManageOperations = isAdmin || isCsm || isTeamLead;

  const dashboardManagerSelectOptions = useMemo(
    () =>
      buildDashboardManagerSelectOptions(dashboardManagerNames, [
        selectedJob?.dashboardManagerName,
        ...(selectedJob?.taggedDashboardManagerNames || [])
      ]),
    [dashboardManagerNames, selectedJob?.dashboardManagerName, selectedJob?.taggedDashboardManagerNames]
  );

  // Reset per-job data on job change (section open/closed prefs persist —
  // they are user layout, not job data)
  useEffect(() => {
    const currentJobId = selectedJob?._id;
    if (previousJobIdRef.current !== null && previousJobIdRef.current !== currentJobId) {
      setClientProfileData(null);
      setProfileError(null);
      setProfileLoading(false);
      setAppliedOnDateCount(null);
      setCardAnalysisDate('');
      setCardJobAnalysis(null);
    }
    previousJobIdRef.current = currentJobId;
  }, [selectedJob?._id]);

  // Init Gmail credentials
  useEffect(() => {
    if (selectedJob?.gmailCredentials) {
      setGmailUsername(selectedJob.gmailCredentials.username || '');
      setGmailPassword(selectedJob.gmailCredentials.password || '');
      setIsEditingGmailCredentials(false);
    } else {
      setGmailUsername('');
      setGmailPassword('');
      setIsEditingGmailCredentials(true);
    }
  }, [selectedJob?.gmailCredentials]);

  // Fetch operations for client — TTL-cached so reopening a ticket renders
  // instantly instead of refetching. The ref guards stale responses landing
  // after the user switched clients.
  const opsClientRef = useRef('');
  const fetchOperationsForClient = useCallback(async (clientEmail, { force = false } = {}) => {
    if (!clientEmail || !canViewOperations) return;
    const key = clientEmail.toLowerCase();
    opsClientRef.current = key;
    setLoadingOperationsForClient(true);
    try {
      const data = await getCached(
        `ops:${key}`,
        () => apiFetch(`/api/operations/by-client/${encodeURIComponent(clientEmail)}`),
        { ttl: 120_000, force }
      );
      if (opsClientRef.current !== key) return; // superseded by a newer client
      setOperationsForClient(data.operations || []);
      setClientIdForOperations(data.clientId || null);
    } catch {
      if (opsClientRef.current !== key) return;
      setOperationsForClient([]); setClientIdForOperations(null);
    } finally {
      if (opsClientRef.current === key) setLoadingOperationsForClient(false);
    }
  }, [canViewOperations]);

  useEffect(() => {
    if (!(selectedJob?.clientEmail && canViewOperations)) {
      setOperationsForClient([]); setClientIdForOperations(null);
      return;
    }
    fetchOperationsForClient(selectedJob.clientEmail);
  }, [selectedJob?.clientEmail, canViewOperations, fetchOperationsForClient]);

  // Email logs + milestone schedule — TTL-cached (mutations pass force:true).
  const emailLogsClientRef = useRef('');
  const fetchEmailLogs = useCallback(async (clientEmail, { force = false } = {}) => {
    if (!clientEmail) { setEmailLogs([]); return; }
    const key = clientEmail.toLowerCase();
    emailLogsClientRef.current = key;
    setEmailLogsLoading(true);
    setEmailLogsError(null);
    try {
      const data = await getCached(
        `emailLogs:${key}`,
        () => apiFetch(`/api/clients/${encodeURIComponent(clientEmail)}/email-logs?limit=100`),
        { ttl: 60_000, force }
      );
      if (emailLogsClientRef.current !== key) return; // superseded by a newer client
      setEmailLogs(Array.isArray(data?.logs) ? data.logs : []);
      const pe = (data?.paymentEmail || '').trim();
      setPaymentEmailValue(pe);
      setPaymentEmailDraft(pe);
      setMilestoneSchedule(Array.isArray(data?.milestoneSchedule) ? data.milestoneSchedule : []);
      setMilestonePlanCap(Number(data?.planCap) || 0);
      setMilestonePlanType(String(data?.planType || ''));
      setMilestoneBaseCap(Number(data?.baseCap) || 0);
      setMilestoneAddonApps(Number(data?.addonApplications) || 0);
      setMilestoneReferralApps(Number(data?.referralApplications) || 0);
      setMilestoneBlockReason(data?.milestoneBlockReason || null);
      setMilestoneDeliveryBlockers(Array.isArray(data?.milestoneDeliveryBlockers) ? data.milestoneDeliveryBlockers : []);
    } catch (err) {
      if (emailLogsClientRef.current !== key) return;
      if (err.status === 401) handleAuthFailure();
      setEmailLogsError('Failed to load email logs');
      setEmailLogs([]);
    } finally {
      if (emailLogsClientRef.current === key) setEmailLogsLoading(false);
    }
  }, []);

  // One-click repair for `no_tracking_record`: seed the dashboardtrackings
  // document from the ticket. Admin-only on the server too — the button is a
  // convenience, not the gate.
  const createTrackingRecord = useCallback(async () => {
    const jobId = selectedJob?._id;
    const clientEmail = selectedJob?.clientEmail;
    if (!jobId || !clientEmail) return;
    setCreatingTrackingRecord(true);
    try {
      const res = await fetch(`${API_BASE}/api/onboarding/jobs/${jobId}/create-tracking-record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...AUTH_HEADERS() },
        body: JSON.stringify({})
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toastUtils.error(body?.error || `Failed (HTTP ${res.status})`);
        return;
      }
      toastUtils.success(
        body.created
          ? `Tracking record created — ${body.planType} (${body.planCap} applications)`
          : 'Tracking record already existed'
      );
      await fetchEmailLogs(clientEmail, { force: true });
    } catch (err) {
      toastUtils.error(err?.message || 'Network error');
    } finally {
      setCreatingTrackingRecord(false);
    }
  }, [selectedJob?._id, selectedJob?.clientEmail, fetchEmailLogs]);

  const savePaymentEmail = useCallback(async () => {
    const clientEmail = selectedJob?.clientEmail;
    if (!clientEmail) return;
    const next = (paymentEmailDraft || '').toLowerCase().trim();
    if (next && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
      toastUtils.error('Enter a valid email');
      return;
    }
    setSavingPaymentEmail(true);
    try {
      const res = await fetch(`${API_BASE}/api/clients/${encodeURIComponent(clientEmail)}/payment-email`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...AUTH_HEADERS() },
        body: JSON.stringify({ paymentEmail: next })
      });
      if (!res.ok) {
        if (res.status === 401) handleAuthFailure();
        const err = await res.json().catch(() => ({}));
        toastUtils.error(err?.error || 'Failed to save');
        return;
      }
      const data = await res.json();
      const saved = (data?.paymentEmail || '').trim();
      setPaymentEmailValue(saved);
      setPaymentEmailDraft(saved);
      setEditingPaymentEmail(false);
      toastUtils.success('Payment email saved');
      fetchEmailLogs(clientEmail, { force: true });
    } catch {
      toastUtils.error('Failed to save');
    } finally {
      setSavingPaymentEmail(false);
    }
  }, [selectedJob?.clientEmail, paymentEmailDraft, fetchEmailLogs]);

  const sendPendingMilestone = useCallback(async () => {
    const clientEmail = selectedJob?.clientEmail;
    if (!clientEmail) return;
    // Client-side pre-flight: payment email required. Saves round-trip and
    // gives a clearer message than the raw backend response.
    if (!paymentEmailValue || !paymentEmailValue.trim()) {
      toastUtils.error('Payment Email is not set for this client. Add one in the INFO panel first — milestone emails are sent to that address.');
      return;
    }
    setSendingPendingMilestone(true);
    try {
      const res = await fetch(`${API_BASE}/api/clients/${encodeURIComponent(clientEmail)}/send-pending-milestones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...AUTH_HEADERS() }
      });
      if (!res.ok) {
        if (res.status === 401) handleAuthFailure();
        const err = await res.json().catch(() => ({}));
        const friendly = {
          no_payment_email: 'Payment Email is not set for this client. Add one in the INFO panel first.',
          inactive: 'Client is not active — milestone emails are only sent to active clients.',
          no_plan: 'This client has no milestone plan configured.',
        }[err?.code] || err?.error || 'Send failed';
        toastUtils.error(friendly);
        return;
      }
      const data = await res.json();
      if (data?.sent) {
        toastUtils.success(`Sent: ${data.milestone} · count ${data.currentCount}/${data.planCap}${data.caughtUp?.length ? ` · caught up ${data.caughtUp.length}` : ''}`);
      } else if (data?.skipped) {
        toastUtils.info ? toastUtils.info(`Skipped: ${data.reason || 'no_pending_milestones'}`) : toastUtils.success(`Skipped: ${data.reason || 'no_pending_milestones'}`);
      } else {
        toastUtils.error(data?.error || 'Did not send');
      }
      fetchEmailLogs(clientEmail, { force: true });
    } catch {
      toastUtils.error('Send failed');
    } finally {
      setSendingPendingMilestone(false);
    }
  }, [selectedJob?.clientEmail, paymentEmailValue, fetchEmailLogs]);

  // Force-resend one specific milestone email. Powers both the "Send again"
  // button on a failed Email Activity row AND the "Send again" button on a
  // SENT item in the Milestone Timeline. `loadingId` keys the spinner so only
  // the clicked button shows it.
  const resendMilestoneEmail = useCallback(async ({ milestoneKey, type, loadingId }) => {
    const clientEmail = selectedJob?.clientEmail;
    if (!clientEmail || (!milestoneKey && !type)) return;
    if (!paymentEmailValue || !paymentEmailValue.trim()) {
      toastUtils.error('Payment Email is not set for this client. Add one in the INFO panel first.');
      return;
    }
    setResendingLogId(loadingId);
    try {
      const res = await fetch(`${API_BASE}/api/clients/${encodeURIComponent(clientEmail)}/resend-milestone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...AUTH_HEADERS() },
        body: JSON.stringify({ milestoneKey, type })
      });
      if (!res.ok) {
        if (res.status === 401) handleAuthFailure();
        const err = await res.json().catch(() => ({}));
        const friendly = {
          no_payment_email: 'Payment Email is not set for this client. Add one in the INFO panel first.',
          inactive: 'Client is not active — milestone emails are only sent to active clients.',
          no_milestone: 'This milestone is no longer part of the client’s plan.',
        }[err?.code] || err?.error || 'Resend failed';
        toastUtils.error(friendly);
        return;
      }
      const data = await res.json();
      if (data?.sent) {
        toastUtils.success(`Re-sent · ${data.milestone} · ${data.currentCount}/${data.planCap}`);
      } else {
        toastUtils.error(data?.error || 'Did not send');
      }
      fetchEmailLogs(clientEmail, { force: true });
    } catch {
      toastUtils.error('Resend failed');
    } finally {
      setResendingLogId(null);
    }
  }, [selectedJob?.clientEmail, paymentEmailValue, fetchEmailLogs]);

  // ── Onboarding email sequence ──
  // Reads the dashboard backend (OnboardingMailState), which is where the
  // worker records base résumé / cover letter / LinkedIn delivery. Unlike the
  // milestone emails, this state does NOT live in the clients-tracking DB, so
  // it goes direct to DASHBOARD_BASE the same way ClientAiSummary.jsx does.
  const onboardingMailClientRef = useRef('');
  const fetchOnboardingMail = useCallback(async (clientEmail) => {
    if (!clientEmail) { setOnboardingMail(null); return; }
    const key = clientEmail.toLowerCase();
    onboardingMailClientRef.current = key;
    setOnboardingMailLoading(true);
    setOnboardingMailError(null);
    try {
      const res = await fetch(
        `${DASHBOARD_BASE}/admin/onboarding-mail/status?email=${encodeURIComponent(key)}`
      );
      const body = await res.json().catch(() => null);
      if (onboardingMailClientRef.current !== key) return; // superseded
      if (!res.ok) {
        setOnboardingMailError(body?.error || `HTTP ${res.status}`);
        setOnboardingMail(null);
        return;
      }
      setOnboardingMail(body);
    } catch (err) {
      if (onboardingMailClientRef.current !== key) return;
      setOnboardingMailError(err?.message || 'Network error');
      setOnboardingMail(null);
    } finally {
      if (onboardingMailClientRef.current === key) setOnboardingMailLoading(false);
    }
  }, []);

  // Manual send for one step. `force` re-sends a step already delivered — the
  // backend refuses a repeat without it, so a double-click can't re-mail.
  const sendOnboardingStep = useCallback(async (stepKey, { force = false } = {}) => {
    const clientEmail = selectedJob?.clientEmail;
    if (!clientEmail || !stepKey) return;
    setSendingOnboardingStep(stepKey);
    try {
      const res = await fetch(`${DASHBOARD_BASE}/admin/onboarding-mail/send-step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: clientEmail.toLowerCase(), key: stepKey, force })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.ok) {
        toastUtils.error(body?.error || `Failed to send (HTTP ${res.status})`);
        return;
      }
      toastUtils.success(`Sent to ${body.to}`);
      await fetchOnboardingMail(clientEmail);
    } catch (err) {
      toastUtils.error(err?.message || 'Network error');
    } finally {
      setSendingOnboardingStep(null);
    }
  }, [selectedJob?.clientEmail, fetchOnboardingMail]);

  useEffect(() => {
    if (!selectedJob?.clientEmail) {
      setEmailLogs([]); setPaymentEmailValue(''); setPaymentEmailDraft(''); setMilestoneSchedule([]); setMilestonePlanCap(0); setMilestonePlanType('');
      setMilestoneBlockReason(null); setMilestoneDeliveryBlockers([]);
      setOnboardingMail(null); setOnboardingMailError(null);
      return;
    }
    fetchEmailLogs(selectedJob.clientEmail);
    fetchOnboardingMail(selectedJob.clientEmail);
  }, [selectedJob?.clientEmail, fetchEmailLogs, fetchOnboardingMail]);

  // Fetch operator managed users — TTL-cached per operator.
  const managedOpRef = useRef('');
  const fetchOperatorManagedUsers = useCallback(async (operatorEmail, { force = false } = {}) => {
    if (!operatorEmail?.trim()) { setOperatorManagedUsers([]); return; }
    const key = operatorEmail.trim().toLowerCase();
    managedOpRef.current = key;
    setLoadingOperatorManagedUsers(true);
    try {
      const data = await getCached(
        `managedUsers:${key}`,
        () => apiFetch(`/api/operations/${encodeURIComponent(operatorEmail.trim())}/managed-users`),
        { ttl: 120_000, force }
      );
      if (managedOpRef.current !== key) return; // superseded by a newer operator
      setOperatorManagedUsers(data.managedUsers || []);
    } catch {
      if (managedOpRef.current !== key) return;
      setOperatorManagedUsers([]);
    } finally {
      if (managedOpRef.current === key) setLoadingOperatorManagedUsers(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedJob?.operatorEmail) { setOperatorManagedUsers([]); return; }
    fetchOperatorManagedUsers(selectedJob.operatorEmail);
  }, [selectedJob?.operatorEmail, fetchOperatorManagedUsers]);

  // Job analysis for card. Routed through the shared analysis cache so opening a
  // card reuses the result the board/analysis page already fetched (no duplicate
  // heavy aggregation). `ignore` guards against a stale response landing after
  // the user switched to a different client.
  useEffect(() => {
    const email = (selectedJob?.clientEmail || '').toLowerCase();
    if (!email) { setCardJobAnalysis(null); return; }
    let ignore = false;
    const dateKey = cardAnalysisDate ? convertToDMY(cardAnalysisDate) : '';
    const body = dateKey ? { date: dateKey } : {};
    getCached(
      `analysis:${dateKey || '__all__'}`,
      () => apiFetch('/api/analytics/client-job-analysis', { method: 'POST', body }),
      { ttl: 30_000 }
    ).then((data) => {
      if (ignore || !data) return;
      const clientRow = (data.rows || []).find(r => (r.email || '').toLowerCase() === email);
      setCardJobAnalysis(clientRow ? {
        saved: clientRow.saved || 0, applied: clientRow.applied || 0,
        interviewing: clientRow.interviewing || 0, offer: clientRow.offer || 0,
        rejected: clientRow.rejected || 0, removed: clientRow.removed || 0,
        lastAppliedOperatorName: clientRow.lastAppliedOperatorName || ''
      } : null);
    }).catch(() => { if (!ignore) setCardJobAnalysis(null); });
    return () => { ignore = true; };
  }, [selectedJob?.clientEmail, cardAnalysisDate]);

  const findAppliedOnDate = useCallback(async () => {
    if (!cardAnalysisDate) { toastUtils.error('Pick a date first'); return; }
    if (!selectedJob?.clientEmail) { toastUtils.error('No client selected'); return; }
    setFetchingAppliedOnDate(true);
    try {
      const res = await fetch(`${API_BASE}/api/analytics/applied-by-date?t=${Date.now()}`, {
        method: 'POST', headers: AUTH_HEADERS(),
        body: JSON.stringify({ date: convertToDMY(cardAnalysisDate) })
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      const count = Number((data.counts || {})[(selectedJob.clientEmail || '').toLowerCase()] || 0);
      setAppliedOnDateCount(count);
      toastUtils.success(`Found ${count} job(s) applied on ${convertToDMY(cardAnalysisDate)}`);
    } catch { toastUtils.error('Failed to fetch applied-on-date'); setAppliedOnDateCount(null); }
    finally { setFetchingAppliedOnDate(false); }
  }, [cardAnalysisDate, selectedJob?.clientEmail]);

  // Profile fetch
  const fetchClientProfile = useCallback((email, jobId) => {
    if (!email) return;
    const emailLower = email.toLowerCase().trim();
    const profileStore = useClientProfileStore.getState();
    const cached = profileStore.getProfile(emailLower);
    if (cached && cached.profile && !profileStore.isStale(emailLower)) {
      setClientProfileData(cached.profile);
      setProfileLoading(false);
      setProfileError(null);
      if (jobId) {
        useOnboardingStore.getState().setJobs((prev) => prev.map((j) => (j._id === jobId ? { ...j, profileComplete: cached.profileComplete } : j)));
        useOnboardingStore.getState().setSelectedJob((prev) => (prev && prev._id === jobId ? { ...prev, profileComplete: cached.profileComplete } : prev));
      }
      return;
    }
    if (cached?.profile) { setClientProfileData(cached.profile); setProfileError(null); }
    setProfileLoading(true);
    const runId = ++profileFetchRunIdRef.current;
    fetch(`${API_BASE}/api/onboarding/client-profile/${encodeURIComponent(emailLower)}`, { headers: AUTH_HEADERS() })
      .then(async (r) => await r.json().catch(() => ({})))
      .then((data) => {
        if (profileFetchRunIdRef.current !== runId) return;
        const rawProfile = data?.userProfile ?? (data && (data.firstName != null || data.email != null) ? data : null);
        const profileObj = rawProfile && typeof rawProfile === 'object' ? rawProfile : null;
        const complete = data?.profileComplete === true;
        if (profileObj) {
          useClientProfileStore.getState().setProfile(emailLower, profileObj, complete);
          setProfileError(null);
          setClientProfileData(profileObj);
          setProfileLoading(false);
          if (jobId) {
            useOnboardingStore.getState().setJobs((prev) => prev.map((j) => (j._id === jobId ? { ...j, profileComplete: complete } : j)));
            useOnboardingStore.getState().setSelectedJob((prev) => (prev && prev._id === jobId ? { ...prev, profileComplete: complete } : prev));
          }
        } else {
          useClientProfileStore.getState().setProfileError(emailLower, data?.message || 'Profile not found');
          setProfileError(data?.message || data?.error || 'Profile not found');
          setClientProfileData(null);
          setProfileLoading(false);
          if (jobId) {
            useOnboardingStore.getState().setJobs((prev) => prev.map((j) => (j._id === jobId ? { ...j, profileComplete: false } : j)));
            useOnboardingStore.getState().setSelectedJob((prev) => (prev && prev._id === jobId ? { ...prev, profileComplete: false } : prev));
          }
        }
      })
      .catch((err) => {
        if (profileFetchRunIdRef.current !== runId) return;
        setProfileError(err?.message || 'Failed to fetch profile');
        setProfileLoading(false);
      });
  }, []);

  // The profile section's open state lives in the persisted modal UI store,
  // so whenever it is open ensure the current job's profile is loaded.
  // fetchClientProfile is cache-guarded — repeat runs for a cached profile
  // cost nothing.
  useEffect(() => {
    if (profileOpen && selectedJob?.clientEmail) {
      fetchClientProfile(selectedJob.clientEmail, selectedJob._id);
    }
  }, [profileOpen, selectedJob?.clientEmail, selectedJob?._id, fetchClientProfile]);

  // Operator options
  const operatorOptions = useMemo(() => {
    const list = [...(roles?.operationsInterns || [])];
    const currentEmail = (selectedJob?.operatorEmail || '').toLowerCase().trim();
    if (currentEmail && !list.some((o) => (o.email || '').toLowerCase() === currentEmail)) {
      list.push({ email: selectedJob.operatorEmail, name: selectedJob.operatorName || selectedJob.operatorEmail });
    }
    return list;
  }, [roles?.operationsInterns, selectedJob?.operatorEmail, selectedJob?.operatorName]);

  // Assignment handlers
  const handleAssignCsm = useCallback(async (csmEmail, csmName) => {
    if (!selectedJob) return;
    setAssigningCsm(true);
    try {
      const res = await fetch(`${API_BASE}/api/onboarding/jobs/${selectedJob._id}`, { method: 'PATCH', headers: AUTH_HEADERS(), body: JSON.stringify({ csmEmail, csmName }) });
      if (!res.ok) throw new Error('Failed to assign CSM');
      const data = await res.json();
      onUpdateJob(data.job);
      toastUtils.success('CSM assigned');
    } catch (e) { toastUtils.error(e.message || 'Failed'); }
    finally { setAssigningCsm(false); }
  }, [selectedJob, onUpdateJob]);

  const handleAssignResumeMaker = useCallback(async (email, name) => {
    if (!selectedJob || !isAdmin) return;
    setAssigningResumeMaker(true);
    try {
      const res = await fetch(`${API_BASE}/api/onboarding/jobs/${selectedJob._id}`, { method: 'PATCH', headers: AUTH_HEADERS(), body: JSON.stringify({ resumeMakerEmail: email, resumeMakerName: name }) });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      onUpdateJob(data.job);
      toastUtils.success('Resume Maker assigned');
    } catch (e) { toastUtils.error(e.message || 'Failed'); }
    finally { setAssigningResumeMaker(false); }
  }, [selectedJob, isAdmin, onUpdateJob]);

  const handleAssignLinkedInMember = useCallback(async (email, name) => {
    if (!selectedJob || !isAdmin) return;
    setAssigningLinkedInMember(true);
    try {
      const res = await fetch(`${API_BASE}/api/onboarding/jobs/${selectedJob._id}`, { method: 'PATCH', headers: AUTH_HEADERS(), body: JSON.stringify({ linkedInMemberEmail: email, linkedInMemberName: name }) });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      onUpdateJob(data.job);
      toastUtils.success('LinkedIn member assigned');
    } catch (e) { toastUtils.error(e.message || 'Failed'); }
    finally { setAssigningLinkedInMember(false); }
  }, [selectedJob, isAdmin, onUpdateJob]);

  const handleAssignOperator = useCallback(async (email, name) => {
    if (!selectedJob || !isAdmin) return;
    setAssigningOperator(true);
    try {
      const res = await fetch(`${API_BASE}/api/onboarding/jobs/${selectedJob._id}`, { method: 'PATCH', headers: AUTH_HEADERS(), body: JSON.stringify({ operatorEmail: email || '', operatorName: name || '' }) });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      onUpdateJob(data.job);
      setOperatorManagedUsers([]);
      if (selectedJob.clientEmail && canViewOperations) fetchOperationsForClient(selectedJob.clientEmail, { force: true });
      toastUtils.success('Operations Intern assigned');
    } catch (e) { toastUtils.error(e.message || 'Failed'); }
    finally { setAssigningOperator(false); }
  }, [selectedJob, isAdmin, onUpdateJob, canViewOperations, fetchOperationsForClient]);

  // Attachment handlers
  const getNextDefaultAttachmentName = useCallback((job) => {
    const planLower = (job?.planType || '').toLowerCase();
    const isExec = planLower === 'executive' || planLower.includes('executive');
    const defaults = isExec ? ['Resume', 'Cover letter', 'Portfolio (link)'] : (planLower === 'professional' ? ['Resume', 'Cover letter'] : ['Resume']);
    const names = (job?.attachments || []).map((a) => (a.name || '').trim());
    const hasMatch = (d) => names.some((n) => n.toLowerCase() === d.toLowerCase());
    return defaults.find((d) => !hasMatch(d)) || '';
  }, []);

  const handleUploadAttachment = useCallback(async () => {
    const name = attachmentNameInput.trim() || attachmentFilePending?.name || 'Attachment';
    if (!attachmentFilePending || !selectedJob) { toastUtils.error('Please select a file'); return; }
    const base = (API_BASE || '').replace(/\/$/, '');
    if (!base) { toastUtils.error('API URL not configured.'); return; }
    setUploadingAttachment(true);
    try {
      const form = new FormData();
      form.append('file', attachmentFilePending);
      const uploadRes = await fetch(`${base}/api/upload/onboarding-attachment`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('authToken') || ''}` }, body: form });
      const uploadData = await uploadRes.json().catch(() => ({}));
      if (!uploadRes.ok) throw new Error(uploadData.message || 'Upload failed');
      const url = uploadData.url;
      if (!url) throw new Error('Server did not return file URL');
      const res = await fetch(`${base}/api/onboarding/jobs/${selectedJob._id}/attachments`, { method: 'POST', headers: AUTH_HEADERS(), body: JSON.stringify({ url, filename: uploadData.filename || attachmentFilePending.name, name }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed');
      const attachment = data.attachment || { url, filename: uploadData.filename || attachmentFilePending.name, name };
      const updated = { ...selectedJob, attachments: [...(selectedJob.attachments || []), attachment] };
      onUpdateJob(updated);
      setShowAddAttachmentModal(false);
      setAttachmentNameInput('');
      setAttachmentFilePending(null);
      toastUtils.success('Attachment uploaded');
    } catch (err) { toastUtils.error(err?.message || 'Upload failed'); }
    finally { setUploadingAttachment(false); }
  }, [attachmentNameInput, attachmentFilePending, selectedJob, onUpdateJob]);

  const saveAttachmentEdit = useCallback(async () => {
    if (editingAttachmentIndex == null || !selectedJob?._id) return;
    setSavingAttachmentEdit(true);
    try {
      const base = (API_BASE || '').replace(/\/$/, '');
      let url = selectedJob.attachments?.[editingAttachmentIndex]?.url;
      let filename = selectedJob.attachments?.[editingAttachmentIndex]?.filename;
      if (attachmentReplaceFilePending) {
        const formData = new FormData();
        formData.append('file', attachmentReplaceFilePending);
        const uploadRes = await fetch(`${base}/api/upload/onboarding-attachment`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('authToken') || ''}` }, body: formData });
        const uploadData = await uploadRes.json().catch(() => ({}));
        if (!uploadRes.ok || !uploadData?.url) throw new Error(uploadData?.message || 'Upload failed');
        url = uploadData.url;
        filename = uploadData.filename || attachmentReplaceFilePending.name;
      }
      const payload = { name: editingAttachmentName.trim() || filename };
      if (url) payload.url = url;
      if (filename) payload.filename = filename;
      const res = await fetch(`${base}/api/onboarding/jobs/${selectedJob._id}/attachments/${editingAttachmentIndex}`, { method: 'PATCH', headers: AUTH_HEADERS(), body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed');
      const updated = data.job || (() => { const u = { ...selectedJob, attachments: [...(selectedJob.attachments || [])] }; u.attachments[editingAttachmentIndex] = { ...u.attachments[editingAttachmentIndex], ...payload }; return u; })();
      onUpdateJob(updated);
      setEditingAttachmentIndex(null);
      setEditingAttachmentName('');
      setAttachmentReplaceFilePending(null);
      toastUtils.success('Attachment updated');
    } catch (e) { toastUtils.error(e?.message || 'Failed'); }
    finally { setSavingAttachmentEdit(false); }
  }, [editingAttachmentIndex, editingAttachmentName, attachmentReplaceFilePending, selectedJob, onUpdateJob]);

  // Gmail save
  const handleSaveGmailCredentials = useCallback(async () => {
    if (!selectedJob?._id || savingGmailCredentials) return;
    if (!gmailUsername.trim() || !gmailPassword.trim()) { toastUtils.error('Please enter both username and password'); return; }
    setSavingGmailCredentials(true);
    try {
      const res = await fetch(`${API_BASE}/api/onboarding/jobs/${selectedJob._id}`, { method: 'PATCH', headers: AUTH_HEADERS(), body: JSON.stringify({ gmailCredentials: { username: gmailUsername.trim(), password: gmailPassword.trim() } }) });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      onUpdateJob(data.job);
      toastUtils.success('Gmail credentials saved');
      setIsEditingGmailCredentials(false);
      if (data.job.gmailCredentials) { setGmailUsername(data.job.gmailCredentials.username || ''); setGmailPassword(data.job.gmailCredentials.password || ''); }
    } catch (e) { toastUtils.error(e.message || 'Failed'); }
    finally { setSavingGmailCredentials(false); }
  }, [selectedJob, gmailUsername, gmailPassword, savingGmailCredentials, onUpdateJob]);

  // Client name + number save
  const saveClientName = useCallback(async (jobId, newName) => {
    const trimmed = (newName || '').trim();
    if (!trimmed || savingClientName) return;
    setSavingClientName(true);
    try {
      const res = await fetch(`${API_BASE}/api/onboarding/jobs/${jobId}`, { method: 'PATCH', headers: AUTH_HEADERS(), body: JSON.stringify({ clientName: trimmed }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed');
      onUpdateJob(data.job);
      setEditingClientNameJobId(null);
      setEditingClientNameValue('');
      toastUtils.success('Name updated');
    } catch (e) { toastUtils.error(e.message || 'Failed'); }
    finally { setSavingClientName(false); }
  }, [savingClientName, onUpdateJob]);

  const handleSaveClientNumber = useCallback(async (clientEmail, valueOverride) => {
    if (!clientEmail || !isAdmin) return;
    const val = String((valueOverride ?? editingClientNumberValue) || '').trim();
    const finalNumber = val ? parseInt(val, 10) : null;
    setSavingClientNumber(true);
    try {
      const res = await fetch(`${API_BASE}/api/clients/${encodeURIComponent(clientEmail)}/client-number`, { method: 'PATCH', headers: AUTH_HEADERS(), body: JSON.stringify({ clientNumber: finalNumber }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed');
      toastUtils.success('Client number updated');
      setEditingClientNumberEmail(null);
      setEditingClientNumberValue('');
      setShowEditClientNumberModal(false);
      // Update job in UI so title/display reflects new or cleared number (backend already synced to OnboardingJob)
      if (selectedJob && (selectedJob.clientEmail || '').toLowerCase() === (clientEmail || '').toLowerCase()) {
        onUpdateJob({ ...selectedJob, clientNumber: finalNumber });
      }
    } catch (e) { toastUtils.error(e.message || 'Failed'); }
    finally { setSavingClientNumber(false); }
  }, [editingClientNumberValue, isAdmin, selectedJob, onUpdateJob]);

  // Operator management
  const handleAddOperatorToClient = useCallback(async (operatorEmail) => {
    const clientEmail = selectedJob?.clientEmail;
    if (!clientEmail || !operatorEmail) return;
    setAddingOperatorToClient(true);
    try {
      const res = await fetch(`${API_BASE}/api/operations/assign-client`, { method: 'POST', headers: AUTH_HEADERS(), body: JSON.stringify({ clientEmail, operatorEmail }) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const primary = data.error || data.message || `Could not add intern (${res.status})`;
        const msg = data.error && data.message && data.message !== data.error ? `${data.error}: ${data.message}` : primary;
        throw new Error(msg);
      }
      toastUtils.success('Operations intern added');
      setShowAddOperatorModal(false);
      fetchOperationsForClient(clientEmail, { force: true });
    } catch (e) { toastUtils.error(e.message || 'Failed'); }
    finally { setAddingOperatorToClient(false); }
  }, [selectedJob?.clientEmail, fetchOperationsForClient]);

  const handleRemoveOperatorFromClient = useCallback(async (operatorEmail) => {
    const clientEmail = selectedJob?.clientEmail;
    if (!clientEmail || !operatorEmail || !clientIdForOperations) return;
    setRemovingOperatorFromClient(operatorEmail);
    try {
      const res = await fetch(`${API_BASE}/api/operations/${encodeURIComponent(operatorEmail.trim())}/managed-users/${encodeURIComponent(clientIdForOperations)}`, { method: 'DELETE', headers: AUTH_HEADERS() });
      if (!res.ok) throw new Error('Failed');
      toastUtils.success('Operations intern removed');
      fetchOperationsForClient(clientEmail, { force: true });
      if (selectedJob?.operatorEmail?.toLowerCase() === operatorEmail.toLowerCase()) {
        const res2 = await fetch(`${API_BASE}/api/onboarding/jobs/${selectedJob._id}`, { method: 'PATCH', headers: AUTH_HEADERS(), body: JSON.stringify({ operatorEmail: '', operatorName: '' }) });
        if (res2.ok) { const data = await res2.json(); onUpdateJob(data.job); }
      }
    } catch (e) { toastUtils.error(e.message || 'Failed'); }
    finally { setRemovingOperatorFromClient(null); }
  }, [selectedJob, clientIdForOperations, fetchOperationsForClient, onUpdateJob]);

  const handleAssignClientToOperator = useCallback(async (clientEmail) => {
    const operatorEmail = selectedJob?.operatorEmail;
    if (!operatorEmail || !clientEmail) return;
    setAddingClientToOperator(true);
    try {
      const res = await fetch(`${API_BASE}/api/operations/assign-client`, { method: 'POST', headers: AUTH_HEADERS(), body: JSON.stringify({ clientEmail, operatorEmail }) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const primary = data.error || data.message || `Could not assign client (${res.status})`;
        const msg = data.error && data.message && data.message !== data.error ? `${data.error}: ${data.message}` : primary;
        throw new Error(msg);
      }
      toastUtils.success('Client added');
      setShowAddManagedUserModal(false);
      fetchOperatorManagedUsers(operatorEmail, { force: true });
    } catch (e) { toastUtils.error(e.message || 'Failed'); }
    finally { setAddingClientToOperator(false); }
  }, [selectedJob?.operatorEmail, fetchOperatorManagedUsers]);

  const handleRemoveManagedUser = useCallback(async (userID) => {
    const operatorEmail = selectedJob?.operatorEmail;
    if (!operatorEmail || !userID) return;
    setRemovingManagedUser(userID);
    try {
      const res = await fetch(`${API_BASE}/api/operations/${encodeURIComponent(operatorEmail.trim())}/managed-users/${encodeURIComponent(userID)}`, { method: 'DELETE', headers: AUTH_HEADERS() });
      if (!res.ok) throw new Error('Failed');
      toastUtils.success('User removed');
      fetchOperatorManagedUsers(operatorEmail, { force: true });
    } catch (e) { toastUtils.error(e.message || 'Failed'); }
    finally { setRemovingManagedUser(null); }
  }, [selectedJob?.operatorEmail, fetchOperatorManagedUsers]);

  const openAddManagedUserModal = useCallback(async () => {
    const email = selectedJob?.operatorEmail;
    if (!email) return;
    setShowAddManagedUserModal(true);
    setAvailableClientsForOperator([]);
    setLoadingAvailableClientsForOperator(true);
    try {
      const res = await fetch(`${API_BASE}/api/operations/${encodeURIComponent(email.trim())}/available-clients`, { headers: AUTH_HEADERS() });
      if (res.ok) { const data = await res.json(); setAvailableClientsForOperator(data.availableClients || []); }
    } catch { setAvailableClientsForOperator([]); }
    finally { setLoadingAvailableClientsForOperator(false); }
  }, [selectedJob?.operatorEmail]);

  const handleCloseModal = useCallback((e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    setClientProfileData(null);
    setEditingClientNameJobId(null);
    setEditingClientNameValue('');
    setCardAnalysisDate('');
    setCardJobAnalysis(null);
    setGmailUsername('');
    setGmailPassword('');
    setShowGmailCredentialsHistory(false);
    setIsEditingGmailCredentials(false);
    onClose();
  }, [onClose]);

  if (!selectedJob) return null;

  return (
    <Motion.div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) handleCloseModal(e); }}
      {...OVERLAY_FADE}
    >
      <Motion.div
        key={selectedJob._id}
        className="bg-[#f6f5f4] rounded-2xl shadow-2xl w-full max-w-7xl max-h-[94vh] h-[94vh] overflow-hidden flex flex-col ring-1 ring-white/20"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        {...PANEL_RISE}
      >
        {loadingJobDetails && (
          <div className="h-0.5 w-full bg-orange-100 overflow-hidden">
            <div className="h-full bg-primary w-2/5" style={{ animation: 'slideRight 1s ease-in-out infinite' }} />
          </div>
        )}
        {/* Modal Header */}
        <div className="bg-white border-b border-[#e6e4e1] px-6 py-4 flex items-start justify-between sticky top-0 z-10">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-bold text-gray-900">{clientDisplayName(selectedJob)}</h2>
                {isAdmin && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); setEditingClientNameJobId(selectedJob._id); setEditingClientNameValue(selectedJob.clientName || ''); setEditingClientNumberEmail(selectedJob.clientEmail); setEditingClientNumberValue(String(selectedJob.clientNumber ?? '')); setShowEditClientNumberModal(true); }} className="p-1.5 text-gray-400 hover:text-primary hover:bg-primary/5 rounded" title="Edit client details">
                    <Pencil className="w-4 h-4" />
                  </button>
                )}
              </div>
              <span className="text-sm font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-md border border-gray-200">#{selectedJob.jobNumber}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(selectedJob.status)}`}>
                {STATUS_LABELS[selectedJob.status]}
              </span>
              <span className="text-gray-300 text-sm">|</span>
              <span className="text-sm text-gray-500">{selectedJob.planType || 'Professional'} Plan</span>
              {/* Vital signs — the facts people glance at mid-conversation.
                  Person chips carry a stable per-person color, so owners are
                  recognizable without reading. */}
              <span className="hidden md:inline-flex items-center gap-1.5 ml-1">
                <PersonChip role="DM" name={selectedJob.dashboardManagerName} title={`Dashboard Manager: ${selectedJob.dashboardManagerName}`} />
                <PersonChip role="CSM" name={selectedJob.csmName} title={`Client Success Manager: ${selectedJob.csmName}`} />
                {cardJobAnalysis != null && (
                  <span className="inline-flex items-center text-[11px] text-gray-500 bg-white border border-[#e6e4e1] rounded-full px-2.5 py-1">
                    <b className="font-semibold text-gray-800 tabular-nums mr-1">{(cardJobAnalysis.applied ?? 0).toLocaleString()}</b> applied
                  </span>
                )}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 z-20 relative">
            <button
              type="button"
              onClick={() => setDetailsOpen((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                detailsOpen
                  ? 'border-orange-200 text-primary bg-orange-50'
                  : 'border-[#e6e4e1] text-gray-600 hover:border-[#d9d5d0] bg-white'
              }`}
              title="Open ticket details (team, info, credentials, analysis…)"
            >
              <PanelLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Details</span>
            </button>
            <button
              type="button"
              onClick={() => useChatStore.getState().shareTicket({
                jobId: selectedJob._id,
                jobNumber: selectedJob.jobNumber,
                clientName: selectedJob.clientName || '',
                clientNumber: selectedJob.clientNumber ?? null
              })}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium text-gray-500 hover:text-primary hover:bg-orange-50 transition-colors"
              title="Share this ticket in a chat message"
            >
              <MessageSquare className="w-4 h-4" />
              <span className="hidden sm:inline">Discuss in chat</span>
            </button>
            <button onClick={handleCloseModal} className="p-2 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer" type="button" aria-label="Close modal">
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Modal Body — chat-first: conversation full-width, details in a drawer */}
        <div className="flex flex-1 overflow-hidden min-h-0 relative">
          <AnimatePresence>
          {detailsOpen && (
            <React.Fragment key="details-drawer">
            <Motion.div
              key="dim"
              className="absolute inset-0 bg-black/15 z-10"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => setDetailsOpen(false)}
            />
            <Motion.div
              key="drawer"
              /* Width scales with the viewport: 470px was too narrow for the
                 timeline cards — milestone and onboarding rows wrapped onto
                 three lines and every list needed its own scrollbar.
                 max-w-[92%] keeps a sliver of the chat visible so this still
                 reads as a drawer over the modal, not a second modal. */
              className="absolute left-0 top-0 bottom-0 w-[640px] 2xl:w-[760px] max-w-[92%] bg-[#f6f5f4] border-r border-[#e6e4e1] z-20 flex flex-col shadow-[12px_0_40px_rgba(0,0,0,0.12)]"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
            >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[#e6e4e1] bg-white flex-none">
              <h3 className="text-sm font-bold text-gray-900">Ticket details</h3>
              <span className="text-xs text-gray-400">#{selectedJob.jobNumber}</span>
              <button
                type="button"
                onClick={() => setDetailsOpen(false)}
                className="ml-auto p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-[#f6f5f4]"
                aria-label="Close details"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* overscroll-contain stops a scroll that reaches the end of this
                column from chaining out to the board behind the modal. */}
            <div className="flex-1 overflow-y-auto overscroll-contain p-4">
            <div className="flex flex-col gap-3 mb-4">
              {/* Team Section */}
              <CollapsibleSection
                id="team"
                icon={User}
                title="Team"
                summary={[selectedJob.csmName, selectedJob.resumeMakerName, selectedJob.operatorName].filter(Boolean).join(' · ') || 'Unassigned'}
              >
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">Client Success Manager</label>
                    <select value={selectedJob.csmEmail || ''} onChange={(e) => { const opt = roles.csms?.find((c) => c.email === e.target.value); handleAssignCsm(opt?.email || '', opt?.name || ''); }} disabled={assigningCsm} className="w-full text-sm border-gray-200 rounded-lg focus:ring-primary focus:border-primary bg-white">
                      <option value="">Select CSM...</option>
                      {(roles.csms || []).map((c) => (<option key={c.email} value={c.email}>{c.name || c.email}</option>))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">Resume Maker</label>
                    {isAdmin ? (
                      <select value={selectedJob.resumeMakerEmail || ''} onChange={(e) => { const opt = roles.resumeMakers?.find((r) => r.email === e.target.value); handleAssignResumeMaker(opt?.email || '', opt?.name || ''); }} disabled={assigningResumeMaker} className="w-full text-sm border-gray-200 rounded-lg focus:ring-primary focus:border-primary bg-white">
                        <option value="">Select Resume Maker...</option>
                        {(roles.resumeMakers || []).map((r) => (<option key={r.email} value={r.email}>{r.name || r.email}</option>))}
                      </select>
                    ) : (
                      <div className="p-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 font-medium">{selectedJob.resumeMakerName || 'Unassigned'}</div>
                    )}
                  </div>
                  {canViewOperations && (
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1.5">Operations Intern</label>
                      {canManageOperations ? (
                        <select value={selectedJob.operatorEmail || ''} onChange={(e) => { const val = e.target.value; if (val === '') { handleAssignOperator('', ''); return; } const opt = operatorOptions.find((o) => (o.email || '').toLowerCase() === val.toLowerCase()); handleAssignOperator(opt?.email ?? val, opt?.name ?? val); }} disabled={assigningOperator} className="w-full text-sm border-gray-200 rounded-lg focus:ring-primary focus:border-primary bg-white">
                          <option value="">— Unassigned —</option>
                          {operatorOptions.map((o) => (<option key={(o.email || '').toLowerCase()} value={o.email}>{o.name || o.email}</option>))}
                        </select>
                      ) : (
                        <div className="p-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 font-medium">{selectedJob.operatorName || selectedJob.operatorEmail || 'Unassigned'}</div>
                      )}
                      {/* Operations managing this client */}
                      <div className="mt-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Operations managing this client</span>
                          {canManageOperations && (<button type="button" onClick={() => setShowAddOperatorModal(true)} className="text-xs font-medium text-primary hover:text-primary/80">+ Add operations intern</button>)}
                        </div>
                        {loadingOperationsForClient ? (<p className="text-xs text-gray-500">Loading...</p>) : operationsForClient.length === 0 ? (<p className="text-xs text-gray-500">No operations assigned yet.</p>) : (
                          <ul className="space-y-1.5 max-h-52 overflow-y-auto rounded-lg border border-gray-100 bg-white p-2">
                            {operationsForClient.map((o) => (
                              <li key={(o.email || '').toLowerCase()} className="flex items-center justify-between gap-2 text-sm">
                                <span className="truncate text-gray-800" title={o.email}>{o.name || o.email}</span>
                                {canManageOperations && (<button type="button" onClick={() => handleRemoveOperatorFromClient(o.email)} disabled={removingOperatorFromClient === o.email} className="text-red-500 hover:text-red-700 text-xs disabled:opacity-50 shrink-0">{removingOperatorFromClient === o.email ? '…' : 'Remove'}</button>)}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      {selectedJob.operatorEmail && (
                        <div className="mt-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Users managed by primary operator</span>
                            {canManageOperations && (<button type="button" onClick={openAddManagedUserModal} className="text-xs font-medium text-primary hover:text-primary/80">+ Add new user</button>)}
                          </div>
                          {loadingOperatorManagedUsers ? (<p className="text-xs text-gray-500">Loading...</p>) : operatorManagedUsers.length === 0 ? (<p className="text-xs text-gray-500">No users assigned yet.</p>) : (
                            <ul className="space-y-1.5 max-h-52 overflow-y-auto rounded-lg border border-gray-100 bg-white p-2">
                              {operatorManagedUsers.map((u) => (
                                <li key={u.userID} className="flex items-center justify-between gap-2 text-sm">
                                  <span className="truncate text-gray-800" title={u.email}>{u.name || u.email}</span>
                                  {canManageOperations && (<button type="button" onClick={() => handleRemoveManagedUser(u.userID)} disabled={removingManagedUser === u.userID} className="text-red-500 hover:text-red-700 text-xs disabled:opacity-50 shrink-0">{removingManagedUser === u.userID ? '…' : 'Remove'}</button>)}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {(selectedJob.linkedInPhaseStarted || selectedJob.status === 'linkedin_in_progress' || selectedJob.status === 'linkedin_done') && (
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1.5">LinkedIn Member</label>
                      {isAdmin ? (
                        <select value={selectedJob.linkedInMemberEmail || ''} onChange={(e) => { const opt = roles.linkedInMembers?.find((l) => l.email === e.target.value); handleAssignLinkedInMember(opt?.email || '', opt?.name || ''); }} disabled={assigningLinkedInMember} className="w-full text-sm border-gray-200 rounded-lg focus:ring-primary focus:border-primary bg-white">
                          <option value="">Select LinkedIn Member...</option>
                          {(roles.linkedInMembers || []).map((l) => (<option key={l.email} value={l.email}>{l.name || l.email}</option>))}
                        </select>
                      ) : (<div className="p-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 font-medium">{selectedJob.linkedInMemberName || 'Unassigned'}</div>)}
                    </div>
                  )}
                </div>
              </CollapsibleSection>

              {/* Client Info Section */}
              <CollapsibleSection
                id="info"
                icon={Briefcase}
                title="Info"
                summary={selectedJob.dashboardManagerName || selectedJob.clientEmail}
              >
                <div className="space-y-4">
                  <div>
                    <span className="block text-xs font-semibold text-gray-700 mb-1">Dashboard Manager</span>
                    {isAdmin ? (
                      <select value={selectValueMatchingOption(selectedJob.dashboardManagerName, dashboardManagerSelectOptions)} onChange={async (e) => {
                        const val = e.target.value;
                        if (!selectedJob?._id || savingDashboardManager.has(selectedJob._id)) return;
                        setSavingDashboardManager((s) => new Set(s).add(selectedJob._id));
                        try {
                          const res = await fetch(`${API_BASE}/api/onboarding/jobs/${selectedJob._id}`, { method: 'PATCH', headers: AUTH_HEADERS(), body: JSON.stringify({ dashboardManagerName: val }) });
                          if (!res.ok) throw new Error('Failed');
                          const data = await res.json();
                          onUpdateJob(data.job);
                          toastUtils.success('Dashboard Manager updated');
                        } catch (err) { toastUtils.error(err.message || 'Failed'); }
                        finally { setSavingDashboardManager((s) => { const n = new Set(s); n.delete(selectedJob._id); return n; }); }
                      }} disabled={savingDashboardManager.has(selectedJob._id)} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white disabled:opacity-50">
                        <option value="">Not assigned</option>
                        {dashboardManagerSelectOptions.map((name) => (<option key={name} value={name}>{name}</option>))}
                      </select>
                    ) : (<span className="text-sm text-gray-900 font-medium">{selectedJob.dashboardManagerName || '—'}</span>)}
                  </div>
                  {canManageOperations && (
                    <div>
                      <span className="block text-xs font-semibold text-gray-700 mb-1">Also visible to (tagged managers)</span>
                      <div className="flex flex-wrap gap-2 items-center">
                        {(selectedJob.taggedDashboardManagerNames || []).filter((n) => n && n !== (selectedJob.dashboardManagerName || '').trim()).map((name) => (
                          <span key={name} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/10 text-primary text-xs font-medium">
                            {name}
                            <button type="button" onClick={async () => {
                              if (!selectedJob?._id || savingDashboardManager.has(selectedJob._id)) return;
                              const next = (selectedJob.taggedDashboardManagerNames || []).filter((n) => n !== name);
                              setSavingDashboardManager((s) => new Set(s).add(selectedJob._id));
                              try {
                                const res = await fetch(`${API_BASE}/api/onboarding/jobs/${selectedJob._id}`, { method: 'PATCH', headers: AUTH_HEADERS(), body: JSON.stringify({ taggedDashboardManagerNames: next }) });
                                if (!res.ok) throw new Error('Failed');
                                const data = await res.json();
                                onUpdateJob(data.job);
                                toastUtils.success('Manager removed from visibility');
                              } catch (err) { toastUtils.error(err.message || 'Failed'); }
                              finally { setSavingDashboardManager((s) => { const n = new Set(s); n.delete(selectedJob._id); return n; }); }
                            }} className="p-0.5 rounded hover:bg-primary/20 text-primary" aria-label={`Remove ${name}`}>×</button>
                          </span>
                        ))}
                        <select
                          value=""
                          onChange={async (e) => {
                            const addName = e.target.value;
                            if (!addName || !selectedJob?._id || savingDashboardManager.has(selectedJob._id)) return;
                            e.target.value = '';
                            const current = selectedJob.taggedDashboardManagerNames || [];
                            const primary = (selectedJob.dashboardManagerName || '').trim();
                            if (current.includes(addName) || addName === primary) return;
                            const next = [...current, addName];
                            setSavingDashboardManager((s) => new Set(s).add(selectedJob._id));
                            try {
                              const res = await fetch(`${API_BASE}/api/onboarding/jobs/${selectedJob._id}`, { method: 'PATCH', headers: AUTH_HEADERS(), body: JSON.stringify({ taggedDashboardManagerNames: next }) });
                              if (!res.ok) throw new Error('Failed');
                              const data = await res.json();
                              onUpdateJob(data.job);
                              toastUtils.success('Manager added to visibility');
                            } catch (err) { toastUtils.error(err.message || 'Failed'); }
                            finally { setSavingDashboardManager((s) => { const n = new Set(s); n.delete(selectedJob._id); return n; }); }
                          }}
                          className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-50"
                          disabled={savingDashboardManager.has(selectedJob._id)}
                        >
                          <option value="">+ Add visibility for...</option>
                          {dashboardManagerNames.filter((n) => n && n !== (selectedJob.dashboardManagerName || '').trim() && !(selectedJob.taggedDashboardManagerNames || []).includes(n)).map((name) => (
                            <option key={name} value={name}>{name}</option>
                          ))}
                        </select>
                      </div>
                      <p className="text-[10px] text-gray-500 mt-1">Tagged managers will also see this ticket in their view.</p>
                    </div>
                  )}
                  <div>
                    <span className="block text-xs font-semibold text-gray-700 mb-1">Assigned Email</span>
                    <span className="text-sm text-gray-900 font-mono bg-white px-2 py-1 rounded border border-gray-200">{selectedJob.clientEmail}</span>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="block text-xs font-semibold text-gray-700">Payment Email</span>
                      {!editingPaymentEmail && (
                        <button type="button" onClick={() => setEditingPaymentEmail(true)} className="text-[11px] text-orange-600 hover:text-orange-700 font-semibold flex items-center gap-1"><Pencil className="w-3 h-3" /> {paymentEmailValue ? 'Edit' : 'Add'}</button>
                      )}
                    </div>
                    {editingPaymentEmail ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="email"
                          value={paymentEmailDraft}
                          onChange={(e) => setPaymentEmailDraft(e.target.value)}
                          placeholder="payer@example.com"
                          className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-white"
                          autoFocus
                        />
                        <button type="button" disabled={savingPaymentEmail} onClick={savePaymentEmail} className="px-3 py-1.5 text-xs bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:opacity-50 font-semibold">
                          {savingPaymentEmail ? '…' : 'Save'}
                        </button>
                        <button type="button" disabled={savingPaymentEmail} onClick={() => { setPaymentEmailDraft(paymentEmailValue); setEditingPaymentEmail(false); }} className="px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-md border border-gray-200">Cancel</button>
                      </div>
                    ) : (
                      <div className="text-sm text-gray-900 font-mono bg-white px-2 py-1 rounded border border-gray-200">
                        {paymentEmailValue || <span className="text-gray-400 italic font-sans text-xs">not set — milestone emails will be skipped</span>}
                      </div>
                    )}
                    <p className="text-[10px] text-gray-500 mt-1">Recipient for the resume-ready, applications-started and per-plan count milestone emails (Ignite 250, Professional 250/500, Executive 350/700/1200).</p>
                  </div>
                </div>
              </CollapsibleSection>

              {/* Gmail Credentials */}
              <CollapsibleSection
                id="gmail"
                icon={Briefcase}
                title="Gmail Credentials"
                summary={selectedJob?.gmailCredentials?.username || 'Not set'}
              >
                <div className="space-y-4">
                  {selectedJob?.gmailCredentials && !isEditingGmailCredentials ? (
                    <>
                      <div><label className="block text-xs font-semibold text-gray-700 mb-1.5">Username</label><div className="w-full px-3 py-2.5 text-sm bg-white border border-gray-200 rounded-lg text-gray-800 font-mono">{selectedJob.gmailCredentials.username || '—'}</div></div>
                      <div><label className="block text-xs font-semibold text-gray-700 mb-1.5">Password</label><div className="w-full px-3 py-2.5 text-sm bg-white border border-gray-200 rounded-lg text-gray-800 font-mono">{selectedJob.gmailCredentials.password || '—'}</div></div>
                      <button type="button" onClick={() => { setIsEditingGmailCredentials(true); setGmailUsername(selectedJob.gmailCredentials?.username || ''); setGmailPassword(selectedJob.gmailCredentials?.password || ''); }} className="w-full px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm font-medium flex items-center justify-center gap-2"><Pencil className="w-3.5 h-3.5" /> Change Credentials</button>
                    </>
                  ) : (
                    <>
                      <div><label className="block text-xs font-semibold text-gray-700 mb-1.5">Username</label><input type="text" value={gmailUsername} onChange={(e) => setGmailUsername(e.target.value)} placeholder="Enter Gmail username" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white" /></div>
                      <div><label className="block text-xs font-semibold text-gray-700 mb-1.5">Password</label><input type="text" value={gmailPassword} onChange={(e) => setGmailPassword(e.target.value)} placeholder="Enter Gmail password" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white" /></div>
                      <div className="flex gap-2">
                        <button type="button" onClick={handleSaveGmailCredentials} disabled={savingGmailCredentials} className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 text-sm font-medium">{savingGmailCredentials ? 'Saving...' : 'Save Credentials'}</button>
                        {selectedJob?.gmailCredentials && (<button type="button" onClick={() => { setIsEditingGmailCredentials(false); setGmailUsername(selectedJob.gmailCredentials?.username || ''); setGmailPassword(selectedJob.gmailCredentials?.password || ''); }} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-sm font-medium">Cancel</button>)}
                      </div>
                    </>
                  )}
                  {(selectedJob.gmailCredentialsHistory || []).length > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <button type="button" onClick={() => setShowGmailCredentialsHistory(!showGmailCredentialsHistory)} className="w-full flex items-center justify-between text-xs font-semibold text-gray-700 hover:text-gray-900 transition-colors">
                        <span>Credentials History ({(selectedJob.gmailCredentialsHistory || []).length})</span>
                        <ChevronRight className={`w-4 h-4 transition-transform ${showGmailCredentialsHistory ? 'rotate-90' : ''}`} />
                      </button>
                      {showGmailCredentialsHistory && (
                        <div className="mt-3 space-y-2 max-h-80 overflow-y-auto">
                          {(selectedJob.gmailCredentialsHistory || []).slice().reverse().map((h, idx) => (
                            <div key={idx} className="bg-white rounded-lg p-3 border border-gray-200">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] text-gray-500">Updated by: {h.updatedBy || 'Unknown'}</span>
                                <span className="text-[10px] text-gray-500">{new Date(h.updatedAt).toLocaleDateString()} {new Date(h.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                              </div>
                              <div className="space-y-1.5">
                                <div><span className="text-[10px] text-gray-500 font-medium">Username:</span><div className="text-xs text-gray-700 font-mono bg-gray-50 px-2 py-1 rounded mt-0.5">{h.username || '—'}</div></div>
                                <div><span className="text-[10px] text-gray-500 font-medium">Password:</span><div className="text-xs text-gray-700 font-mono bg-gray-50 px-2 py-1 rounded mt-0.5">{h.password || '—'}</div></div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </CollapsibleSection>

              {/* Job Analysis */}
              {(selectedJob.status === 'applications_in_progress' || selectedJob.status === 'completed') && (
                <CollapsibleSection
                  id="analysis"
                  icon={Briefcase}
                  title="Job Analysis"
                  summary={cardJobAnalysis ? `${cardJobAnalysis.applied ?? 0} applied · ${cardJobAnalysis.interviewing ?? 0} interview` : 'No data'}
                >
                  <div className="mb-4">
                    <label className="block text-xs font-semibold text-gray-700 mb-2">Filter by Date:</label>
                    <div className="flex items-center gap-2">
                      <input type="date" value={cardAnalysisDate} onChange={(e) => { setCardAnalysisDate(e.target.value); setAppliedOnDateCount(null); }} className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white" />
                      {cardAnalysisDate && (<><button type="button" onClick={findAppliedOnDate} disabled={fetchingAppliedOnDate} className="px-3 py-2 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium">{fetchingAppliedOnDate ? 'Loading...' : 'Find Applied'}</button><button type="button" onClick={() => { setCardAnalysisDate(''); setAppliedOnDateCount(null); }} className="px-3 py-2 text-xs text-gray-600 hover:bg-gray-100 rounded-lg border border-gray-200">Clear</button></>)}
                    </div>
                    {cardAnalysisDate && appliedOnDateCount !== null && (<div className="mt-2 text-xs text-gray-600"><span className="font-semibold text-indigo-700">Applied on {convertToDMY(cardAnalysisDate)}: {appliedOnDateCount} job(s)</span></div>)}
                  </div>
                  {cardJobAnalysis ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-3 gap-2">
                        {[['Saved', cardJobAnalysis.saved, 'text-gray-700'], ['Applied', cardJobAnalysis.applied, 'text-green-600'], ['Interview', cardJobAnalysis.interviewing, 'text-yellow-600'], ['Offer', cardJobAnalysis.offer, 'text-purple-600'], ['Rejected', cardJobAnalysis.rejected, 'text-red-600'], ['Removed', cardJobAnalysis.removed, 'text-gray-600']].map(([label, val, color]) => (
                          <div key={label} className="text-center bg-white rounded-lg p-2 border border-gray-200">
                            <div className="text-[10px] text-gray-500 font-medium mb-1">{label}</div>
                            <div className={`text-sm font-semibold ${color}`}>{val || 0}</div>
                          </div>
                        ))}
                      </div>
                      {appliedOnDateCount !== null && cardAnalysisDate && (
                        <div className="bg-indigo-50 rounded-lg p-3 border border-indigo-200">
                          <div className="text-[10px] text-indigo-600 font-medium mb-1">Applied on {convertToDMY(cardAnalysisDate)}</div>
                          <div className="text-lg font-bold text-indigo-700">{appliedOnDateCount} job(s)</div>
                        </div>
                      )}
                      {cardJobAnalysis.lastAppliedOperatorName && (
                        <div className="bg-white rounded-lg p-3 border border-gray-200">
                          <div className="text-[10px] text-gray-500 font-medium mb-1">Last applied by</div>
                          <div className="text-sm font-semibold text-gray-700">{cardJobAnalysis.lastAppliedOperatorName.charAt(0).toUpperCase() + cardJobAnalysis.lastAppliedOperatorName.slice(1).toLowerCase()}</div>
                        </div>
                      )}
                    </div>
                  ) : (<div className="text-sm text-gray-500 py-4 text-center">No data available</div>)}
                </CollapsibleSection>
              )}

              {/* Milestone Timeline — visible all stages.
                  Rendered even when the schedule is empty. It used to vanish on
                  an empty array, which made "this client has no tracking record"
                  and "milestones are broken" look identical: a missing panel
                  with nothing to act on. Now it names the cause and, for admins,
                  offers the repair. */}
              {selectedJob?.clientEmail && !emailLogsLoading && !emailLogsError && (
                <CollapsibleSection
                  id="milestones"
                  icon={History}
                  title="Milestone Timeline"
                  summary={milestoneSchedule.length > 0
                    ? `${milestoneSchedule.filter((m) => m.sent).length}/${milestoneSchedule.length} sent`
                    : (MILESTONE_BLOCK_COPY[milestoneBlockReason]?.summary || 'Not set up')}
                >
                  {milestoneSchedule.length === 0 ? (() => {
                    const copy = MILESTONE_BLOCK_COPY[milestoneBlockReason] || {
                      summary: 'Not set up',
                      title: 'No milestone schedule for this client',
                      detail: 'Nothing to show yet.'
                    };
                    return (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                        <div className="flex items-start gap-2.5">
                          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-amber-900">{copy.title}</div>
                            <p className="text-[11px] text-amber-800 leading-relaxed mt-1">{copy.detail}</p>
                            {selectedJob?.planType && (
                              <p className="text-[11px] text-amber-800 leading-relaxed mt-2">
                                The ticket says <strong>{selectedJob.planType}</strong>. Creating the record below copies that plan across.
                              </p>
                            )}
                          </div>
                        </div>
                        {milestoneBlockReason === 'no_tracking_record' && isAdmin && (
                          <div className="mt-3 flex justify-end">
                            <button
                              type="button"
                              onClick={createTrackingRecord}
                              disabled={creatingTrackingRecord}
                              title="Create the dashboardtrackings record for this client using the ticket's plan"
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-full border border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {creatingTrackingRecord ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                              {creatingTrackingRecord ? 'Creating…' : 'Create tracking record'}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })() : (
                  <>
                  <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      {milestonePlanType && (
                        <span
                          className="ml-1 text-[10px] text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full uppercase tracking-wider"
                          title={(milestoneAddonApps > 0 || milestoneReferralApps > 0)
                            ? `Base ${milestoneBaseCap}${milestoneAddonApps > 0 ? ` + addon ${milestoneAddonApps}` : ''}${milestoneReferralApps > 0 ? ` + referral ${milestoneReferralApps}` : ''} = ${milestonePlanCap}`
                            : `Plan cap ${milestonePlanCap}`}
                        >
                          {milestonePlanType}{milestonePlanCap ? ` · ${milestonePlanCap}` : ''}
                        </span>
                      )}
                      {milestoneAddonApps > 0 && (
                        <span className="text-[10px] text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full normal-case">+{milestoneAddonApps} addon</span>
                      )}
                      {milestoneReferralApps > 0 && (
                        <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full normal-case">+{milestoneReferralApps} referral</span>
                      )}
                      {/* Payment Email shown inline so operators see the milestone recipient at a glance */}
                      {paymentEmailValue ? (
                        <span className="text-[10px] text-gray-600 bg-white border border-gray-200 px-1.5 py-0.5 rounded-full normal-case lowercase" title="Milestone emails are sent to this Payment Email">
                          ✉ {paymentEmailValue}
                        </span>
                      ) : (
                        <span className="text-[10px] text-rose-600 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-full normal-case" title="No Payment Email set — milestone emails will be skipped">
                          ✉ no payment email
                        </span>
                      )}
                    </div>
                    {isAdmin && milestoneSchedule.some((m) => !m.sent) && (() => {
                      const noPaymentEmail = !paymentEmailValue || !paymentEmailValue.trim();
                      return (
                        <button
                          type="button"
                          onClick={sendPendingMilestone}
                          disabled={sendingPendingMilestone || noPaymentEmail}
                          title={noPaymentEmail ? 'Payment Email is not set — add one in the INFO panel first' : 'Send the highest pending milestone email this client qualifies for now'}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-full border disabled:opacity-50 disabled:cursor-not-allowed ${noPaymentEmail ? 'border-gray-300 bg-gray-50 text-gray-400' : 'border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100'}`}
                        >
                          {sendingPendingMilestone ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                          {noPaymentEmail ? 'Payment Email missing' : 'Fire pending email'}
                        </button>
                      );
                    })()}
                  </div>
                  <ol className="relative border-l-2 border-orange-200 ml-2 space-y-4">
                    {milestoneSchedule.map((m) => {
                      const labelByType = {
                        started: 'Applications Started + Resume Created',
                        count_milestone: `${m.threshold} applications submitted`,
                        completed: 'Applications Completed'
                      };
                      const label = m.type === 'count_milestone' ? labelByType.count_milestone : labelByType[m.type];
                      const sent = m.sent;
                      const dotColor = sent ? 'bg-green-500 ring-green-100' : 'bg-gray-300 ring-gray-100';
                      return (
                        <li key={m.key} className="ml-4 pl-2">
                          <span className={`absolute -left-[7px] flex items-center justify-center w-3 h-3 rounded-full ring-4 ${dotColor}`} />
                          <div className="bg-white border border-gray-200 rounded-lg p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-xs font-bold text-gray-900">{label}</div>
                                <div className="text-[11px] text-gray-500 mt-0.5">
                                  {m.type === 'started' ? `Triggers at ${m.threshold}+ jobs in dashboard (after resume + AppIP)` :
                                    m.type === 'completed' ? `Triggers when count reaches ${m.threshold}` :
                                    `Triggers when count reaches ${m.threshold}`}
                                </div>
                              </div>
                              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap ${sent ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                {sent ? 'Sent' : 'Pending'}
                              </span>
                            </div>
                            {sent && m.at && (
                              <div className="text-[10px] text-gray-500 mt-1.5">
                                {new Date(m.at).toLocaleString()}{m.count ? ` · count ${m.count}` : ''}
                              </div>
                            )}
                            {sent && isAdmin && (() => {
                              const noPaymentEmail = !paymentEmailValue || !paymentEmailValue.trim();
                              const resending = resendingLogId === `ms_${m.key}`;
                              return (
                                <div className="mt-2 flex items-center justify-end">
                                  <button
                                    type="button"
                                    onClick={() => resendMilestoneEmail({ milestoneKey: m.key, type: m.type, loadingId: `ms_${m.key}` })}
                                    disabled={resending || noPaymentEmail}
                                    title={noPaymentEmail ? 'Payment Email is not set — add one in the INFO panel first' : 'Re-send this milestone email now'}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-full border border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    {resending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                    {resending ? 'Sending…' : 'Send again'}
                                  </button>
                                </div>
                              );
                            })()}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                  {milestoneDeliveryBlockers.length > 0 && (
                    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                        <div className="text-[11px] text-amber-800 leading-relaxed space-y-1">
                          {milestoneDeliveryBlockers.map((b) => (
                            <div key={b}>{MILESTONE_DELIVERY_BLOCKER_COPY[b] || b}</div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  </>
                  )}
                </CollapsibleSection>
              )}

              {/* Onboarding Emails — base résumé / cover letter / LinkedIn.
                  Separate from the Milestone Timeline above: these fire off the
                  client's FIRST application (dashboard backend), the milestones
                  fire off application COUNT (this app's backend). */}
              {(onboardingMailLoading || onboardingMailError || onboardingMail) && (
                <CollapsibleSection
                  id="onboardingMail"
                  icon={Mail}
                  title="Onboarding Emails"
                  summary={
                    onboardingMailLoading
                      ? 'Loading…'
                      : onboardingMailError
                        ? 'Unavailable'
                        : (() => {
                            // Collapsed summary has to answer "did they all go
                            // out?" without expanding — so name the problem,
                            // don't just count.
                            // Out-of-plan rows (inPlan === false) are history,
                            // not outstanding work — counting them makes a
                            // fully-delivered client read as "1/2 sent".
                            const all = (onboardingMail?.steps || []).filter((s) => s.inPlan !== false);
                            const sent = all.filter((s) => s.sent).length;
                            const failed = all.filter((s) => s.state === 'failed').length;
                            const base = `${sent}/${all.length} sent`;
                            if (failed) return `${base} · ${failed} failed`;
                            if (sent < all.length && onboardingMail?.status === 'skipped') return `${base} · never scheduled`;
                            if (sent < all.length) return `${base} · ${all.length - sent} pending`;
                            return base;
                          })()
                  }
                >
                  {onboardingMailLoading ? (
                    <div className="text-sm text-gray-500 py-3 text-center flex items-center justify-center gap-2">
                      <Loader2 className="w-3 h-3 animate-spin" /> Loading…
                    </div>
                  ) : onboardingMailError ? (
                    <div className="text-xs text-red-600 py-2 flex items-center justify-between gap-2">
                      <span>Could not load onboarding email status: {onboardingMailError}</span>
                      <button
                        type="button"
                        onClick={() => fetchOnboardingMail(selectedJob.clientEmail)}
                        className="text-[10px] text-gray-500 hover:text-orange-600 font-medium whitespace-nowrap"
                      >
                        Retry
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          {onboardingMail.planType ? (
                            <span
                              className="text-[10px] text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full uppercase tracking-wider"
                              title="Executive / Prime get all three; Professional / Ignite skip the cover letter"
                            >
                              {onboardingMail.planType}
                            </span>
                          ) : (
                            <span className="text-[10px] text-rose-600 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-full" title="No planType on the tracking record — the sequence falls back to résumé + LinkedIn">
                              no plan set
                            </span>
                          )}
                          {onboardingMail.paymentEmail ? (
                            <span className="text-[10px] text-gray-600 bg-white border border-gray-200 px-1.5 py-0.5 rounded-full lowercase" title="Onboarding emails are sent to this Payment Email">
                              ✉ {onboardingMail.paymentEmail}
                            </span>
                          ) : (
                            <span className="text-[10px] text-rose-600 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-full" title="No Payment Email — nothing can be sent">
                              ✉ no payment email
                            </span>
                          )}
                          <span className="text-[10px] text-gray-600 bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded-full" title="Applied jobs on the dashboard — the sequence starts at the first one">
                            {onboardingMail.appliedCount} applied
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => fetchOnboardingMail(selectedJob.clientEmail)}
                          className="text-[10px] text-gray-500 hover:text-orange-600 font-medium"
                        >
                          Refresh
                        </button>
                      </div>

                      {/* Why nothing is going out — stated once, above the rows. */}
                      {!onboardingMail.delivery?.canSend && (
                        <div className="mb-3 flex items-start gap-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                          <span>
                            {onboardingMail.delivery?.paused
                              ? 'Onboarding emails are paused server-side and nothing will send, by hand or on schedule.'
                              : !onboardingMail.delivery?.smtpConfigured
                                ? 'SMTP is not configured on the dashboard backend (SMTP_USER / SMTP_PASS).'
                                : !onboardingMail.paymentEmail
                                  ? 'No Payment Email on file — set one in the INFO panel first.'
                                  : 'Sending is unavailable right now.'}
                          </span>
                        </div>
                      )}
                      {onboardingMail.delivery?.canSend && !onboardingMail.delivery?.workerEnabled && (
                        <div className="mb-3 flex items-start gap-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                          <span>
                            The automatic sender is {onboardingMail.delivery.workerReason} — nothing fires on its own, but you can still send each email by hand below.
                          </span>
                        </div>
                      )}
                      {onboardingMail.notScheduledReason && (
                        <div className="mb-3 text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                          Not scheduled: {onboardingMail.notScheduledReason}
                        </div>
                      )}

                      <ol className="relative border-l-2 border-orange-200 ml-2 space-y-4">
                        {(onboardingMail.steps || []).map((s) => {
                          // inPlan === false means the client's plan does not
                          // include this email (a Prime client and the LinkedIn
                          // optimisation, say). Older backends omit the field,
                          // so only an explicit false counts.
                          const outOfPlan = s.inPlan === false;
                          const dotColor = outOfPlan
                            ? 'bg-gray-300 ring-gray-100'
                            : s.sent
                              ? 'bg-green-500 ring-green-100'
                              : s.state === 'failed'
                                ? 'bg-rose-500 ring-rose-100'
                                : 'bg-gray-300 ring-gray-100';
                          const badge = outOfPlan
                            ? 'bg-gray-100 text-gray-500'
                            : s.sent
                              ? 'bg-green-100 text-green-700'
                              : s.state === 'failed'
                                ? 'bg-rose-100 text-rose-700'
                                : s.state === 'not-scheduled'
                                  ? 'bg-gray-100 text-gray-500'
                                  : 'bg-amber-100 text-amber-700';
                          const badgeText = outOfPlan
                            ? (s.sent ? 'Sent · not in plan' : 'Not in plan')
                            : s.sent
                              ? 'Sent'
                              : s.state === 'failed'
                                ? 'Failed'
                                : s.state === 'not-scheduled'
                                  ? 'Not scheduled'
                                  : 'Pending';
                          const busy = sendingOnboardingStep === s.key;
                          // Never offer to send an email the plan doesn't cover
                          // — that button is how an out-of-plan email goes out
                          // by hand after the automatic sender stopped it.
                          const canSend = isAdmin && onboardingMail.delivery?.canSend && !outOfPlan;
                          return (
                            <li key={s.key} className="ml-4 pl-2">
                              <span className={`absolute -left-[7px] flex items-center justify-center w-3 h-3 rounded-full ring-4 ${dotColor}`} />
                              <div className="bg-white border border-gray-200 rounded-lg p-3">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="text-xs font-bold text-gray-900">{s.label}</div>
                                    {(outOfPlan || !s.sent) && s.reason && (
                                      <div className={`text-[11px] mt-0.5 ${outOfPlan ? 'text-amber-700' : 'text-gray-500'}`}>
                                        {s.reason}
                                        {outOfPlan && onboardingMail.planType ? ` (${onboardingMail.planType})` : ''}
                                      </div>
                                    )}
                                    {!s.sent && !s.reason && s.sendAt && (
                                      <div className="text-[11px] text-gray-500 mt-0.5">
                                        Due {new Date(s.sendAt).toLocaleString()}
                                      </div>
                                    )}
                                  </div>
                                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap ${badge}`}>
                                    {badgeText}
                                  </span>
                                </div>
                                {s.sent && s.sentAt && (
                                  <div className="text-[10px] text-gray-500 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <span>
                                      {new Date(s.sentAt).toLocaleString()}
                                      {s.attempts > 1 ? ` · ${s.attempts} attempts` : ''}
                                    </span>
                                  </div>
                                )}
                                {!s.sent && s.error && (
                                  <div className="text-[10px] text-rose-600 mt-1.5 break-words">
                                    Last error: {s.error}
                                  </div>
                                )}
                                {canSend && (
                                  <div className="mt-2 flex items-center justify-end">
                                    <button
                                      type="button"
                                      onClick={() => sendOnboardingStep(s.key, { force: s.sent })}
                                      disabled={busy}
                                      title={s.sent
                                        ? 'Already delivered — send this email again'
                                        : 'Send this email to the client now, ignoring the schedule'}
                                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-full border border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                      {busy ? 'Sending…' : s.sent ? 'Send again' : 'Send now'}
                                    </button>
                                  </div>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    </>
                  )}
                </CollapsibleSection>
              )}

              {/* Email Activity (milestone notifications + move history) */}
              {(selectedJob.status === 'applications_in_progress' || selectedJob.status === 'completed') && (
                <CollapsibleSection
                  id="emails"
                  icon={Mail}
                  title="Email Activity"
                  summary={emailLogsLoading ? 'Loading…' : `${emailLogs.length} sent`}
                >
                  <div className="flex items-center justify-end mb-3">
                    <button type="button" onClick={() => fetchEmailLogs(selectedJob.clientEmail, { force: true })} className="text-[10px] text-gray-500 hover:text-orange-600 font-medium">Refresh</button>
                  </div>

                  {emailLogsLoading ? (
                    <div className="text-sm text-gray-500 py-3 text-center flex items-center justify-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</div>
                  ) : emailLogsError ? (
                    <div className="text-xs text-red-600 py-2">{emailLogsError}</div>
                  ) : emailLogs.length === 0 ? (
                    <div className="text-xs text-gray-500 py-3 text-center">No emails sent yet.</div>
                  ) : (
                    <div className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
                      {emailLogs.map((l) => {
                        const typeLabel = ({
                          started: 'Applications started + resume',
                          count_250: '250 applications',
                          count_350: '350 applications',
                          count_700: '700 applications',
                          completed: 'Applications completed',
                          // legacy
                          resume_ready: 'Resume ready',
                          apps_started: 'Applications started',
                          pct30: '30% milestone',
                          pct50: '50% milestone',
                          pct75: '75% milestone',
                          pct100: '100% milestone'
                        })[l.type] || l.type;
                        const ok = l.status === 'success';
                        const canResend = !ok && isAdmin && l.category === 'milestone';
                        const noPaymentEmail = !paymentEmailValue || !paymentEmailValue.trim();
                        const resending = resendingLogId === l._id;
                        return (
                          <div key={l._id} className={`rounded-lg p-3 border ${ok ? 'bg-white border-gray-200' : 'bg-red-50/60 border-red-200'}`}>
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${ok ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'}`}>{typeLabel}</span>
                                <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                  {ok ? <CheckCircle className="w-2.5 h-2.5" /> : <AlertTriangle className="w-2.5 h-2.5" />}
                                  {ok ? 'Sent' : 'Failed'}
                                </span>
                              </div>
                              <span className="text-[10px] text-gray-500 whitespace-nowrap">{new Date(l.createdAt).toLocaleString()}</span>
                            </div>
                            <div className="text-xs text-gray-700 truncate" title={l.subject}>{l.subject}</div>
                            <div className="text-[11px] text-gray-500 mt-1">
                              to {l.paymentEmail}{l.fromEmail ? ` · from ${l.fromEmail}` : ''}{l.snapshot?.planCap ? ` · ${l.snapshot.currentCount}/${l.snapshot.planCap} (${Math.round(l.snapshot.percent || 0)}%)` : ''}
                            </div>
                            {!ok && l.errorMessage && (
                              <div className="text-[11px] text-red-700 bg-red-100/70 border border-red-200 rounded-md px-2 py-1 mt-1.5 break-words">
                                <span className="font-semibold">Error:</span> {l.errorMessage}
                              </div>
                            )}
                            {canResend && (
                              <div className="mt-2 flex items-center justify-end">
                                <button
                                  type="button"
                                  onClick={() => resendMilestoneEmail({ milestoneKey: l.type, type: l.meta?.milestoneType, loadingId: l._id })}
                                  disabled={resending || noPaymentEmail}
                                  title={noPaymentEmail ? 'Payment Email is not set — add one in the INFO panel first' : 'Resend this milestone email now'}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-full border border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  {resending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                  {resending ? 'Sending…' : 'Send again'}
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {Array.isArray(selectedJob?.moveHistory) && selectedJob.moveHistory.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-gray-200">
                      <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-2 flex items-center gap-1"><History className="w-3 h-3" /> Move history</div>
                      <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                        {selectedJob.moveHistory.slice().reverse().map((m, i) => {
                          const who = m.movedByName || m.movedBy || 'unknown';
                          const when = m.movedAt ? new Date(m.movedAt).toLocaleString() : '';
                          const milestoneLabel = ({
                            started: 'Applications started + resume',
                            count_250: '250 applications',
                            count_350: '350 applications',
                            count_700: '700 applications',
                            completed: 'Applications completed',
                            // legacy
                            resume_ready: 'Resume ready',
                            apps_started: 'Applications started',
                            pct30: '30% milestone',
                            pct50: '50% milestone',
                            pct75: '75% milestone',
                            pct100: '100% milestone'
                          })[m.meta?.type] || m.meta?.type;
                          let line;
                          switch (m.actionType) {
                            case 'payment_email_set':
                              line = <span><strong>Payment email set</strong> → <span className="font-mono text-[10px]">{m.meta?.to || '—'}</span> · by {who}</span>;
                              break;
                            case 'payment_email_updated':
                              line = <span><strong>Payment email updated</strong> · <span className="font-mono text-[10px]">{m.meta?.from || '—'}</span> → <span className="font-mono text-[10px]">{m.meta?.to || '—'}</span> · by {who}</span>;
                              break;
                            case 'payment_email_cleared':
                              line = <span><strong>Payment email cleared</strong> · was <span className="font-mono text-[10px]">{m.meta?.from || '—'}</span> · by {who}</span>;
                              break;
                            case 'milestone_email_sent':
                              line = (
                                <span>
                                  📧 <strong>{milestoneLabel}</strong> email sent → <span className="font-mono text-[10px]">{m.meta?.paymentEmail || '—'}</span>
                                  {typeof m.meta?.currentCount === 'number' && m.meta?.planCap ? <span className="text-gray-500"> · {m.meta.currentCount}/{m.meta.planCap} ({m.meta.percent || 0}%)</span> : null}
                                </span>
                              );
                              break;
                            case 'milestone_email_skipped':
                              line = (
                                <span>
                                  ⚠️ <strong>{milestoneLabel}</strong> skipped
                                  {m.meta?.reason ? <span className="text-gray-500"> · {m.meta.reason}</span> : null}
                                </span>
                              );
                              break;
                            case 'client_paused':
                              line = <span><strong>Client paused</strong> · by {who}</span>;
                              break;
                            case 'client_unpaused':
                              line = <span><strong>Client unpaused</strong> (entered Apps In Progress) · by {who}</span>;
                              break;
                            case 'assignment':
                              line = <span><strong>{m.targetRole || 'Assignment'}</strong>{m.targetName ? ` → ${m.targetName}` : ''} · by {who}</span>;
                              break;
                            case 'comment_resolved':
                              line = <span><strong>Comment resolved</strong> · by {who}</span>;
                              break;
                            default:
                              line = <span>{m.fromStatus || '—'} → <strong>{m.toStatus || '—'}</strong> · by {who}</span>;
                          }
                          return (
                            <div key={i} className="text-[11px] text-gray-600 flex items-start justify-between gap-2 bg-white px-2 py-1.5 rounded border border-gray-100">
                              <span className="flex-1 min-w-0">{line}</span>
                              <span className="text-gray-400 whitespace-nowrap">{when}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </CollapsibleSection>
              )}
            </div>

            {/* Client Profile */}
            <ClientProfileSection profileData={clientProfileData} loading={profileLoading} error={profileError} />

            {/* Attachments */}
            <div className="mb-6">
              <CollapsibleSection
                id="attachments"
                icon={Paperclip}
                title="Attachments"
                badge={(selectedJob.attachments || []).length > 0 ? (
                  <span className="text-xs text-gray-500 bg-slate-200 px-2 py-0.5 rounded-full flex-shrink-0">{(selectedJob.attachments || []).length}</span>
                ) : null}
                summary={(selectedJob.attachments || []).length > 0 ? undefined : 'None yet'}
              >
                <>
                  <div className="mb-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
                    <p className="text-xs font-semibold text-slate-600 mb-2">By plan</p>
                    <ul className="space-y-1.5 text-sm">
                      {(() => {
                        const planLower = (selectedJob?.planType || '').toLowerCase();
                        const isExecutive = planLower === 'executive' || planLower.includes('executive');
                        const types = isExecutive ? ['Resume', 'Cover letter', 'Portfolio (link)'] : (planLower === 'professional' ? ['Resume', 'Cover letter'] : ['Resume']);
                        const names = (selectedJob?.attachments || []).map((a) => (a.name || '').trim());
                        const has = (label) => names.some((n) => n.toLowerCase() === label.toLowerCase());
                        return types.map((label) => (
                          <li key={label}>
                            <button type="button" onClick={() => { setAttachmentNameInput(label); setAttachmentFilePending(null); setShowAddAttachmentModal(true); }} className="flex items-center gap-2 w-full text-left rounded px-1 py-0.5 -mx-1 hover:bg-slate-100/80 transition-colors">
                              {has(label) ? <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" /> : <span className="w-4 h-4 rounded-full border-2 border-slate-300 flex-shrink-0" />}
                              <span className={has(label) ? 'text-slate-800 font-medium' : 'text-slate-500'}>{label}</span>
                            </button>
                          </li>
                        ));
                      })()}
                    </ul>
                  </div>
                  <div className="space-y-1 mb-3">
                    {(selectedJob.attachments || []).length === 0 && <p className="text-sm text-gray-500 py-4">No attachments yet</p>}
                    {(selectedJob.attachments || []).map((a, i) => {
                      const isExpanded = expandedAttachmentIndices.has(i);
                      const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(a.filename || a.url);
                      const isPdf = /\.pdf$/i.test(a.filename || a.url);
                      const isDoc = /\.(doc|docx)$/i.test(a.filename || a.url);
                      const displayName = (a.name && a.name.trim()) || a.filename || 'Attachment';
                      return (
                        <div key={i} className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                          <div className="w-full flex items-center gap-2 px-4 py-2.5">
                            <button type="button" onClick={(e) => { e.stopPropagation(); setExpandedAttachmentIndices((prev) => { const next = new Set(prev); if (next.has(i)) next.delete(i); else next.add(i); return next; }); }} className="p-0.5 text-gray-500 hover:text-gray-700 flex-shrink-0">
                              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                            <button type="button" onClick={() => { setEditingAttachmentIndex(i); setEditingAttachmentName((a.name && String(a.name).trim()) || a.filename || ''); setAttachmentReplaceFilePending(null); }} className="flex-1 flex items-center gap-2 text-left hover:bg-gray-50/80 transition-colors rounded py-0.5 -my-0.5 px-1 -mx-1 min-w-0">
                              <Paperclip className="w-4 h-4 text-gray-400 flex-shrink-0" /><span className="text-sm font-medium text-gray-900 truncate flex-1">{displayName}</span>
                            </button>
                          </div>
                          {isExpanded && (
                            <div className="border-t border-gray-100 p-3 bg-gray-50/50">
                              {isImage ? (
                                <a href={a.url} target="_blank" rel="noopener noreferrer" className="block"><img src={a.url} alt={displayName} className="max-h-48 rounded-lg object-contain" /><p className="text-xs text-gray-500 mt-1">Click to view full size</p></a>
                              ) : (
                                <a href={a.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-2 rounded-lg hover:bg-white transition-colors">
                                  <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center border border-gray-100 flex-shrink-0">
                                    <FileText className={`w-5 h-5 ${isPdf ? 'text-red-500' : isDoc ? 'text-blue-500' : 'text-gray-400'}`} />
                                  </div>
                                  <div className="min-w-0 flex-1"><p className="text-sm font-medium text-gray-900 truncate">{a.filename}</p><p className="text-xs text-gray-500">{isPdf ? 'PDF' : isDoc ? 'Word' : 'Click to view'}</p></div>
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <button type="button" onClick={() => { setAttachmentNameInput(getNextDefaultAttachmentName(selectedJob)); setAttachmentFilePending(null); setShowAddAttachmentModal(true); }} disabled={uploadingAttachment} className="inline-flex items-center gap-2 px-4 py-2 bg-gray-50 text-gray-700 rounded-lg border border-gray-200 hover:bg-white hover:border-gray-300 transition-all cursor-pointer text-sm font-medium shadow-sm disabled:opacity-60">
                    {uploadingAttachment ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    {uploadingAttachment ? 'Uploading...' : 'Add Attachment'}
                  </button>
                </>
              </CollapsibleSection>
            </div>

            {/* Move History */}
            <CollapsibleSection
              id="history"
              icon={History}
              title="Move History"
              badge={(selectedJob.moveHistory || []).length > 0 ? (
                <span className="text-xs text-gray-500 bg-slate-200 px-2 py-0.5 rounded-full flex-shrink-0">{(selectedJob.moveHistory || []).length}</span>
              ) : null}
            >
                <div className="space-y-3 max-h-[26rem] overflow-y-auto">
                  {(selectedJob.moveHistory || []).length === 0 ? (<p className="text-xs text-gray-400 italic py-2 text-center">No move history</p>) : (
                    (selectedJob.moveHistory || []).map((move, i) => {
                      const actionType = move.actionType || 'status_change';
                      let label = '';
                      if (actionType === 'assignment') { const roleLabel = move.targetRole === 'dashboard_manager' ? 'Dashboard Manager' : move.targetRole === 'linkedin_member' ? 'LinkedIn member' : move.targetRole || 'assignee'; label = `${roleLabel} assigned: ${move.targetName || '—'}`; }
                      else if (actionType === 'client_paused') label = 'Client paused';
                      else if (actionType === 'client_unpaused') label = 'Client unpaused';
                      else if (actionType === 'client_phase_set') label = 'Status set to New (onboarding phase)';
                      else if (actionType === 'comment_resolved') label = 'Tagged comment resolved';
                      else { label = move.fromStatus === 'created' ? 'Job card created' : `Moved from ${STATUS_LABELS[move.fromStatus] || move.fromStatus}` + (move.toStatus ? ` → ${STATUS_LABELS[move.toStatus] || move.toStatus}` : ''); }
                      const byEmail = (move.movedBy || '').trim().toLowerCase();
                      const byName = (move.movedByName || '').trim();
                      const isSystem = !byEmail || byEmail === 'system' || byEmail === 'unknown';
                      const whoText = isSystem ? 'System' : byName && byName !== byEmail ? `${byName} (${move.movedBy})` : move.movedBy;
                      const resolvedList = Array.isArray(move.resolvedEmails) ? move.resolvedEmails.filter(Boolean).join(', ') : '';
                      const metaLine = actionType === 'comment_resolved'
                        ? (resolvedList ? `Resolved by ${resolvedList}` : `Resolved (${whoText})`)
                        : `by ${whoText}`;
                      const actorNote = actionType === 'comment_resolved' && resolvedList && !isSystem
                        ? ` · action by ${whoText}`
                        : '';
                      const snippet = (move.commentSnippet || '').trim();
                      return (
                        <div key={i} className="flex gap-3">
                          <div className="flex flex-col items-center pt-1"><div className={`w-2 h-2 rounded-full ${actionType === 'comment_resolved' ? 'bg-emerald-500' : 'bg-primary'}`}></div>{i < (selectedJob.moveHistory || []).length - 1 && (<div className="w-px h-full bg-gray-200 mt-1 min-h-[20px]"></div>)}</div>
                          <div className="flex-1 pb-2">
                            <p className="text-xs text-gray-700"><span className="font-semibold text-gray-900">{label}</span></p>
                            {actionType === 'comment_resolved' && snippet ? (
                              <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-2" title={snippet}>{snippet.length >= 120 ? `${snippet}…` : snippet}</p>
                            ) : null}
                            <p className="text-[10px] text-gray-400 mt-0.5">{metaLine}{actorNote} • {new Date(move.movedAt).toLocaleString()}</p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
            </CollapsibleSection>
            </div>
            </Motion.div>
            </React.Fragment>
          )}
          </AnimatePresence>

          {/* Conversation — full width */}
          <CommentsSection
            selectedJob={selectedJob}
            user={user}
            roles={roles}
            loadingJobDetails={loadingJobDetails}
            loadingComments={loadingComments}
            onUpdateJob={onUpdateJob}
            onMoveJob={onMoveJob}
            canMoveAny={canMoveAny}
            movingStatus={movingStatus}
            onFetchNonResolvedIssues={onFetchNonResolvedIssues}
          />
        </div>
      </Motion.div>

      {/* Sub-modals rendered inside the detail modal portal */}
      {/* Add Attachment Modal */}
      {showAddAttachmentModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50" onClick={(e) => { if (e.target === e.currentTarget && !uploadingAttachment) { setShowAddAttachmentModal(false); setAttachmentNameInput(''); setAttachmentFilePending(null); } }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()} onPaste={(e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            for (let i = 0; i < items.length; i++) {
              if (items[i].kind === 'file') {
                const file = items[i].getAsFile();
                if (file && file.type.startsWith('image/')) { e.preventDefault(); e.stopPropagation(); setAttachmentFilePending(file); setAttachmentNameInput(prev => prev.trim() ? prev : (file.name.replace(/\.[^/.]+$/, '') || 'pasted-image.png')); toastUtils.success('Image pasted!'); return; }
              }
            }
          }} tabIndex={-1}>
            <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between"><h2 className="text-lg font-bold text-gray-900">Add Attachment</h2><button type="button" onClick={() => { setShowAddAttachmentModal(false); setAttachmentNameInput(''); setAttachmentFilePending(null); }} disabled={uploadingAttachment} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-50"><X className="w-5 h-5" /></button></div>
            <div className="p-6 space-y-4">
              <div><label className="block text-sm font-semibold text-gray-700 mb-1.5">Name</label><input ref={attachmentNameInputRef} type="text" value={attachmentNameInput} onChange={(e) => setAttachmentNameInput(e.target.value)} placeholder="e.g. Resume Draft v1" className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary text-sm" /></div>
              <div><label className="block text-sm font-semibold text-gray-700 mb-1.5">File</label><label className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 rounded-lg hover:border-gray-300 cursor-pointer text-sm font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 transition-colors"><Paperclip className="w-4 h-4" />{attachmentFilePending ? attachmentFilePending.name : 'Choose file or paste image (Ctrl+V)'}<input type="file" className="hidden" onChange={(e) => { const file = e?.target?.files?.[0]; if (file) { setAttachmentFilePending(file); if (!attachmentNameInput.trim()) setAttachmentNameInput(file.name.replace(/\.[^/.]+$/, '')); } e.target.value = ''; }} /></label><p className="text-xs text-gray-500 mt-1">Paste an image from clipboard with Ctrl+V</p></div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-3">
              <button type="button" onClick={() => { setShowAddAttachmentModal(false); setAttachmentNameInput(''); setAttachmentFilePending(null); }} disabled={uploadingAttachment} className="px-4 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-50">Cancel</button>
              <button type="button" onClick={handleUploadAttachment} disabled={!attachmentFilePending || uploadingAttachment} className="px-4 py-2 text-sm font-semibold text-white bg-primary rounded-lg hover:bg-[#c94a28] disabled:opacity-50 flex items-center gap-2">{uploadingAttachment ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Upload</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Attachment Modal */}
      {editingAttachmentIndex != null && selectedJob.attachments?.[editingAttachmentIndex] && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50" onClick={() => !savingAttachmentEdit && (setEditingAttachmentIndex(null), setEditingAttachmentName(''), setAttachmentReplaceFilePending(null))}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between"><h3 className="text-lg font-semibold text-gray-900">Edit attachment</h3><button type="button" onClick={() => { setEditingAttachmentIndex(null); setEditingAttachmentName(''); setAttachmentReplaceFilePending(null); }} disabled={savingAttachmentEdit} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg disabled:opacity-50"><X className="w-5 h-5" /></button></div>
            <div className="p-5 space-y-4">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Name</label><input type="text" value={editingAttachmentName} onChange={(e) => setEditingAttachmentName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary" placeholder="e.g. Resume" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">File</label><a href={selectedJob.attachments[editingAttachmentIndex].url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-primary hover:underline"><FileText className="w-4 h-4" /> Open current file</a></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Replace file (optional)</label><div className="flex items-center gap-2"><input type="file" className="hidden" id="attachment-replace-input" onChange={(e) => setAttachmentReplaceFilePending(e.target.files?.[0] || null)} /><label htmlFor="attachment-replace-input" className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 bg-gray-50 hover:bg-gray-100 cursor-pointer truncate">{attachmentReplaceFilePending ? attachmentReplaceFilePending.name : 'Choose new file…'}</label>{attachmentReplaceFilePending && <button type="button" onClick={() => setAttachmentReplaceFilePending(null)} className="text-sm text-gray-500 hover:text-red-600">Clear</button>}</div></div>
            </div>
            <div className="px-5 py-4 border-t border-gray-200 flex justify-end gap-2">
              <button type="button" onClick={() => { setEditingAttachmentIndex(null); setEditingAttachmentName(''); setAttachmentReplaceFilePending(null); }} disabled={savingAttachmentEdit} className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50">Cancel</button>
              <button type="button" onClick={saveAttachmentEdit} disabled={savingAttachmentEdit} className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-2">{savingAttachmentEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Client Details Modal — only close via Cancel or X, not backdrop */}
      {showEditClientNumberModal && editingClientNumberEmail && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50" role="dialog" aria-modal="true" aria-labelledby="edit-client-details-title">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
            <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between"><h2 id="edit-client-details-title" className="text-lg font-bold text-gray-900">Edit Client Details</h2><button type="button" onClick={() => { setShowEditClientNumberModal(false); setEditingClientNumberEmail(null); setEditingClientNumberValue(''); setEditingClientNameJobId(null); setEditingClientNameValue(''); }} disabled={savingClientNumber || savingClientName} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 disabled:opacity-50"><X className="w-5 h-5" /></button></div>
            <div className="p-6 space-y-4">
              <div><label className="block text-sm font-semibold text-gray-700 mb-1.5">Client Name</label><input type="text" value={editingClientNameValue} onChange={(e) => setEditingClientNameValue(e.target.value)} placeholder="Client name" className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary text-sm" autoFocus /></div>
              <div><label className="block text-sm font-semibold text-gray-700 mb-1.5">Client Number</label><input type="number" min={1} value={editingClientNumberValue} onChange={(e) => setEditingClientNumberValue(e.target.value)} placeholder="e.g. 5810" className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary text-sm" /><p className="text-xs text-gray-500 mt-1">Leave empty to clear the number</p></div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-3">
              <button type="button" onClick={() => { setShowEditClientNumberModal(false); setEditingClientNumberEmail(null); setEditingClientNumberValue(''); setEditingClientNameJobId(null); setEditingClientNameValue(''); }} disabled={savingClientNumber || savingClientName} className="px-4 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-50">Cancel</button>
              <button type="button" onClick={async () => { if (editingClientNameJobId && editingClientNameValue.trim()) await saveClientName(editingClientNameJobId, editingClientNameValue); await handleSaveClientNumber(editingClientNumberEmail, editingClientNumberValue); setShowEditClientNumberModal(false); setEditingClientNameJobId(null); setEditingClientNameValue(''); }} disabled={savingClientNumber || savingClientName} className="px-4 py-2 text-sm font-semibold text-white bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">{(savingClientNumber || savingClientName) ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Operations Intern Modal */}
      {showAddOperatorModal && selectedJob?.clientEmail && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50" onClick={() => !addingOperatorToClient && setShowAddOperatorModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between"><h3 className="text-lg font-semibold text-gray-900">Add operations intern to client</h3><button type="button" onClick={() => !addingOperatorToClient && setShowAddOperatorModal(false)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg"><X className="w-5 h-5" /></button></div>
            <div className="p-5">
              {(() => {
                const assignedEmails = new Set(operationsForClient.map(o => (o.email || '').toLowerCase()));
                const available = (roles?.operationsInterns || []).filter(o => !assignedEmails.has((o.email || '').toLowerCase()));
                if (available.length === 0) return <p className="text-sm text-gray-500">All operations interns are already assigned.</p>;
                return (<div className="space-y-2 max-h-64 overflow-y-auto">{available.map((op) => (<div key={(op.email || '').toLowerCase()} className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg border border-gray-100 hover:bg-gray-50"><div className="min-w-0 flex-1"><p className="text-sm font-medium text-gray-900 truncate">{op.name || op.email}</p><p className="text-xs text-gray-500 truncate">{op.email}</p></div><button type="button" onClick={() => handleAddOperatorToClient(op.email)} disabled={addingOperatorToClient} className="shrink-0 px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50">{addingOperatorToClient ? 'Adding…' : 'Add'}</button></div>))}</div>);
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Add Managed User Modal */}
      {showAddManagedUserModal && selectedJob?.operatorEmail && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50" onClick={() => !addingClientToOperator && setShowAddManagedUserModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between"><h3 className="text-lg font-semibold text-gray-900">Add user to operator</h3><button type="button" onClick={() => !addingClientToOperator && setShowAddManagedUserModal(false)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg"><X className="w-5 h-5" /></button></div>
            <div className="p-5">
              {loadingAvailableClientsForOperator ? (<p className="text-sm text-gray-500">Loading...</p>) : availableClientsForOperator.length === 0 ? (<p className="text-sm text-gray-500">No additional clients available.</p>) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">{availableClientsForOperator.map((client) => (<div key={client._id || client.email} className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg border border-gray-100 hover:bg-gray-50"><div className="min-w-0 flex-1"><p className="text-sm font-medium text-gray-900 truncate">{client.name || client.email}</p><p className="text-xs text-gray-500 truncate">{client.email}</p></div><button type="button" onClick={() => handleAssignClientToOperator(client.email)} disabled={addingClientToOperator} className="shrink-0 px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50">{addingClientToOperator ? 'Adding…' : 'Add'}</button></div>))}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </Motion.div>
  );
});

JobDetailModal.displayName = 'JobDetailModal';
export default JobDetailModal;
