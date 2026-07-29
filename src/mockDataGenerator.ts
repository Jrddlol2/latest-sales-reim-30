import { 
  User, Claim, ExpenseLineItem, MOM, StatusHistory, UserRole, ClaimStatus, 
  Company, FieldDefinition, ApproverDelegation, DelegationStatus, ReviewMeeting, 
  ReviewMeetingStatus, MasterData, SupportRequest, SupportRequestStatus, ImportBatch, 
  Notification, MinutesSource 
} from './types';

export const generateMockData = () => {
  const users: User[] = [
    {
      id: 'u-requestor',
      name: 'Alex Johnson',
      email: 'alex.j@example.com',
      role: UserRole.REQUESTOR,
      department: 'Sales',
      jobTitle: 'Sales Rep',
      reportsTo: 'u-approver',
      employmentStatus: 'Active',
      canApproveReimbursements: false,
      avatarUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBuyqwquFMp2dRflEQoPdfAdyvzuYIZBnuuz91ZiBQDfag_xJihUgGyzwnlu0v1ZFJ9B3iCvvHk0eViyLw8GVlKZDysfYyoyNk2U4PZv6UTGDhHmGAGukHYje6gsvQ_vhMl-Pu2ha5c2pDLv7eWC0dn8J_JSYLSMDgGvuXL3x7umpXYnGBbT9j08dGSjH30TU5xDnRTIBUNcBZV23tlsuhg6Btlt9YiPH7hWtjNW76ApjtjPVsknjwNvOtucVvIalUd5Kp5OH9YVv0'
    },
    {
      id: 'u-approver',
      name: 'Sarah Mitchell',
      email: 'sarah.m@example.com',
      role: UserRole.APPROVER,
      department: 'Sales',
      jobTitle: 'Financial Director',
      employmentStatus: 'Active',
      canApproveReimbursements: true,
      avatarUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBE_JQKvS5ELnZXgrzjMftQiDrARGomPGIoc5R6VuOCtS6XEEv7ZlKHBQJMxzROZ2b9Xar8uY4OSTcFyEv6BzTo75kBNdbt_JxjXty29cKTlL6xE-K6eVzehHx8EkSm1-T5hg4aY-MZLtHmNUmuwfTRpOQcZTrZGNuu2SVonI8C3aarUK7cGVkvlydEsfdiDUpq-tTHoKmiuilWEbcvXbtpfSKsfBdr7jOX83gTTGFZDEr9dbWl0vEeyTTNGv9mZcH7b5RAJu1-lC0'
    },
    {
      id: 'u-custodian',
      name: 'John Doe',
      email: 'john.d@example.com',
      role: UserRole.CUSTODIAN,
      department: 'Finance',
      jobTitle: 'Custodian',
      employmentStatus: 'Active',
      canApproveReimbursements: false,
    },
    {
      id: 'u-admin',
      name: 'Admin User',
      email: 'admin@example.com',
      role: UserRole.ADMIN,
      department: 'IT',
      jobTitle: 'System Admin',
      employmentStatus: 'Active',
      canApproveReimbursements: false,
    },
    {
      id: 'u-analyst',
      name: 'Alex Sterling',
      email: 'alex.s@example.com',
      role: UserRole.APPROVER,
      department: 'Finance Audit',
      jobTitle: 'Senior Analyst',
      employmentStatus: 'Active',
      canApproveReimbursements: true,
      avatarUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBDJ0M43k2D80FFOCf3s2OAC2vOt-Ztx8uwfI4gy84GQQbMBr5UODRpRQ9gnFCRB_eoqn7Bgl2DtTDNj7SmS-K3CMRaMz5bqQ95O9OwInvS0-EzAsa-ISnaZj1Qj2s6HIfSxNr6VAYGlBBhMs5cQXSh60bffoKS9e1gMyrrpQNf04mJEDPRddaf5qKEBWGn_PpWJBblPuySPyI2vrnHArFqJFEesvJ0PR1r2E5cQiyuQ4p4JSKHO1niVkDuISFL45qKE44D-m4HKrY'
    }
  ];

  const companies: Company[] = [
    { id: 'comp-1', name: 'Acme Global Industries', industry: 'Manufacturing' },
    { id: 'comp-2', name: 'TechCorp Solutions', industry: 'Technology' },
    { id: 'comp-3', name: 'Stark Industries', industry: 'Defense' }
  ];

  const fieldDefinitions: FieldDefinition[] = [
    { id: 'fd-claim-1', entity: 'claim', key: 'clientReference', label: 'Client Reference (Optional)', input_type: 'text', required: false, active: true, display_order: 1 },
    { id: 'fd-claim-3', entity: 'claim', key: 'advanceJustification', label: 'Advance Justification', input_type: 'textarea', required: true, active: true, display_order: 3, applicableClaimTypes: ['Cash Advance'] },
    { id: 'fd-claim-2', entity: 'claim', key: 'costCenter', label: 'Cost Center', input_type: 'dropdown', required: true, active: true, display_order: 2, master_data_entity: 'costCenter' },
    { id: 'fd-1', entity: 'mom', key: 'typeOfAccount', label: 'Type of Account', input_type: 'dropdown', required: true, active: true, display_order: 1, options: ['Corporate', 'Enterprise', 'VIP', 'SMB'] },
    { id: 'fd-2', entity: 'mom', key: 'companyName', label: 'Company Name', input_type: 'dropdown', required: true, active: true, display_order: 2, master_data_entity: 'company' },
    { id: 'fd-3', entity: 'mom', key: 'purposeOfMeeting', label: 'Purpose of Meeting', input_type: 'text', required: true, active: true, display_order: 3 },
    { id: 'fd-4', entity: 'mom', key: 'category', label: 'Category', input_type: 'dropdown', required: true, active: true, display_order: 4, options: ['Sales & Business Development', 'Client Retention', 'Partnership', 'Marketing'] }
  ];

  const masterData: MasterData[] = [
    { id: 'md-1', type: 'department', name: 'Sales', active: true, createdAt: '2023-01-01T00:00:00Z', updatedAt: '2023-01-01T00:00:00Z' },
    { id: 'md-2', type: 'department', name: 'Finance', active: true, createdAt: '2023-01-01T00:00:00Z', updatedAt: '2023-01-01T00:00:00Z' },
    { id: 'md-3', type: 'department', name: 'IT', active: true, createdAt: '2023-01-01T00:00:00Z', updatedAt: '2023-01-01T00:00:00Z' },
  ];

  const delegations: ApproverDelegation[] = [
    {
      id: 'del-1',
      approver_id: 'u-approver',
      delegate_id: 'u-analyst',
      start_date: '2023-11-01',
      end_date: '2023-11-15',
      status: DelegationStatus.ACTIVE,
      created_by: 'u-approver',
      created_at: '2023-10-25T10:00:00Z',
      updated_at: '2023-10-25T10:00:00Z'
    }
  ];

  // Random Data Generators
  const claims: Claim[] = [];
  const lineItems: ExpenseLineItem[] = [];
  const moms: MOM[] = [];
  const statusHistory: StatusHistory[] = [];
  const reviewMeetings: ReviewMeeting[] = [];
  
  const generateRef = (type: string, idNum: number) => {
    const prefix = type === 'Reimbursement' ? 'CLM' : type === 'Cash Advance' ? 'ADV' : 'LIQ';
    return `#${prefix}-${1000 + idNum}`;
  };

  const types = ['Reimbursement', 'Cash Advance', 'Liquidation'] as const;
  const statuses = Object.values(ClaimStatus);
  const purposes = ['Client Dinner', 'Software Sub', 'Travel Conf', 'Marketing Event', 'Office Supplies', 'Team Lunch', 'Hardware upgrade'];
  
  const generateDate = (offsetDays: number) => {
    const d = new Date('2023-10-01T10:00:00Z');
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString();
  };

  let liId = 1;
  let shId = 1;
  let rmId = 1;
  let mId = 1;

  for (let i = 1; i <= 30; i++) {
    const requestorId = (i % 5 === 0) ? 'u-approver' : 'u-requestor';
    const type = types[i % 3];
    const status = statuses[i % statuses.length];
    const purpose = purposes[i % purposes.length];
    
    // Create Claim
    const claim: Claim = {
      id: `c-${i}`,
      ref: generateRef(type, i),
      requestorId,
      status,
      total: 0,
      createdAt: generateDate(i),
      submittedAt: ['Draft', 'Returned for Revision'].includes(status) ? undefined : generateDate(i + 1),
      type,
      purpose,
    };
    
    // Custodian Release if processing or ready
    if (status === ClaimStatus.PROCESSING || status === ClaimStatus.READY_FOR_CLAIM) {
      claim.releaseCode = `RC-${5000 + i}`;
    }

    // Line Items
    const numItems = (i % 4) + 1;
    let total = 0;
    for (let j = 0; j < numItems; j++) {
      const amount = 50 + (i * 10) + j * 5;
      total += amount;
      lineItems.push({
        id: `li-${liId++}`,
        claimId: claim.id,
        expenseDate: generateDate(i - j),
        vendor: ['Airline', 'Hotel', 'Uber', 'Restaurant', 'Amazon'][j % 5],
        category: ['Flight', 'Lodging', 'Transport', 'Meals', 'Supplies'][j % 5],
        amount,
        paymentMethod: 'Corporate Card',
        businessPurpose: purpose,
        receiptFileName: `receipt_${liId}.pdf`
      });
    }
    claim.total = total;
    claims.push(claim);

    // MOMs
    if (i % 3 === 0 && type === 'Reimbursement') {
      moms.push({
        id: `m-${mId++}`,
        claimId: claim.id,
        typeOfAccount: 'Corporate',
        companyName: 'Acme Global Industries',
        purposeOfMeeting: purpose,
        category: 'Sales & Business Development',
        location: 'Chicago, IL',
        contactPerson: 'Jane Doe',
        contactPersonEmail: 'jane@acme.com',
        description: 'Discussed Q3 results.'
      });
    }

    // Status History
    statusHistory.push({
      id: `sh-${shId++}`,
      claimId: claim.id,
      oldStatus: undefined,
      newStatus: ClaimStatus.DRAFT,
      changedBy: requestorId,
      timestamp: claim.createdAt
    });

    if (claim.submittedAt) {
      statusHistory.push({
        id: `sh-${shId++}`,
        claimId: claim.id,
        oldStatus: ClaimStatus.DRAFT,
        newStatus: ClaimStatus.SUBMITTED,
        changedBy: requestorId,
        timestamp: claim.submittedAt
      });
    }

    if (status === ClaimStatus.REVIEW_MEETING_SCHEDULED) {
      reviewMeetings.push({
        id: `rm-${rmId++}`,
        claimId: claim.id,
        meetingDate: claim.submittedAt!.split('T')[0],
        meetingTime: '10:00',
        approverId: 'u-approver',
        status: ReviewMeetingStatus.CONFIRMED
      });
    }
  }

  return {
    mockUsers: users,
    mockClaims: claims,
    mockLineItems: lineItems,
    mockMOMs: moms,
    mockCompanies: companies,
    mockFieldDefinitions: fieldDefinitions,
    mockDelegations: delegations,
    mockStatusHistory: statusHistory,
    mockMasterData: masterData,
    mockReviewMeetings: reviewMeetings,
    mockSupportRequests: [],
    mockImportBatches: [],
    mockNotifications: []
  };
};
