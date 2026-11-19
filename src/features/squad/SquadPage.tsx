// P01 小队工作区：成员列表、资料完整度、添加/编辑/删除、邀请与导入回调。
import { useMemo, useState } from 'react';
import { Plus, Trash2, Send, ArrowRight, MapPin, CalendarDays, Waves, Landmark, Building2, Mountain } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, Dialog, Drawer, ErrorNotice, PageHeader, Avatar, StatusChip, ActionMenu } from '../../components/ui';
import type { Id, WorkspaceProps } from '../../contracts/services';
import { getMemberProfileStatus, getMissingProfileFields } from '../../domain/planning';
import { formatMoney } from '../../domain/money';
import { addDays } from '../../domain/dates';
import { MemberEditor, draftFromMember, validateDraft, draftToMemberInput, findBlockingExpenses, type MemberDraft } from './MemberEditor';
import styles from './squad.module.css';
const travelKit = new URL('../../assets/illustrations/travel-kit.webp', import.meta.url).href;
const travelKitMobile = new URL('../../assets/illustrations/travel-kit-mobile.webp', import.meta.url).href;
const preferenceIcons: Record<string, typeof Waves> = { '海边': Waves, '人文': Landmark, '城市': Building2, '自然': Mountain };

interface EditorState {
  memberId: Id | null; // null = 新增
  draft: MemberDraft;
  initialFocusSelector?: string;
}

