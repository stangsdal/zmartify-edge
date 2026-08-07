import { useEffect, useState } from 'react';
import { IonButton, IonContent, IonInput, IonItem, IonLabel, IonLoading, IonPage, IonSelect, IonSelectOption } from '@ionic/react';
import { AppHeader } from '../components/AppHeader';
import { useAccess } from '../auth/AccessContext';
import { SiteInvitation, SiteMembership, SiteMembershipCandidate, siteMembersApi } from '../api/siteMembers';

const productTypes = ['hvac', 'irrigation', 'weather', 'energy'];

export function SiteMembersPage() {
  const { context, isAdministrator, selectedSiteId, selectSite } = useAccess();
  const manageableSites = (context?.sites || []).filter((site) => isAdministrator || site.role === 'owner');
  const siteId = manageableSites.some((site) => site.id === selectedSiteId) ? selectedSiteId : manageableSites[0]?.id ?? null;
  const [members, setMembers] = useState<SiteMembership[]>([]);
  const [candidates, setCandidates] = useState<SiteMembershipCandidate[]>([]);
  const [invitations, setInvitations] = useState<SiteInvitation[]>([]);
  const [candidateId, setCandidateId] = useState<number | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [newRole, setNewRole] = useState('user');
  const [newProducts, setNewProducts] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async (selectedSiteId: number) => {
    try {
      setLoading(true);
      const [memberRows, candidateRows, invitationRows] = await Promise.all([
        siteMembersApi.list(selectedSiteId),
        siteMembersApi.candidates(selectedSiteId),
        siteMembersApi.invitations(selectedSiteId),
      ]);
      setMembers(memberRows);
      setCandidates(candidateRows);
      setInvitations(invitationRows);
      setCandidateId(candidateRows[0]?.id ?? null);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (siteId !== null && siteId !== selectedSiteId) {
      selectSite(siteId);
    }
  }, [selectedSiteId, siteId, selectSite]);

  useEffect(() => {
    if (siteId !== null) {
      void load(siteId);
    }
  }, [siteId]);

  const refresh = async () => {
    if (siteId !== null) {
      await load(siteId);
    }
  };

  const addMember = async () => {
    if (siteId === null || candidateId === null) {
      return;
    }
    try {
      setLoading(true);
      await siteMembersApi.create(siteId, { user_id: candidateId, role: newRole, product_types: newProducts });
      setNewRole('user');
      setNewProducts([]);
      await refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setLoading(false);
    }
  };

  const inviteMember = async () => {
    if (siteId === null || !inviteEmail.trim()) {
      return;
    }
    try {
      setLoading(true);
      await siteMembersApi.invite(siteId, { email: inviteEmail.trim(), role: newRole, product_types: newProducts });
      setInviteEmail('');
      setNewRole('user');
      setNewProducts([]);
      await refresh();
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : String(inviteError));
    } finally {
      setLoading(false);
    }
  };

  const updateMember = async (member: SiteMembership, patch: { role?: string; status?: string; product_types?: string[] }) => {
    if (siteId === null) {
      return;
    }
    try {
      setLoading(true);
      await siteMembersApi.update(siteId, member.id, patch);
      await refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setLoading(false);
    }
  };

  const removeMember = async (member: SiteMembership) => {
    if (siteId === null || !window.confirm(`Remove ${member.display_name || member.username} from this site?`)) {
      return;
    }
    try {
      setLoading(true);
      await siteMembersApi.delete(siteId, member.id);
      await refresh();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : String(removeError));
    } finally {
      setLoading(false);
    }
  };

  return (
    <IonPage>
      <AppHeader title="Site Members" subtitle="Access roles and installed product access" />
      <IonContent className="ion-padding">
        <IonLoading isOpen={loading} message="Updating members..." />
        <div className="space-y-4 pb-20 lg:pb-8">
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          {manageableSites.length === 0 ? <p className="text-sm text-muted">You do not manage any sites.</p> : null}
          {manageableSites.length > 0 ? (
            <>
              <IonItem>
                <IonLabel position="stacked">Site</IonLabel>
                <IonSelect value={siteId} interface="popover" onIonChange={(event) => selectSite(Number(event.detail.value))}>
                  {manageableSites.map((site) => <IonSelectOption key={site.id} value={site.id}>{site.name}</IonSelectOption>)}
                </IonSelect>
              </IonItem>

              <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
                <h2 className="text-lg font-semibold">Invite person</h2>
                <IonItem>
                  <IonLabel position="stacked">Email</IonLabel>
                  <IonInput value={inviteEmail} type="email" placeholder="name@example.com" onIonChange={(event) => setInviteEmail(event.detail.value || '')} />
                </IonItem>
                <IonItem>
                  <IonLabel position="stacked">Site role</IonLabel>
                  <IonSelect value={newRole} interface="popover" onIonChange={(event) => setNewRole(String(event.detail.value))}>
                    <IonSelectOption value="owner">Owner</IonSelectOption>
                    <IonSelectOption value="user">User</IonSelectOption>
                    <IonSelectOption value="viewer">Viewer</IonSelectOption>
                  </IonSelect>
                </IonItem>
                <IonItem>
                  <IonLabel position="stacked">System access</IonLabel>
                  <IonSelect value={newProducts} multiple interface="popover" onIonChange={(event) => setNewProducts((event.detail.value as string[]) || [])}>
                    {productTypes.map((product) => <IonSelectOption key={product} value={product}>{product}</IonSelectOption>)}
                  </IonSelect>
                </IonItem>
                <IonButton className="ion-margin-top" onClick={() => void inviteMember()} disabled={!inviteEmail.trim()}>Send invitation</IonButton>
              </section>

              {candidates.length > 0 ? (
                <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
                  <h2 className="text-lg font-semibold">Add member</h2>
                  <IonItem>
                    <IonLabel position="stacked">Account</IonLabel>
                    <IonSelect value={candidateId} interface="popover" onIonChange={(event) => setCandidateId(Number(event.detail.value))}>
                      {candidates.map((candidate) => <IonSelectOption key={candidate.id} value={candidate.id}>{candidate.display_name || candidate.username}</IonSelectOption>)}
                    </IonSelect>
                  </IonItem>
                  <IonItem>
                    <IonLabel position="stacked">Site role</IonLabel>
                    <IonSelect value={newRole} interface="popover" onIonChange={(event) => setNewRole(String(event.detail.value))}>
                      <IonSelectOption value="owner">Owner</IonSelectOption>
                      <IonSelectOption value="user">User</IonSelectOption>
                      <IonSelectOption value="viewer">Viewer</IonSelectOption>
                    </IonSelect>
                  </IonItem>
                  <IonItem>
                    <IonLabel position="stacked">Product access</IonLabel>
                    <IonSelect value={newProducts} multiple interface="popover" onIonChange={(event) => setNewProducts((event.detail.value as string[]) || [])}>
                      {productTypes.map((product) => <IonSelectOption key={product} value={product}>{product}</IonSelectOption>)}
                    </IonSelect>
                  </IonItem>
                  <IonButton className="ion-margin-top" onClick={() => void addMember()}>Add member</IonButton>
                </section>
              ) : <p className="text-sm text-muted">All enabled accounts are already members of this site.</p>}

              <section className="space-y-3">
                {members.map((member) => (
                  <article key={member.id} className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
                    <p className="font-semibold">{member.display_name || member.username}</p>
                    <p className="text-sm text-muted">{member.username}{member.email ? ` - ${member.email}` : ''}</p>
                    <IonItem>
                      <IonLabel position="stacked">Role</IonLabel>
                      <IonSelect value={member.role} interface="popover" onIonChange={(event) => void updateMember(member, { role: String(event.detail.value) })}>
                        <IonSelectOption value="owner">Owner</IonSelectOption>
                        <IonSelectOption value="user">User</IonSelectOption>
                        <IonSelectOption value="viewer">Viewer</IonSelectOption>
                      </IonSelect>
                    </IonItem>
                    <IonItem>
                      <IonLabel position="stacked">Status</IonLabel>
                      <IonSelect value={member.status} interface="popover" onIonChange={(event) => void updateMember(member, { status: String(event.detail.value) })}>
                        <IonSelectOption value="active">Active</IonSelectOption>
                        <IonSelectOption value="disabled">Disabled</IonSelectOption>
                      </IonSelect>
                    </IonItem>
                    <IonItem>
                      <IonLabel position="stacked">Product access</IonLabel>
                      <IonSelect value={member.product_types} multiple interface="popover" onIonChange={(event) => void updateMember(member, { product_types: (event.detail.value as string[]) || [] })}>
                        {productTypes.map((product) => <IonSelectOption key={product} value={product}>{product}</IonSelectOption>)}
                      </IonSelect>
                    </IonItem>
                    <IonButton color="danger" fill="outline" size="small" className="ion-margin-top" onClick={() => void removeMember(member)}>Remove</IonButton>
                  </article>
                ))}
              </section>

              {invitations.length > 0 ? (
                <section className="space-y-3">
                  <h2 className="text-lg font-semibold">Invitations</h2>
                  {invitations.map((invitation) => (
                    <article key={invitation.id} className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
                      <p className="font-semibold">{invitation.email}</p>
                      <p className="text-sm text-muted">{invitation.role} - {invitation.product_types.length ? invitation.product_types.join(', ') : 'All systems'}</p>
                      <p className="text-sm text-muted">{invitation.accepted_at ? 'Accepted' : `Expires ${new Date(invitation.expires_at).toLocaleString()}`}</p>
                    </article>
                  ))}
                </section>
              ) : null}
            </>
          ) : null}
        </div>
      </IonContent>
    </IonPage>
  );
}