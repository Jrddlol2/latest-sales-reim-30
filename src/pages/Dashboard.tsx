import { useAppContext } from '../components/AppContext';
import { RequestorDashboard } from './requestor/RequestorDashboard';
import { ApproverDashboard } from './approver/ApproverDashboard';
import { CustodianDashboard } from './custodian/CustodianDashboard';
import { AdminDashboard } from './admin/AdminDashboard';
import { UserRole } from '../types';

export function Dashboard() {
  const { currentUser } = useAppContext();

  switch (currentUser.role) {
    case UserRole.REQUESTOR:
      return <RequestorDashboard />;
    case UserRole.APPROVER:
      return <ApproverDashboard />;
    case UserRole.CUSTODIAN:
      return <CustodianDashboard />;
    case UserRole.ADMIN:
      return <AdminDashboard />;
    default:
      return <div>Unknown Role</div>;
  }
}