export function SquadPage({ trip, execute, services, openInvite, openImport }: WorkspaceProps) {
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [removingId, setRemovingId] = useState<Id | null>(null);
  const [submitError, setSubmitError] = useState('');
  const [busy, setBusy] = useState(false);

  const completeCount = useMemo(
    () => trip.members.filter((m) => getMemberProfileStatus(m) === 'complete').length,
    [trip.members],
  );

  const commonDates = useMemo(() => completeCount > 0 && completeCount === trip.members.length
    ? services.planning.findCommonDepartures(trip.members, trip.searchWindow, trip.duration) : [],
    [completeCount, trip.members, trip.searchWindow, trip.duration, services.planning]);
  const commonStart = commonDates[0];
  const commonEnd = commonStart ? addDays(commonStart, trip.duration - 1) : null;

  const openAdd = () => {
    setErrors({}); setSubmitError('');
    setEditor({ memberId: null, draft: draftFromMember() });
  };
  const openEdit = (memberId: Id, focusMissing = false) => {
    const member = trip.members.find((m) => m.id === memberId);
    if (!member) return;
    setErrors({}); setSubmitError('');
    const missing = !member.name ? 'name' : !member.originCity ? 'originCity' : member.budgetCap === null ? 'budgetCap' : 'availability';
    setEditor({ memberId, draft: draftFromMember(member), initialFocusSelector: focusMissing ? '[data-profile-field="' + missing + '"]' : undefined });
  };

  const save = async () => {
    if (!editor) return;
    const { errors: nextErrors, budgetCap } = validateDraft(editor.draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || budgetCap === undefined) return;
    const input = draftToMemberInput(editor.draft, budgetCap);
    setBusy(true); setSubmitError('');
    const payload = editor.memberId === null
      ? { type: 'member.add' as const, member: { id: crypto.randomUUID(), ...input } }
      : { type: 'member.update' as const, memberId: editor.memberId, changes: input };
    const result = await execute(payload);
    setBusy(false);
    if (!result.ok) {
      setSubmitError(result.error.message);
      return;
    }
    setEditor(null);
  };

  const remove = async () => {
    if (!removingId) return;
    setBusy(true); setSubmitError('');
    const result = await execute({ type: 'member.remove', memberId: removingId });
    setBusy(false);
    if (!result.ok) {
      setSubmitError(result.error.message);
      return;
    }
    setRemovingId(null);
  };

  const blocked = removingId ? findBlockingExpenses(trip, removingId) : [];
  const removingMember = trip.members.find((m) => m.id === removingId);

  return (
    <div className={styles.squadPage}>
      <PageHeader title="小队" subtitle={trip.members.length + ' 人 · ' + completeCount + '/' + trip.members.length + ' 资料齐全'} actions={<>
        <Button variant="ghost" onClick={openImport}>导入反馈</Button>
        <Button className="mobile-primary" onClick={openAdd} disabled={trip.members.length >= 20} aria-label="添加成员"><Plus size={20}/>添加成员</Button>
      </>}/>
      {submitError && !editor && !removingId ? <ErrorNotice>{submitError}</ErrorNotice> : null}
      {trip.members.length >= 20 ? <p className={styles.formHint}>已达 20 人上限</p> : null}
      <div className={styles.rosterLayout}>
        <section className={styles.cardList} aria-label="小队成员">
          {trip.members.length === 0 ? <div className="empty-state"><h2>还没有成员</h2><Button variant="ghost" onClick={openImport}>导入文件</Button></div> : trip.members.map((member, index) => {
            const missing = getMissingProfileFields(member);
            const range = member.availability[0];
            return <article className={styles.memberCard} key={member.id}>
              <div className={styles.memberCardHead}>
                <button className={styles.memberIdentity} onClick={() => openEdit(member.id)} aria-label={'编辑 ' + member.name}><Avatar name={member.name} index={index}/><strong>{member.name}</strong></button>
                <ActionMenu label={'成员操作 ' + member.name}>
                  <Button variant="ghost" onClick={() => openInvite(member.id)} aria-label={'邀请 ' + member.name + ' 填写'}><Send size={18}/>邀请填写</Button>
                  <Button variant="ghost" aria-label={'删除 ' + member.name} onClick={() => { setSubmitError(''); setRemovingId(member.id); }}><Trash2 size={18}/>删除成员</Button>
                </ActionMenu>
              </div>
              <div className={styles.budget}><strong>{member.budgetCap === null ? '待补充' : formatMoney(member.budgetCap).replace(/\.00$/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</strong><span>预算上限</span></div>
              <div className={styles.memberCardFields}>
                <span><MapPin size={18} aria-hidden="true"/>{member.originCity ?? '待补出发地'}</span>
                <span title={member.availability.map(item => item.start + ' — ' + item.end).join('、')}><CalendarDays size={18} aria-hidden="true"/>{range ? range.start.slice(5).replace('-', '.') + ' — ' + range.end.slice(5).replace('-', '.') : '待补日期'}{member.availability.length > 1 ? ' +' + (member.availability.length - 1) + '段' : ''}</span>
              </div>
              <div className={styles.tags}>{member.preferences.slice(0, 2).map(tag => { const Icon = preferenceIcons[tag] ?? Mountain; return <span key={tag} data-preference={tag}><Icon size={17} aria-hidden="true"/>{tag}</span>; })}</div>
              {missing.length > 0 ? <button className={styles.missing} onClick={() => openEdit(member.id, true)}><StatusChip tone="warning">待补 {missing.join('、')}</StatusChip></button> : null}
            </article>;
          })}
        </section>
        <aside className={styles.aside}>
          <picture className={styles.travelArt} data-asset-id="asset-travel-kit"><source media="(max-width: 767px)" srcSet={travelKitMobile}/><img src={travelKit} width={480} height={560} alt="" loading="lazy" decoding="async" fetchPriority="high"/></picture>
          <div className={styles.dateSummary}><h2>共同日期</h2><strong>{commonStart && commonEnd ? commonStart.slice(5).replace('-', '.') + ' — ' + commonEnd.slice(5).replace('-', '.') : completeCount < trip.members.length ? '待补资料' : '暂无共同日期'}</strong><Link className="next-step" to={'/trip/' + trip.id + '/plans'}>查看方案<ArrowRight size={20}/></Link></div>
        </aside>
      </div>
      <Drawer initialFocusSelector={editor?.initialFocusSelector} open={editor !== null} title={editor?.memberId ? '编辑成员' : '添加成员'} onClose={() => setEditor(null)}
        footer={<>
          <Button variant="secondary" onClick={() => setEditor(null)}>取消</Button>
          <Button onClick={save} disabled={busy}>{busy ? '保存中…' : '保存成员'}</Button>
        </>}>
        {editor ? (
          <>
            {submitError ? <ErrorNotice>{submitError}</ErrorNotice> : null}
            {editor.memberId && <p className={styles.formHint}>修改后可能需要重新确认方案。</p>}
            <MemberEditor draft={editor.draft} errors={errors}
              onChange={(draft) => { setEditor({ ...editor, draft }); setErrors({}); }} />
          </>
        ) : null}
      </Drawer>

      <Dialog open={removingId !== null} title="删除成员" onClose={() => setRemovingId(null)}
        footer={<>
          <Button variant="secondary" onClick={() => setRemovingId(null)}>取消</Button>
          <Button variant="danger" onClick={remove} disabled={busy || blocked.length > 0}>{busy ? '删除中…' : '确认删除'}</Button>
        </>}>
        {blocked.length > 0 ? (
          <div className={styles.blockedList}>
            <p>{removingMember?.name} 已被以下费用记录引用，不能删除：</p>
            <ul>{blocked.map((item) => <li key={item.id}>{item.title}</li>)}</ul>
            <p>请先到账本处理相关费用。</p>
          </div>
        ) : (
          <p>确认删除「{removingMember?.name}」？此操作会使现有方案的确认与意向失效。</p>
        )}
      </Dialog>
    </div>
  );
}
