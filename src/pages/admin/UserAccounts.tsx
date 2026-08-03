import { useState, useEffect, useMemo } from 'react';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input, Select, Label } from '../../components/ui/Input';
import { Pagination } from '../../components/ui/Pagination';
import { Modal } from '../../components/shared/Modal';
import { useAppContext } from '../../components/AppContext';
import { useToast } from '../../components/shared/ToastContext';
import { updateUser, ApiError } from '../../lib/api';
import { User, UserRole } from '../../types';

export function UserAccounts() {
  const { users, currentUser, refresh } = useAppContext();
  const { addToast } = useToast();

  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<Partial<User>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortOrder, setSortOrder] = useState<'name' | 'department' | 'role'>('name');
  const [showFilters, setShowFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter(u => {
      const matchesSearch = !q || [u.name, u.email, u.department, u.jobTitle].some(v => (v || '').toLowerCase().includes(q));
      const matchesRole = !roleFilter || u.role === roleFilter;
      const matchesDepartment = !departmentFilter || u.department === departmentFilter;
      const matchesStatus = !statusFilter || u.employmentStatus === statusFilter;
      return matchesSearch && matchesRole && matchesDepartment && matchesStatus;
    }).sort((a, b) => {
      if (sortOrder === 'department') return (a.department || '').localeCompare(b.department || '') || a.name.localeCompare(b.name);
      if (sortOrder === 'role') return a.role.localeCompare(b.role) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });
  }, [users, search, roleFilter, departmentFilter, statusFilter, sortOrder]);
  const departments = useMemo(() => Array.from(new Set(users.map(user => user.department).filter(Boolean))).sort(), [users]);
  const hasFilters = Boolean(roleFilter || departmentFilter || statusFilter);

  const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
  const paginatedUsers = filteredUsers.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, roleFilter, departmentFilter, statusFilter, sortOrder]);

  const openEditor = (user: User) => {
    setEditing(user);
    setForm({
      role: user.role,
      department: user.department,
      jobTitle: user.jobTitle,
      reportsTo: user.reportsTo,
      employmentStatus: user.employmentStatus,
    });
    setError('');
  };

  // Anyone who can sit above someone in the chain. Self is excluded server-side
  // too, but filtering here keeps it out of the picker.
  const managerChoices = users.filter(u => u.id !== editing?.id);

  const save = async (confirmOrphan = false) => {
    if (!editing) return;
    setSaving(true);
    setError('');
    try {
      await updateUser(editing.id, {
        role: form.role,
        department: form.department,
        job_title: form.jobTitle,
        reports_to: form.reportsTo || null,
        employment_status: form.employmentStatus,
        confirmOrphan,
      });
      await refresh();
      addToast('User updated.', 'success');
      setEditing(null);
    } catch (err) {
      const e = err as ApiError;
      // The server returns 409 with error:'orphan_warning' when demoting an
      // approver who still has direct reports — surface it as a confirm.
      if (e.status === 409 && e.body?.error === 'orphan_warning') {
        if (window.confirm(`${e.body.message}\n\nProceed anyway?`)) {
          await save(true);
          return;
        }
        setError('Change cancelled — reassign their reports first.');
      } else {
        setError(e.message || 'Could not update the user.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <span className="font-label-sm text-primary font-bold tracking-wider uppercase">System Administration</span>
          <h1 className="font-display text-display text-on-surface mt-1">User Accounts</h1>
        </div>
      </div>

      <Card className="p-4">
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
          <div className="min-w-[240px] flex-1 max-w-xl"><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email, department, or title..." /></div>
          <Select containerClassName="w-full sm:w-40 sm:flex-none" value={roleFilter} onChange={e => setRoleFilter(e.target.value)} aria-label="Filter users by role"><option value="">All roles</option>{Object.values(UserRole).map(r => <option key={r} value={r}>{r}</option>)}</Select>
          <Button variant="outline" className="gap-2 sm:flex-none" onClick={() => setShowFilters(open => !open)}><span className="material-symbols-outlined text-[18px]">filter_list</span>Filters{departmentFilter || statusFilter ? ' (active)' : ''}</Button>
          <Select containerClassName="w-full sm:w-40 sm:flex-none" value={sortOrder} onChange={e => setSortOrder(e.target.value as typeof sortOrder)} aria-label="Sort user accounts"><option value="name">Name A–Z</option><option value="department">Department</option><option value="role">Role</option></Select>
          {(search || hasFilters || sortOrder !== 'name') && <button className="text-xs font-semibold text-primary hover:underline" onClick={() => { setSearch(''); setRoleFilter(''); setDepartmentFilter(''); setStatusFilter(''); setSortOrder('name'); }}>Clear all</button>}
        </div>
        {showFilters && <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-outline-variant pt-4">
          <div><Label>Department</Label><Select value={departmentFilter} onChange={e => setDepartmentFilter(e.target.value)}><option value="">All departments</option>{departments.map(item => <option key={item}>{item}</option>)}</Select></div>
          <div><Label>Employment Status</Label><Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="">All statuses</option><option value="Active">Active</option><option value="Inactive">Inactive</option></Select></div>
        </div>}
        {hasFilters && <div className="mt-3 flex flex-wrap gap-2">
          {roleFilter && <button onClick={() => setRoleFilter('')} className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold">{roleFilter}<span className="material-symbols-outlined text-[14px]">close</span></button>}
          {departmentFilter && <button onClick={() => setDepartmentFilter('')} className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold">{departmentFilter}<span className="material-symbols-outlined text-[14px]">close</span></button>}
          {statusFilter && <button onClick={() => setStatusFilter('')} className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary px-3 py-1 text-xs font-semibold">{statusFilter}<span className="material-symbols-outlined text-[14px]">close</span></button>}
        </div>}
      </Card>

      <Card>
        <CardHeader className="bg-surface-container-low">
          <h3 className="font-label-md uppercase tracking-wider text-on-surface">Registered Users</h3>
          <span className="font-label-sm text-outline whitespace-nowrap">{filteredUsers.length} of {users.length}</span>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low text-label-sm text-outline uppercase">
              <tr>
                <th className="px-6 py-4">Name</th>
                <th className="px-6 py-4">Email</th>
                <th className="px-6 py-4">Department</th>
                <th className="px-6 py-4">Role</th>
                <th className="px-6 py-4">Reports To</th>
                <th className="px-6 py-4 text-center">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {paginatedUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-outline">
                    <span className="material-symbols-outlined text-4xl mb-2 opacity-50">person_search</span>
                    <p className="font-label-md">No users match your search.</p>
                  </td>
                </tr>
              ) : paginatedUsers.map(user => {
                const manager = users.find(u => u.id === user.reportsTo);
                return (
                  <tr key={user.id} className="hover:bg-primary-container/5 transition-colors">
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-3">
                        {user.avatarUrl ? (
                          <img src={user.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center text-xs font-semibold">{user.name.split(' ').map(n=>n[0]).join('')}</div>
                        )}
                        <p className="text-sm font-bold">{user.name}</p>
                      </div>
                    </td>
                    <td className="px-6 py-5 text-on-surface-variant text-sm">{user.email}</td>
                    <td className="px-6 py-5 text-on-surface-variant text-sm">{user.department}</td>
                    <td className="px-6 py-5 text-sm font-bold text-primary">{user.role}</td>
                    <td className="px-6 py-5 text-on-surface-variant text-sm">{manager ? manager.name : '—'}</td>
                    <td className="px-6 py-5 text-center">
                      <span className={`px-2 py-1 rounded-full text-xs font-bold ${user.employmentStatus === 'Active' ? 'bg-green-100 text-green-800' : 'bg-surface-container-high text-on-surface-variant'}`}>
                        {user.employmentStatus}
                      </span>
                    </td>
                    <td className="px-6 py-5 text-right">
                      <Button size="sm" variant="outline" onClick={() => openEditor(user)}>Edit</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />
      </Card>

      {editing && (
        <Modal isOpen onClose={() => setEditing(null)} titleId="user-editor-title" className="max-w-lg">
            <div className="bg-surface-container-lowest rounded-xl w-full p-6 shadow-2xl space-y-4">
              <div className="flex justify-between items-center border-b border-outline-variant pb-3">
                <h3 id="user-editor-title" className="font-headline-sm text-on-surface">Edit {editing.name}</h3>
                <button aria-label="Close user editor" onClick={() => setEditing(null)} className="text-outline hover:text-on-surface">
                  <span aria-hidden="true" className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Role</Label>
                  <Select
                    value={form.role || ''}
                    onChange={e => setForm(p => ({ ...p, role: e.target.value as UserRole }))}
                    disabled={editing.id === currentUser.id}
                  >
                    {Object.values(UserRole).map(r => <option key={r} value={r}>{r}</option>)}
                  </Select>
                  {editing.id === currentUser.id && <p className="text-xs text-outline mt-1">You can't change your own role.</p>}
                </div>
                <div>
                  <Label>Employment Status</Label>
                  <Select value={form.employmentStatus || 'Active'} onChange={e => setForm(p => ({ ...p, employmentStatus: e.target.value as 'Active' | 'Inactive' }))}>
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </Select>
                </div>
                <div>
                  <Label>Department</Label>
                  <Input value={form.department || ''} onChange={e => setForm(p => ({ ...p, department: e.target.value }))} />
                </div>
                <div>
                  <Label>Job Title</Label>
                  <Input value={form.jobTitle || ''} onChange={e => setForm(p => ({ ...p, jobTitle: e.target.value }))} />
                </div>
                <div className="md:col-span-2">
                  <Label>Reports To</Label>
                  <Select value={form.reportsTo || ''} onChange={e => setForm(p => ({ ...p, reportsTo: e.target.value || undefined }))}>
                    <option value="">— No manager —</option>
                    {managerChoices.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                  </Select>
                </div>
              </div>

              {error && <p className="text-error text-sm">{error}</p>}

              <div className="flex justify-end gap-2 pt-2 border-t border-outline-variant">
                <Button variant="ghost" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
                <Button onClick={() => save()} disabled={saving} className="gap-2">
                  {saving ? <span className="material-symbols-outlined animate-spin text-[18px]">sync</span> : null}
                  Save Changes
                </Button>
              </div>
            </div>
        </Modal>
      )}
    </div>
  );
}
